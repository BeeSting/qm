#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_RECORD = Object.freeze({
  sponsorApproved: true,
  flyOrg: "personal",
  flyRegion: "jnb",
  provider: "openai",
  providerProjectDedicated: true,
  providerMaxExposureUsd: 50,
  autoRecharge: false,
  retentionReviewed: true,
  syntheticOnly: true,
  participantCount: 3,
  teardownScheduled: true,
});

const SECRET_KEY = /(?:api[_-]?key|authorization|credential|password|private[_-]?key|secret|token)/i;
const PARTICIPANT_IDENTITY_KEY = /^(?:participants?|participant(?:email|identit(?:y|ies)|ids?|names?))$/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVATION_INPUT_LIMIT_BYTES = 64 * 1024;
const FLY_JSON_INPUT_LIMIT_BYTES = 1024 * 1024;
const QM_METADATA_INPUT_LIMIT_BYTES = 1024 * 1024;
const QM_PACKAGE_VERSION = "0.1.4";
const QM_PACKAGE_NAME = "@yc-software/qm";
const QM_PACKAGE_RESOLVED = "https://registry.npmjs.org/@yc-software/qm/-/qm-0.1.4.tgz";
const QM_PACKAGE_INTEGRITY =
  "sha512-L3WWtV+yjhBq7ARYJxNzTpV4cdvw8ZCYXVk0kRUUPjKwH7NObz8newikeCZwijvpmEEEnDLTi02O+nowQTDC4Q==";
const QM_PACKAGE_TREE_DIGEST = "207ccd131e662bfa4a982dd597935bb209f42cc78b996a75d3e3c0d5da3e6647";
const QM_PACKAGE_ENTRY_LIMIT = 1024;
const QM_PACKAGE_FILE_LIMIT_BYTES = 8 * 1024 * 1024;
const QM_PACKAGE_TOTAL_LIMIT_BYTES = 64 * 1024 * 1024;
// Contracts verified against superfly/flyctl 63696879b4fc149d71a9a75123df2111a7c28c8f.
const MPG_EMPTY_STATE = "No managed postgres clusters found in organization personal\n";
const FORBIDDEN_APP_NAMES = new Set([
  "alpha-ticker-stage-a-hosted-core",
  "alpha-ticker-stage-a-hosted-web-ui",
  "alpha-ticker-stage-a-hosted-admin",
  "alpha-ticker-stage-a-hosted-portal",
  "alpha-ticker-stage-a-hosted-auth",
  "alpha-ticker-stage-a-hosted-sandboxes",
  "alpha-ticker-stage-a-egress",
]);

class ActivationRecordError extends Error {
  constructor(field) {
    super(`invalid activation field: ${field}`);
    this.name = "ActivationRecordError";
    this.field = field;
  }
}

function invalid(field) {
  const safeField = typeof field === "string" && /^[A-Za-z][A-Za-z0-9_.[\]-]{0,79}$/.test(field) ? field : "record";
  throw new ActivationRecordError(safeField);
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.length && expected.every((key) => actual.includes(key));
}

function isResourceName(value) {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(value);
}

function inspectForSensitiveData(value, field = "record", seen = new WeakSet()) {
  if (typeof value === "string" && EMAIL_VALUE.test(value)) invalid(field);
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) invalid(field);
  seen.add(value);

  const descriptors = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") invalid("record");
    if (Array.isArray(value) && key === "length") continue;
    if (SECRET_KEY.test(key) || PARTICIPANT_IDENTITY_KEY.test(key)) invalid(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalid(key);
    descriptors.push([key, descriptor]);
  }

  for (const [key, descriptor] of descriptors) {
    inspectForSensitiveData(descriptor.value, Array.isArray(value) ? `${field}[${key}]` : key, seen);
  }
}

export function assertActivationRecord(record) {
  if (
    typeof record !== "object" ||
    record === null ||
    Array.isArray(record) ||
    Object.getPrototypeOf(record) !== Object.prototype
  ) {
    invalid("record");
  }
  inspectForSensitiveData(record);

  const expectedKeys = Reflect.ownKeys(EXPECTED_RECORD);
  const suppliedKeys = Reflect.ownKeys(record);
  for (const key of suppliedKeys) {
    if (typeof key !== "string") invalid("record");
    if (!Object.hasOwn(EXPECTED_RECORD, key)) invalid(key);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid(key);
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor) || descriptor.value !== EXPECTED_RECORD[key]) invalid(key);
  }
}

function parseJson(text, field) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    invalid(field);
  }
  return value;
}

