#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APPROVED_APPS = Object.freeze([
  "alpha-ticker-stage-a-hosted-core",
  "alpha-ticker-stage-a-hosted-web-ui",
  "alpha-ticker-stage-a-hosted-admin",
  "alpha-ticker-stage-a-hosted-portal",
  "alpha-ticker-stage-a-hosted-auth",
  "alpha-ticker-stage-a-hosted-sandboxes",
  "alpha-ticker-stage-a-egress",
]);
const APPROVED_APP_SET = new Set(APPROVED_APPS);
const INVENTORY_KEYS = Object.freeze([
  "flyOrg",
  "h2ResourceReconciliation",
  "apps",
  "managedPostgres",
  "objectStorage",
  "sandboxRegistry",
]);
const RECONCILIATION_STATES = new Set(["not-started", "unresolved", "complete"]);
const EXPECTED_ORG = "personal";
const MPG_NAME = "alpha-ticker-stage-a-hosted-pg";
const STORAGE_NAME = "alpha-ticker-stage-a-hosted-data";
const SANDBOX_REGISTRY_NAME = "alpha-ticker-stage-a-hosted-sandboxes";
const MPG_EMPTY = "No managed postgres clusters found in organization personal\n";
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/;
const RESOURCE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
const INVENTORY_LIMIT_BYTES = 64 * 1024;
const PROVIDER_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const ACTIVATION_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "activation-record.mjs");
const timeoutCandidate = Number(process.env.ALPHA_TICKER_RECONCILE_TIMEOUT_MS ?? "15000");
const COMMAND_TIMEOUT_MS =
  Number.isSafeInteger(timeoutCandidate) && timeoutCandidate >= 1000 && timeoutCandidate <= 30_000
    ? timeoutCandidate
    : null;

class ReconciliationError extends Error {}

function fail() {
  throw new ReconciliationError("resource reconciliation failed");
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) fail();
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function snapshotInventory(input) {
  if (typeof input !== "string" || input.length === 0 || !Number.isInteger(constants.O_NOFOLLOW)) fail();
  const requestedPath = resolve(input);
  let descriptor;
  try {
    const before = lstatSync(requestedPath, { bigint: true });
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1n ||
      Number(before.mode & 0o777n) !== 0o600 ||
      before.size > BigInt(INVENTORY_LIMIT_BYTES)
    ) {
      fail();
    }
    const path = realpathSync(requestedPath);
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameIdentity(before, opened)) fail();
    const buffer = Buffer.alloc(INVENTORY_LIMIT_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = readSync(descriptor, buffer, total, buffer.length - total, null);
      if (count === 0) break;
      total += count;
    }
    const afterRead = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(path, { bigint: true });
    if (
      total > INVENTORY_LIMIT_BYTES ||
      BigInt(total) !== opened.size ||
      !sameIdentity(opened, afterRead) ||
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      !sameIdentity(opened, afterPath)
    ) {
      fail();
    }
    let value;
    try {
      value = JSON.parse(buffer.subarray(0, total).toString("utf8"));
    } catch {
      fail();
    }
    return { path, metadata: opened, value };
  } catch (error) {
    if (error instanceof ReconciliationError) throw error;
    fail();
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the fixed primary failure marker.
      }
    }
  }
}

function validateInventory(value) {
  exactObject(value, INVENTORY_KEYS);
  if (
    value.flyOrg !== EXPECTED_ORG ||
    !RECONCILIATION_STATES.has(value.h2ResourceReconciliation) ||
    !Array.isArray(value.apps) ||
    value.apps.length < 1 ||
    value.apps.length > APPROVED_APPS.length
  ) {
    fail();
  }
  const ids = new Set();
  const names = new Set();
  const validateEntry = (entry, expectedName) => {
    exactObject(entry, ["name", "id"]);
    if (entry.name !== expectedName || typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) fail();
    if (ids.has(entry.id)) fail();
    ids.add(entry.id);
    return Object.freeze({ name: entry.name, id: entry.id });
  };
  const apps = value.apps.map((entry) => {
    if (!isPlainObject(entry) || !APPROVED_APP_SET.has(entry.name) || names.has(entry.name)) fail();
    names.add(entry.name);
    return validateEntry(entry, entry.name);
  });
  const optionalEntry = (entry, expectedName) => (entry === null ? null : validateEntry(entry, expectedName));
  const managedPostgres = optionalEntry(value.managedPostgres, MPG_NAME);
  const objectStorage = optionalEntry(value.objectStorage, STORAGE_NAME);
  const sandboxRegistry = optionalEntry(value.sandboxRegistry, SANDBOX_REGISTRY_NAME);
  if (value.h2ResourceReconciliation === "not-started" && (managedPostgres !== null || objectStorage !== null)) fail();
  return Object.freeze({
    flyOrg: EXPECTED_ORG,
    h2ResourceReconciliation: value.h2ResourceReconciliation,
    apps,
    managedPostgres,
    objectStorage,
    sandboxRegistry,
  });
}

