#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = "deploy/layers/alpha-ticker-stage-a";
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPOSITORY_REAL_ROOT = realpathSync(REPOSITORY_ROOT);
const TEXT_FILE_LIMIT = 2_000_000;
const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);
const DEFAULT_ALLOWED_PUBLIC_URLS = new Set(["http://localhost:8082"]);

const CONTENT_RULES = [
  {
    ruleId: "SECRET_VALUE",
    pattern:
      /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[ \t]*[=:][ \t]*["']?(?!false\b|null\b|undefined\b)[A-Za-z0-9_./+=-]{16,}/i,
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

function addViolation(violations, file, ruleId) {
  if (!violations.some((entry) => entry.file === file && entry.ruleId === ruleId)) {
    violations.push({ file, ruleId });
  }
}

function entryName(root, filePath) {
  const file = relative(root, filePath);
  return file ? `${sep}${file}` : "<scan-root>";
}

function listFiles(root, violations) {
  const files = [];
  const stack = [resolve(root)];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entry;
    try {
      entry = lstatSync(current);
    } catch {
      addViolation(violations, entryName(root, current), "UNREADABLE_ENTRY");
      continue;
    }
    if (entry.isSymbolicLink()) {
      addViolation(violations, entryName(root, current), "SYMLINK_ENTRY");
      continue;
    }
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(basename(current))) continue;
      try {
        for (const child of readdirSync(current)) stack.push(join(current, child));
      } catch {
        addViolation(violations, entryName(root, current), "UNREADABLE_ENTRY");
      }
      continue;
    }
    if (entry.isFile()) {
      if (entry.size <= TEXT_FILE_LIMIT) files.push(current);
      continue;
    }
    addViolation(violations, entryName(root, current), "UNSUPPORTED_ENTRY_TYPE");
  }
  return files.sort();
}

function isWithin(root, filePath) {
  const pathFromRepository = relative(root, filePath);
  return (
    pathFromRepository === "" ||
    (pathFromRepository !== ".." && !pathFromRepository.startsWith(`..${sep}`) && !isAbsolute(pathFromRepository))
  );
}

function isWithinRepository(filePath) {
  return isWithin(REPOSITORY_ROOT, filePath);
}

function normalizedOrigins(allowedPublicUrls) {
  if (!allowedPublicUrls || typeof allowedPublicUrls[Symbol.iterator] !== "function") return new Set();
  const origins = new Set();
  for (const value of allowedPublicUrls) {
    try {
      const url = new URL(value);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        return new Set();
      }
      origins.add(url.origin);
    } catch {
      return new Set();
    }
  }
  return origins;
}

function scanPublicUrl(content, file, violations, { allowedOrigins, localPolicy }) {
  const keys = [...content.matchAll(/["']publicUrl["']\s*:/gi)];
  const matches = [...content.matchAll(/["']publicUrl["']\s*:\s*["']([^"']+)["']/gi)];
  if (keys.length > 1) addViolation(violations, file, "DUPLICATE_PUBLIC_URL");
  if (keys.length !== matches.length) {
    addViolation(violations, file, "UNAPPROVED_PUBLIC_URL");
    if (localPolicy) addViolation(violations, file, "NON_LOOPBACK_PUBLIC_URL");
  }
  for (const match of matches) {
    try {
      const url = new URL(match[1]);
      const approved =
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password &&
        allowedOrigins.has(url.origin);
      if (!approved) addViolation(violations, file, "UNAPPROVED_PUBLIC_URL");
      if (localPolicy && !approved) addViolation(violations, file, "NON_LOOPBACK_PUBLIC_URL");
    } catch {
      addViolation(violations, file, "UNAPPROVED_PUBLIC_URL");
      if (localPolicy) addViolation(violations, file, "NON_LOOPBACK_PUBLIC_URL");
    }
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

function scanContent(content, file, violations, publicUrlPolicy) {
  for (const rule of CONTENT_RULES) {
    if (rule.pattern.test(content)) addViolation(violations, file, rule.ruleId);
  }
  scanPublicUrl(content, file, violations, publicUrlPolicy);
  scanToolDescriptor(content, file, violations);
}

function isGitIgnored(filePath) {
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--", filePath], {
      cwd: dirname(filePath),
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function publicUrlPolicy(allowedPublicUrls) {
  const allowedOrigins = normalizedOrigins(allowedPublicUrls);
  const defaultOrigins = normalizedOrigins(DEFAULT_ALLOWED_PUBLIC_URLS);
  return {
    allowedOrigins,
    localPolicy:
      allowedOrigins.size === defaultOrigins.size && [...allowedOrigins].every((origin) => defaultOrigins.has(origin)),
  };
}

export function scanDirectory(root, { allowedPublicUrls = new Set(["http://localhost:8082"]) } = {}) {
  const absoluteRoot = resolve(root);
  const violations = [];
  if (!isWithinRepository(absoluteRoot)) {
    return [{ file: "<scan-root>", ruleId: "SCAN_ROOT_OUTSIDE_REPOSITORY" }];
  }
  let rootEntry;
  try {
    rootEntry = lstatSync(absoluteRoot);
  } catch {
    return [{ file: "<scan-root>", ruleId: "MISSING_SCAN_ROOT" }];
  }
  if (rootEntry.isSymbolicLink()) {
    return [{ file: "<scan-root>", ruleId: "SYMLINK_ENTRY" }];
  }
  if (!rootEntry.isDirectory()) {
    return [{ file: "<scan-root>", ruleId: "UNSUPPORTED_ENTRY_TYPE" }];
  }
  let realRoot;
  try {
    realRoot = realpathSync(absoluteRoot);
  } catch {
    return [{ file: "<scan-root>", ruleId: "UNREADABLE_ENTRY" }];
  }
  if (!isWithin(REPOSITORY_REAL_ROOT, realRoot)) {
    return [{ file: "<scan-root>", ruleId: "SCAN_ROOT_OUTSIDE_REPOSITORY" }];
  }
  const urlPolicy = publicUrlPolicy(allowedPublicUrls);
  for (const filePath of listFiles(absoluteRoot, violations)) {
    const file = relative(absoluteRoot, filePath) || basename(filePath);
    if (basename(filePath) === ".env") {
      if (!isGitIgnored(filePath)) addViolation(violations, file, "COMMITTED_ENV_FILE");
      continue;
    }
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    scanContent(content, `${sep}${file}`, violations, urlPolicy);
  }
  return violations.sort((a, b) => `${a.file}:${a.ruleId}`.localeCompare(`${b.file}:${b.ruleId}`));
}

export function scanStagedDeploymentDiff(
  repoRoot = process.cwd(),
  deploymentRoot = DEFAULT_ROOT,
  { allowedPublicUrls = new Set(["http://localhost:8082"]) } = {},
) {
  let diff;
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
  scanContent(added, "<staged-deployment-diff>", violations, publicUrlPolicy(allowedPublicUrls));
  return violations;
}

function runCli() {
  const rootArg = process.argv.indexOf("--root");
  const root = rootArg >= 0 ? process.argv[rootArg + 1] : join(REPOSITORY_ROOT, DEFAULT_ROOT);
  if (!root) {
    process.stderr.write("boundary-check: missing root\n");
    process.exitCode = 2;
    return;
  }
  const absoluteRoot = resolve(root);
  const deploymentPath = isWithinRepository(absoluteRoot) ? relative(REPOSITORY_ROOT, absoluteRoot) : root;
  const violations = [...scanDirectory(absoluteRoot), ...scanStagedDeploymentDiff(REPOSITORY_ROOT, deploymentPath)];
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