function parseFlyInventory(kind, text) {
  if (kind === "mpg" && text === MPG_EMPTY_STATE) return { inventory: [], names: [] };
  let inventory;
  inventory = parseJson(text, kind);
  if (!Array.isArray(inventory)) invalid(kind);
  if (kind === "mpg" && inventory.length === 0) invalid(kind);
  const names = [];
  for (const item of inventory) {
    if (kind === "regions") {
      const keys = [
        "code",
        "name",
        "latitude",
        "longitude",
        "gateway_available",
        "requires_paid_plan",
        "deprecated",
        "capacity",
        "geo_region",
      ];
      if (
        !hasExactKeys(item, keys) ||
        typeof item.code !== "string" ||
        !/^[a-z0-9]{3,16}$/.test(item.code) ||
        typeof item.name !== "string" ||
        item.name.length === 0 ||
        typeof item.latitude !== "number" ||
        !Number.isFinite(item.latitude) ||
        typeof item.longitude !== "number" ||
        !Number.isFinite(item.longitude) ||
        typeof item.gateway_available !== "boolean" ||
        typeof item.requires_paid_plan !== "boolean" ||
        typeof item.deprecated !== "boolean" ||
        !Number.isSafeInteger(item.capacity) ||
        typeof item.geo_region !== "string" ||
        item.geo_region.length === 0
      ) {
        invalid(kind);
      }
      names.push(item.name);
      continue;
    }

    if (kind === "apps") {
      if (
        !isPlainObject(item) ||
        !isResourceName(item.Name) ||
        !isPlainObject(item.Organization) ||
        item.Organization.Slug !== "personal"
      ) {
        invalid(kind);
      }
      names.push(item.Name);
      continue;
    }

    const mpgKeys = [
      "id",
      "mpgd_cluster_id",
      "version",
      "name",
      "region",
      "status",
      "plan",
      "disk",
      "replicas",
      "organization",
      "ip_assignments",
      "attached_apps",
    ];
    if (
      !hasExactKeys(item, mpgKeys) ||
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      typeof item.mpgd_cluster_id !== "string" ||
      item.mpgd_cluster_id.length === 0 ||
      !Number.isSafeInteger(item.version) ||
      !isResourceName(item.name) ||
      typeof item.region !== "string" ||
      !/^[a-z0-9]{3,16}$/.test(item.region) ||
      typeof item.status !== "string" ||
      typeof item.plan !== "string" ||
      !Number.isSafeInteger(item.disk) ||
      item.disk < 0 ||
      !Number.isSafeInteger(item.replicas) ||
      item.replicas < 0 ||
      !isPlainObject(item.organization) ||
      item.organization.Slug !== "personal" ||
      !hasExactKeys(item.ip_assignments, ["direct"]) ||
      typeof item.ip_assignments.direct !== "string" ||
      !Array.isArray(item.attached_apps) ||
      !item.attached_apps.every(
        (app) =>
          hasExactKeys(app, ["name", "id"]) && isResourceName(app.name) && Number.isSafeInteger(app.id) && app.id >= 0,
      )
    ) {
      invalid(kind);
    }
    names.push(item.name);
  }
  return { inventory, names };
}

export function assertFlyInventory(kind, text) {
  if (!["regions", "apps", "mpg"].includes(kind) || typeof text !== "string") invalid("fly-json");
  const { inventory, names } = parseFlyInventory(kind, text);

  if (kind === "regions" && !inventory.some((item) => item.code === "jnb")) invalid(kind);
  if (kind === "apps" && names.some((name) => FORBIDDEN_APP_NAMES.has(name))) invalid(kind);
  if (kind === "mpg" && names.includes("alpha-ticker-stage-a-hosted-pg")) invalid(kind);
}

export function assertFlyStorageTable(text) {
  if (typeof text !== "string" || !text.endsWith("\n\n") || text.includes("\r") || /\x1b/.test(text))
    invalid("storage");
  const lines = text.slice(0, -2).split("\n");
  const parseRow = (line) => {
    const match = /^ ([^│]*) │ ([^│]*) $/.exec(line);
    if (!match) invalid("storage");
    return [match[1], match[2]];
  };
  const [headerName, headerOrganization] = parseRow(lines.shift() ?? "");
  if (headerName.trimEnd() !== "NAME" || headerOrganization.trimEnd() !== "ORG") invalid("storage");
  if (!/^NAME *$/.test(headerName) || !/^ORG *$/.test(headerOrganization)) invalid("storage");
  const nameWidth = headerName.length;
  const organizationWidth = headerOrganization.length;
  const names = [];
  for (const line of lines) {
    const [rawName, rawOrganization] = parseRow(line);
    const name = rawName.trimEnd();
    const organization = rawOrganization.trimEnd();
    if (
      rawName.length !== nameWidth ||
      rawOrganization.length !== organizationWidth ||
      !isResourceName(name) ||
      !new RegExp(`^${name} *$`).test(rawName) ||
      organization !== "personal" ||
      !/^personal *$/.test(rawOrganization)
    ) {
      invalid("storage");
    }
    names.push(name);
  }
  if (names.includes("alpha-ticker-stage-a-hosted-data")) invalid("storage");
}

