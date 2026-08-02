import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { egressDecision } from "../src/resolution/egress-policy.ts";

const root = "deploy/layers/alpha-ticker-stage-a-hosted";
const qmPackage = "@yc-software/qm";
const qmVersion = "0.1.4";
const qmIntegrity = "sha512-L3WWtV+yjhBq7ARYJxNzTpV4cdvw8ZCYXVk0kRUUPjKwH7NObz8newikeCZwijvpmEEEnDLTi02O+nowQTDC4Q==";

interface HostedConfig {
  orgId: string;
  target: string;
  publicUrl: string;
  appPrefix?: string;
  region?: string;
  flyOrg?: string;
  modelProvider?: string;
  model?: string;
  services: string[];
  plugins: unknown[];
  env: { core?: Record<string, string> };
}

interface DeploymentContract {
  loadConfigAt(path: string): { config: HostedConfig };
}

interface HostedPolicy {
  dataClass: string;
  cloudMutation: string;
  modelBacked: boolean;
  liveAlphaPackets: boolean;
  productionCredentials: boolean;
  allowedTools: string[];
  allowedSandboxControlPlaneHosts: string[];
  allowedSandboxExternalHosts: string[];
  coreExternalDependencies: string[];
  allowedTickers: string[];
  allowedPortfolios: string[];
  prohibitedCapabilities: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(isRecord(value), `${path} must contain a JSON object`);
  return value;
}

function assertDeploymentContract(value: unknown): asserts value is DeploymentContract {
  assert.ok(isRecord(value));
  assert.equal(typeof value.loadConfigAt, "function");
}

function assertHostedPolicy(value: unknown): asserts value is HostedPolicy {
  assert.ok(isRecord(value));
  assert.equal(typeof value.dataClass, "string");
  assert.equal(typeof value.cloudMutation, "string");
  assert.equal(typeof value.modelBacked, "boolean");
  assert.equal(typeof value.liveAlphaPackets, "boolean");
  assert.equal(typeof value.productionCredentials, "boolean");

  const stringArrayFields = [
    "allowedTools",
    "allowedSandboxControlPlaneHosts",
    "allowedSandboxExternalHosts",
    "coreExternalDependencies",
    "allowedTickers",
    "allowedPortfolios",
    "prohibitedCapabilities",
  ] as const;
  for (const field of stringArrayFields) {
    const fieldValue = value[field];
    assert.ok(Array.isArray(fieldValue), `${field} must be an array`);
    assert.ok(
      fieldValue.every((item: unknown) => typeof item === "string"),
      `${field} must contain strings`,
    );
  }
}

function readHostedPolicy(): HostedPolicy {
  const value: unknown = JSON.parse(readFileSync(`${root}/stage-a-hosted-policy.json`, "utf8"));
  assertHostedPolicy(value);
  return value;
}

const deploymentRequire = createRequire(resolve(root, "package.json"));
const deploymentContractPath = deploymentRequire.resolve(`${qmPackage}/contract`);
const deploymentContractModule: unknown = await import(pathToFileURL(deploymentContractPath).href);
assertDeploymentContract(deploymentContractModule);
const { loadConfigAt } = deploymentContractModule;

test("hosted Stage A pins the QM package that loads its deployment contract", () => {
  const packageJson = readJsonObject(`${root}/package.json`);
  const dependencies = packageJson.dependencies;
  assert.ok(isRecord(dependencies));
  assert.equal(dependencies[qmPackage], qmVersion);

  const packageLock = readJsonObject(`${root}/package-lock.json`);
  const packages = packageLock.packages;
  assert.ok(isRecord(packages));
  const rootPackage = packages[""];
  assert.ok(isRecord(rootPackage));
  const lockedDependencies = rootPackage.dependencies;
  assert.ok(isRecord(lockedDependencies));
  assert.equal(lockedDependencies[qmPackage], qmVersion);

  const lockedQm = packages[`node_modules/${qmPackage}`];
  assert.ok(isRecord(lockedQm));
  assert.equal(lockedQm.version, qmVersion);
  assert.equal(lockedQm.integrity, qmIntegrity);
  assert.equal(deploymentContractPath, resolve(root, "node_modules/@yc-software/qm/dist/src/contract.js"));
});

test("hosted Stage A is model-backed, bounded, and connector-free", () => {
  const config = loadConfigAt(`${root}/qm.config.jsonc`).config;
  const policy = readHostedPolicy();

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
  assert.equal(policy.cloudMutation, "gated");
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
  assert.deepEqual(policy.allowedTickers, ["SYNTH"]);
  assert.deepEqual(policy.allowedPortfolios, ["SYNTHETIC_NUCLEUS"]);
  assert.deepEqual(policy.prohibitedCapabilities, [
    "browser",
    "connectors",
    "published-apps",
    "public-links",
    "slack",
    "telegram",
    "github",
    "database-access",
    "brokerage",
    "external-actions",
  ]);
});

test("hosted Stage A exposes only the approved empty secret-name catalog", () => {
  const secretNames = [
    "ADMIN_GRANTS",
    "AUTH_ALLOWED_EMAILS",
    "AUTH_CLIENT_SECRET",
    "AUTH_EMAIL_FROM",
    "AUTH_SIGNING_JWK",
    "AUTH_TOKEN_SECRET",
    "CAPABILITY_SECRET",
    "CONNECTOR_SECRET_KEY",
    "CORE_SIGNING_SECRET",
    "FLY_SANDBOX_API_TOKEN",
    "OPENAI_API_KEY",
    "PORTAL_IDENTITY_SECRET",
    "PORTAL_SESSION_SECRET",
    "PUBLIC_API_URL",
    "SKILL_SIGNING_SECRET",
    "SMTP_HOST",
    "SMTP_PASSWORD",
    "SMTP_USERNAME",
  ];
  const expectedCatalog = `${secretNames.map((name) => `${name}=`).join("\n")}\n`;

  assert.equal(readFileSync(`${root}/.env.example`, "utf8"), expectedCatalog);
});

test("hosted Stage A deliberately keeps pinned QM in allowlist mode", () => {
  const policy = readHostedPolicy();
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
