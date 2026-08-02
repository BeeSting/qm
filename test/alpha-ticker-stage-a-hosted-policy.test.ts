import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadConfigAt } from "../cli/src/config.ts";
import { egressDecision } from "../src/resolution/egress-policy.ts";

const root = "deploy/layers/alpha-ticker-stage-a-hosted";

test("hosted Stage A is model-backed, bounded, and connector-free", () => {
  const config = loadConfigAt(`${root}/qm.config.jsonc`).config;
  const policy = JSON.parse(readFileSync(`${root}/stage-a-hosted-policy.json`, "utf8"));

  assert.equal(config.orgId, "alpha-ticker-stage-a-hosted");
  assert.equal(config.target, "fly");
  assert.equal(config.publicUrl, "https://alpha-ticker-stage-a-hosted-portal.fly.dev");
  assert.equal(config.appPrefix, "alpha-ticker-stage-a-hosted");
  assert.equal(config.region, "jnb");
  assert.equal(config.flyOrg, "personal");
  assert.equal(config.modelProvider, "openai");
  assert.equal(config.model, "gpt-5.6-terra");
  assert.deepEqual(config.services, ["core", "web-ui", "admin", "portal", "auth"]);
  assert.deepEqual(config.plugins, []);
  assert.equal(config.env.core?.HARNESS, "pi");
  assert.equal(config.env.core?.HARNESS_SECURITY_POSTURE, "strict");
  assert.equal(config.env.core?.BUDGET_WINDOW_MS, "604800000");
  assert.equal(config.env.core?.BUDGET_USD_PER_WINDOW, "20");
  assert.equal(config.env.core?.ORG_BUDGET_USD_PER_WINDOW, "45");
  assert.equal(config.env.core?.SPRITES_EGRESS_PROXY_URL, "https://alpha-ticker-stage-a-egress.fly.dev");

  assert.equal(policy.dataClass, "public-synthetic-only");
  assert.equal(policy.modelBacked, true);
  assert.equal(policy.liveAlphaPackets, false);
  assert.equal(policy.productionCredentials, false);
  assert.deepEqual(policy.allowedTools, ["alpha-packet"]);
  assert.deepEqual(policy.allowedSandboxControlPlaneHosts, ["alpha-ticker-stage-a-hosted-portal.fly.dev"]);
  assert.deepEqual(policy.allowedSandboxExternalHosts, []);
  assert.deepEqual(policy.coreExternalDependencies, [
    "openai-api",
    "smtp-relay",
    "fly-control-plane",
    "fly-managed-postgres",
    "tigris-object-storage",
  ]);
  assert.ok(policy.prohibitedCapabilities.includes("browser"));
  assert.ok(policy.prohibitedCapabilities.includes("connectors"));
  assert.ok(policy.prohibitedCapabilities.includes("external-actions"));
});

test("hosted Stage A deliberately keeps pinned QM in allowlist mode", () => {
  const policy = JSON.parse(readFileSync(`${root}/stage-a-hosted-policy.json`, "utf8"));
  const allowedHosts = policy.allowedSandboxControlPlaneHosts;

  assert.deepEqual(allowedHosts, ["alpha-ticker-stage-a-hosted-portal.fly.dev"]);
  assert.equal(
    egressDecision("alpha-ticker-stage-a-hosted-portal.fly.dev", { allowedHosts, deniedHosts: [] }).allow,
    true,
  );
  assert.equal(egressDecision("example.com", { allowedHosts, deniedHosts: [] }).allow, false);

  // Characterize the pinned upstream behavior that makes an empty list unsafe.
  assert.equal(egressDecision("example.com", { allowedHosts: [], deniedHosts: [] }).allow, true);
});
