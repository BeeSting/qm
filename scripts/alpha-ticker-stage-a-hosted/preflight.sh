#!/usr/bin/env bash

set -u

export NO_COLOR=1
export FORCE_COLOR=0

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
DEPLOYMENT_REL="deploy/layers/alpha-ticker-stage-a-hosted"
DEPLOYMENT_ROOT="$REPO_ROOT/$DEPLOYMENT_REL"
ACTIVATION_FILE="$REPO_ROOT/.generated/alpha-ticker-stage-a-hosted/activation.json"
ENV_FILE="$DEPLOYMENT_ROOT/.env"
QM_BIN="$DEPLOYMENT_ROOT/node_modules/.bin/qm"
EXPECTED_PLAN_ERROR='error: "sandbox.app" is set but no sandbox layer image is pinned; run `qm sandbox publish` to build and record the digest-pinned "sandbox.image" agents boot from'
COMMAND_TIMEOUT_SECONDS=${ALPHA_TICKER_PREFLIGHT_TIMEOUT_SECONDS:-30}

pass() {
  printf '%s: pass\n' "$1"
}

fail() {
  printf '%s: fail\n' "$1" >&2
  exit 1
}

run_with_timeout() {
  node "$SCRIPT_DIR/activation-record.mjs" --run-timeout "$((COMMAND_TIMEOUT_SECONDS * 1000))" -- "$@"
}

file_identity() {
  node "$SCRIPT_DIR/activation-record.mjs" --file-identity --input "$1" 2>/dev/null || true
}

env_is_unchanged() {
  [ -f "$ENV_FILE" ] &&
    [ ! -L "$ENV_FILE" ] &&
    [ "$(file_identity "$ENV_FILE")" = "$ENV_IDENTITY" ]
}

validate_fly_json() {
  kind=$1
  input=$2
  node "$SCRIPT_DIR/activation-record.mjs" --fly-json "$kind" --input "$input" >/dev/null 2>&1
}

validate_fly_storage_table() {
  input=$1
  node "$SCRIPT_DIR/activation-record.mjs" --fly-storage-table --input "$input" >/dev/null 2>&1
}

cd "$REPO_ROOT" || fail "worktree"

case "$COMMAND_TIMEOUT_SECONDS" in
  ""|*[!0-9]*) fail "runtime" ;;
esac
if [ "$COMMAND_TIMEOUT_SECONDS" -lt 1 ] || [ "$COMMAND_TIMEOUT_SECONDS" -gt 300 ]; then
  fail "runtime"
fi

node_version=$(node --version 2>/dev/null) || fail "runtime"
npm_version=$(npm --version 2>/dev/null) || fail "runtime"
if [ "$node_version" != "v24.18.1" ] || [ "$npm_version" != "11.16.0" ]; then
  fail "runtime"
fi
pass "runtime"

tracked_status=$(git status --porcelain --untracked-files=no 2>/dev/null) || fail "worktree"
if [ -n "$tracked_status" ]; then
  fail "worktree"
fi
pass "worktree"

if ! node "$SCRIPT_DIR/check-boundary.mjs" >/dev/null 2>&1; then
  fail "hosted-boundary"
fi
pass "hosted-boundary"

# PATH-provided Node/npm/git/docker/fly are operator-controlled prerequisites.
# QM is verified against the committed dependency, lock integrity, metadata,
# executable realpath, and clean-install package-tree digest without npm execution.
if ! node "$SCRIPT_DIR/activation-record.mjs" --verify-qm-install --root "$DEPLOYMENT_ROOT" >/dev/null 2>&1; then
  fail "qm-binary"
fi
pass "qm-binary"

if ! run_with_timeout docker buildx version >/dev/null 2>&1; then
  fail "docker-buildx"
fi
pass "docker-buildx"

if ! run_with_timeout fly auth whoami >/dev/null 2>&1; then
  fail "fly-auth"
fi
pass "fly-auth"

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/alpha-ticker-hosted-preflight.XXXXXX") || fail "fly-region"
chmod 700 "$TEMP_DIR" || fail "fly-region"
trap 'rm -rf "$TEMP_DIR"' EXIT

regions_file="$TEMP_DIR/regions.json"
if ! run_with_timeout fly platform regions --json >"$regions_file" 2>/dev/null; then
  fail "fly-region"
fi
if ! validate_fly_json "regions" "$regions_file"; then
  fail "fly-region"
fi
pass "fly-region"

apps_file="$TEMP_DIR/apps.json"
if ! run_with_timeout fly apps list --org personal --json >"$apps_file" 2>/dev/null; then
  fail "fly-app-names"
fi
if ! validate_fly_json "apps" "$apps_file"; then
  fail "fly-app-names"
fi
pass "fly-app-names"

mpg_file="$TEMP_DIR/mpg.json"
storage_file="$TEMP_DIR/storage.json"
if ! run_with_timeout fly mpg list --json --org personal >"$mpg_file" 2>/dev/null ||
  ! validate_fly_json "mpg" "$mpg_file" ||
  ! run_with_timeout fly storage list --org personal >"$storage_file" 2>/dev/null ||
  ! validate_fly_storage_table "$storage_file"; then
  fail "fly-data-resource-names"
fi
pass "fly-data-resource-names"

if ! node "$SCRIPT_DIR/activation-record.mjs" --input "$ACTIVATION_FILE" >/dev/null 2>&1; then
  fail "activation-record"
fi
pass "activation-record"

if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  fail "env-file"
fi
ENV_IDENTITY=$(file_identity "$ENV_FILE")
case "$ENV_IDENTITY" in
  *:*:600:*:*) ;;
  *) fail "env-file" ;;
esac
if ! git check-ignore --quiet "$DEPLOYMENT_REL/.env" >/dev/null 2>&1; then
  fail "env-file"
fi
pass "env-file"

# This detects replacement, permission drift, and content mutation between checks.
# It cannot close the final local-write race between validation and a QM process
# opening the file; the operator-controlled local account remains inside the trust boundary.
if ! env_is_unchanged; then
  fail "env-file"
fi
if ! (cd "$DEPLOYMENT_ROOT" && run_with_timeout "$QM_BIN" check >/dev/null 2>&1); then
  fail "qm-check"
fi
pass "qm-check"

if ! env_is_unchanged; then
  fail "env-file"
fi
if ! (cd "$DEPLOYMENT_ROOT" && run_with_timeout "$QM_BIN" sandbox build --dry-run >/dev/null 2>&1); then
  fail "qm-sandbox-dry-run"
fi
pass "qm-sandbox-dry-run"

if ! env_is_unchanged; then
  fail "env-file"
fi
plan_output=$(cd "$DEPLOYMENT_ROOT" && run_with_timeout "$QM_BIN" plan 2>&1)
plan_status=$?
if [ "$plan_status" -ne 1 ] || [ "$plan_output" != "$EXPECTED_PLAN_ERROR" ]; then
  fail "qm-plan-missing-image-pin"
fi
pass "qm-plan-missing-image-pin"

printf 'hosted-preflight: pass\n'
