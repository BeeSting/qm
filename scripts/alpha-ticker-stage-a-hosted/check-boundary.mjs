#!/usr/bin/env node

import { scanDirectory, scanStagedDeploymentDiff } from "../alpha-ticker-stage-a/check-boundary.mjs";

const root = "deploy/layers/alpha-ticker-stage-a-hosted";
const options = {
  allowedPublicUrls: new Set(["https://alpha-ticker-stage-a-hosted-portal.fly.dev"]),
};
const violations = [...scanDirectory(root, options), ...scanStagedDeploymentDiff(process.cwd(), root, options)];
if (!violations.length) {
  process.stdout.write("hosted-boundary-check: pass\n");
} else {
  for (const violation of violations) process.stderr.write(`${violation.file}:${violation.ruleId}\n`);
  process.exitCode = 1;
}
