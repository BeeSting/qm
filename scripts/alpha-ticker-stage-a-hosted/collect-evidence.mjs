#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertActivationRecord } from "./activation-record.mjs";
import { readScoreLedger, summarizeScoreRecords } from "./evaluation-ledger.mjs";

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_SANDBOX_FILES = 128;
const MAX_SANDBOX_BYTES = 8 * 1024 * 1024;
const DEFAULT_OUTPUT = ".generated/alpha-ticker-stage-a-hosted/evidence-manifest.json";
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
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) fail(kind);
  }
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
  if (manifest.contentCaptured !== false) fail("contentCaptured");

  if (!Array.isArray(manifest.checks) || manifest.checks.length !== 8) fail("checks");
  const checkIds = new Set();
  for (const check of manifest.checks) {
    exactOwnKeys(check, CHECK_KEYS, "check");
    if (typeof check.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(check.id)) fail("check id");
    if (checkIds.has(check.id)) fail("check id");
    checkIds.add(check.id);
    if (check.status !== "pass" && check.status !== "fail") fail("check status");
    assertSha256(check.artifactSha256, "artifactSha256");
  }

  exactOwnKeys(manifest.counts, COUNT_KEYS, "counts");
  if (manifest.counts.principals !== 3 || manifest.counts.scoredOutputs !== 15) fail("counts");

  exactOwnKeys(manifest.scoreSummary, SCORE_KEYS, "scoreSummary");
  for (const field of ["sampleSize", "disclosurePasses", "acceptedWithMinorOrLess", "incidentCount"]) {
    assertNonNegativeInteger(manifest.scoreSummary[field], field);
  }
  for (const field of ["medianUsefulness", "medianFactualConsistency", "medianElapsedMs", "totalCostUsd"]) {
    assertNonNegativeFinite(manifest.scoreSummary[field], field);
  }
  if (manifest.scoreSummary.sampleSize !== 15 || typeof manifest.scoreSummary.pass !== "boolean") {
    fail("scoreSummary");
  }

  exactOwnKeys(manifest.spendSummary, SPEND_KEYS, "spendSummary");
  for (const field of SPEND_KEYS) assertNonNegativeFinite(manifest.spendSummary[field], field);
  if (manifest.spendSummary.scoredOutputCostUsd !== manifest.scoreSummary.totalCostUsd) fail("spendSummary");
  if (manifest.spendSummary.allTurnModelCostUsd < manifest.spendSummary.scoredOutputCostUsd) fail("spendSummary");
  const expectedTotal = manifest.spendSummary.allTurnModelCostUsd + manifest.spendSummary.flyCostUsd;
  if (Math.abs(expectedTotal - manifest.spendSummary.totalCostUsd) > 1e-9) fail("spendSummary");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function boundedRegularFile(path, maxBytes = MAX_INPUT_BYTES) {
  let before;
  try {
    before = lstatSync(path);
  } catch {
    fail("input invalid");
  }
  if (before.isSymbolicLink() || !before.isFile() || before.size > maxBytes) fail("input invalid");
  if (!Number.isInteger(constants.O_NOFOLLOW)) fail("input invalid");

  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    fail("input invalid");
  }
  try {
    const current = fstatSync(descriptor);
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino || current.size > maxBytes) {
      fail("input invalid");
    }
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = readSync(descriptor, buffer, total, buffer.length - total, null);
      if (count === 0) break;
      total += count;
    }
    if (total > maxBytes) fail("input invalid");
    return buffer.subarray(0, total);
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    fail("input invalid");
  } finally {
    try {
      closeSync(descriptor);
    } catch {
      // Preserve the sanitized primary result.
    }
  }
}

function parseBoundedJson(path) {
  try {
    return JSON.parse(boundedRegularFile(path).toString("utf8"));
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    fail("input invalid");
  }
}

function assertPlainJson(value, seen = new WeakSet()) {
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) fail("input invalid");
  seen.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) fail("input invalid");
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") fail("input invalid");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail("input invalid");
    assertPlainJson(descriptor.value, seen);
  }
}

function parseLiveChecks(path) {
  const value = parseBoundedJson(path);
  assertPlainJson(value);
  exactOwnKeys(value, ["checks", "spendSummary"], "input invalid");
  if (!Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 128) fail("input invalid");
  for (const check of value.checks) {
    exactOwnKeys(check, LIVE_CHECK_KEYS, "input invalid");
    if (typeof check.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(check.id)) fail("input invalid");
    if (check.status !== "pass" && check.status !== "fail") fail("input invalid");
    if (typeof check.timestamp !== "string" || !Number.isFinite(Date.parse(check.timestamp))) fail("input invalid");
    if (typeof check.revision !== "string" || check.revision.trim() === "") fail("input invalid");
    assertSha256(check.resourceNameSha256, "input invalid");
  }
  exactOwnKeys(value.spendSummary, ["allTurnModelCostUsd", "flyCostUsd", "totalCostUsd"], "input invalid");
  for (const field of ["allTurnModelCostUsd", "flyCostUsd", "totalCostUsd"]) {
    assertNonNegativeFinite(value.spendSummary[field], "input invalid");
  }
  if (
    Math.abs(value.spendSummary.allTurnModelCostUsd + value.spendSummary.flyCostUsd - value.spendSummary.totalCostUsd) >
    1e-9
  ) {
    fail("input invalid");
  }
  return value;
}

