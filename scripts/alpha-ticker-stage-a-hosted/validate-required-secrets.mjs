#!/usr/bin/env node

import { createPrivateKey } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_ENV_BYTES = 64 * 1024;
const EXPECTED_PUBLIC_API_URL = "https://alpha-ticker-stage-a-hosted-core.fly.dev";
const EMAIL_PATTERN = /^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$/;
const SMTP_HOST_PATTERN =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export const REQUIRED_SECRET_NAMES = Object.freeze([
  "ADMIN_GRANTS",
  "AUTH_ALLOWED_EMAILS",
  "AUTH_CLIENT_SECRET",
  "AUTH_EMAIL_FROM",
  "AUTH_SIGNING_JWK",
  "AUTH_TOKEN_SECRET",
  "CAPABILITY_SECRET",
  "CONNECTOR_SECRET_KEY",
  "CORE_SIGNING_SECRET",
  "FLY_SANDBOX_API_TOKEN",
  "OPENAI_API_KEY",
  "PORTAL_IDENTITY_SECRET",
  "PORTAL_SESSION_SECRET",
  "PUBLIC_API_URL",
  "SKILL_SIGNING_SECRET",
  "SMTP_HOST",
  "SMTP_PASSWORD",
  "SMTP_USERNAME",
]);

const DISTINCT_SECRET_NAMES = Object.freeze([
  "AUTH_CLIENT_SECRET",
  "AUTH_TOKEN_SECRET",
  "CAPABILITY_SECRET",
  "CONNECTOR_SECRET_KEY",
  "CORE_SIGNING_SECRET",
  "PORTAL_IDENTITY_SECRET",
  "PORTAL_SESSION_SECRET",
  "SKILL_SIGNING_SECRET",
]);

export const GENERATED_SECRET_NAMES = Object.freeze([...DISTINCT_SECRET_NAMES, "AUTH_SIGNING_JWK"]);
const EXTERNAL_SECRET_NAMES = Object.freeze(
  REQUIRED_SECRET_NAMES.filter((name) => !GENERATED_SECRET_NAMES.includes(name)),
);

class ValidationError extends Error {}

function invalid() {
  throw new ValidationError();
}

function readPrivateEnv(path) {
  let descriptor;
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600) {
      invalid();
    }
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || (opened.mode & 0o777) !== 0o600 || opened.size > MAX_ENV_BYTES) {
      invalid();
    }
    const bytes = readFileSync(descriptor);
    if (bytes.length > MAX_ENV_BYTES) invalid();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    invalid();
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the fixed validation outcome.
      }
    }
  }
}

function parseEnv(source) {
  if (source.includes("\0") || source.includes("\r")) invalid();
  const values = new Map();
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) invalid();
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || values.has(name)) invalid();
    values.set(name, value);
  }
  return values;
}

function requireValue(values, name) {
  const value = values.get(name);
  if (typeof value !== "string" || !value || /^(replace-me|placeholder|changeme|todo)$/i.test(value)) invalid();
  return value;
}

function parseEmailList(value) {
  const emails = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (
    emails.length === 0 ||
    new Set(emails).size !== emails.length ||
    !emails.every((email) => EMAIL_PATTERN.test(email))
  ) {
    invalid();
  }
  return new Set(emails);
}

function parseAdminEmails(value) {
  const emails = [];
  for (const rawEntry of value.split(",")) {
    const entry = rawEntry.trim();
    const separator = entry.lastIndexOf(":");
    const email = entry.slice(0, separator).trim().toLowerCase();
    const role = entry.slice(separator + 1).trim();
    if (separator <= 0 || role !== "org_admin" || !EMAIL_PATTERN.test(email)) invalid();
    emails.push(email);
  }
  if (emails.length === 0 || new Set(emails).size !== emails.length) invalid();
  return new Set(emails);
}

function validateSigningJwk(value) {
  let jwk;
  try {
    jwk = JSON.parse(value);
  } catch {
    invalid();
  }
  if (
    typeof jwk !== "object" ||
    jwk === null ||
    Array.isArray(jwk) ||
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    ![jwk.d, jwk.x, jwk.y].every((part) => typeof part === "string" && part.length > 0)
  ) {
    invalid();
  }
  try {
    const key = createPrivateKey({ key: jwk, format: "jwk" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") invalid();
  } catch {
    invalid();
  }
}

function validateExternalValues(values) {
  const adminEmails = parseAdminEmails(requireValue(values, "ADMIN_GRANTS"));
  const allowedEmails = parseEmailList(requireValue(values, "AUTH_ALLOWED_EMAILS"));
  if (![...adminEmails].every((email) => allowedEmails.has(email))) invalid();

  const from = requireValue(values, "AUTH_EMAIL_FROM");
  const bracketed = /<([^<>]+)>$/.exec(from);
  if (!EMAIL_PATTERN.test((bracketed?.[1] ?? from).trim())) invalid();
  if (!requireValue(values, "OPENAI_API_KEY").startsWith("sk-")) invalid();
  if (requireValue(values, "PUBLIC_API_URL") !== EXPECTED_PUBLIC_API_URL) invalid();
  if (!SMTP_HOST_PATTERN.test(requireValue(values, "SMTP_HOST"))) invalid();
}

export function assertExternalSecrets(source) {
  const values = parseEnv(source);
  for (const name of EXTERNAL_SECRET_NAMES) requireValue(values, name);
  validateExternalValues(values);
}

export function assertRequiredSecrets(source) {
  const values = parseEnv(source);
  for (const name of REQUIRED_SECRET_NAMES) requireValue(values, name);
  validateExternalValues(values);
  validateSigningJwk(requireValue(values, "AUTH_SIGNING_JWK"));

  const distinctValues = DISTINCT_SECRET_NAMES.map((name) => requireValue(values, name));
  if (
    distinctValues.some((value) => !/^[0-9a-f]{64}$/.test(value)) ||
    new Set(distinctValues).size !== distinctValues.length
  ) {
    invalid();
  }
}

function isDirectExecution(argvEntry) {
  if (!argvEntry) return false;
  return pathToFileURL(resolve(argvEntry)).href === import.meta.url;
}

function runCli() {
  try {
    const args = process.argv.slice(2);
    const externalOnly = args[0] === "--external-only";
    const offset = externalOnly ? 1 : 0;
    if (args.length !== offset + 2 || args[offset] !== "--env" || !args[offset + 1]) invalid();
    const source = readPrivateEnv(args[offset + 1]);
    if (externalOnly) {
      assertExternalSecrets(source);
      process.stdout.write("external-secrets: pass\n");
    } else {
      assertRequiredSecrets(source);
      process.stdout.write("required-secrets: pass\n");
    }
  } catch {
    const externalOnly = process.argv.slice(2)[0] === "--external-only";
    process.stderr.write(externalOnly ? "external-secrets: fail\n" : "required-secrets: fail\n");
    process.exitCode = 1;
  }
}

if (isDirectExecution(process.argv[1])) runCli();
