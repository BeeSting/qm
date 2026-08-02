#!/usr/bin/env bash

set -euo pipefail

EXPECTED_CONFIRM="alpha-ticker-stage-a-hosted"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)

APPS=(
  alpha-ticker-stage-a-hosted-core
  alpha-ticker-stage-a-hosted-web-ui
  alpha-ticker-stage-a-hosted-admin
  alpha-ticker-stage-a-hosted-portal
  alpha-ticker-stage-a-hosted-auth
  alpha-ticker-stage-a-hosted-sandboxes
  alpha-ticker-stage-a-egress
)
DATA_RESOURCES=(
  alpha-ticker-stage-a-hosted-pg
  alpha-ticker-stage-a-hosted-data
)

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [[ "${1:-}" == "--dry-run" && $# -eq 1 ]]; then
  printf '%s\n' "${APPS[@]}" "${DATA_RESOURCES[@]}"
  exit 0
fi

if [[ "${1:-}" != "--execute" || $# -ne 1 ]]; then
  fail "teardown-usage-invalid"
fi
if [[ "${STAGE_A_DESTROY_CONFIRM:-}" != "$EXPECTED_CONFIRM" ]]; then
  fail "teardown-confirmation-required"
fi

node - "$REPO_ROOT" <<'NODE'
"use strict";

const { spawnSync } = require("node:child_process");
const { closeSync, constants, fstatSync, lstatSync, openSync, readSync } = require("node:fs");
const { join, resolve } = require("node:path");

const root = resolve(process.argv[2]);
const deployment = join(root, "deploy", "layers", "alpha-ticker-stage-a-hosted");
const generated = join(root, ".generated", "alpha-ticker-stage-a-hosted");
const activationScript = join(root, "scripts", "alpha-ticker-stage-a-hosted", "activation-record.mjs");
const expectedOrg = "personal";
const apps = [
  "alpha-ticker-stage-a-hosted-core",
  "alpha-ticker-stage-a-hosted-web-ui",
  "alpha-ticker-stage-a-hosted-admin",
  "alpha-ticker-stage-a-hosted-portal",
  "alpha-ticker-stage-a-hosted-auth",
  "alpha-ticker-stage-a-hosted-sandboxes",
  "alpha-ticker-stage-a-egress",
];
const qmManagedApps = [
  "alpha-ticker-stage-a-hosted-core",
  "alpha-ticker-stage-a-hosted-web-ui",
  "alpha-ticker-stage-a-hosted-admin",
  "alpha-ticker-stage-a-hosted-portal",
  "alpha-ticker-stage-a-hosted-auth",
];
const inventoryPath = join(generated, "resource-inventory.json");
const teardownEvidencePath = join(generated, "teardown-evidence.json");
const maxInputBytes = 64 * 1024;
const maxCommandBytes = 64 * 1024;
const timeoutCandidate = Number(process.env.ALPHA_TICKER_TEARDOWN_TIMEOUT_MS ?? "15000");
const requestedTimeoutMs =
  Number.isSafeInteger(timeoutCandidate) && timeoutCandidate >= 100 && timeoutCandidate <= 30_000
    ? timeoutCandidate
    : null;
const timeoutMs = requestedTimeoutMs === null ? null : Math.max(requestedTimeoutMs, 1_500);

function stop(message, status = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(status);
}

function exactObject(value, keys, kind) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    stop(kind);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) stop(kind);
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

function snapshotFile(path, kind, { privateMode = false, maxBytes = maxInputBytes } = {}) {
  let descriptor;
  try {
    const before = lstatSync(path, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(maxBytes)) stop(kind);
    if (privateMode && Number(before.mode & 0o777n) !== 0o600) stop(kind);
    if (!Number.isInteger(constants.O_NOFOLLOW)) stop(kind);
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameIdentity(before, opened) || opened.size > BigInt(maxBytes)) stop(kind);
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = readSync(descriptor, buffer, total, buffer.length - total, null);
      if (count === 0) break;
      total += count;
    }
    const afterRead = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(path, { bigint: true });
    if (
      total > maxBytes ||
      BigInt(total) !== opened.size ||
      !sameIdentity(opened, afterRead) ||
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      !sameIdentity(opened, afterPath)
    ) {
      stop(kind);
    }
    return Buffer.from(buffer.subarray(0, total));
  } catch (error) {
    if (error && error.__teardownStop) throw error;
    stop(kind);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the fixed primary error surface.
      }
    }
  }
}

function parseJsonSnapshot(path, kind, options) {
  try {
    const value = JSON.parse(snapshotFile(path, kind, options).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) stop(kind);
    return value;
  } catch {
    stop(kind);
  }
}

