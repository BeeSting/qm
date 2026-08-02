#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
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

  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForSensitiveData(item, `${field}[${index}]`, seen));
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || PARTICIPANT_IDENTITY_KEY.test(key)) invalid(key);
    inspectForSensitiveData(nested, key, seen);
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

  const expectedKeys = Object.keys(EXPECTED_RECORD);
  const suppliedKeys = Reflect.ownKeys(record);
  for (const key of suppliedKeys) {
    if (typeof key !== "string") invalid("record");
    if (!Object.hasOwn(EXPECTED_RECORD, key)) invalid(key);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid(key);
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(record, key) || record[key] !== EXPECTED_RECORD[key]) invalid(key);
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

function inputPathFromArgs(args) {
  if (args.length !== 2 || args[0] !== "--input" || !args[1]) invalid("input");
  return args[1];
}

function runCli() {
  try {
    const input = inputPathFromArgs(process.argv.slice(2));
    let record;
    try {
      record = JSON.parse(readFileSync(input, "utf8"));
    } catch {
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
