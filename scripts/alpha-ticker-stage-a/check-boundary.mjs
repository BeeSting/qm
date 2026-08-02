#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ROOT = "deploy/layers/alpha-ticker-stage-a";
const TEXT_FILE_LIMIT = 2_000_000;
const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);

const CONTENT_RULES = [
  {
    ruleId: "SECRET_VALUE",
    pattern:
      /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*["']?(?!false\b|null\b|undefined\b)[A-Za-z0-9_./+=-]{16,}/i,
  },
  {
    ruleId: "SECRET_VALUE",
    pattern: /(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/,
  },
  {
    ruleId: "RESTRICTED_ENV_NAME",
    pattern:
      /\b(?:SUPABASE_DATABASE_URL|DATABASE_URL|VERCEL_[A-Z0-9_]+|RAILWAY_[A-Z0-9_]+|BROKER(?:AGE)?_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|PROD(?:UCTION)?_[A-Z0-9_]*(?:CREDENTIAL|KEY|TOKEN|SECRET|PASSWORD))\b/,
  },
  {
    ruleId: "REAL_PORTFOLIO",
    pattern: /\b(?:Nucleus Fund|Pilatus Capital|My Portfolio)\b/i,
  },
  {
    ruleId: "SENSITIVE_CLASSIFICATION",
    pattern:
      /["']?(?:classification|dataClass)["']?\s*[:=]\s*["']?(?:partner|client|investor|payroll|legal|board|mnpi)\b/i,
  },
  {
    ruleId: "PRODUCTION_HOST",
    pattern: /https?:\/\/(?:[a-z0-9-]+\.)*(?:ticker-alpha(?:-blond)?\.vercel\.app|alphaticker\.[a-z.]+)/i,
  },
];

function listFiles(root) {
  const files = [];
  const stack = [resolve(root)];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    const entry = statSync(current);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(basename(current))) continue;
      for (const child of readdirSync(current)) stack.push(join(current, child));
      continue;
    }
    if (entry.isFile() && entry.size <= TEXT_FILE_LIMIT) files.push(current);
  }
  return files.sort();
}

function addViolation(violations, file, ruleId) {
  if (!violations.some((entry) => entry.file === file && entry.ruleId === ruleId)) {
    violations.push({ file, ruleId });
  }
}

function scanPublicUrl(content, file, violations) {
  const match = /["']publicUrl["']\s*:\s*["']([^"']+)["']/i.exec(content);
  if (!match) return;
  try {
    const url = new URL(match[1]);
    if (url.protocol !== "http:" || (url.hostname !== "localhost" && url.hostname !== "127.0.0.1")) {
      addViolation(violations, file, "NON_LOOPBACK_PUBLIC_URL");
    }
  } catch {
    addViolation(violations, file, "NON_LOOPBACK_PUBLIC_URL");
  }
}

function scanToolDescriptor(content, file, violations) {
  if (!file.replaceAll("\\", "/").includes("/sandbox/tools/") || basename(file) !== "tool.json") return;
  try {
    const descriptor = JSON.parse(content);
    const safe =
      descriptor.id === "alpha-packet" &&
      descriptor.install?.binary === "alpha-packet" &&
      Array.isArray(descriptor.egress) &&
      descriptor.egress.length === 0 &&
      descriptor.auth === undefined &&
      Array.isArray(descriptor.approvals) &&
      descriptor.approvals.length > 0 &&
      descriptor.approvals.every((approval) => approval?.decision === "deny");
    if (!safe) addViolation(violations, file, "TOOL_CAPABILITY");
  } catch {
    addViolation(violations, file, "TOOL_CAPABILITY");
  }
}

function scanContent(content, file, violations) {
  for (const rule of CONTENT_RULES) {
    if (rule.pattern.test(content)) addViolation(violations, file, rule.ruleId);
  }
  scanPublicUrl(content, file, violations);
  scanToolDescriptor(content, file, violations);
}

export function scanDirectory(root) {
  const absoluteRoot = resolve(root);
  const violations = [];
  for (const filePath of listFiles(absoluteRoot)) {
    const file = relative(absoluteRoot, filePath) || basename(filePath);
    if (basename(filePath) === ".env") addViolation(violations, file, "COMMITTED_ENV_FILE");
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    scanContent(content, `${sep}${file}`, violations);
  }
  return violations.sort((a, b) => `${a.file}:${a.ruleId}`.localeCompare(`${b.file}:${b.ruleId}`));
}

export function scanStagedDeploymentDiff(repoRoot = process.cwd(), deploymentRoot = DEFAULT_ROOT) {
  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "--cached", "--unified=0", "--no-color", "--", deploymentRoot], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [{ file: "<staged-diff>", ruleId: "STAGED_DIFF_UNREADABLE" }];
  }

  const added = diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  const violations = [];
  scanContent(added, "<staged-deployment-diff>", violations);
  return violations;
}

function runCli() {
  const rootArg = process.argv.indexOf("--root");
  const root = rootArg >= 0 ? process.argv[rootArg + 1] : DEFAULT_ROOT;
  if (!root) {
    process.stderr.write("boundary-check: missing root\n");
    process.exitCode = 2;
    return;
  }
  const violations = [...scanDirectory(root), ...scanStagedDeploymentDiff()];
  if (!violations.length) {
    process.stdout.write("boundary-check: pass\n");
    return;
  }
  for (const violation of violations) {
    process.stderr.write(`${violation.file}:${violation.ruleId}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli();