function validateInventory() {
  const value = parseJsonSnapshot(inventoryPath, "resource-inventory-invalid", { privateMode: true });
  exactObject(
    value,
    ["flyOrg", "h2ResourceReconciliation", "apps", "managedPostgres", "objectStorage", "sandboxRegistry"],
    "resource-inventory-invalid",
  );
  if (
    value.flyOrg !== expectedOrg ||
    !["not-started", "unresolved", "complete"].includes(value.h2ResourceReconciliation) ||
    !Array.isArray(value.apps) ||
    value.apps.length < 1 ||
    value.apps.length > apps.length
  ) {
    stop("resource-inventory-invalid");
  }
  const ids = new Set();
  const names = new Set();
  const validateEntry = (entry, expectedName) => {
    exactObject(entry, ["name", "id"], "resource-inventory-invalid");
    if (entry.name !== expectedName || typeof entry.id !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(entry.id)) {
      stop("resource-inventory-invalid");
    }
    if (ids.has(entry.id)) stop("resource-inventory-invalid");
    ids.add(entry.id);
    return entry.id;
  };
  const appIds = new Map();
  for (const entry of value.apps) {
    if (!entry || !apps.includes(entry.name) || names.has(entry.name)) stop("resource-inventory-invalid");
    appIds.set(entry.name, validateEntry(entry, entry.name));
    names.add(entry.name);
  }
  const optionalEntry = (entry, expectedName) => (entry === null ? false : Boolean(validateEntry(entry, expectedName)));
  const managedPostgresCaptured = optionalEntry(value.managedPostgres, "alpha-ticker-stage-a-hosted-pg");
  const objectStorageCaptured = optionalEntry(value.objectStorage, "alpha-ticker-stage-a-hosted-data");
  optionalEntry(value.sandboxRegistry, "alpha-ticker-stage-a-hosted-sandboxes");
  if (value.h2ResourceReconciliation === "not-started" && (managedPostgresCaptured || objectStorageCaptured)) {
    stop("resource-inventory-invalid");
  }
  return {
    appIds,
    h2ResourceReconciliation: value.h2ResourceReconciliation,
    managedPostgresCaptured,
    objectStorageCaptured,
  };
}

function validateTeardownEvidence({ managedPostgresCaptured, objectStorageCaptured }) {
  if (!managedPostgresCaptured && !objectStorageCaptured) return true;
  const value = parseJsonSnapshot(teardownEvidencePath, "teardown-evidence-invalid", { privateMode: true });
  exactObject(
    value,
    ["managedPostgresDeleted", "objectStorageDeleted", "managedPostgresDeletedAt", "objectStorageDeletedAt"],
    "teardown-evidence-invalid",
  );
  for (const prefix of ["managedPostgres", "objectStorage"]) {
    const deleted = value[`${prefix}Deleted`];
    const timestamp = value[`${prefix}DeletedAt`];
    if (typeof deleted !== "boolean") stop("teardown-evidence-invalid");
    if (deleted ? typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp)) : timestamp !== null) {
      stop("teardown-evidence-invalid");
    }
  }
  return (
    (!managedPostgresCaptured || value.managedPostgresDeleted === true) &&
    (!objectStorageCaptured || value.objectStorageDeleted === true)
  );
}

function run(command, args, failure) {
  if (timeoutMs === null) stop(failure);
  const result = spawnSync(
    process.execPath,
    [activationScript, "--run-timeout", String(timeoutMs), "--", command, ...args],
    {
      cwd: deployment,
      encoding: "utf8",
      input: "",
      maxBuffer: maxCommandBytes,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0 || result.signal !== null) stop(failure);
  if (Buffer.byteLength(result.stdout ?? "", "utf8") > maxCommandBytes) stop(failure);
  return result.stdout;
}

function verifyQmInstall() {
  const result = spawnSync(
    process.execPath,
    [activationScript, "--verify-qm-install", "--root", deployment],
    {
      cwd: deployment,
      encoding: "utf8",
      input: "",
      maxBuffer: maxCommandBytes,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0 || result.signal !== null) stop("qm-install-invalid");
  return join(deployment, "node_modules", "@yc-software", "qm", "dist", "bin", "qm.js");
}

function parseFlyInventory(text, appIds) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    stop("fly-inventory-invalid");
  }
  if (!Array.isArray(value) || value.length > 10_000) stop("fly-inventory-invalid");
  const exact = new Map();
  const expectedIds = new Map([...appIds.entries()].map(([name, id]) => [id, name]));
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) stop("fly-inventory-invalid");
    if (typeof entry.ID !== "string" || typeof entry.Name !== "string" || typeof entry.Organization !== "string") {
      stop("fly-inventory-invalid");
    }
    if (expectedIds.has(entry.ID) && expectedIds.get(entry.ID) !== entry.Name) stop("fly-identity-refused");
    if (apps.includes(entry.Name) && !appIds.has(entry.Name)) stop("fly-uncaptured-app-refused");
    if (!appIds.has(entry.Name)) continue;
    if (exact.has(entry.Name)) stop("fly-inventory-invalid");
    if (entry.Organization !== expectedOrg) stop("fly-ownership-refused");
    if (entry.ID !== appIds.get(entry.Name)) stop("fly-identity-refused");
    exact.set(entry.Name, true);
  }
  return exact;
}

function listFlyApps(appIds) {
  return parseFlyInventory(run("fly", ["apps", "list", "--org", expectedOrg, "--json"], "fly-inventory-invalid"), appIds);
}

const inventory = validateInventory();
const appIds = inventory.appIds;
const deletionComplete =
  inventory.h2ResourceReconciliation === "unresolved" ? false : validateTeardownEvidence(inventory);
const qmBin = verifyQmInstall();
const initialApps = listFlyApps(appIds);
if (initialApps.size > 0) {
  const qmManagedSetEligible = qmManagedApps.every((app) => appIds.has(app) && initialApps.has(app));
  if (qmManagedSetEligible) run(qmBin, ["down"], "qm-down-failed");
  for (const app of apps) {
    const current = listFlyApps(appIds);
    if (current.has(app)) run("fly", ["apps", "destroy", app, "--yes"], "fly-destroy-failed");
  }
  if (listFlyApps(appIds).size !== 0) stop("fly-apps-still-present");
}

if (inventory.h2ResourceReconciliation === "unresolved") stop("h2-resource-reconciliation-required", 3);
if (!deletionComplete) stop("manual-data-destruction-required", 3);
process.stdout.write("teardown-complete\n");
NODE
