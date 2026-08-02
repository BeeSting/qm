#!/usr/bin/env node

import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanDirectory, scanStagedDeploymentDiff } from "../alpha-ticker-stage-a/check-boundary.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = join(repositoryRoot, "deploy/layers/alpha-ticker-stage-a-hosted");
const deploymentPath = relative(repositoryRoot, root);
const options = {
  allowedPublicUrls: new Set(["https://alpha-ticker-stage-a-hosted-portal.fly.dev"]),
};
const violations = [
  ...scanDirectory(root, options),
  ...scanStagedDeploymentDiff(repositoryRoot, deploymentPath, options),
];
if (!violations.length) {
  process.stdout.write("hosted-boundary-check: pass\n");
} else {
  for (const violation of violations) process.stderr.write(`${violation.file}:${violation.ruleId}\n`);
  process.exitCode = 1;
}
