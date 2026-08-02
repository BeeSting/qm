#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertActivationRecord } from "./activation-record.mjs";
import { assertScoreRecord, summarizeScoreRecords } from "./evaluation-ledger.mjs";

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_SANDBOX_FILES = 128;
const MAX_SANDBOX_BYTES = 8 * 1024 * 1024;
const MAX_LEDGER_LINE_BYTES = 16 * 1024;
const MAX_LEDGER_RECORDS = 15;
const MODEL_SPEND_LIMIT_USD = 45;
const DEFAULT_OUTPUT = ".generated/alpha-ticker-stage-a-hosted/evidence-manifest.json";
const HOSTED_APPS = Object.freeze([
  "alpha-ticker-stage-a-hosted-core",
  "alpha-ticker-stage-a-hosted-web-ui",
  "alpha-ticker-stage-a-hosted-admin",
  "alpha-ticker-stage-a-hosted-portal",
  "alpha-ticker-stage-a-hosted-auth",
  "alpha-ticker-stage-a-hosted-sandboxes",
  "alpha-ticker-stage-a-egress",
]);
const CHECK_IDS = Object.freeze([
  "activation-record",
  "hosted-policy",
  "hosted-config",
  "egress-proxy-config",
  "sandbox-bundle",
  "evaluation-ledger",
  "resource-inventory",
  "live-checks",
]);
const LIVE_CHECK_IDS = Object.freeze([
  "h2-qm-doctor",
  "h2-qm-live-check",
  "h2-qm-conformance",
  "h2-egress-allowlist",
  "h2-model-harness-provider",
  "h2-connectors-unconfigured",
  "h2-prohibited-capabilities-absent",
  "h2-identity-admission",
  "h2-personal-scope-isolation",
  "h2-synthetic-advisory-response",
  "h2-durable-personal-computer",
  "h2-idempotent-deployment",
  "h3-sandbox-egress-denial",
  "h3-alpha-packet-allowed",
  "h3-shared-room-access",
  "h3-shared-room-revocation",
  "h3-zero-budget-denial",
  "h3-budget-restored",
  "h3-provider-key-revocation-isolation",
  "h3-model-health-recovery",
  "h3-exact-teardown-plan",
  "h3-inventory-ownership",
]);
const FORBIDDEN_KEYS = new Set([
  "prompt",
  "response",
  "packetBody",
  "providerRequest",
  "secret",
  "tokenValue",
  "email",
  "name",
  "resourceId",
]);
const TOP_LEVEL_KEYS = [
  "commit",
  "qmBaseline",
  "sandboxDigest",
  "timestamp",
  "pass",
  "checks",
  "counts",
  "scoreSummary",
  "spendSummary",
  "contentCaptured",
];
const CHECK_KEYS = ["id", "status", "artifactSha256"];
const COUNT_KEYS = ["principals", "scoredOutputs"];
const SCORE_KEYS = [
  "sampleSize",
  "disclosurePasses",
  "acceptedWithMinorOrLess",
  "medianUsefulness",
  "medianFactualConsistency",
  "medianElapsedMs",
  "totalCostUsd",
  "incidentCount",
  "pass",
];
const SPEND_KEYS = ["allTurnModelCostUsd", "flyCostUsd", "scoredOutputCostUsd", "totalCostUsd"];
const LIVE_CHECK_KEYS = ["id", "status", "timestamp", "revision", "resourceNameSha256"];
const EXPECTED_UPSTREAM_LOCK = Object.freeze({
  repository: "https://github.com/yc-software/qm.git",
  commit: "7f2c916360f1797a8ff2a77ce2ce40c5fabab087",
  package: "@yc-software/qm@0.1.4",
  node: "24.18.1",
  npm: "11.16.0",
  reviewedAt: "2026-08-01",
  implementedAt: "2026-08-02",
  stage: "A",
  dataClass: "public-synthetic-only",
});
const EXPECTED_POLICY = Object.freeze({
  stage: "A-hosted",
  dataClass: "public-synthetic-only",
  cloudMutation: "gated",
  modelBacked: true,
  liveAlphaPackets: false,
  productionCredentials: false,
  allowedTools: ["alpha-packet"],
  allowedSandboxControlPlaneHosts: ["alpha-ticker-stage-a-hosted-portal.fly.dev"],
  allowedSandboxExternalHosts: [],
  coreExternalDependencies: [
    "openai-api",
    "smtp-relay",
    "fly-control-plane",
    "fly-managed-postgres",
    "tigris-object-storage",
  ],
  allowedTickers: ["SYNTH"],
  allowedPortfolios: ["SYNTHETIC_NUCLEUS"],
  prohibitedCapabilities: [
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
  ],
});
const EXPECTED_CONFIG = Object.freeze({
  contract: 1,
  orgId: "alpha-ticker-stage-a-hosted",
  publicUrl: "https://alpha-ticker-stage-a-hosted-portal.fly.dev",
  target: "fly",
  modelProvider: "openai",
  model: "gpt-5.6-terra",
  appPrefix: "alpha-ticker-stage-a-hosted",
  region: "jnb",
  flyOrg: "personal",
  services: ["core", "web-ui", "admin", "portal", "auth"],
  plugins: [],
  skills: [],
  env: {
    core: {
      HARNESS: "pi",
      HARNESS_SECURITY_POSTURE: "strict",
      SNAPSHOT_STORE: "s3",
      TRANSFER_STORE: "s3",
      S3_BUCKET: "alpha-ticker-stage-a-hosted-data",
      S3_REGION: "auto",
      BUDGET_WINDOW_MS: "604800000",
      BUDGET_USD_PER_WINDOW: "20",
      ORG_BUDGET_USD_PER_WINDOW: "45",
      SPRITES_EGRESS_PROXY_URL: "https://alpha-ticker-stage-a-egress.fly.dev",
    },
    auth: {
      AUTH_EMAIL_TRANSPORT: "smtp",
      AUTH_BRAND_NAME: "Alpha Ticker QM Stage A",
    },
  },
  secretEnv: { core: { ADMIN_GRANTS: "ADMIN_GRANTS" } },
  sandbox: { app: "alpha-ticker-stage-a-hosted-sandboxes" },
});
const EXPECTED_EGRESS = `app = "alpha-ticker-stage-a-egress"
primary_region = "jnb"

[env]
  EGRESS_TOKENLESS = "deny"

[[services]]
  internal_port = 48080
  protocol = "tcp"
  auto_stop_machines = false
  min_machines_running = 1

  [[services.ports]]
    port = 443
    handlers = ["tls"]

  [[services.tcp_checks]]
    interval = "15s"
    timeout = "2s"
    grace_period = "10s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"

kill_signal = "SIGTERM"
kill_timeout = "10s"
`;

