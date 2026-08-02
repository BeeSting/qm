import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  assertEvidenceSafe,
  buildEvidenceManifest,
} from "../scripts/alpha-ticker-stage-a/collect-evidence.mjs";

const teardown = "scripts/alpha-ticker-stage-a/teardown.sh";

test("evidence manifest is content-minimized and schema-bounded", () => {
  const manifest = buildEvidenceManifest({
    commit: "a".repeat(40),
    qmBaseline: "b".repeat(40),
    timestamp: "2026-08-02T00:00:00.000Z",
    checks: [{ id: "policy", status: "pass", artifactSha256: "c".repeat(64) }],
    counts: { tests: 42, failures: 0, principals: 3 },
  });

  assert.deepEqual(Object.keys(manifest).sort(), [
    "checks",
    "commit",
    "contentCaptured",
    "counts",
    "qmBaseline",
    "timestamp",
  ]);
  assert.equal(manifest.contentCaptured, false);
  assert.doesNotThrow(() => assertEvidenceSafe(manifest));
});

test("evidence validation rejects content-bearing or secret-bearing keys", () => {
  const forbidden = ["prompt", "response", "packetBody", "providerRequest", "secret", "tokenValue"];
  for (const key of forbidden) {
    assert.throws(() => assertEvidenceSafe({ commit: "x", nested: { [key]: "synthetic-canary" } }), /forbidden/i);
  }
});

test("teardown dry-run is idempotent and exact-prefix bounded", () => {
  const first = spawnSync("bash", [teardown, "--dry-run"], { encoding: "utf8" });
  const second = spawnSync("bash", [teardown, "--dry-run"], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /^teardown dry-run: alpha-ticker-stage-a\n$/);

  const body = readFileSync(teardown, "utf8");
  assert.match(body, /EXPECTED_ORG="alpha-ticker-stage-a"/);
  assert.match(body, /has_stage_a_resources\(\)/);
  assert.match(body, /if has_stage_a_resources; then/);
  assert.doesNotMatch(body, /docker system prune|docker volume prune|docker network prune/);
});
