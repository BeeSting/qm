import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { scanDirectory } from "../scripts/alpha-ticker-stage-a/check-boundary.mjs";

const deploymentRoot = "deploy/layers/alpha-ticker-stage-a";
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function withCanary(name: string, content: string, run: (root: string) => void) {
  const root = mkdtempSync(join(repositoryRoot, ".alpha-ticker-stage-a-boundary-"));
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

test("the local default compares normalized localhost origins", () => {
  withCanary("config.json", '{"publicUrl":"http://localhost:8082/callback?state=synthetic"}\n', (root) => {
    assert.deepEqual(scanDirectory(root), []);
  });
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
      assert.ok(ids.includes("UNAPPROVED_PUBLIC_URL"));
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
  const root = mkdtempSync(join(repositoryRoot, ".alpha-ticker-stage-a-boundary-"));
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

test("fails closed when the scan root is missing or outside the repository", () => {
  const missingRoot = join(repositoryRoot, ".missing-alpha-ticker-stage-a-boundary");
  assert.ok(ruleIds(missingRoot).includes("MISSING_SCAN_ROOT"));

  const outsideRoot = mkdtempSync(join(tmpdir(), "alpha-ticker-stage-a-outside-"));
  try {
    writeFileSync(join(outsideRoot, "benign.txt"), "synthetic\n");
    assert.ok(ruleIds(outsideRoot).includes("SCAN_ROOT_OUTSIDE_REPOSITORY"));
  } finally {
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("rejects symlink escapes without reading their targets", () => {
  const root = mkdtempSync(join(repositoryRoot, ".alpha-ticker-stage-a-boundary-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "alpha-ticker-stage-a-target-"));
  try {
    const target = join(outsideRoot, "synthetic-secret.txt");
    writeFileSync(target, "SERVICE_TOKEN=synthetic-canary-value-1234567890\n");
    symlinkSync(target, join(root, "alias.txt"));

    const ids = ruleIds(root);
    assert.ok(ids.includes("SYMLINK_ENTRY"));
    assert.ok(!ids.includes("SECRET_VALUE"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("rejects a scan root reached through a symlinked parent", () => {
  const outsideRoot = mkdtempSync(join(tmpdir(), "alpha-ticker-stage-a-parent-target-"));
  const linkedParent = join(repositoryRoot, `.alpha-ticker-stage-a-linked-parent-${process.pid}`);
  try {
    const outsideDeployment = join(outsideRoot, "deployment");
    mkdirSync(outsideDeployment);
    writeFileSync(join(outsideDeployment, "synthetic.txt"), "synthetic\n");
    symlinkSync(outsideRoot, linkedParent);

    assert.ok(ruleIds(join(linkedParent, "deployment")).includes("SCAN_ROOT_OUTSIDE_REPOSITORY"));
  } finally {
    rmSync(linkedParent, { force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("rejects unsupported filesystem entry types", () => {
  const root = mkdtempSync(join(repositoryRoot, ".alpha-ticker-stage-a-boundary-"));
  try {
    execFileSync("mkfifo", [join(root, "synthetic.fifo")]);
    assert.ok(ruleIds(root).includes("UNSUPPORTED_ENTRY_TYPE"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports regular-file read errors without exposing the error value", () => {
  const root = mkdtempSync(join(repositoryRoot, ".alpha-ticker-stage-a-boundary-"));
  try {
    const unreadable = join(root, "unreadable.txt");
    writeFileSync(unreadable, "synthetic\n");
    const violations = scanDirectory(root, {
      readTextFile(filePath) {
        if (filePath === unreadable) throw new Error("synthetic-sensitive-read-error");
        return readFileSync(filePath, "utf8");
      },
    });

    assert.ok(violations.some((violation) => violation.ruleId === "UNREADABLE_ENTRY"));
    assert.ok(!JSON.stringify(violations).includes("synthetic-sensitive-read-error"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports oversized files without reading their contents", () => {
  const root = mkdtempSync(join(repositoryRoot, ".alpha-ticker-stage-a-boundary-"));
  try {
    const oversized = join(root, "oversized.txt");
    writeFileSync(oversized, "");
    truncateSync(oversized, 2_000_001);
    let readAttempted = false;
    const violations = scanDirectory(root, {
      readTextFile() {
        readAttempted = true;
        return "";
      },
    });

    assert.ok(violations.some((violation) => violation.ruleId === "OVERSIZED_ENTRY"));
    assert.equal(readAttempted, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports NUL-containing files as binary without scanning their contents", () => {
  const root = mkdtempSync(join(repositoryRoot, ".alpha-ticker-stage-a-boundary-"));
  try {
    writeFileSync(
      join(root, "synthetic.bin"),
      Buffer.from("SERVICE_TOKEN=synthetic-canary-value-1234567890\0tail", "utf8"),
    );
    const violations = scanDirectory(root);

    assert.ok(violations.some((violation) => violation.ruleId === "BINARY_ENTRY"));
    assert.ok(!violations.some((violation) => violation.ruleId === "SECRET_VALUE"));
    assert.ok(!JSON.stringify(violations).includes("synthetic-canary-value"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
