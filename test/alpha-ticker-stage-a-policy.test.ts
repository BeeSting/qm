import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadConfigAt } from "../cli/src/config.ts";

const deploymentRoot = "deploy/layers/alpha-ticker-stage-a";

test("Stage A is local, synthetic, and connector-free", () => {
  const config = loadConfigAt(`${deploymentRoot}/qm.config.jsonc`).config;
  const policy = JSON.parse(readFileSync(`${deploymentRoot}/stage-a-policy.json`, "utf8"));

  assert.equal(config.target, "docker");
  assert.match(config.publicUrl, /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/);
  assert.ok(!config.services.includes("slack"));
  assert.deepEqual(config.plugins, []);
  assert.equal(config.env.core?.HARNESS, "mock");
  assert.equal(config.modelProvider, undefined);

  assert.equal(policy.dataClass, "public-synthetic-only");
  assert.equal(policy.cloudMutation, false);
  assert.equal(policy.liveAlphaPackets, false);
  assert.deepEqual(policy.allowedTools, ["alpha-packet"]);
  assert.deepEqual(policy.allowedEgress, []);
  assert.ok(policy.prohibitedCapabilities.includes("browser"));
  assert.ok(policy.prohibitedCapabilities.includes("published-apps"));
  assert.ok(policy.prohibitedCapabilities.includes("external-communications"));
});
