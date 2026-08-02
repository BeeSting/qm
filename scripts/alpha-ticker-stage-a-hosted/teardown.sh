#!/usr/bin/env bash

set -euo pipefail

EXPECTED_ORG="personal"
EXPECTED_CONFIRM="alpha-ticker-stage-a-hosted"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)
DEPLOYMENT_ROOT="${REPO_ROOT}/deploy/layers/alpha-ticker-stage-a-hosted"
GENERATED_ROOT="${REPO_ROOT}/.generated/alpha-ticker-stage-a-hosted"
QM_BIN="${DEPLOYMENT_ROOT}/node_modules/.bin/qm"
INVENTORY_FILE="${GENERATED_ROOT}/resource-inventory.json"
TEARDOWN_EVIDENCE_FILE="${GENERATED_ROOT}/teardown-evidence.json"

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

file_mode() {
  local mode
  mode=$(stat -f '%Lp' "$1" 2>/dev/null || true)
  case "$mode" in
    ""|*[!0-7]*) mode=$(stat -c '%a' "$1" 2>/dev/null || true) ;;
  esac
  printf '%s' "$mode"
}

validate_private_json_file() {
  local path=$1
  local kind=$2
  if [[ ! -f "$path" || -L "$path" || "$(file_mode "$path")" != "600" ]]; then
    fail "$kind"
  fi
  node - "$path" "$kind" <<'NODE' >/dev/null 2>&1 || fail "$kind"
const fs = require("node:fs");
const [path, kind] = process.argv.slice(2);
const stat = fs.lstatSync(path);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) process.exit(2);
const value = JSON.parse(fs.readFileSync(path, "utf8"));
if (!value || typeof value !== "object" || Array.isArray(value)) process.exit(2);
if (kind === "resource-inventory-invalid") {
  const apps = [
    "alpha-ticker-stage-a-hosted-core",
    "alpha-ticker-stage-a-hosted-web-ui",
    "alpha-ticker-stage-a-hosted-admin",
    "alpha-ticker-stage-a-hosted-portal",
    "alpha-ticker-stage-a-hosted-auth",
    "alpha-ticker-stage-a-hosted-sandboxes",
    "alpha-ticker-stage-a-egress",
  ];
  if (value.flyOrg !== "personal" || !Array.isArray(value.apps) || value.apps.length !== apps.length) process.exit(2);
  for (let i = 0; i < apps.length; i += 1) {
    const entry = value.apps[i];
    if (!entry || Object.keys(entry).sort().join(",") !== "id,name" || entry.name !== apps[i] || typeof entry.id !== "string" || !entry.id) process.exit(2);
  }
  const pairs = [
    [value.managedPostgres, "alpha-ticker-stage-a-hosted-pg"],
    [value.objectStorage, "alpha-ticker-stage-a-hosted-data"],
    [value.sandboxRegistry, "alpha-ticker-stage-a-hosted-sandboxes"],
  ];
  for (const [entry, expected] of pairs) {
    if (!entry || Object.keys(entry).sort().join(",") !== "id,name" || entry.name !== expected || typeof entry.id !== "string" || !entry.id) process.exit(2);
  }
} else {
  const keys = ["managedPostgresDeleted", "objectStorageDeleted", "managedPostgresDeletedAt", "objectStorageDeletedAt"];
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) process.exit(2);
  for (const prefix of ["managedPostgres", "objectStorage"]) {
    const deleted = value[`${prefix}Deleted`];
    const timestamp = value[`${prefix}DeletedAt`];
    if (typeof deleted !== "boolean") process.exit(2);
    if (deleted ? typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp)) : timestamp !== null) process.exit(2);
  }
}
NODE
}

fly_app_state() {
  local app=$1
  local json
  json=$(fly apps list --org "$EXPECTED_ORG" --json 2>/dev/null) || fail "fly-inventory-invalid"
  FLY_APP="$app" FLY_ORG="$EXPECTED_ORG" FLY_JSON="$json" node <<'NODE'
let inventory;
try {
  inventory = JSON.parse(process.env.FLY_JSON);
} catch {
  process.exit(4);
}
if (!Array.isArray(inventory)) process.exit(4);
const expected = process.env.FLY_APP;
const exact = [];
for (const entry of inventory) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) process.exit(4);
  if (typeof entry.Name !== "string" || typeof entry.Organization !== "string") process.exit(4);
  if (entry.Name === expected) exact.push(entry);
}
if (exact.length > 1) process.exit(4);
if (exact.length === 0) process.exit(0);
if (exact[0].Organization !== process.env.FLY_ORG) process.exit(5);
process.exit(10);
NODE
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

validate_private_json_file "$INVENTORY_FILE" "resource-inventory-invalid"
validate_private_json_file "$TEARDOWN_EVIDENCE_FILE" "teardown-evidence-invalid"

if [[ ! -x "$QM_BIN" || -L "$QM_BIN" ]]; then
  fail "qm-binary-invalid"
fi
if ! (cd "$DEPLOYMENT_ROOT" && "$QM_BIN" down >/dev/null 2>&1); then
  fail "qm-down-failed"
fi

for app in "${APPS[@]}"; do
  set +e
  fly_app_state "$app"
  state=$?
  set -e
  case "$state" in
    0) ;;
    10) fly apps destroy "$app" --yes >/dev/null 2>&1 || fail "fly-destroy-failed" ;;
    5) fail "fly-ownership-refused" ;;
    *) fail "fly-inventory-invalid" ;;
  esac
done

if node - "$TEARDOWN_EVIDENCE_FILE" <<'NODE' >/dev/null 2>&1
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.exit(value.managedPostgresDeleted === true && value.objectStorageDeleted === true ? 0 : 3);
NODE
then
  printf 'teardown-complete\n'
  exit 0
else
  status=$?
  if [[ "$status" -eq 3 ]]; then
    printf 'manual-data-destruction-required\n' >&2
    exit 3
  fi
  fail "teardown-evidence-invalid"
fi
