#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_RECORD = Object.freeze({
  sponsorApproved: true,
  flyOrg: "personal",
  flyRegion: "jnb",
  provider: "openai",
  providerProjectDedicated: true,
  providerMaxExposureUsd: 50,
  autoRecharge: false,
  retentionReviewed: true,
  syntheticOnly: true,
  participantCount: 3,
  teardownScheduled: true,
});

const SECRET_KEY = /(?:api[_-]?key|authorization|credential|password|private[_-]?key|secret|token)/i;
const PARTICIPANT_IDENTITY_KEY = /^(?:participants?|participant(?:email|identit(?:y|ies)|ids?|names?))$/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVATION_INPUT_LIMIT_BYTES = 64 * 1024;
const FLY_JSON_INPUT_LIMIT_BYTES = 1024 * 1024;
const FORBIDDEN_APP_NAMES = new Set([
  "alpha-ticker-stage-a-hosted-core",
  "alpha-ticker-stage-a-hosted-web-ui",
  "alpha-ticker-stage-a-hosted-admin",
  "alpha-ticker-stage-a-hosted-portal",
  "alpha-ticker-stage-a-hosted-auth",
  "alpha-ticker-stage-a-hosted-sandboxes",
  "alpha-ticker-stage-a-egress",
]);

class ActivationRecordError extends Error {
  constructor(field) {
    super(`invalid activation field: ${field}`);
    this.name = "ActivationRecordError";
    this.field = field;
  }
}

function invalid(field) {
  const safeField = typeof field === "string" && /^[A-Za-z][A-Za-z0-9_.[\]-]{0,79}$/.test(field) ? field : "record";
  throw new ActivationRecordError(safeField);
}

function inspectForSensitiveData(value, field = "record", seen = new WeakSet()) {
  if (typeof value === "string" && EMAIL_VALUE.test(value)) invalid(field);
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) invalid(field);
  seen.add(value);

  const descriptors = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") invalid("record");
    if (Array.isArray(value) && key === "length") continue;
    if (SECRET_KEY.test(key) || PARTICIPANT_IDENTITY_KEY.test(key)) invalid(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalid(key);
    descriptors.push([key, descriptor]);
  }

  for (const [key, descriptor] of descriptors) {
    inspectForSensitiveData(descriptor.value, Array.isArray(value) ? `${field}[${key}]` : key, seen);
  }
}

export function assertActivationRecord(record) {
  if (
    typeof record !== "object" ||
    record === null ||
    Array.isArray(record) ||
    Object.getPrototypeOf(record) !== Object.prototype
  ) {
    invalid("record");
  }
  inspectForSensitiveData(record);

  const expectedKeys = Reflect.ownKeys(EXPECTED_RECORD);
  const suppliedKeys = Reflect.ownKeys(record);
  for (const key of suppliedKeys) {
    if (typeof key !== "string") invalid("record");
    if (!Object.hasOwn(EXPECTED_RECORD, key)) invalid(key);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid(key);
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor) || descriptor.value !== EXPECTED_RECORD[key]) invalid(key);
  }
}

function parseFlyInventory(kind, text) {
  let inventory;
  try {
    inventory = JSON.parse(text);
  } catch {
    invalid(kind);
  }
  if (!Array.isArray(inventory)) invalid(kind);

  const nameKey = kind === "apps" ? "Name" : "name";
  const names = [];
  for (const item of inventory) {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      Object.getPrototypeOf(item) !== Object.prototype
    ) {
      invalid(kind);
    }
    const name = item[nameKey];
    if (typeof name !== "string" || name.length === 0 || name.length > 255) invalid(kind);
    if (kind === "regions") {
      const code = item.code;
      if (typeof code !== "string" || !/^[a-z0-9]{3,16}$/.test(code)) invalid(kind);
    }
    names.push(name);
  }
  return { inventory, names };
}

export function assertFlyInventory(kind, text) {
  if (!["regions", "apps", "mpg", "storage"].includes(kind) || typeof text !== "string") invalid("fly-json");
  const { inventory, names } = parseFlyInventory(kind, text);

  if (kind === "regions" && !inventory.some((item) => item.code === "jnb")) invalid(kind);
  if (kind === "apps" && names.some((name) => FORBIDDEN_APP_NAMES.has(name))) invalid(kind);
  if (kind === "mpg" && names.includes("alpha-ticker-stage-a-hosted-pg")) invalid(kind);
  if (kind === "storage" && names.includes("alpha-ticker-stage-a-hosted-data")) invalid(kind);
}

function readBoundedRegularFile(input, limit) {
  let descriptor;
  try {
    descriptor = openSync(input, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > limit) invalid("input");
    const buffer = Buffer.alloc(limit + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > limit) invalid("input");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (error instanceof ActivationRecordError) throw error;
    invalid("input");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isDirectExecution(argvEntry) {
  if (!argvEntry || argvEntry === "-") return false;
  try {
    const candidateUrl = pathToFileURL(resolve(argvEntry));
    if (candidateUrl.href === import.meta.url) return true;
    return realpathSync(fileURLToPath(candidateUrl)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function commandFromArgs(args) {
  if (args.length === 2 && args[0] === "--input" && args[1]) {
    return { command: "activation", input: args[1] };
  }
  if (args.length === 4 && args[0] === "--fly-json" && args[1] && args[2] === "--input" && args[3]) {
    return { command: "fly-json", kind: args[1], input: args[3] };
  }
  invalid("input");
}

function runTimedCommand(args) {
  if (args.length < 4 || args[0] !== "--run-timeout" || args[2] !== "--") return false;
  const timeoutMs = Number(args[1]);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000 || !args[3]) {
    process.exitCode = 1;
    return true;
  }

  const result = spawnSync(args[3], args.slice(4), {
    stdio: ["ignore", "inherit", "inherit"],
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  process.exitCode = result.error || result.status === null ? 124 : result.status;
  return true;
}

function runCli() {
  if (runTimedCommand(process.argv.slice(2))) return;
  try {
    const request = commandFromArgs(process.argv.slice(2));
    if (request.command === "fly-json") {
      const json = readBoundedRegularFile(request.input, FLY_JSON_INPUT_LIMIT_BYTES);
      assertFlyInventory(request.kind, json);
      process.stdout.write("fly-json: pass\n");
      return;
    }

    let record;
    try {
      record = JSON.parse(readBoundedRegularFile(request.input, ACTIVATION_INPUT_LIMIT_BYTES));
    } catch (error) {
      if (error instanceof ActivationRecordError) throw error;
      invalid("input");
    }
    assertActivationRecord(record);
    process.stdout.write("activation-record: pass\n");
  } catch (error) {
    const field = error instanceof ActivationRecordError ? error.field : "input";
    process.stderr.write(`activation-record: fail ${field}\n`);
    process.exitCode = 1;
  }
}

if (isDirectExecution(process.argv[1])) runCli();
