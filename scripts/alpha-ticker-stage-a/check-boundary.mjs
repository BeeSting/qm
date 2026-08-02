#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = "deploy/layers/alpha-ticker-stage-a";
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPOSITORY_REAL_ROOT = realpathSync(REPOSITORY_ROOT);
const TEXT_FILE_LIMIT = 2_000_000;
const STAGED_FILE_LIMIT = 1_000;
const STAGED_TOTAL_SIZE_LIMIT = 20_000_000;
const STAGED_PATH_OUTPUT_LIMIT = 2_000_000;
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
      else addViolation(violations, entryName(root, current), "OVERSIZED_ENTRY");
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

// Mirror the production config loader's JSONC string handling while retaining duplicate keys.
function scanJsonString(content, start) {
  for (let index = start + 1; index < content.length; index++) {
    if (content[index] === "\\") {
      index++;
      continue;
    }
    if (content[index] === '"') return index + 1;
  }
  return undefined;
}

function skipJsoncTrivia(content, start) {
  let index = start;
  while (index < content.length) {
    if (/\s/.test(content[index])) {
      index++;
      continue;
    }
    if (content[index] === "/" && content[index + 1] === "/") {
      index += 2;
      while (index < content.length && content[index] !== "\n") index++;
      continue;
    }
    if (content[index] === "/" && content[index + 1] === "*") {
      const close = content.indexOf("*/", index + 2);
      if (close < 0) return { index: content.length, malformed: true };
      index = close + 2;
      continue;
    }
    break;
  }
  return { index, malformed: false };
}

function jsoncPropertyTokens(content) {
  const properties = [];
  const containers = [];
  const root = skipJsoncTrivia(content, 0);
  if (root.malformed || content[root.index] !== "{") return { properties, malformed: false };
  let malformed = false;
  for (let index = 0; index < content.length;) {
    const trivia = skipJsoncTrivia(content, index);
    if (trivia.malformed) return { properties, malformed: true };
    index = trivia.index;
    if (content[index] === "{") {
      containers.push({ type: "object", expectsKey: true });
      index++;
      continue;
    }
    if (content[index] === "[") {
      containers.push({ type: "array" });
      index++;
      continue;
    }
    if (content[index] === "}" || content[index] === "]") {
      const expectedType = content[index] === "}" ? "object" : "array";
      if (containers.at(-1)?.type !== expectedType) malformed = true;
      else containers.pop();
      index++;
      continue;
    }
    if (content[index] === ",") {
      const container = containers.at(-1);
      if (container?.type === "object") container.expectsKey = true;
      index++;
      continue;
    }
    if (content[index] !== '"') {
      index++;
      continue;
    }

    const keyEnd = scanJsonString(content, index);
    if (keyEnd === undefined) return { properties, malformed: true };
    let decodedString;
    try {
      decodedString = JSON.parse(content.slice(index, keyEnd));
    } catch {
      malformed = true;
    }
    const container = containers.at(-1);
    if (container?.type !== "object" || !container.expectsKey) {
      index = keyEnd;
      continue;
    }
    const afterKey = skipJsoncTrivia(content, keyEnd);
    if (afterKey.malformed) return { properties, malformed: true };
    if (content[afterKey.index] !== ":") {
      malformed = true;
      index = keyEnd;
      continue;
    }
    container.expectsKey = false;

    const afterColon = skipJsoncTrivia(content, afterKey.index + 1);
    if (afterColon.malformed) return { properties, malformed: true };
    let value;
    let stringValue = false;
    if (content[afterColon.index] === '"') {
      const valueEnd = scanJsonString(content, afterColon.index);
      if (valueEnd === undefined) {
        malformed = true;
      } else {
        try {
          value = JSON.parse(content.slice(afterColon.index, valueEnd));
          stringValue = true;
        } catch {
          malformed = true;
        }
      }
    }
    if (containers.length === 1 && container.type === "object" && decodedString !== undefined) {
      properties.push({ key: decodedString, stringValue, value });
    }
    index = keyEnd;
  }
  if (containers.length) malformed = true;
  return { properties, malformed };
}