function readBoundedRegularFile(input, limit) {
  let descriptor;
  try {
    descriptor = openSync(input, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > limit) invalid("input");
    const buffer = Buffer.alloc(limit + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > limit) invalid("input");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (error instanceof ActivationRecordError) throw error;
    invalid("input");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readJsonMetadata(input, field) {
  try {
    return parseJson(readBoundedRegularFile(input, QM_METADATA_INPUT_LIMIT_BYTES), field);
  } catch {
    invalid(field);
  }
}

export function calculateQmPackageTreeDigest(packageRoot) {
  const hash = createHash("sha256");
  let entryCount = 0;
  let totalBytes = 0;

  function walk(directory, relativeDirectory = "") {
    const names = readdirSync(directory).sort((left, right) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    for (const name of names) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const absolutePath = join(directory, name);
      const metadata = lstatSync(absolutePath);
      entryCount += 1;
      if (entryCount > QM_PACKAGE_ENTRY_LIMIT) invalid("qmTreeDigest");

      if (metadata.isDirectory()) {
        hash.update(`d\0${relativePath}\0`);
        hash.update("\0");
        walk(absolutePath, relativePath);
        continue;
      }
      if (!metadata.isFile() || metadata.size > QM_PACKAGE_FILE_LIMIT_BYTES) invalid("qmTreeDigest");
      totalBytes += metadata.size;
      if (totalBytes > QM_PACKAGE_TOTAL_LIMIT_BYTES) invalid("qmTreeDigest");
      hash.update(`f\0${relativePath}\0${metadata.size}\0`);
      hash.update(readFileSync(absolutePath));
      hash.update("\0");
    }
  }

  try {
    const rootMetadata = lstatSync(packageRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) invalid("qmTreeDigest");
    walk(packageRoot);
    return hash.digest("hex");
  } catch (error) {
    if (error instanceof ActivationRecordError) throw error;
    invalid("qmTreeDigest");
  }
}

export function assertQmInstall(deploymentRoot, expectedDigest = QM_PACKAGE_TREE_DIGEST) {
  const dependency = readJsonMetadata(join(deploymentRoot, "package.json"), "packageDependency");
  if (
    !isPlainObject(dependency) ||
    !hasExactKeys(dependency.dependencies, [QM_PACKAGE_NAME]) ||
    dependency.dependencies[QM_PACKAGE_NAME] !== QM_PACKAGE_VERSION
  ) {
    invalid("packageDependency");
  }

  const lock = readJsonMetadata(join(deploymentRoot, "package-lock.json"), "lockVersion");
  const rootLock = lock?.packages?.[""];
  const packageLock = lock?.packages?.[`node_modules/${QM_PACKAGE_NAME}`];
  if (
    lock?.lockfileVersion !== 3 ||
    lock?.requires !== true ||
    !isPlainObject(rootLock) ||
    !hasExactKeys(rootLock.dependencies, [QM_PACKAGE_NAME]) ||
    rootLock.dependencies[QM_PACKAGE_NAME] !== QM_PACKAGE_VERSION ||
    !isPlainObject(packageLock) ||
    packageLock.version !== QM_PACKAGE_VERSION
  ) {
    invalid("lockVersion");
  }
  if (packageLock.resolved !== QM_PACKAGE_RESOLVED) invalid("lockResolved");
  if (packageLock.integrity !== QM_PACKAGE_INTEGRITY) invalid("lockIntegrity");

  const packageRoot = join(deploymentRoot, "node_modules", "@yc-software", "qm");
  const installed = readJsonMetadata(join(packageRoot, "package.json"), "installedPackage");
  if (
    !isPlainObject(installed) ||
    installed.name !== QM_PACKAGE_NAME ||
    installed.version !== QM_PACKAGE_VERSION ||
    !hasExactKeys(installed.bin, ["qm"]) ||
    installed.bin.qm !== "dist/bin/qm.js"
  ) {
    invalid("installedPackage");
  }

  const executableLink = join(deploymentRoot, "node_modules", ".bin", "qm");
  const expectedExecutable = join(packageRoot, "dist", "bin", "qm.js");
  try {
    if (!lstatSync(executableLink).isSymbolicLink()) invalid("qmExecutable");
    if (readlinkSync(executableLink) !== "../@yc-software/qm/dist/bin/qm.js") invalid("qmExecutable");
    if (realpathSync(executableLink) !== realpathSync(expectedExecutable)) invalid("qmExecutable");
    const executableMetadata = statSync(expectedExecutable);
    if (!executableMetadata.isFile() || (executableMetadata.mode & 0o111) === 0) invalid("qmExecutable");
  } catch (error) {
    if (error instanceof ActivationRecordError) throw error;
    invalid("qmExecutable");
  }

  if (calculateQmPackageTreeDigest(packageRoot) !== expectedDigest) invalid("qmTreeDigest");
}

function isDirectExecution(argvEntry) {
  if (!argvEntry || argvEntry === "-") return false;
  try {
    const candidateUrl = pathToFileURL(resolve(argvEntry));
    if (candidateUrl.href === import.meta.url) return true;
    return realpathSync(fileURLToPath(candidateUrl)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function commandFromArgs(args) {
  if (args.length === 2 && args[0] === "--input" && args[1]) {
    return { command: "activation", input: args[1] };
  }
  if (args.length === 4 && args[0] === "--fly-json" && args[1] && args[2] === "--input" && args[3]) {
    return { command: "fly-json", kind: args[1], input: args[3] };
  }
  if (args.length === 3 && args[0] === "--fly-storage-table" && args[1] === "--input" && args[2]) {
    return { command: "fly-storage-table", input: args[2] };
  }
  if (args.length === 3 && args[0] === "--verify-qm-install" && args[1] === "--root" && args[2]) {
    return { command: "verify-qm-install", root: args[2] };
  }
  invalid("input");
}

function signalProcessGroup(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The process may have exited between the timer and signal.
  }
}

async function runTimedCommand(args) {
  if (args.length < 4 || args[0] !== "--run-timeout" || args[2] !== "--") return false;
  const timeoutMs = Number(args[1]);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000 || !args[3]) {
    process.exitCode = 1;
    return true;
  }

  const child = spawn(args[3], args.slice(4), {
    stdio: ["ignore", "inherit", "inherit"],
    detached: process.platform !== "win32",
  });
  let timedOut = false;
  let hardKillTimer;
  const exitCode = await new Promise((complete) => {
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      hardKillTimer = setTimeout(() => signalProcessGroup(child, "SIGKILL"), 250);
      signalProcessGroup(child, "SIGTERM");
    }, timeoutMs);

    const finish = (code) => {
      clearTimeout(timeoutTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      complete(timedOut ? 124 : code);
    };
    child.once("error", () => finish(1));
    child.once("exit", (code) => finish(Number.isInteger(code) ? code : 1));
  });
  process.exitCode = exitCode;
  return true;
}

async function runCli() {
  if (await runTimedCommand(process.argv.slice(2))) return;
  let outputKind = "activation-record";
  try {
    const request = commandFromArgs(process.argv.slice(2));
    if (request.command === "fly-json") {
      outputKind = "fly-json";
      const json = readBoundedRegularFile(request.input, FLY_JSON_INPUT_LIMIT_BYTES);
      assertFlyInventory(request.kind, json);
      process.stdout.write("fly-json: pass\n");
      return;
    }
    if (request.command === "fly-storage-table") {
      outputKind = "fly-storage-table";
      const table = readBoundedRegularFile(request.input, FLY_JSON_INPUT_LIMIT_BYTES);
      assertFlyStorageTable(table);
      process.stdout.write("fly-storage-table: pass\n");
      return;
    }
    if (request.command === "verify-qm-install") {
      outputKind = "qm-install";
      assertQmInstall(request.root);
      process.stdout.write("qm-install: pass\n");
      return;
    }

    let record;
    try {
      record = JSON.parse(readBoundedRegularFile(request.input, ACTIVATION_INPUT_LIMIT_BYTES));
    } catch (error) {
      if (error instanceof ActivationRecordError) throw error;
      invalid("input");
    }
    assertActivationRecord(record);
    process.stdout.write("activation-record: pass\n");
  } catch (error) {
    const field = error instanceof ActivationRecordError ? error.field : "input";
    process.stderr.write(`${outputKind}: fail ${field}\n`);
    process.exitCode = 1;
  }
}

if (isDirectExecution(process.argv[1])) await runCli();