function listSandboxFiles(root, current = root, files = []) {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    fail("sandbox bundle invalid");
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      fail("sandbox bundle invalid");
    }
    if (stat.isSymbolicLink()) fail("sandbox bundle invalid");
    if (stat.isDirectory()) listSandboxFiles(root, path, files);
    else if (stat.isFile()) files.push({ path, size: stat.size, mode: stat.mode & 0o777 });
    else fail("sandbox bundle invalid");
    if (files.length > MAX_SANDBOX_FILES) fail("sandbox bundle invalid");
  }
  return files;
}

function sandboxDigest(root) {
  const files = listSandboxFiles(root);
  let bytes = 0;
  const index = files.map(({ path, size, mode }) => {
    bytes += size;
    if (bytes > MAX_SANDBOX_BYTES || size > MAX_ARTIFACT_BYTES) fail("sandbox bundle invalid");
    const content = boundedRegularFile(path, MAX_ARTIFACT_BYTES);
    return `${relative(root, path)}:${mode.toString(8)}:${sha256(content)}`;
  });
  return sha256(index.join("\n"));
}

function safeJsonWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!Number.isInteger(constants.O_NOFOLLOW)) fail("output invalid");
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600,
    );
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) fail("output invalid");
    writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, undefined, "utf8");
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
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    fail("output invalid");
  }
}

function ensureWithinRoot(root, path, kind) {
  const resolved = resolve(path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) fail(kind);
  return resolved;
}

export function collectEvidence({
  repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  commit,
  timestamp = new Date().toISOString(),
  output,
} = {}) {
  const root = resolve(repoRoot);
  const deployment = ensureWithinRoot(root, join(root, "deploy/layers/alpha-ticker-stage-a-hosted"), "input invalid");
  const generated = ensureWithinRoot(root, join(root, ".generated/alpha-ticker-stage-a-hosted"), "input invalid");
  const outputPath = ensureWithinRoot(root, output ?? join(root, DEFAULT_OUTPUT), "output invalid");
  if (outputPath !== join(generated, "evidence-manifest.json")) fail("output invalid");

  const baseline = parseBoundedJson(join(root, "UPSTREAM.lock.json"));
  assertPlainJson(baseline);
  assertSha1(baseline.commit, "qmBaseline");
  const resolvedCommit = commit ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assertSha1(resolvedCommit, "commit");
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) fail("timestamp");

  const paths = {
    activation: join(generated, "activation.json"),
    policy: join(deployment, "stage-a-hosted-policy.json"),
    config: join(deployment, "qm.config.jsonc"),
    egress: join(deployment, "egress-proxy.fly.toml"),
    ledger: join(generated, "scores.jsonl"),
    inventory: join(generated, "resource-inventory.json"),
    liveChecks: join(generated, "live-checks.json"),
  };

  const activation = parseBoundedJson(paths.activation);
  assertActivationRecord(activation);
  const inventory = parseBoundedJson(paths.inventory);
  assertPlainJson(inventory);
  const liveChecks = parseLiveChecks(paths.liveChecks);
  let scoreSummary;
  try {
    scoreSummary = summarizeScoreRecords(readScoreLedger(paths.ledger));
  } catch {
    fail("input invalid");
  }
  if (scoreSummary.sampleSize !== 15) fail("scoreSummary");
  if (liveChecks.spendSummary.allTurnModelCostUsd < scoreSummary.totalCostUsd) fail("spendSummary");

  const digest = sandboxDigest(join(deployment, "sandbox"));
  const status = liveChecks.checks.every((check) => check.status === "pass") ? "pass" : "fail";
  const checks = [
    ["activation-record", paths.activation, "pass"],
    ["hosted-policy", paths.policy, "pass"],
    ["hosted-config", paths.config, "pass"],
    ["egress-proxy-config", paths.egress, "pass"],
    ["evaluation-ledger", paths.ledger, scoreSummary.pass ? "pass" : "fail"],
    ["resource-inventory", paths.inventory, "pass"],
    ["live-checks", paths.liveChecks, status],
  ].map(([id, path, checkStatus]) => ({
    id,
    status: checkStatus,
    artifactSha256: sha256(boundedRegularFile(path, MAX_ARTIFACT_BYTES)),
  }));
  checks.push({ id: "sandbox-bundle", status: "pass", artifactSha256: digest });

  const manifest = {
    commit: resolvedCommit,
    qmBaseline: baseline.commit,
    sandboxDigest: digest,
    timestamp,
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
  safeJsonWrite(outputPath, manifest);
  return manifest;
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
  try {
    if (process.argv.length !== 2) fail("arguments invalid");
    const manifest = collectEvidence();
    process.stdout.write(`${DEFAULT_OUTPUT}\n`);
    if (!manifest.scoreSummary.pass || manifest.checks.some((check) => check.status !== "pass")) process.exitCode = 1;
  } catch {
    process.stderr.write("evidence-collection: invalid\n");
    process.exitCode = 1;
  }
}
