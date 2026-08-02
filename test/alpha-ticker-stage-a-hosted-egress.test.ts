import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { EGRESS_PROXY_AUD, verifyCapabilityToken } from "../src/auth/capability-token.ts";

const proxyConfig = "deploy/layers/alpha-ticker-stage-a-hosted/egress-proxy.fly.toml";
const probeScript = "scripts/alpha-ticker-stage-a-hosted/probe-egress.mjs";
const execFileAsync = promisify(execFile);

function createCertificate(temp: string) {
  const keyPath = join(temp, "key.pem");
  const certificatePath = join(temp, "certificate.pem");
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
    { stdio: "ignore", timeout: 10_000 },
  );
  return { keyPath, certificatePath };
}

function runProbe(proxy: string, envPath: string, certificatePath?: string, timeout = 10_000) {
  return execFileAsync(
    process.execPath,
    ["--", probeScript, "--proxy", proxy, "--env-file", envPath, "--host", "example.com"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      ...(certificatePath ? { env: { ...process.env, NODE_EXTRA_CA_CERTS: certificatePath } } : {}),
      timeout,
    },
  );
}

async function expectGenericProbeFailure(
  proxy: string,
  envPath: string,
  sentinel: string,
  options: { certificatePath?: string; timeout?: number } = {},
) {
  let failure: (Error & { killed?: boolean; stderr?: string; stdout?: string }) | undefined;
  try {
    await runProbe(proxy, envPath, options.certificatePath, options.timeout ?? 2_500);
  } catch (error) {
    failure = error as typeof failure;
  }
  assert.ok(failure);
  assert.notEqual(failure.killed, true);
  assert.equal(failure.stdout ?? "", "");
  assert.equal(failure.stderr ?? "", "egress probe failed\n");
  assert.equal(`${failure.stdout ?? ""}${failure.stderr ?? ""}`.includes(sentinel), false);
}

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
  const body = readFileSync(probeScript, "utf8");
  assert.match(body, /CAPABILITY_SECRET/);
  assert.match(body, /O_NOFOLLOW/);
  assert.match(body, /O_NONBLOCK/);
  assert.match(body, /geteuid/);
  assert.match(body, /metadata\.size/);
  assert.match(body, /CONNECT_TIMEOUT_MS/);
  assert.match(body, /setTimeout/);
  assert.match(body, /signed-unapproved-host-deny: pass/);
  assert.doesNotMatch(body, /--token|console\.log\([^)]*token|process\.stdout\.write\([^)]*token/);
});

test("the hosted egress probe times out a silent CONNECT and closes its socket", async () => {
  const temp = mkdtempSync(join(tmpdir(), "qm-egress-timeout-"));
  const { keyPath, certificatePath } = createCertificate(temp);
  const envPath = join(temp, "probe.env");
  const sentinel = randomBytes(32).toString("base64url");
  writeFileSync(envPath, `CAPABILITY_SECRET=${sentinel}\n`, { mode: 0o600 });

  let connected = false;
  let resolveSocketClosed!: () => void;
  const socketClosed = new Promise<void>((resolve) => {
    resolveSocketClosed = resolve;
  });
  const server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) });
  server.on("connect", (_request, socket) => {
    connected = true;
    socket.once("close", resolveSocketClosed);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const port = (server.address() as AddressInfo).port;
    const startedAt = Date.now();
    await expectGenericProbeFailure(`https://127.0.0.1:${port}`, envPath, sentinel, {
      certificatePath,
      timeout: 8_000,
    });
    await socketClosed;
    assert.equal(connected, true);
    assert.ok(Date.now() - startedAt < 7_500);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(temp, { recursive: true, force: true });
  }
});

