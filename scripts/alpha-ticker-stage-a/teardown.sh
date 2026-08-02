#!/usr/bin/env bash

set -euo pipefail

EXPECTED_ORG="alpha-ticker-stage-a"
RESOURCE_PREFIX="qm-alpha-ticker-stage-a"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/deploy/layers/alpha-ticker-stage-a"
CONFIG_PATH="${DEPLOY_DIR}/qm.config.jsonc"

org_id="$(node -e '
  const fs = require("node:fs");
  const source = fs.readFileSync(process.argv[1], "utf8");
  const match = /"orgId"\s*:\s*"([^"]+)"/.exec(source);
  if (!match) process.exit(2);
  process.stdout.write(match[1]);
' "${CONFIG_PATH}")"

if [[ "${org_id}" != "${EXPECTED_ORG}" ]]; then
  printf 'teardown refused: unexpected org\n' >&2
  exit 2
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  printf 'teardown dry-run: %s\n' "${EXPECTED_ORG}"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'teardown failed: docker unavailable\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf 'teardown failed: docker daemon unavailable\n' >&2
  exit 1
fi

has_stage_a_resources() {
  [[ -n "$(docker ps -aq --filter "label=qm.org=${EXPECTED_ORG}")" ]] ||
    docker network ls --format '{{.Name}}' | grep -Fxq "${RESOURCE_PREFIX}" ||
    docker volume ls --format '{{.Name}}' | grep -E "^${RESOURCE_PREFIX}-" >/dev/null
}

if has_stage_a_resources; then
  if ! (
    cd "${DEPLOY_DIR}"
    npm exec qm -- down --purge
  ); then
    printf 'teardown warning: upstream down was incomplete; applying exact-scope cleanup\n' >&2
  fi
fi

while IFS= read -r container_id; do
  [[ -z "${container_id}" ]] && continue
  docker rm -f "${container_id}" >/dev/null
done < <(docker ps -aq --filter "label=qm.org=${EXPECTED_ORG}")

while IFS= read -r network_name; do
  [[ -z "${network_name}" ]] && continue
  if [[ "${network_name}" != "${RESOURCE_PREFIX}" ]]; then
    printf 'teardown refused: unexpected network name\n' >&2
    exit 2
  fi
  docker network rm "${network_name}" >/dev/null
done < <(docker network ls --format '{{.Name}}' --filter "name=^${RESOURCE_PREFIX}$")

while IFS= read -r volume_name; do
  [[ -z "${volume_name}" ]] && continue
  if [[ "${volume_name}" != "${RESOURCE_PREFIX}-"* ]]; then
    printf 'teardown refused: unexpected volume name\n' >&2
    exit 2
  fi
  docker volume rm "${volume_name}" >/dev/null
done < <(docker volume ls --format '{{.Name}}' --filter "name=^${RESOURCE_PREFIX}-")

if [[ -n "$(docker ps -aq --filter "label=qm.org=${EXPECTED_ORG}")" ]]; then
  printf 'teardown failed: matching container remains\n' >&2
  exit 1
fi
if docker network ls --format '{{.Name}}' | grep -Fxq "${RESOURCE_PREFIX}"; then
  printf 'teardown failed: matching network remains\n' >&2
  exit 1
fi
if docker volume ls --format '{{.Name}}' | grep -E "^${RESOURCE_PREFIX}-" >/dev/null; then
  printf 'teardown failed: matching volume remains\n' >&2
  exit 1
fi

printf 'teardown complete: %s\n' "${EXPECTED_ORG}"