function scanPublicUrl(content, file, violations, { allowedOrigins, localPolicy }) {
  const tokenized = jsoncPropertyTokens(content);
  if (tokenized.malformed) addViolation(violations, file, "MALFORMED_JSONC");
  const publicUrls = tokenized.properties.filter((property) => property.key === "publicUrl");
  if (publicUrls.length > 1) addViolation(violations, file, "DUPLICATE_PUBLIC_URL");
  for (const property of publicUrls) {
    if (!property.stringValue) {
      addViolation(violations, file, "UNAPPROVED_PUBLIC_URL");
      if (localPolicy) addViolation(violations, file, "NON_LOOPBACK_PUBLIC_URL");
      continue;
    }
    try {
      const url = new URL(property.value);
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

export function scanDirectory(
  root,
  {
    allowedPublicUrls = new Set(["http://localhost:8082"]),
    readTextFile = (filePath) => readFileSync(filePath, "utf8"),
  } = {},
) {
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
      content = readTextFile(filePath);
    } catch {
      addViolation(violations, `${sep}${file}`, "UNREADABLE_ENTRY");
      continue;
    }
    if (typeof content !== "string") {
      addViolation(violations, `${sep}${file}`, "UNREADABLE_ENTRY");
      continue;
    }
    if (content.includes("\0")) {
      addViolation(violations, `${sep}${file}`, "BINARY_ENTRY");
      continue;
    }
    scanContent(content, `${sep}${file}`, violations, urlPolicy);
  }
  return violations.sort((a, b) => `${a.file}:${a.ruleId}`.localeCompare(`${b.file}:${b.ruleId}`));
}

export function scanStagedDeploymentDiff(
  repoRoot = process.cwd(),
  deploymentRoot = DEFAULT_ROOT,
  { allowedPublicUrls = new Set(["http://localhost:8082"]) } = {},
) {
  let absoluteRepository;
  let repositoryRealRoot;
  let gitRealRoot;
  try {
    absoluteRepository = resolve(repoRoot);
    repositoryRealRoot = realpathSync(absoluteRepository);
    gitRealRoot = realpathSync(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: repositoryRealRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    return [{ file: "<staged-diff>", ruleId: "STAGED_DIFF_UNREADABLE" }];
  }
  if (gitRealRoot !== repositoryRealRoot) {
    return [{ file: "<staged-diff>", ruleId: "STAGED_DIFF_UNREADABLE" }];
  }

  const absoluteDeployment = resolve(repositoryRealRoot, deploymentRoot);
  if (!isWithin(repositoryRealRoot, absoluteDeployment)) {
    return [{ file: "<staged-diff>", ruleId: "STAGED_PATH_OUTSIDE_REPOSITORY" }];
  }
  const deploymentPath = relative(repositoryRealRoot, absoluteDeployment).replaceAll("\\", "/");
  if (!deploymentPath) {
    return [{ file: "<staged-diff>", ruleId: "STAGED_PATH_OUTSIDE_REPOSITORY" }];
  }

  let stagedPaths;
  try {
    const output = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z", "--", deploymentPath],
      {
        cwd: repositoryRealRoot,
        encoding: "utf8",
        maxBuffer: STAGED_PATH_OUTPUT_LIMIT,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    stagedPaths = output.split("\0").filter(Boolean);
  } catch {
    return [{ file: "<staged-diff>", ruleId: "STAGED_DIFF_UNREADABLE" }];
  }

  if (stagedPaths.length > STAGED_FILE_LIMIT) {
    return [{ file: "<staged-diff>", ruleId: "STAGED_FILE_LIMIT_EXCEEDED" }];
  }

  const violations = [];
  const urlPolicy = publicUrlPolicy(allowedPublicUrls);
  let totalSize = 0;
  for (const stagedPath of stagedPaths) {
    const file = `${sep}${stagedPath}`;
    const absoluteFile = resolve(repositoryRealRoot, stagedPath);
    if (!isWithin(repositoryRealRoot, absoluteFile) || !isWithin(absoluteDeployment, absoluteFile)) {
      addViolation(violations, file, "STAGED_PATH_OUTSIDE_REPOSITORY");
      continue;
    }
    if (basename(stagedPath) === ".env") {
      addViolation(violations, file, "COMMITTED_ENV_FILE");
      continue;
    }

    try {
      const indexRecords = execFileSync("git", ["ls-files", "--stage", "-z", "--", stagedPath], {
        cwd: repositoryRealRoot,
        encoding: "utf8",
        maxBuffer: 16_384,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split("\0")
        .filter(Boolean);
      if (indexRecords.length !== 1) throw new Error("missing stage-zero entry");
      const metadata = indexRecords[0].slice(0, indexRecords[0].indexOf("\t"));
      const match = /^(\d{6}) ([a-f0-9]{40,64}) 0$/.exec(metadata);
      if (!match) throw new Error("invalid stage-zero entry");
      const [, mode, objectId] = match;
      if (mode === "120000") {
        addViolation(violations, file, "SYMLINK_ENTRY");
        continue;
      }
      if (mode !== "100644" && mode !== "100755") {
        addViolation(violations, file, "UNSUPPORTED_ENTRY_TYPE");
        continue;
      }

      const size = Number(
        execFileSync("git", ["cat-file", "-s", objectId], {
          cwd: repositoryRealRoot,
          encoding: "utf8",
          maxBuffer: 1_024,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      );
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid staged object size");
      if (size > TEXT_FILE_LIMIT) {
        addViolation(violations, file, "OVERSIZED_ENTRY");
        continue;
      }
      totalSize += size;
      if (totalSize > STAGED_TOTAL_SIZE_LIMIT) {
        addViolation(violations, "<staged-diff>", "STAGED_TOTAL_SIZE_EXCEEDED");
        break;
      }

      const blob = execFileSync("git", ["cat-file", "blob", objectId], {
        cwd: repositoryRealRoot,
        maxBuffer: TEXT_FILE_LIMIT + 1,
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (!Buffer.isBuffer(blob) || blob.length !== size) throw new Error("invalid staged object");
      if (blob.includes(0)) {
        addViolation(violations, file, "BINARY_ENTRY");
        continue;
      }
      scanContent(blob.toString("utf8"), file, violations, urlPolicy);
    } catch {
      addViolation(violations, file, "STAGED_DIFF_UNREADABLE");
    }
  }

  return violations.sort((a, b) => `${a.file}:${a.ruleId}`.localeCompare(`${b.file}:${b.ruleId}`));
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