function atomicReplaceInventory(snapshot, value) {
  const serialized = Buffer.from(`${JSON.stringify(value)}\n`);
  if (serialized.length > INVENTORY_LIMIT_BYTES) fail();
  const parent = dirname(snapshot.path);
  const parentBefore = lstatSync(parent, { bigint: true });
  if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory() || realpathSync(parent) !== parent) fail();
  const current = lstatSync(snapshot.path, { bigint: true });
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    current.nlink !== 1n ||
    Number(current.mode & 0o777n) !== 0o600 ||
    !sameIdentity(snapshot.metadata, current)
  ) {
    fail();
  }
  const temp = join(parent, `.resource-inventory.tmp-${process.pid}-${randomBytes(12).toString("hex")}`);
  let descriptor;
  let renamed = false;
  try {
    descriptor = openSync(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n) fail();
    fchmodSync(descriptor, 0o600);
    let offset = 0;
    while (offset < serialized.length) offset += writeSync(descriptor, serialized, offset, serialized.length - offset);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const tempStat = lstatSync(temp, { bigint: true });
    const targetBeforeRename = lstatSync(snapshot.path, { bigint: true });
    const parentAfter = lstatSync(parent, { bigint: true });
    if (
      tempStat.isSymbolicLink() ||
      !tempStat.isFile() ||
      tempStat.nlink !== 1n ||
      Number(tempStat.mode & 0o777n) !== 0o600 ||
      !sameIdentity(snapshot.metadata, targetBeforeRename) ||
      !parentAfter.isDirectory() ||
      sameDirectoryIdentity(parentBefore, parentAfter) === false
    ) {
      fail();
    }
    renameSync(temp, snapshot.path);
    renamed = true;
  } catch (error) {
    if (error instanceof ReconciliationError) throw error;
    fail();
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the fixed primary failure marker.
      }
    }
    if (!renamed) {
      try {
        unlinkSync(temp);
      } catch {
        // Preserve the fixed primary failure marker.
      }
    }
  }
}

function runFly(args) {
  if (COMMAND_TIMEOUT_MS === null) fail();
  const result = spawnSync(
    process.execPath,
    [ACTIVATION_SCRIPT, "--run-timeout", String(COMMAND_TIMEOUT_MS), "--", "fly", ...args],
    {
      encoding: "utf8",
      input: "",
      maxBuffer: PROVIDER_OUTPUT_LIMIT_BYTES + 1,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (
    result.error ||
    result.status !== 0 ||
    result.signal !== null ||
    typeof result.stdout !== "string" ||
    Buffer.byteLength(result.stdout, "utf8") > PROVIDER_OUTPUT_LIMIT_BYTES
  ) {
    fail();
  }
  return result.stdout;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    fail();
  }
}

function parseApps(text, existingApps) {
  const value = parseJson(text);
  if (!Array.isArray(value) || value.length > 10_000) fail();
  const seenIds = new Map();
  const seenNames = new Set();
  const discovered = new Map();
  const existingIds = new Map(existingApps.map((entry) => [entry.id, entry.name]));
  for (const entry of value) {
    if (!isPlainObject(entry) || !isPlainObject(entry.Organization)) fail();
    if (
      typeof entry.ID !== "string" ||
      !ID_PATTERN.test(entry.ID) ||
      typeof entry.Name !== "string" ||
      !RESOURCE_NAME_PATTERN.test(entry.Name) ||
      entry.Organization.Slug !== EXPECTED_ORG ||
      seenIds.has(entry.ID) ||
      seenNames.has(entry.Name)
    ) {
      fail();
    }
    seenIds.set(entry.ID, entry.Name);
    seenNames.add(entry.Name);
    if (existingIds.has(entry.ID) && existingIds.get(entry.ID) !== entry.Name) fail();
    if (APPROVED_APP_SET.has(entry.Name)) discovered.set(entry.Name, entry.ID);
  }
  const merged = new Map(existingApps.map((entry) => [entry.name, entry.id]));
  for (const [name, id] of discovered) {
    if (merged.has(name) && merged.get(name) !== id) fail();
    merged.set(name, id);
  }
  return APPROVED_APPS.filter((name) => merged.has(name)).map((name) => ({ name, id: merged.get(name) }));
}

function parseMpg(text, existing) {
  if (text === MPG_EMPTY) {
    if (existing !== null) fail();
    return null;
  }
  const value = parseJson(text);
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) fail();
  const ids = new Set();
  const names = new Set();
  let target = null;
  for (const entry of value) {
    exactObject(entry, [
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
    ]);
    exactObject(entry.organization, ["Slug"]);
    exactObject(entry.ip_assignments, ["direct"]);
    if (
      typeof entry.id !== "string" ||
      !ID_PATTERN.test(entry.id) ||
      typeof entry.mpgd_cluster_id !== "string" ||
      !ID_PATTERN.test(entry.mpgd_cluster_id) ||
      !Number.isSafeInteger(entry.version) ||
      typeof entry.name !== "string" ||
      !RESOURCE_NAME_PATTERN.test(entry.name) ||
      typeof entry.region !== "string" ||
      !/^[a-z0-9]{3,16}$/.test(entry.region) ||
      typeof entry.status !== "string" ||
      entry.status.length === 0 ||
      typeof entry.plan !== "string" ||
      entry.plan.length === 0 ||
      !Number.isSafeInteger(entry.disk) ||
      entry.disk < 0 ||
      !Number.isSafeInteger(entry.replicas) ||
      entry.replicas < 0 ||
      entry.organization.Slug !== EXPECTED_ORG ||
      typeof entry.ip_assignments.direct !== "string" ||
      !Array.isArray(entry.attached_apps) ||
      ids.has(entry.id) ||
      names.has(entry.name)
    ) {
      fail();
    }
    for (const app of entry.attached_apps) {
      exactObject(app, ["name", "id"]);
      if (
        typeof app.name !== "string" ||
        !RESOURCE_NAME_PATTERN.test(app.name) ||
        !Number.isSafeInteger(app.id) ||
        app.id < 0
      ) {
        fail();
      }
    }
    ids.add(entry.id);
    names.add(entry.name);
    if (entry.name === MPG_NAME) target = { name: MPG_NAME, id: entry.id };
  }
  if (existing !== null) {
    if (target === null || target.id !== existing.id) fail();
    return existing;
  }
  return target;
}

