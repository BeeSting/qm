import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { loadConfigAt } from "../deploy/layers/alpha-ticker-stage-a-hosted/node_modules/@yc-software/qm/dist/src/config.js";
import {
  computedSecrets,
  MINT_JWK,
  MINT_LOCALLY,
} from "../deploy/layers/alpha-ticker-stage-a-hosted/node_modules/@yc-software/qm/dist/src/secrets.js";
// @ts-expect-error -- the committed validator is an .mjs CLI without a separate declaration file.
const contract = await import("../scripts/alpha-ticker-stage-a-hosted/validate-required-secrets.mjs");
const { GENERATED_SECRET_NAMES, REQUIRED_SECRET_NAMES } = contract;

const validator = resolve("scripts/alpha-ticker-stage-a-hosted/validate-required-secrets.mjs");
const deploymentRoot = resolve("deploy/layers/alpha-ticker-stage-a-hosted");
const validSigningJwk = JSON.stringify(
  generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
);

function validEntries(): Map<string, string> {
  const entries = new Map<string, string>([
    ["ADMIN_GRANTS", "admin@example.com:org_admin"],
    ["AUTH_ALLOWED_EMAILS", "admin@example.com,analyst@example.com"],
    ["AUTH_EMAIL_FROM", "Alpha Ticker <auth@example.com>"],
    ["AUTH_SIGNING_JWK", validSigningJwk],
    ["FLY_SANDBOX_API_TOKEN", "fly-sandbox-token"],
    ["OPENAI_API_KEY", "sk-test-provider-key"],
    ["PUBLIC_API_URL", "https://alpha-ticker-stage-a-hosted-core.fly.dev"],
    ["SMTP_HOST", "smtp.example.com"],
    ["SMTP_PASSWORD", "smtp-password"],
    ["SMTP_USERNAME", "smtp-user"],
  ]);
  const distinctKeys = [
    "AUTH_CLIENT_SECRET",
    "AUTH_TOKEN_SECRET",
    "CAPABILITY_SECRET",
    "CONNECTOR_SECRET_KEY",
    "CORE_SIGNING_SECRET",
    "PORTAL_IDENTITY_SECRET",
    "PORTAL_SESSION_SECRET",
    "SKILL_SIGNING_SECRET",
  ];
  for (const [index, name] of distinctKeys.entries()) {
    entries.set(name, createHash("sha256").update(`${name}:${index}`).digest("hex"));
  }
  return entries;
}

function serialize(entries: Map<string, string>): string {
  return `${[...entries].map(([name, value]) => `${name}=${value}`).join("\n")}\n`;
}