class EvidenceError extends Error {
  constructor(kind) {
    super(`evidence ${kind}`);
    this.name = "EvidenceError";
  }
}

function fail(kind) {
  throw new EvidenceError(kind);
}

function exactOwnKeys(value, expected, kind) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(kind);
  if (Object.getPrototypeOf(value) !== Object.prototype) fail("unsupported evidence object");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) fail(kind);
  for (const key of keys) {
    if (typeof key !== "string") fail("unsupported evidence key");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail("unsupported evidence property");
    if (!expected.includes(key)) fail(kind);
  }
  for (const key of expected) if (!Object.hasOwn(value, key)) fail(kind);
}

function visitEvidence(value, path = "manifest", seen = new WeakSet()) {
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) fail("unsupported evidence cycle");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) fail("unsupported evidence key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) fail("unsupported evidence property");
      visitEvidence(descriptor.value, `${path}[${key}]`, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail("unsupported evidence object");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("unsupported evidence key");
    if (FORBIDDEN_KEYS.has(key)) throw new EvidenceError(`forbidden evidence key ${path}.${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail("unsupported evidence property");
    visitEvidence(descriptor.value, `${path}.${key}`, seen);
  }
}

function assertSha1(value, field) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) fail(field);
}

function assertSha256(value, field) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail(field);
}

function assertNonNegativeFinite(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(field);
}

function assertNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) fail(field);
}

export function assertEvidenceSafe(manifest) {
  visitEvidence(manifest);
  exactOwnKeys(manifest, TOP_LEVEL_KEYS, "unsupported evidence key");
  assertSha1(manifest.commit, "commit");
  assertSha1(manifest.qmBaseline, "qmBaseline");
  assertSha256(manifest.sandboxDigest, "sandboxDigest");
  if (typeof manifest.timestamp !== "string" || !Number.isFinite(Date.parse(manifest.timestamp))) fail("timestamp");
  if (typeof manifest.pass !== "boolean") fail("pass");
  if (manifest.contentCaptured !== false) fail("contentCaptured");

  if (!Array.isArray(manifest.checks) || manifest.checks.length !== CHECK_IDS.length) fail("checks");
  for (let index = 0; index < CHECK_IDS.length; index += 1) {
    const check = manifest.checks[index];
    exactOwnKeys(check, CHECK_KEYS, "check");
    if (check.id !== CHECK_IDS[index]) fail("check id");
    if (check.status !== "pass" && check.status !== "fail") fail("check status");
    if (check.artifactSha256 === null) {
      if (check.id !== "evaluation-ledger" || check.status !== "fail") fail("artifactSha256");
    } else {
      assertSha256(check.artifactSha256, "artifactSha256");
    }
  }
  if (manifest.checks[4].artifactSha256 !== manifest.sandboxDigest) fail("sandboxDigest");

  exactOwnKeys(manifest.counts, COUNT_KEYS, "counts");
  if (
    manifest.counts.principals !== 3 ||
    !Number.isInteger(manifest.counts.scoredOutputs) ||
    manifest.counts.scoredOutputs < 0 ||
    manifest.counts.scoredOutputs > 15
  ) {
    fail("counts");
  }
  exactOwnKeys(manifest.scoreSummary, SCORE_KEYS, "scoreSummary");
  for (const field of ["sampleSize", "disclosurePasses", "acceptedWithMinorOrLess", "incidentCount"]) {
    assertNonNegativeInteger(manifest.scoreSummary[field], field);
  }
  for (const field of ["medianUsefulness", "medianFactualConsistency", "medianElapsedMs", "totalCostUsd"]) {
    assertNonNegativeFinite(manifest.scoreSummary[field], field);
  }
  if (
    manifest.scoreSummary.sampleSize !== manifest.counts.scoredOutputs ||
    manifest.scoreSummary.sampleSize > 15 ||
    typeof manifest.scoreSummary.pass !== "boolean"
  ) {
    fail("scoreSummary");
  }
  if (manifest.scoreSummary.pass && manifest.scoreSummary.sampleSize !== 15) fail("scoreSummary");
  if (manifest.checks[5].artifactSha256 === null && manifest.scoreSummary.sampleSize !== 0) fail("scoreSummary");
  if (manifest.checks[7].status === "pass" && manifest.scoreSummary.sampleSize !== 15) fail("scoreSummary");

  exactOwnKeys(manifest.spendSummary, SPEND_KEYS, "spendSummary");
  for (const field of SPEND_KEYS) assertNonNegativeFinite(manifest.spendSummary[field], field);
  if (manifest.spendSummary.scoredOutputCostUsd !== manifest.scoreSummary.totalCostUsd) fail("spendSummary");
  if (
    manifest.spendSummary.allTurnModelCostUsd < manifest.spendSummary.scoredOutputCostUsd ||
    manifest.spendSummary.allTurnModelCostUsd > MODEL_SPEND_LIMIT_USD
  ) {
    fail("spendSummary");
  }
  const expectedTotal = manifest.spendSummary.allTurnModelCostUsd + manifest.spendSummary.flyCostUsd;
  if (Math.abs(expectedTotal - manifest.spendSummary.totalCostUsd) > 1e-9) fail("spendSummary");
  const expectedPass = manifest.scoreSummary.pass && manifest.checks.every((check) => check.status === "pass");
  if (manifest.pass !== expectedPass) fail("pass");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function snapshotRegularFile(id, path, maxBytes = MAX_INPUT_BYTES, hooks = {}, { requiredMode } = {}) {
  let before;
  try {
    before = lstatSync(path, { bigint: true });
  } catch {
    fail("input invalid");
  }
  if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(maxBytes)) fail("input invalid");
  if (requiredMode !== undefined && Number(before.mode & 0o777n) !== requiredMode) fail("input invalid");
  if (!Number.isInteger(constants.O_NOFOLLOW)) fail("input invalid");

  let descriptor;
  let bytes;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameIdentity(before, opened) || opened.size > BigInt(maxBytes)) fail("input invalid");
    if (requiredMode !== undefined && Number(opened.mode & 0o777n) !== requiredMode) fail("input invalid");
    hooks.afterOpen?.(id, path);
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = readSync(descriptor, buffer, total, buffer.length - total, null);
      if (count === 0) break;
      total += count;
    }
    const afterRead = fstatSync(descriptor, { bigint: true });
    if (total > maxBytes || BigInt(total) !== opened.size || !sameIdentity(opened, afterRead)) fail("input invalid");
    const afterPath = lstatSync(path, { bigint: true });
    if (afterPath.isSymbolicLink() || !afterPath.isFile() || !sameIdentity(opened, afterPath)) fail("input invalid");
    bytes = Buffer.from(buffer.subarray(0, total));
    before = opened;
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    fail("input invalid");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the sanitized primary result.
      }
    }
  }
  const snapshot = Object.freeze({
    bytes,
    hash: sha256(bytes),
    mode: Number(before.mode & 0o777n),
    size: Number(before.size),
  });
  try {
    hooks.afterSnapshot?.(id);
  } catch {
    fail("input invalid");
  }
  return snapshot;
}

function snapshotOptionalRegularFile(id, path, maxBytes = MAX_INPUT_BYTES, hooks = {}, options = {}) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("input invalid");
  }
  return snapshotRegularFile(id, path, maxBytes, hooks, options);
}

function parseSnapshotJson(snapshot, kind = "input invalid") {
  try {
    const value = JSON.parse(snapshot.bytes.toString("utf8"));
    assertPlainJson(value, kind);
    return value;
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    fail(kind);
  }
}

function assertPlainJson(value, kind = "input invalid", seen = new WeakSet()) {
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) fail(kind);
  seen.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) fail(kind);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") fail(kind);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(kind);
    assertPlainJson(descriptor.value, kind, seen);
  }
}

function deepExact(value, expected, kind) {
  if (Object.is(value, expected)) return;

  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length) fail(kind);
    for (let index = 0; index < expected.length; index += 1) {
      deepExact(value[index], expected[index], kind);
    }
    return;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof expected === "object" &&
    expected !== null
  ) {
    const expectedKeys = Object.keys(expected);
    exactOwnKeys(value, expectedKeys, kind);
    for (const key of expectedKeys) deepExact(value[key], expected[key], kind);
    return;
  }

  fail(kind);
}

function validatePolicy(snapshot) {
  deepExact(parseSnapshotJson(snapshot, "policy invalid"), EXPECTED_POLICY, "policy invalid");
}

function validateUpstreamLock(snapshot) {
  const value = parseSnapshotJson(snapshot);
  exactOwnKeys(value, Object.keys(EXPECTED_UPSTREAM_LOCK), "input invalid");
  assertSha1(value.commit, "qmBaseline");
  deepExact(value, EXPECTED_UPSTREAM_LOCK, "input invalid");
  return value;
}

function scanJsonString(text, index) {
  for (index += 1; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === '"') return index + 1;
  }
  fail("config invalid");
}

function skipJsonWhitespace(text, index) {
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function stripJsonComments(text) {
  let output = "";
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (character === '"') {
      const end = scanJsonString(text, index);
      output += text.slice(index, end);
      index = end;
      continue;
    }
    if (character === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }
    if (character === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      while (index < stop) {
        output += text[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

function stripTrailingCommas(text) {
  let output = text;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === '"') {
      index = scanJsonString(output, index) - 1;
      continue;
    }
    if (output[index] !== ",") continue;
    const next = skipJsonWhitespace(output, index + 1);
    if (output[next] === "}" || output[next] === "]") {
      output = `${output.slice(0, index)} ${output.slice(index + 1)}`;
    }
  }
  return output;
}

function assertNoDuplicateJsonKeys(text) {
  let index = 0;
  const skip = () => {
    while (/\s/.test(text[index] ?? "")) index += 1;
  };
  const string = () => {
    const start = index;
    if (text[index] !== '"') fail("config invalid");
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index++];
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          fail("config invalid");
        }
      }
    }
    fail("config invalid");
  };
  const value = () => {
    skip();
    if (text[index] === "{") return object();
    if (text[index] === "[") return array();
    if (text[index] === '"') {
      string();
      return;
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
    if (!match) fail("config invalid");
    index += match[0].length;
  };
  const object = () => {
    index += 1;
    const keys = new Set();
    skip();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    while (index < text.length) {
      skip();
      const key = string();
      if (keys.has(key)) fail("config invalid");
      keys.add(key);
      skip();
      if (text[index++] !== ":") fail("config invalid");
      value();
      skip();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      if (text[index++] !== ",") fail("config invalid");
    }
    fail("config invalid");
  };
  const array = () => {
    index += 1;
    skip();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    while (index < text.length) {
      value();
      skip();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      if (text[index++] !== ",") fail("config invalid");
    }
    fail("config invalid");
  };
  value();
  skip();
  if (index !== text.length) fail("config invalid");
}

function validateConfig(snapshot) {
  try {
    const text = stripTrailingCommas(stripJsonComments(snapshot.bytes.toString("utf8")));
    assertNoDuplicateJsonKeys(text);
    const value = JSON.parse(text);
    assertPlainJson(value, "config invalid");
    deepExact(value, EXPECTED_CONFIG, "config invalid");
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    fail("config invalid");
  }
}

function validateEgress(snapshot) {
  if (!snapshot.bytes.equals(Buffer.from(EXPECTED_EGRESS))) fail("egress invalid");
}

function validateInventory(snapshot, { requireFullInventory = false } = {}) {
  const value = parseSnapshotJson(snapshot, "input invalid");
  exactOwnKeys(
    value,
    ["flyOrg", "h2ResourceReconciliation", "apps", "managedPostgres", "objectStorage", "sandboxRegistry"],
    "inventory invalid",
  );
  if (
    value.flyOrg !== "personal" ||
    !["not-started", "unresolved", "complete"].includes(value.h2ResourceReconciliation) ||
    !Array.isArray(value.apps) ||
    value.apps.length < 1 ||
    value.apps.length > HOSTED_APPS.length
  ) {
    fail("inventory invalid");
  }
  const ids = new Set();
  const appNames = new Set();
  const validateEntry = (entry, expectedName) => {
    exactOwnKeys(entry, ["name", "id"], "inventory invalid");
    if (entry.name !== expectedName || typeof entry.id !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(entry.id)) {
      fail("inventory invalid");
    }
    if (ids.has(entry.id)) fail("inventory invalid");
    ids.add(entry.id);
  };
  const validateNameBoundEntry = (entry, expectedName) => {
    exactOwnKeys(entry, ["name", "identityKind", "deletionKey"], "inventory invalid");
    if (entry.name !== expectedName || entry.identityKind !== "name-bound" || entry.deletionKey !== expectedName) {
      fail("inventory invalid");
    }
  };
  for (const entry of value.apps) {
    if (!HOSTED_APPS.includes(entry?.name) || appNames.has(entry.name)) fail("inventory invalid");
    validateEntry(entry, entry.name);
    appNames.add(entry.name);
  }
  if (requireFullInventory && HOSTED_APPS.some((name) => !appNames.has(name))) fail("inventory invalid");
  if (requireFullInventory && value.h2ResourceReconciliation !== "complete") fail("inventory invalid");
  if (
    value.h2ResourceReconciliation === "not-started" &&
    (value.managedPostgres !== null || value.objectStorage !== null)
  ) {
    fail("inventory invalid");
  }
  for (const [entry, expectedName] of [
    [value.managedPostgres, "alpha-ticker-stage-a-hosted-pg"],
    [value.sandboxRegistry, "alpha-ticker-stage-a-hosted-sandboxes"],
  ]) {
    if (entry === null) {
      if (requireFullInventory) fail("inventory invalid");
    } else {
      validateEntry(entry, expectedName);
    }
  }
  if (value.objectStorage === null) {
    if (requireFullInventory) fail("inventory invalid");
  } else {
    validateNameBoundEntry(value.objectStorage, "alpha-ticker-stage-a-hosted-data");
  }
}

function parseLiveChecks(snapshot) {
  const value = parseSnapshotJson(snapshot);
  exactOwnKeys(value, ["checks", "spendSummary"], "input invalid");
  if (!Array.isArray(value.checks) || value.checks.length !== LIVE_CHECK_IDS.length) fail("live-checks invalid");
  const ids = new Set();
  for (const check of value.checks) {
    exactOwnKeys(check, LIVE_CHECK_KEYS, "input invalid");
    if (typeof check.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(check.id)) fail("input invalid");
    if (check.status !== "pass" && check.status !== "fail" && check.status !== "not-run") {
      fail("live-checks invalid");
    }
    if (typeof check.timestamp !== "string" || !Number.isFinite(Date.parse(check.timestamp))) fail("input invalid");
    if (typeof check.revision !== "string" || check.revision.trim() === "") fail("input invalid");
    assertSha256(check.resourceNameSha256, "input invalid");
    if (!LIVE_CHECK_IDS.includes(check.id) || ids.has(check.id)) fail("live-checks invalid");
    ids.add(check.id);
  }
  if (LIVE_CHECK_IDS.some((id) => !ids.has(id))) fail("live-checks invalid");
  exactOwnKeys(value.spendSummary, ["allTurnModelCostUsd", "flyCostUsd", "totalCostUsd"], "input invalid");
  for (const field of ["allTurnModelCostUsd", "flyCostUsd", "totalCostUsd"]) {
    assertNonNegativeFinite(value.spendSummary[field], "input invalid");
  }
  if (value.spendSummary.allTurnModelCostUsd > MODEL_SPEND_LIMIT_USD) fail("spendSummary");
  if (
    Math.abs(value.spendSummary.allTurnModelCostUsd + value.spendSummary.flyCostUsd - value.spendSummary.totalCostUsd) >
    1e-9
  ) {
    fail("input invalid");
  }
  return value;
}

function parseScoreLedger(snapshot) {
  const records = [];
  for (const rawLine of snapshot.bytes.toString("utf8").split("\n")) {
    if (Buffer.byteLength(rawLine, "utf8") > MAX_LEDGER_LINE_BYTES) fail("input invalid");
    const line = rawLine.trim();
    if (line === "") continue;
    if (records.length === MAX_LEDGER_RECORDS) fail("input invalid");
    try {
      const record = JSON.parse(line);
      assertScoreRecord(record);
      records.push(record);
    } catch {
      fail("input invalid");
    }
  }
  if (records.length === 0) {
    return {
      sampleSize: 0,
      disclosurePasses: 0,
      acceptedWithMinorOrLess: 0,
      medianUsefulness: 0,
      medianFactualConsistency: 0,
      medianElapsedMs: 0,
      totalCostUsd: 0,
      incidentCount: 0,
      pass: false,
    };
  }
  try {
    return summarizeScoreRecords(records);
  } catch {
    fail("input invalid");
  }
}

function secureDirectorySnapshot(repoRoot, path) {
  const root = resolve(repoRoot);
  const target = resolve(path);
  const relativeTarget = relative(root, target);
  if (relativeTarget.startsWith("..") || resolve(root, relativeTarget) !== target) fail("sandbox bundle invalid");

  let canonicalRoot;
  try {
    const rootStat = lstatSync(root, { bigint: true });
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail("sandbox bundle invalid");
    canonicalRoot = realpathSync(root);
  } catch {
    fail("sandbox bundle invalid");
  }

  let current = root;
  let snapshot;
  const components = relativeTarget === "" ? [] : relativeTarget.split(sep);
  for (const component of ["", ...components]) {
    if (component !== "") current = join(current, component);
    let stat;
    try {
      stat = lstatSync(current, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("sandbox bundle invalid");
      const expected = join(canonicalRoot, relative(root, current));
      if (realpathSync(current) !== expected) fail("sandbox bundle invalid");
    } catch {
      fail("sandbox bundle invalid");
    }
    snapshot = stat;
  }
  return snapshot;
}

function listSandboxFiles(repoRoot, sandboxRoot) {
  const files = [];
  const directories = new Map();

  const recordDirectory = (path) => {
    const snapshot = secureDirectorySnapshot(repoRoot, path);
    const prior = directories.get(path);
    if (prior && !sameIdentity(prior, snapshot)) fail("sandbox bundle invalid");
    directories.set(path, snapshot);
    return snapshot;
  };

  const walk = (current) => {
    const before = recordDirectory(current);
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      fail("sandbox bundle invalid");
    }
    if (!sameIdentity(before, recordDirectory(current))) fail("sandbox bundle invalid");
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(current, entry.name);
      const relativePath = relative(sandboxRoot, path);
      if (relativePath.startsWith("..") || resolve(sandboxRoot, relativePath) !== path) {
        fail("sandbox bundle invalid");
      }
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        fail("sandbox bundle invalid");
      }
      if (stat.isSymbolicLink()) fail("sandbox bundle invalid");
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(path);
      else fail("sandbox bundle invalid");
      if (files.length > MAX_SANDBOX_FILES) fail("sandbox bundle invalid");
    }
    if (!sameIdentity(before, recordDirectory(current))) fail("sandbox bundle invalid");
  };

  walk(sandboxRoot);
  return { directories, files, recordDirectory };
}

function sandboxDigest(repoRoot, root, hooks) {
  const state = listSandboxFiles(repoRoot, root);
  try {
    hooks.afterSandboxList?.();
  } catch {
    fail("sandbox bundle invalid");
  }
  for (const [path, snapshot] of state.directories) {
    if (!sameIdentity(snapshot, state.recordDirectory(path))) fail("sandbox bundle invalid");
  }
  let totalBytes = 0;
  const index = state.files.map((path) => {
    const snapshot = snapshotRegularFile(`sandbox:${relative(root, path)}`, path, MAX_ARTIFACT_BYTES, hooks);
    totalBytes += snapshot.size;
    if (totalBytes > MAX_SANDBOX_BYTES) fail("sandbox bundle invalid");
    return `${relative(root, path)}:${snapshot.mode.toString(8)}:${snapshot.hash}`;
  });
  for (const [path, snapshot] of state.directories) {
    if (!sameIdentity(snapshot, state.recordDirectory(path))) fail("sandbox bundle invalid");
  }
  const digest = sha256(index.join("\n"));
  try {
    hooks.afterSnapshot?.("sandbox-bundle");
  } catch {
    fail("sandbox bundle invalid");
  }
  return digest;
}

function snapshotRepositoryEvidenceInputs(root, hooks = {}) {
  const deployment = ensureWithinRoot(root, join(root, "deploy/layers/alpha-ticker-stage-a-hosted"), "input invalid");
  const snapshots = {
    baseline: snapshotRegularFile("qm-baseline", join(root, "UPSTREAM.lock.json"), MAX_INPUT_BYTES, hooks),
    policy: snapshotRegularFile(
      "hosted-policy",
      join(deployment, "stage-a-hosted-policy.json"),
      MAX_INPUT_BYTES,
      hooks,
    ),
    config: snapshotRegularFile("hosted-config", join(deployment, "qm.config.jsonc"), MAX_INPUT_BYTES, hooks),
    egress: snapshotRegularFile(
      "egress-proxy-config",
      join(deployment, "egress-proxy.fly.toml"),
      MAX_INPUT_BYTES,
      hooks,
    ),
  };
  const baseline = validateUpstreamLock(snapshots.baseline);
  validatePolicy(snapshots.policy);
  validateConfig(snapshots.config);
  validateEgress(snapshots.egress);
  const digest = sandboxDigest(root, join(deployment, "sandbox"), hooks);
  return { baseline, deployment, digest, snapshots };
}

export function validateRepositoryEvidenceInputs({
  repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
} = {}) {
  const repository = snapshotRepositoryEvidenceInputs(resolve(repoRoot));
  return Object.freeze({ qmBaseline: repository.baseline.commit, sandboxDigest: repository.digest });
}

function ensureWithinRoot(root, path, kind) {
  const resolved = resolve(path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) fail(kind);
  return resolved;
}

function secureOutputParent(root, outputPath) {
  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    fail("output invalid");
  }
  const parent = dirname(outputPath);
  const relativeParent = relative(root, parent);
  if (relativeParent === "" || relativeParent.startsWith("..") || resolve(root, relativeParent) !== parent) {
    fail("output invalid");
  }
  let current = root;
  for (const component of relativeParent.split(sep)) {
    current = join(current, component);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("output invalid");
    } catch (error) {
      if (error instanceof EvidenceError) throw error;
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch {
        fail("output invalid");
      }
    }
    try {
      const canonicalExpected = join(realRoot, relative(root, current));
      if (realpathSync(current) !== canonicalExpected) fail("output invalid");
    } catch (error) {
      if (error instanceof EvidenceError) throw error;
      fail("output invalid");
    }
  }
  return parent;
}

function safeJsonWrite(root, path, value) {
  const parent = secureOutputParent(root, path);
  try {
    const existing = lstatSync(path);
    if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1) fail("output invalid");
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    if (error?.code !== "ENOENT") fail("output invalid");
  }
  if (!Number.isInteger(constants.O_NOFOLLOW)) fail("output invalid");
  const serialized = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const temp = join(parent, `${path.split(sep).at(-1)}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`);
  let descriptor;
  let renamed = false;
  try {
    descriptor = openSync(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1) fail("output invalid");
    fchmodSync(descriptor, 0o600);
    let offset = 0;
    while (offset < serialized.length) offset += writeSync(descriptor, serialized, offset, serialized.length - offset);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const tempStat = lstatSync(temp);
    if (!tempStat.isFile() || tempStat.isSymbolicLink() || tempStat.nlink !== 1 || (tempStat.mode & 0o777) !== 0o600) {
      fail("output invalid");
    }
    renameSync(temp, path);
    renamed = true;
    const finalStat = lstatSync(path);
    if (
      !finalStat.isFile() ||
      finalStat.isSymbolicLink() ||
      finalStat.nlink !== 1 ||
      (finalStat.mode & 0o777) !== 0o600
    ) {
      fail("output invalid");
    }
    const canonicalParent = join(realpathSync(root), relative(root, parent));
    if (realpathSync(dirname(path)) !== canonicalParent) fail("output invalid");
    const finalSnapshot = snapshotRegularFile("evidence-output", path, MAX_ARTIFACT_BYTES);
    if (!finalSnapshot.bytes.equals(serialized)) fail("output invalid");
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    fail("output invalid");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the sanitized primary result.
      }
    }
    if (!renamed) {
      try {
        unlinkSync(temp);
      } catch {
        // No temporary artifact remains when unlink succeeds; preserve primary result otherwise.
      }
    }
  }
}

export function collectEvidence({
  repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  commit,
  timestamp = new Date().toISOString(),
  output,
  afterOpen,
  afterSnapshot,
  afterSandboxList,
} = {}) {
  const root = resolve(repoRoot);
  const generated = ensureWithinRoot(root, join(root, ".generated/alpha-ticker-stage-a-hosted"), "input invalid");
  const outputPath = ensureWithinRoot(root, output ?? join(root, DEFAULT_OUTPUT), "output invalid");
  if (outputPath !== join(generated, "evidence-manifest.json")) fail("output invalid");
  const hooks = { afterOpen, afterSnapshot, afterSandboxList };
  const repository = snapshotRepositoryEvidenceInputs(root, hooks);
  const paths = {
    activation: join(generated, "activation.json"),
    inventory: join(generated, "resource-inventory.json"),
    liveChecks: join(generated, "live-checks.json"),
  };
  const snapshotIds = {
    activation: "activation-record",
    inventory: "resource-inventory",
    liveChecks: "live-checks",
  };
  const snapshots = {};
  for (const [id, path] of Object.entries(paths)) {
    snapshots[id] = snapshotRegularFile(snapshotIds[id], path, MAX_INPUT_BYTES, hooks, { requiredMode: 0o600 });
  }
  snapshots.ledger = snapshotOptionalRegularFile(
    "evaluation-ledger",
    join(generated, "scores.jsonl"),
    MAX_INPUT_BYTES,
    hooks,
    { requiredMode: 0o600 },
  );

  const baseline = repository.baseline;
  const resolvedCommit = commit ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assertSha1(resolvedCommit, "commit");
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) fail("timestamp");

  const activation = parseSnapshotJson(snapshots.activation);
  try {
    assertActivationRecord(activation);
  } catch {
    fail("activation invalid");
  }
  const liveChecks = parseLiveChecks(snapshots.liveChecks);
  const liveChecksPass = liveChecks.checks.every((check) => check.status === "pass");
  validateInventory(snapshots.inventory, { requireFullInventory: liveChecksPass });
  if (liveChecksPass && snapshots.ledger === null) fail("scoreSummary");
  const scoreSummary =
    snapshots.ledger === null ? parseScoreLedger({ bytes: Buffer.alloc(0) }) : parseScoreLedger(snapshots.ledger);
  if (liveChecksPass && scoreSummary.sampleSize !== 15) fail("scoreSummary");
  if (liveChecks.spendSummary.allTurnModelCostUsd < scoreSummary.totalCostUsd) fail("spendSummary");

  const digest = repository.digest;
  const checks = [
    { id: "activation-record", status: "pass", artifactSha256: snapshots.activation.hash },
    { id: "hosted-policy", status: "pass", artifactSha256: repository.snapshots.policy.hash },
    { id: "hosted-config", status: "pass", artifactSha256: repository.snapshots.config.hash },
    { id: "egress-proxy-config", status: "pass", artifactSha256: repository.snapshots.egress.hash },
    { id: "sandbox-bundle", status: "pass", artifactSha256: digest },
    {
      id: "evaluation-ledger",
      status: scoreSummary.pass ? "pass" : "fail",
      artifactSha256: snapshots.ledger?.hash ?? null,
    },
    { id: "resource-inventory", status: "pass", artifactSha256: snapshots.inventory.hash },
    {
      id: "live-checks",
      status: liveChecksPass ? "pass" : "fail",
      artifactSha256: snapshots.liveChecks.hash,
    },
  ];
  const manifest = {
    commit: resolvedCommit,
    qmBaseline: baseline.commit,
    sandboxDigest: digest,
    timestamp,
    pass: scoreSummary.pass && liveChecksPass,
    checks,
    counts: { principals: 3, scoredOutputs: scoreSummary.sampleSize },
    scoreSummary,
    spendSummary: {
      allTurnModelCostUsd: liveChecks.spendSummary.allTurnModelCostUsd,
      flyCostUsd: liveChecks.spendSummary.flyCostUsd,
      scoredOutputCostUsd: scoreSummary.totalCostUsd,
      totalCostUsd: liveChecks.spendSummary.totalCostUsd,
    },
    contentCaptured: false,
  };
  assertEvidenceSafe(manifest);
  safeJsonWrite(root, outputPath, manifest);
  return manifest;
}

export function runEvidenceCli(options, streams = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const manifest = collectEvidence(options);
    streams.stdout.write(`${DEFAULT_OUTPUT}\n`);
    return manifest.pass ? 0 : 1;
  } catch {
    streams.stderr.write("evidence-collection: invalid\n");
    return 1;
  }
}

function isDirectExecution(argvEntry) {
  if (!argvEntry || argvEntry === "-") return false;
  try {
    return pathToFileURL(resolve(argvEntry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectExecution(process.argv[1])) {
  process.exitCode = process.argv.length === 2 ? runEvidenceCli() : 1;
  if (process.argv.length !== 2) process.stderr.write("evidence-collection: invalid\n");
}