test("the hosted egress probe rejects unsafe env-file inputs without connecting", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "qm-egress-env-"));
  const sentinel = randomBytes(32).toString("base64url");
  let connections = 0;
  const server = createTcpServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxy = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await t.test("wrong mode", async () => {
      const path = join(temp, "wrong-mode.env");
      writeFileSync(path, `CAPABILITY_SECRET=${sentinel}\n`, { mode: 0o600 });
      chmodSync(path, 0o640);
      await expectGenericProbeFailure(proxy, path, sentinel);
    });

    await t.test("symlink", { skip: process.platform === "win32" }, async () => {
      const target = join(temp, "symlink-target.env");
      const path = join(temp, "symlink.env");
      writeFileSync(target, `CAPABILITY_SECRET=${sentinel}\n`, { mode: 0o600 });
      symlinkSync(target, path);
      await expectGenericProbeFailure(proxy, path, sentinel);
    });

    await t.test("FIFO", { skip: process.platform === "win32" }, async () => {
      const path = join(temp, "probe.fifo");
      execFileSync("mkfifo", [path], { timeout: 10_000 });
      chmodSync(path, 0o600);
      await expectGenericProbeFailure(proxy, path, sentinel);
    });

    await t.test("oversized file", async () => {
      const path = join(temp, "oversized.env");
      writeFileSync(path, `CAPABILITY_SECRET=${sentinel}\nPADDING=${"x".repeat(128 * 1024)}\n`, { mode: 0o600 });
      await expectGenericProbeFailure(proxy, path, sentinel);
    });

    assert.equal(connections, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(temp, { recursive: true, force: true });
  }
});

test("the hosted egress probe proves an authenticated canary before both denials", async () => {
  const temp = mkdtempSync(join(tmpdir(), "qm-egress-probe-"));
  const { keyPath, certificatePath } = createCertificate(temp);
  const envPath = join(temp, "probe.env");
  const capabilitySecret = randomBytes(32).toString("base64url");
  writeFileSync(envPath, `CAPABILITY_SECRET=${capabilitySecret}\n`, { mode: 0o600 });

  const requests: Array<{ authority: string; authorization?: string }> = [];
  let positiveTunnelBytes = 0;
  let resolvePositiveTunnelClosed!: () => void;
  const positiveTunnelClosed = new Promise<void>((resolve) => {
    resolvePositiveTunnelClosed = resolve;
  });
  const server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) });
  server.on("connect", (request, socket) => {
    requests.push({
      authority: request.url ?? "",
      ...(typeof request.headers["proxy-authorization"] === "string"
        ? { authorization: request.headers["proxy-authorization"] }
        : {}),
    });
    if (requests.length === 1) {
      socket.on("data", (chunk) => {
        positiveTunnelBytes += chunk.length;
      });
      socket.once("close", resolvePositiveTunnelClosed);
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    } else {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const port = (server.address() as AddressInfo).port;
    const result = await runProbe(`https://127.0.0.1:${port}`, envPath, certificatePath);

    await positiveTunnelClosed;
    assert.equal(result.stdout, "unsigned-deny: pass\nsigned-unapproved-host-deny: pass\n");
    assert.equal(result.stderr, "");
    assert.equal(positiveTunnelBytes, 0);
    assert.equal(requests.length, 3);
    assert.deepEqual(
      requests.map(({ authority }) => authority),
      ["example.com:443", "example.com:443", "example.com:443"],
    );
    assert.ok(requests[0]?.authorization?.startsWith("Bearer "));
    assert.equal(requests[1]?.authorization, undefined);
    assert.ok(requests[2]?.authorization?.startsWith("Bearer "));

    const positiveClaims = await verifyCapabilityToken(
      requests[0]!.authorization!.slice("Bearer ".length),
      capabilitySecret,
    );
    assert.equal(positiveClaims?.aud, EGRESS_PROXY_AUD);
    assert.deepEqual(positiveClaims?.egress, { allowedHosts: ["example.com"], deniedHosts: [] });

    const negativeClaims = await verifyCapabilityToken(
      requests[2]!.authorization!.slice("Bearer ".length),
      capabilitySecret,
    );
    assert.equal(negativeClaims?.aud, EGRESS_PROXY_AUD);
    assert.deepEqual(negativeClaims?.egress, {
      allowedHosts: ["alpha-ticker-stage-a-hosted-portal.fly.dev"],
      deniedHosts: [],
    });
    assert.ok((positiveClaims?.exp ?? 0) > Date.now());
    assert.ok((positiveClaims?.exp ?? Infinity) <= Date.now() + 60_000);
    assert.ok((negativeClaims?.exp ?? 0) > Date.now());
    assert.ok((negativeClaims?.exp ?? Infinity) <= Date.now() + 60_000);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(temp, { recursive: true, force: true });
  }
});
