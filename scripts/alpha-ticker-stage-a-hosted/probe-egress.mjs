#!/usr/bin/env node

import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { request } from "node:https";
import { parseArgs, parseEnv } from "node:util";
import { EGRESS_PROXY_AUD, mintCapabilityToken } from "../../src/auth/capability-token.ts";

function readCapabilitySecret(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) throw new Error("invalid env file");
    const secret = parseEnv(readFileSync(descriptor, "utf8")).CAPABILITY_SECRET;
    if (!secret) throw new Error("missing capability secret");
    return secret;
  } finally {
    closeSync(descriptor);
  }
}

function connect(proxy, authority, authorization) {
  return new Promise((resolve, reject) => {
    const connection = request(proxy, {
      method: "CONNECT",
      path: authority,
      headers: authorization ? { "Proxy-Authorization": `Bearer ${authorization}` } : {},
    });
    connection.once("connect", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 0);
    });
    connection.once("error", reject);
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

  const capability = await mintCapabilityToken(
    {
      actorId: "stage-a-egress-probe",
      scopeId: "org:default-org",
      aud: EGRESS_PROXY_AUD,
      exp: Date.now() + 60_000,
      egress: {
        allowedHosts: ["alpha-ticker-stage-a-hosted-portal.fly.dev"],
        deniedHosts: [],
      },
    },
    readCapabilitySecret(values["env-file"]),
  );
  const authority = `${values.host}:443`;
  const unsignedStatus = await connect(proxy, authority);
  const signedStatus = await connect(proxy, authority, capability);
  if (unsignedStatus !== 403 || signedStatus !== 403) throw new Error("egress allowed");

  process.stdout.write("unsigned-deny: pass\nsigned-unapproved-host-deny: pass\n");
}

main().catch(() => {
  process.stderr.write("egress probe failed\n");
  process.exitCode = 1;
});