function parseStorage(text, existing) {
  if (typeof text !== "string" || !text.endsWith("\n\n") || text.includes("\r") || /\x1b/.test(text)) fail();
  const lines = text.slice(0, -2).split("\n");
  const parseRow = (line) => {
    const match = /^ ([^│]*) │ ([^│]*) $/.exec(line);
    if (!match) fail();
    return [match[1], match[2]];
  };
  const [headerName, headerOrg] = parseRow(lines.shift() ?? "");
  if (
    headerName.trimEnd() !== "NAME" ||
    headerOrg.trimEnd() !== "ORG" ||
    !/^NAME *$/.test(headerName) ||
    !/^ORG *$/.test(headerOrg)
  ) {
    fail();
  }
  const nameWidth = headerName.length;
  const orgWidth = headerOrg.length;
  const names = new Set();
  let target = null;
  for (const line of lines) {
    const [rawName, rawOrg] = parseRow(line);
    const name = rawName.trimEnd();
    const org = rawOrg.trimEnd();
    if (
      rawName.length !== nameWidth ||
      rawOrg.length !== orgWidth ||
      !RESOURCE_NAME_PATTERN.test(name) ||
      !new RegExp(`^${name} *$`).test(rawName) ||
      org !== EXPECTED_ORG ||
      !/^personal *$/.test(rawOrg) ||
      names.has(name)
    ) {
      fail();
    }
    names.add(name);
    if (name === STORAGE_NAME) target = { name: STORAGE_NAME, id: STORAGE_NAME };
  }
  if (existing !== null) {
    if (target === null || target.id !== existing.id) fail();
    return existing;
  }
  return target;
}

function begin(snapshot, inventory) {
  if (!new Set(["not-started", "complete"]).has(inventory.h2ResourceReconciliation)) fail();
  atomicReplaceInventory(snapshot, { ...inventory, h2ResourceReconciliation: "unresolved" });
}

function reconcile(snapshot, inventory) {
  if (inventory.h2ResourceReconciliation !== "unresolved") fail();
  const appsOutput = runFly(["apps", "list", "--org", EXPECTED_ORG, "--json"]);
  const mpgOutput = runFly(["mpg", "list", "--json", "--org", EXPECTED_ORG]);
  const storageOutput = runFly(["storage", "list", "--org", EXPECTED_ORG]);
  const apps = parseApps(appsOutput, inventory.apps);
  const managedPostgres = parseMpg(mpgOutput, inventory.managedPostgres);
  const objectStorage = parseStorage(storageOutput, inventory.objectStorage);
  const completed = validateInventory({
    ...inventory,
    apps,
    managedPostgres,
    objectStorage,
    h2ResourceReconciliation: "complete",
  });
  atomicReplaceInventory(snapshot, completed);
}

function cli() {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3 || !["--begin", "--reconcile"].includes(args[0]) || args[1] !== "--inventory" || !args[2]) {
      fail();
    }
    const snapshot = snapshotInventory(args[2]);
    const inventory = validateInventory(snapshot.value);
    if (args[0] === "--begin") {
      begin(snapshot, inventory);
      process.stdout.write("resource-reconciliation: unresolved\n");
    } else {
      reconcile(snapshot, inventory);
      process.stdout.write("resource-reconciliation: complete\n");
    }
  } catch {
    process.stdout.write("");
    process.stderr.write("resource-reconciliation-failed\n");
    process.exitCode = 1;
  }
}

cli();
