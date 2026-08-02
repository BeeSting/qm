#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FORBIDDEN_KEYS = new Set(["prompt", "response", "packetBody", "providerRequest", "secret", "tokenValue"]);
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "commit",
  "qmBaseline",
  "timestamp",
  "checks",
  "counts",
  "contentCaptured",
]);
const DEFAULT_OUTPUT = ".generated/alpha-ticker-stage-a/evidence-manifest.json";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function hashFile(path) {
  return sha256(readFileSync(path));
}

function listSkillFiles(root) {
  const results = [];
  for (const directory of readdirSync(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const path = join(root, directory.name, "SKILL.md");
    results.push(path);
  }
  return results.sort();
}

function hashBundle(paths, repoRoot) {
  const index = paths.map((path) => `${relative(repoRoot, path)}:${hashFile(path)}`).join("\n");
  return sha256(index);
}

function visitKeys(value, path = "manifest") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`forbidden evidence key at ${path}.${key}`);
    visitKeys(nested, `${path}.${key}`);
  }
}

export function assertEvidenceSafe(manifest) {
  visitKeys(manifest);
  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) throw new Error(`unsupported evidence key: ${key}`);
  }
  if (manifest.contentCaptured !== false) throw new Error("contentCaptured must be false");
  if (!/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error("commit must be a Git SHA-1");
  if (!/^[a-f0-9]{40}$/.test(manifest.qmBaseline)) throw new Error("qmBaseline must be a Git SHA-1");
  if (!Number.isFinite(Date.parse(manifest.timestamp))) throw new Error("timestamp must be ISO-8601");
  if (!Array.isArray(manifest.checks)) throw new Error("checks must be an array");
  for (const check of manifest.checks) {
    if (typeof check.id !== "string" || !check.id) throw new Error("check id is required");
    if (check.status !== "pass" && check.status !== "fail") throw new Error("check status must be pass or fail");
    if (!/^[a-f0-9]{64}$/.test(check.artifactSha256)) throw new Error("artifactSha256 must be SHA-256");
  }
  if (
    !manifest.counts ||
    !Number.isInteger(manifest.counts.tests) ||
    manifest.counts.tests < 0 ||
    !Number.isInteger(manifest.counts.failures) ||
    manifest.counts.failures < 0 ||
    manifest.counts.principals !== 3
  ) {
    throw new Error("counts are invalid");
  }
}

export function buildEvidenceManifest({ commit, qmBaseline, timestamp, checks, counts }) {
  const manifest = {
    commit,
    qmBaseline,
    timestamp,
    checks,
    counts,
    contentCaptured: false,
  };
  assertEvidenceSafe(manifest);
  return manifest;
}

export function collectEvidence({ repoRoot = process.cwd(), tests, failures, timestamp = new Date().toISOString() }) {
  const root = resolve(repoRoot);
  const deployment = join(root, "deploy/layers/alpha-ticker-stage-a");
  const baseline = JSON.parse(readFileSync(join(root, "UPSTREAM.lock.json"), "utf8"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const status = failures === 0 ? "pass" : "fail";
  const checkFiles = [
    ["source-pin", join(root, "UPSTREAM.lock.json")],
    ["policy", join(deployment, "stage-a-policy.json")],
    ["deployment-config", join(deployment, "qm.config.jsonc")],
    ["tool-descriptor", join(deployment, "sandbox/tools/alpha-packet/tool.json")],
  ];
  const checks = checkFiles.map(([id, path]) => ({ id, status, artifactSha256: hashFile(path) }));
  checks.push({
    id: "workflow-bundle",
    status,
    artifactSha256: hashBundle(listSkillFiles(join(deployment, "sandbox/skills")), root),
  });
  checks.push({
    id: "deterministic-test-summary",
    status,
    artifactSha256: sha256(`tests=${tests};failures=${failures};principals=3`),
  });
  return buildEvidenceManifest({
    commit,
    qmBaseline: baseline.commit,
    timestamp,
    checks,
    counts: { tests, failures, principals: 3 },
  });
}

function integerArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function stringArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function runCli() {
  try {
    const tests = integerArg("--tests", 0);
    const failures = integerArg("--failures", 0);
    const output = stringArg("--output", DEFAULT_OUTPUT);
    const timestamp = stringArg("--timestamp", new Date().toISOString());
    if (!output || !timestamp) throw new Error("missing output or timestamp");
    const manifest = collectEvidence({ tests, failures, timestamp });
    const outputPath = resolve(output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    chmodSync(outputPath, 0o600);
    process.stdout.write(`${relative(process.cwd(), outputPath)}\n`);
    if (failures > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`evidence-collection: ${error instanceof Error ? error.message : "failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli();
