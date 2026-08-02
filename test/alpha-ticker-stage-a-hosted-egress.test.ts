import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { EGRESS_PROXY_AUD, verifyCapabilityToken } from "../src/auth/capability-token.ts";

const proxyConfig = "deploy/layers/alpha-ticker-stage-a-hosted/egress-proxy.fly.toml";

test("hosted Stage A egress proxy is public, token-gated, and fixed to jnb", () => {
  const body = readFileSync(proxyConfig, "utf8");
  assert.match(body, /^app = "alpha-ticker-stage-a-egress"$/m);
  assert.match(body, /^primary_region = "jnb"$/m);
  assert.match(body, /^\s*EGRESS_TOKENLESS = "deny"$/m);
  assert.match(body, /^\s*internal_port = 48080$/m);
  assert.match(body, /^\s*port = 443$/m);
  assert.match(body, /^\s*handlers = \["tls"\]$/m);
  assert.match(body, /^\s*min_machines_running = 1$/m);
  assert.doesNotMatch(body, /EGRESS_TOKENLESS = "open"/);
});

test("the hosted egress probe never prints or accepts a token on argv", () => {
  const body = readFileSync("scripts/alpha-ticker-stage-a-hosted/probe-egress.mjs", "utf8");
  assert.match(body, /CAPABILITY_SECRET/);
  assert.match(body, /signed-unapproved-host-deny: pass/);
  assert.doesNotMatch(body, /--token|console\.log\([^)]*token|process\.stdout\.write\([^)]*token/);
});

test("the hosted egress probe sends unsigned and policy-limited CONNECT requests", async () => {
  const temp = mkdtempSync(join(tmpdir(), "qm-egress-probe-"));
  const keyPath = join(temp, "key.pem");
  const certificatePath = join(temp, "certificate.pem");
  const envPath = join(temp, "probe.env");
  const capabilitySecret = randomBytes(32).toString("base64url");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  writeFileSync(envPath, `CAPABILITY_SECRET=${capabilitySecret}\n`, { mode: 0o600 });

  const requests: Array<{ authority: string; authorization?: string }> = [];
  const server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) });
  server.on("connect", (request, socket) => {
    requests.push({
      authority: request.url ?? "",
      ...(typeof request.headers["proxy-authorization"] === "string"
        ? { authorization: request.headers["proxy-authorization"] }
        : {}),
    });
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const port = (server.address() as AddressInfo).port;
    const result = await promisify(execFile)(
      process.execPath,
      [
        "scripts/alpha-ticker-stage-a-hosted/probe-egress.mjs",
        "--proxy",
        `https://127.0.0.1:${port}`,
        "--env-file",
        envPath,
        "--host",
        "example.com",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, NODE_EXTRA_CA_CERTS: certificatePath },
      },
    );

    assert.equal(result.stdout, "unsigned-deny: pass\nsigned-unapproved-host-deny: pass\n");
    assert.equal(result.stderr, "");
    assert.equal(requests.length, 2);
    assert.deepEqual(
      requests.map(({ authority }) => authority),
      ["example.com:443", "example.com:443"],
    );
    assert.equal(requests[0]?.authorization, undefined);
    assert.ok(requests[1]?.authorization?.startsWith("Bearer "));

    const claims = await verifyCapabilityToken(requests[1]!.authorization!.slice("Bearer ".length), capabilitySecret);
    assert.equal(claims?.aud, EGRESS_PROXY_AUD);
    assert.deepEqual(claims?.egress, {
      allowedHosts: ["alpha-ticker-stage-a-hosted-portal.fly.dev"],
      deniedHosts: [],
    });
    assert.ok((claims?.exp ?? 0) > Date.now());
    assert.ok((claims?.exp ?? Infinity) <= Date.now() + 60_000);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(temp, { recursive: true, force: true });
  }
});
