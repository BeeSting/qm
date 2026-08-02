import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { parseToolDescriptor } from "../cli/src/sandbox-layer.ts";

const toolRoot = "deploy/layers/alpha-ticker-stage-a/sandbox/tools/alpha-packet";
const binary = `${toolRoot}/alpha-packet`;

function invoke(...args: string[]) {
  return spawnSync(binary, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
}

function run(...args: string[]) {
  const result = invoke(...args);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertDenied(...args: string[]) {
  const result = invoke(...args);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^alpha-packet: request denied\n$/);
  assert.doesNotMatch(result.stderr, /Users|HOME|PATH|NVDA|Nucleus Fund/);
}

test("returns explicitly synthetic advisory envelopes", () => {
  const thesis = run("thesis", "--ticker", "SYNTH");
  assert.equal(thesis.synthetic, true);
  assert.equal(thesis.advisoryOnly, true);
  assert.equal(thesis.packetType, "ThesisPacket");
  assert.equal(thesis.scope.ticker, "SYNTH");
  assert.equal(thesis.freshness.status, "synthetic");
  assert.ok(thesis.disallowedUses.includes("trade-execution"));

  const health = run("portfolio-health", "--portfolio", "SYNTHETIC_NUCLEUS");
  assert.equal(health.packetType, "PortfolioHealthPacket");
  assert.equal(health.scope.portfolio, "SYNTHETIC_NUCLEUS");

  assert.equal(run("alerts", "--portfolio", "SYNTHETIC_NUCLEUS").packetType, "AlertDigestPacket");
  assert.equal(run("signal-trace", "--ticker", "SYNTH").packetType, "SignalTracePacket");
});

test("rejects real or unknown scopes", () => {
  assertDenied("thesis", "--ticker", "NVDA");
  assertDenied("portfolio-health", "--portfolio", "Nucleus Fund");
  assertDenied("alerts", "--portfolio", "UNKNOWN");
  assertDenied("signal-trace", "--ticker", "REAL");
});

test("offers no refresh, SQL, write, fetch, or argument smuggling", () => {
  for (const command of ["refresh", "sql", "write", "fetch"]) assertDenied(command);
  assertDenied("thesis", "--ticker", "SYNTH", "--refresh");
  assertDenied("thesis", "--ticker", "SYNTH", "--url", "http://example.invalid");
});

test("tool descriptor is egress-free and the declared binary is executable", () => {
  const descriptorPath = `${toolRoot}/tool.json`;
  const descriptor = parseToolDescriptor(readFileSync(descriptorPath, "utf8"), descriptorPath);

  assert.equal(descriptor.id, "alpha-packet");
  assert.equal(descriptor.install?.binary, "alpha-packet");
  assert.deepEqual(descriptor.egress, []);
  assert.ok(descriptor.approvals?.every((approval) => approval.decision === "deny"));
  assert.notEqual(statSync(binary).mode & 0o111, 0);
});
