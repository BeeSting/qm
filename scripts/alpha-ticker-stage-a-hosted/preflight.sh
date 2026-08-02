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
EXPECTED_PLAN_ERROR='error: "sandbox.app" is set but no sandbox layer image is pinned; run `qm sandbox publish` to build and record the digest-pinned "sandbox.image" agents boot from'

pass() {
  printf '%s: pass\n' "$1"
}

fail() {
  printf '%s: fail\n' "$1" >&2
  exit 1
}

contains_token() {
  printf '%s\n' "$1" | awk -v expected="$2" '
    {
      for (field = 1; field <= NF; field += 1) {
        if ($field == expected) found = 1
      }
    }
    END { exit found ? 0 : 1 }
  '
}

contains_any_token() {
  output=$1
  shift
  for expected in "$@"; do
    if contains_token "$output" "$expected"; then
      return 0
    fi
  done
  return 1
}

file_mode() {
  mode=$(stat -f '%Lp' "$1" 2>/dev/null || true)
  case "$mode" in
    ""|*[!0-7]*) mode=$(stat -c '%a' "$1" 2>/dev/null || true) ;;
  esac
  printf '%s' "$mode"
}

cd "$REPO_ROOT" || fail "worktree"

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

if ! docker buildx version >/dev/null 2>&1; then
  fail "docker-buildx"
fi
pass "docker-buildx"

if ! fly auth whoami >/dev/null 2>&1; then
  fail "fly-auth"
fi
pass "fly-auth"

regions=$(fly platform regions 2>/dev/null) || fail "fly-region"
if ! contains_token "$regions" "jnb"; then
  fail "fly-region"
fi
pass "fly-region"

apps=$(fly apps list --org personal 2>/dev/null) || fail "fly-app-names"
if contains_any_token "$apps" \
  "alpha-ticker-stage-a-hosted-core" \
  "alpha-ticker-stage-a-hosted-web-ui" \
  "alpha-ticker-stage-a-hosted-admin" \
  "alpha-ticker-stage-a-hosted-portal" \
  "alpha-ticker-stage-a-hosted-auth" \
  "alpha-ticker-stage-a-hosted-sandboxes" \
  "alpha-ticker-stage-a-egress"; then
  fail "fly-app-names"
fi
pass "fly-app-names"

mpg=$(fly mpg list --org personal 2>/dev/null) || fail "fly-data-resource-names"
storage=$(fly storage list --org personal 2>/dev/null) || fail "fly-data-resource-names"
if contains_token "$mpg" "alpha-ticker-stage-a-hosted-pg" || \
  contains_token "$storage" "alpha-ticker-stage-a-hosted-data"; then
  fail "fly-data-resource-names"
fi
pass "fly-data-resource-names"

if ! node "$SCRIPT_DIR/activation-record.mjs" --input "$ACTIVATION_FILE" >/dev/null 2>&1; then
  fail "activation-record"
fi
pass "activation-record"

if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ] || [ "$(file_mode "$ENV_FILE")" != "600" ]; then
  fail "env-file"
fi
if ! git check-ignore --quiet "$DEPLOYMENT_REL/.env" >/dev/null 2>&1; then
  fail "env-file"
fi
pass "env-file"

if ! (cd "$DEPLOYMENT_ROOT" && npm exec qm -- check >/dev/null 2>&1); then
  fail "qm-check"
fi
pass "qm-check"

if ! (cd "$DEPLOYMENT_ROOT" && npm exec qm -- sandbox build --dry-run >/dev/null 2>&1); then
  fail "qm-sandbox-dry-run"
fi
pass "qm-sandbox-dry-run"

plan_output=$(cd "$DEPLOYMENT_ROOT" && npm exec qm -- plan 2>&1)
plan_status=$?
if [ "$plan_status" -eq 0 ] || [ "$plan_output" != "$EXPECTED_PLAN_ERROR" ]; then
  fail "qm-plan-missing-image-pin"
fi
pass "qm-plan-missing-image-pin"

printf 'hosted-preflight: pass\n'
