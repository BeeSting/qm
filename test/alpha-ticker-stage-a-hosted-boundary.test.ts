import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { scanDirectory, scanStagedDeploymentDiff } from "../scripts/alpha-ticker-stage-a/check-boundary.mjs";

const hostedOrigin = "https://alpha-ticker-stage-a-hosted-portal.fly.dev";
const allowedPublicUrls = new Set([hostedOrigin]);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostedWrapper = join(repositoryRoot, "scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs");

function withContent(content: string, run: (root: string) => void) {
  const root = mkdtempSync(join(repositoryRoot, ".hosted-boundary-"));
  try {
    writeFileSync(join(root, "qm.config.jsonc"), content);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function withConfig(publicUrl: string, run: (root: string) => void) {
  withContent(`${JSON.stringify({ publicUrl })}\n`, run);
}

function ruleIds(root: string, allowed = allowedPublicUrls) {
  return scanDirectory(root, { allowedPublicUrls: allowed }).map((violation) => violation.ruleId);
}

test("committed hosted layer is boundary-clean under its exact origin", () => {
  assert.deepEqual(scanDirectory("deploy/layers/alpha-ticker-stage-a-hosted", { allowedPublicUrls }), []);
});

test("hosted profile compares normalized origins", () => {
  withConfig(`${hostedOrigin}/auth/callback?state=synthetic`, (root) => {
    assert.deepEqual(ruleIds(root, new Set([`${hostedOrigin}/configured/path`])), []);
  });
});

test("hosted profile rejects protocol, host, and port alternatives", () => {
  for (const publicUrl of [
    "http://alpha-ticker-stage-a-hosted-portal.fly.dev",
    "https://other.fly.dev",
    "https://alpha-ticker-stage-a-hosted-portal.fly.dev.evil.invalid",
    "https://alpha-ticker-stage-a-hosted-portal.fly.dev:8443",
    "https://synthetic:credential@alpha-ticker-stage-a-hosted-portal.fly.dev",
  ]) {
    withConfig(publicUrl, (root) => {
      assert.ok(ruleIds(root).includes("UNAPPROVED_PUBLIC_URL"), `expected ${publicUrl} to be rejected`);
    });
  }
});

test("hosted profile fails closed on invalid configured and allowed URLs", () => {
  withConfig("not a URL", (root) => {
    assert.ok(ruleIds(root).includes("UNAPPROVED_PUBLIC_URL"));
  });
  withConfig(hostedOrigin, (root) => {
    assert.ok(ruleIds(root, new Set(["not a URL"])).includes("UNAPPROVED_PUBLIC_URL"));
  });
});

test("hosted profile rejects duplicate publicUrl keys in either order", () => {
  for (const content of [
    `{"publicUrl":"${hostedOrigin}","publicUrl":"https://other.fly.dev"}\n`,
    `{"publicUrl":"https://other.fly.dev","publicUrl":"${hostedOrigin}"}\n`,
  ]) {
    withContent(content, (root) => {
      const ids = ruleIds(root);
      assert.ok(ids.includes("DUPLICATE_PUBLIC_URL"));
      assert.ok(ids.includes("UNAPPROVED_PUBLIC_URL"));
    });
  }
});

test("hosted profile decodes escaped property keys before duplicate checks", () => {
  for (const content of [
    `{"publicUrl":"${hostedOrigin}","\\u0070ublicUrl":"https://other.fly.dev"}\n`,
    `{"\\u0070ublicUrl":"https://other.fly.dev","publicUrl":"${hostedOrigin}"}\n`,
  ]) {
    withContent(content, (root) => {
      const violations = scanDirectory(root, { allowedPublicUrls });
      const ids = violations.map((violation) => violation.ruleId);
      assert.ok(ids.includes("DUPLICATE_PUBLIC_URL"));
      assert.ok(ids.includes("UNAPPROVED_PUBLIC_URL"));
      assert.ok(!JSON.stringify(violations).includes("other.fly.dev"));
    });
  }
});

test("hosted profile rejects malformed JSON string escapes", () => {
  for (const content of [
    `{"publicUrl":"${hostedOrigin}","\\u00G0ublicUrl":"https://other.fly.dev"}\n`,
    `{"publicUrl":"https://alpha-ticker-stage-a-hosted-portal.fly.dev/\\u00G0"}\n`,
  ]) {
    withContent(content, (root) => {
      const violations = scanDirectory(root, { allowedPublicUrls });
      assert.ok(violations.some((violation) => violation.ruleId === "MALFORMED_JSONC"));
      assert.ok(!JSON.stringify(violations).includes("other.fly.dev"));
    });
  }
});

test("hosted profile rejects duplicate or non-string publicUrl values", () => {
  for (const content of [
    `{"publicUrl":"${hostedOrigin}","publicUrl":"${hostedOrigin}"}\n`,
    `{"publicUrl":"${hostedOrigin}","publicUrl":null}\n`,
    `{"publicUrl":null}\n`,
  ]) {
    withContent(content, (root) => {
      const ids = ruleIds(root);
      assert.ok(ids.includes("DUPLICATE_PUBLIC_URL") || ids.includes("UNAPPROVED_PUBLIC_URL"));
    });
  }
});

test("hosted profile enforces publicUrl only on the root object", () => {
  withContent(
    `${JSON.stringify({
      publicUrl: hostedOrigin,
      env: { core: { publicUrl: "https://nested.example.invalid" } },
    })}\n`,
    (root) => {
      const ids = ruleIds(root);
      assert.ok(!ids.includes("DUPLICATE_PUBLIC_URL"));
      assert.ok(!ids.includes("UNAPPROVED_PUBLIC_URL"));
    },
  );
});

test("hosted wrapper resolves its repository when invoked from test directory", () => {
  assert.equal(
    execFileSync(process.execPath, [hostedWrapper], {
      cwd: join(repositoryRoot, "test"),
      encoding: "utf8",
    }),
    "hosted-boundary-check: pass\n",
  );
});

test("rejects a symlink alias to a synthetic ignored env without reading it", () => {
  const root = mkdtempSync(join(repositoryRoot, "deploy/layers/alpha-ticker-stage-a-hosted/.boundary-"));
  try {
    const envFile = join(root, ".env");
    writeFileSync(envFile, "SERVICE_TOKEN=synthetic-canary-value-1234567890\n");
    symlinkSync(envFile, join(root, "alias.txt"));

    const ids = ruleIds(root);
    assert.ok(ids.includes("SYMLINK_ENTRY"));
    assert.ok(!ids.includes("SECRET_VALUE"));
    assert.ok(!ids.includes("COMMITTED_ENV_FILE"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staged hosted changes use the hosted origin policy", () => {
  const repo = mkdtempSync(join(tmpdir(), "hosted-boundary-git-"));
  const deploymentRoot = "deploy/layers/alpha-ticker-stage-a-hosted";
  try {
    mkdirSync(join(repo, deploymentRoot), { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: repo });
    writeFileSync(join(repo, deploymentRoot, "qm.config.jsonc"), `${JSON.stringify({ publicUrl: hostedOrigin })}\n`);
    execFileSync("git", ["add", deploymentRoot], { cwd: repo });

    assert.deepEqual(scanStagedDeploymentDiff(repo, deploymentRoot, { allowedPublicUrls }), []);
    assert.ok(
      scanStagedDeploymentDiff(repo, deploymentRoot, {
        allowedPublicUrls: new Set(["https://other.fly.dev"]),
      }).some((violation) => violation.ruleId === "UNAPPROVED_PUBLIC_URL"),
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("staged scan isolates files so cross-file quotes cannot hide unsafe content", () => {
  const repo = mkdtempSync(join(tmpdir(), "hosted-boundary-cross-file-"));
  const deploymentRoot = "deploy/layers/alpha-ticker-stage-a-hosted";
  try {
    const root = join(repo, deploymentRoot);
    mkdirSync(root, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: repo });
    writeFileSync(join(root, "a-prefix.txt"), 'synthetic unmatched "\n');
    writeFileSync(join(root, "qm.config.jsonc"), '{"publicUrl":"https://other.fly.dev"}\n');
    writeFileSync(join(root, "z-secret.txt"), "SERVICE_TOKEN=synthetic-canary-value-1234567890\n");
    execFileSync("git", ["add", deploymentRoot], { cwd: repo });

    const violations = scanStagedDeploymentDiff(repo, deploymentRoot, { allowedPublicUrls });
    assert.ok(
      violations.some(
        (violation) => violation.file.endsWith("/qm.config.jsonc") && violation.ruleId === "UNAPPROVED_PUBLIC_URL",
      ),
    );
    assert.ok(
      violations.some((violation) => violation.file.endsWith("/z-secret.txt") && violation.ruleId === "SECRET_VALUE"),
    );
    assert.ok(!JSON.stringify(violations).includes("synthetic-canary-value"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("staged scan reads the exact index blob rather than an unstaged replacement", () => {
  const repo = mkdtempSync(join(tmpdir(), "hosted-boundary-index-blob-"));
  const deploymentRoot = "deploy/layers/alpha-ticker-stage-a-hosted";
  const configPath = join(repo, deploymentRoot, "qm.config.jsonc");
  try {
    mkdirSync(join(repo, deploymentRoot), { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: repo });
    writeFileSync(configPath, `${JSON.stringify({ publicUrl: hostedOrigin })}\n`);
    execFileSync("git", ["add", deploymentRoot], { cwd: repo });
    execFileSync(
      "git",
      ["-c", "user.name=Boundary Test", "-c", "user.email=boundary@example.invalid", "commit", "--quiet", "-m", "base"],
      { cwd: repo },
    );

    writeFileSync(configPath, '{"publicUrl":"https://staged-unsafe.fly.dev"}\n');
    execFileSync("git", ["add", deploymentRoot], { cwd: repo });
    writeFileSync(configPath, `${JSON.stringify({ publicUrl: hostedOrigin })}\n`);

    const violations = scanStagedDeploymentDiff(repo, deploymentRoot, { allowedPublicUrls });
    assert.ok(
      violations.some(
        (violation) => violation.file.endsWith("/qm.config.jsonc") && violation.ruleId === "UNAPPROVED_PUBLIC_URL",
      ),
    );
    assert.ok(!JSON.stringify(violations).includes("staged-unsafe.fly.dev"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("staged scan reports binary and oversized index blobs without content exposure", () => {
  const repo = mkdtempSync(join(tmpdir(), "hosted-boundary-index-bounds-"));
  const deploymentRoot = "deploy/layers/alpha-ticker-stage-a-hosted";
  try {
    const root = join(repo, deploymentRoot);
    mkdirSync(root, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: repo });
    writeFileSync(join(root, "synthetic.bin"), Buffer.from("synthetic\0binary", "utf8"));
    const oversized = join(root, "oversized.txt");
    writeFileSync(oversized, "");
    truncateSync(oversized, 2_000_001);
    execFileSync("git", ["add", deploymentRoot], { cwd: repo });

    const violations = scanStagedDeploymentDiff(repo, deploymentRoot, { allowedPublicUrls });
    assert.ok(
      violations.some((violation) => violation.file.endsWith("/synthetic.bin") && violation.ruleId === "BINARY_ENTRY"),
    );
    assert.ok(
      violations.some(
        (violation) => violation.file.endsWith("/oversized.txt") && violation.ruleId === "OVERSIZED_ENTRY",
      ),
    );
    assert.ok(!JSON.stringify(violations).includes("synthetic\\u0000binary"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
