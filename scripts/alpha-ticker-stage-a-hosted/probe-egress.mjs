#!/usr/bin/env node

import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { request } from "node:https";
import { parseArgs, parseEnv } from "node:util";
import { EGRESS_PROXY_AUD, mintCapabilityToken } from "../../src/auth/capability-token.ts";

const ENV_FILE_MAX_BYTES = 64 * 1024;
const CONNECT_TIMEOUT_MS = 5_000;

function readCapabilitySecret(path) {
  const descriptor = openSync(
    path,
    constants.O_RDONLY |
      (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0) |
      (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0),
  );
  try {
    const metadata = fstatSync(descriptor);
    const effectiveUid = process.geteuid?.();
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o600 ||
      (effectiveUid !== undefined && metadata.uid !== effectiveUid) ||
      metadata.size > ENV_FILE_MAX_BYTES
    ) {
      throw new Error("invalid env file");
    }
    const secret = parseEnv(readFileSync(descriptor, "utf8")).CAPABILITY_SECRET;
    if (!secret) throw new Error("missing capability secret");
    return secret;
  } finally {
    closeSync(descriptor);
  }
}

function connect(proxy, authority, authorization) {
  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    const connection = request(proxy, {
      method: "CONNECT",
      path: authority,
      headers: authorization ? { "Proxy-Authorization": `Bearer ${authorization}` } : {},
    });
    const finish = (error, status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket?.destroy();
      connection.destroy();
      if (error) reject(error);
      else resolve(status);
    };
    connection.once("socket", (connectedSocket) => {
      socket = connectedSocket;
    });
    connection.once("connect", (response, tunnel) => {
      socket = tunnel;
      finish(undefined, response.statusCode ?? 0);
    });
    connection.once("error", (error) => finish(error));
    const timeout = setTimeout(() => finish(new Error("connect timeout")), CONNECT_TIMEOUT_MS);
    connection.end();
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      proxy: { type: "string" },
      "env-file": { type: "string" },
      host: { type: "string" },
    },
    strict: true,
  });
  if (!values.proxy || !values["env-file"] || !values.host) throw new Error("missing arguments");

  const proxy = new URL(values.proxy);
  if (proxy.protocol !== "https:") throw new Error("invalid proxy");
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(values.host)) throw new Error("invalid host");

  const capabilitySecret = readCapabilitySecret(values["env-file"]);
  const expiresAt = Date.now() + 60_000;
  const canaryCapability = await mintCapabilityToken(
    {
      actorId: "stage-a-egress-probe",
      scopeId: "org:default-org",
      aud: EGRESS_PROXY_AUD,
      exp: expiresAt,
      egress: { allowedHosts: [values.host], deniedHosts: [] },
    },
    capabilitySecret,
  );
  const negativeCapability = await mintCapabilityToken(
    {
      actorId: "stage-a-egress-probe",
      scopeId: "org:default-org",
      aud: EGRESS_PROXY_AUD,
      exp: expiresAt,
      egress: {
        allowedHosts: ["alpha-ticker-stage-a-hosted-portal.fly.dev"],
        deniedHosts: [],
      },
    },
    capabilitySecret,
  );
  const authority = `${values.host}:443`;
  const canaryStatus = await connect(proxy, authority, canaryCapability);
  const unsignedStatus = await connect(proxy, authority);
  const signedStatus = await connect(proxy, authority, negativeCapability);
  if (canaryStatus !== 200 || unsignedStatus !== 403 || signedStatus !== 403) throw new Error("egress contract failed");

  process.stdout.write("unsigned-deny: pass\nsigned-unapproved-host-deny: pass\n");
}

main().catch(() => {
  process.stderr.write("egress probe failed\n");
  process.exitCode = 1;
});
