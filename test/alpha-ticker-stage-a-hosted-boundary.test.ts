import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scanDirectory, scanStagedDeploymentDiff } from "../scripts/alpha-ticker-stage-a/check-boundary.mjs";

const hostedOrigin = "https://alpha-ticker-stage-a-hosted-portal.fly.dev";
const allowedPublicUrls = new Set([hostedOrigin]);

function withConfig(publicUrl: string, run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "hosted-boundary-"));
  try {
    writeFileSync(join(root, "qm.config.jsonc"), `${JSON.stringify({ publicUrl })}\n`);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