function runValidator(content: string, options: { mode?: number; symlink?: boolean; externalOnly?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "qm-required-secrets-"));
  const envPath = join(root, ".env");
  const targetPath = join(root, "target.env");
  writeFileSync(targetPath, content, { mode: options.mode ?? 0o600 });
  chmodSync(targetPath, options.mode ?? 0o600);
  if (options.symlink) symlinkSync(targetPath, envPath);
  else writeFileSync(envPath, content, { mode: options.mode ?? 0o600 });
  if (!options.symlink) chmodSync(envPath, options.mode ?? 0o600);
  const result = spawnSync(
    process.execPath,
    [validator, ...(options.externalOnly ? ["--external-only"] : []), "--env", envPath],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  return { result, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function assertFixedFailure(content: string, options: { mode?: number; symlink?: boolean } = {}): void {
  const harness = runValidator(content, options);
  try {
    assert.notEqual(harness.result.status, 0);
    assert.equal(harness.result.stdout, "");
    assert.equal(harness.result.stderr, "required-secrets: fail\n");
    assert.doesNotMatch(
      `${harness.result.stdout}${harness.result.stderr}`,
      /example\.com|sk-test|smtp-password|fly-sandbox|0123456789abcdef|target\.env/i,
    );
  } finally {
    harness.cleanup();
  }
}

test("required-secret contract matches the pinned QM configuration", () => {
  const { config } = loadConfigAt(join(deploymentRoot, "qm.config.jsonc"));
  const required = computedSecrets(config)
    .filter((secret) => secret.managedBy === "operator" && secret.required)
    .map((secret) => secret.name)
    .sort();
  assert.deepEqual([...REQUIRED_SECRET_NAMES], required);
  const generated = computedSecrets(config)
    .filter(
      (secret) =>
        secret.managedBy === "operator" &&
        secret.required &&
        (secret.generate === MINT_LOCALLY || secret.generate === MINT_JWK),
    )
    .map((secret) => secret.name)
    .sort();
  assert.deepEqual([...GENERATED_SECRET_NAMES].sort(), generated);
});

test("external-only validation requires independent identity and provider values before setup", () => {
  const entries = validEntries();
  for (const name of GENERATED_SECRET_NAMES) entries.delete(name);
  const accepted = runValidator(serialize(entries), { externalOnly: true });
  try {
    assert.equal(accepted.result.status, 0, accepted.result.stderr);
    assert.equal(accepted.result.stdout, "external-secrets: pass\n");
    assert.equal(accepted.result.stderr, "");
  } finally {
    accepted.cleanup();
  }

  for (const name of ["ADMIN_GRANTS", "AUTH_ALLOWED_EMAILS", "FLY_SANDBOX_API_TOKEN", "OPENAI_API_KEY"]) {
    const missing = new Map(entries);
    missing.delete(name);
    const rejected = runValidator(serialize(missing), { externalOnly: true });
    try {
      assert.notEqual(rejected.result.status, 0);
      assert.equal(rejected.result.stdout, "");
      assert.equal(rejected.result.stderr, "external-secrets: fail\n");
    } finally {
      rejected.cleanup();
    }
  }
});

test("required-secret validator accepts a complete independent secret set", () => {
  const harness = runValidator(serialize(validEntries()));
  try {
    assert.equal(harness.result.status, 0, harness.result.stderr);
    assert.equal(harness.result.stdout, "required-secrets: pass\n");
    assert.equal(harness.result.stderr, "");
  } finally {
    harness.cleanup();
  }
});

test("required-secret validator fails closed for every omitted required value", () => {
  for (const name of REQUIRED_SECRET_NAMES) {
    const entries = validEntries();
    entries.delete(name);
    assertFixedFailure(serialize(entries));
  }
});

test("required-secret validator rejects placeholders, duplicates, and inconsistent identities", () => {
  const placeholder = validEntries();
  placeholder.set("SMTP_PASSWORD", "replace-me");
  assertFixedFailure(serialize(placeholder));

  const duplicate = serialize(validEntries()) + "OPENAI_API_KEY=sk-second-value\n";
  assertFixedFailure(duplicate);

  const missingAdmin = validEntries();
  missingAdmin.set("AUTH_ALLOWED_EMAILS", "analyst@example.com");
  assertFixedFailure(serialize(missingAdmin));

  const reused = validEntries();
  reused.set("AUTH_TOKEN_SECRET", reused.get("AUTH_CLIENT_SECRET")!);
  assertFixedFailure(serialize(reused));

  const weakGenerated = validEntries();
  weakGenerated.set("AUTH_TOKEN_SECRET", "a".repeat(63));
  assertFixedFailure(serialize(weakGenerated));
});

test("required-secret validator rejects malformed structured values", () => {
  for (const [name, value] of [
    ["ADMIN_GRANTS", "admin@example.com:viewer"],
    ["AUTH_ALLOWED_EMAILS", "not-an-email"],
    ["AUTH_EMAIL_FROM", "not-an-email"],
    ["AUTH_SIGNING_JWK", '{"kty":"RSA"}'],
    ["AUTH_SIGNING_JWK", '{"kty":"EC","crv":"P-256","d":"private","x":"public-x","y":"public-y"}'],
    ["OPENAI_API_KEY", "provider-key"],
    ["PUBLIC_API_URL", "https://other.example.com"],
    ["SMTP_HOST", "smtp host"],
  ] as const) {
    const entries = validEntries();
    entries.set(name, value);
    assertFixedFailure(serialize(entries));
  }
});

test("required-secret validator accepts only bounded private regular files", () => {
  const content = serialize(validEntries());
  assertFixedFailure(content, { mode: 0o644 });
  assertFixedFailure(content, { symlink: true });
  assertFixedFailure(`${content}#${"x".repeat(70_000)}\n`);
});

test("required-secret module import has no CLI side effects", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import ${JSON.stringify(validator)}`], {
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
