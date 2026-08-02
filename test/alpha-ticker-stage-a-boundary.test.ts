import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scanDirectory } from "../scripts/alpha-ticker-stage-a/check-boundary.mjs";

const deploymentRoot = "deploy/layers/alpha-ticker-stage-a";

function withCanary(name: string, content: string, run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "alpha-ticker-stage-a-boundary-"));
  try {
    writeFileSync(join(root, name), content);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function ruleIds(root: string) {
  return scanDirectory(root).map((violation) => violation.ruleId);
}

test("the committed Stage A deployment layer is boundary-clean", () => {
  assert.deepEqual(scanDirectory(deploymentRoot), []);
});

test("detects secret-shaped values without returning the matched value", () => {
  withCanary("secret.txt", "SERVICE_TOKEN=synthetic-canary-value-1234567890\n", (root) => {
    const violations = scanDirectory(root);
    assert.ok(violations.some((violation) => violation.ruleId === "SECRET_VALUE"));
    assert.ok(violations.every((violation) => !("matchedValue" in violation)));
  });
});

test("detects restricted environment names and non-loopback public URLs", () => {
  withCanary(
    "config.json",
    '{"SUPABASE_DATABASE_URL":"synthetic-canary","publicUrl":"https://pilot.example.invalid"}\n',
    (root) => {
      const ids = ruleIds(root);
      assert.ok(ids.includes("RESTRICTED_ENV_NAME"));
      assert.ok(ids.includes("NON_LOOPBACK_PUBLIC_URL"));
    },
  );
});

test("detects real portfolio labels and sensitive classifications", () => {
  withCanary("record.json", '{"portfolio":"Nucleus Fund","classification":"client"}\n', (root) => {
    const ids = ruleIds(root);
    assert.ok(ids.includes("REAL_PORTFOLIO"));
    assert.ok(ids.includes("SENSITIVE_CLASSIFICATION"));
  });
});

test("detects write-capable or egress-enabled tool descriptors", () => {
  const root = mkdtempSync(join(tmpdir(), "alpha-ticker-stage-a-boundary-"));
  try {
    const toolDir = join(root, "sandbox/tools/unsafe-tool");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(
      join(toolDir, "tool.json"),
      '{"id":"unsafe-tool","egress":["example.invalid"],"install":{"binary":"unsafe-tool"}}\n',
    );
    assert.ok(ruleIds(root).includes("TOOL_CAPABILITY"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
