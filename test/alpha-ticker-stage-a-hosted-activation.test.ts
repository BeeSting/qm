import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const activationScript = resolve("scripts/alpha-ticker-stage-a-hosted/activation-record.mjs");
const preflightScript = resolve("scripts/alpha-ticker-stage-a-hosted/preflight.sh");
const hostedRoot = "deploy/layers/alpha-ticker-stage-a-hosted";
const activationRelativePath = ".generated/alpha-ticker-stage-a-hosted/activation.json";
const missingImagePin =
  '"sandbox.app" is set but no sandbox layer image is pinned; run `qm sandbox publish` to build and record the digest-pinned "sandbox.image" agents boot from';
const sentinel = "DO-NOT-LEAK-IDENTITY-OR-ENV";
const envSecretName = "OPENAI_API_KEY";
const envSecretValue = "sk-test-env-value-that-must-never-leak";

const acceptedRecord = {
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
} as const;

interface ActivationModule {
  assertActivationRecord(record: unknown): void;
  assertQmInstall(root: string, expectedDigest?: string): void;
  calculateQmPackageTreeDigest(packageRoot: string): string;
}

interface PreflightScenario {
  nodeVersion?: string;
  npmVersion?: string;
  dirtyTracked?: boolean;
  boundaryExit?: number;
  buildxExit?: number;
  qmBinary?: "present" | "missing" | "unexpected-symlink";
  qmInstallExit?: number;
  flyAuthExit?: number;
  flyAuthDelaySeconds?: number;
  regionsExit?: number;
  regions?: string;
  appsExit?: number;
  appOutput?: string;
  mpgExit?: number;
  mpgOutput?: string;
  storageExit?: number;
  storageOutput?: string;
  activation?: unknown;
  envState?: "file" | "missing" | "symlink";
  envMode?: number;
  envIgnored?: boolean;
  qmCheckExit?: number;
  qmBuildExit?: number;
  qmPlanExit?: number;
  qmPlanOutput?: string;
  mutateEnvAfterQmCheck?: boolean;
}

interface PreflightResult {
  status: number | null;
  stdout: string;
  stderr: string;
  root: string;
  cleanup(): void;
}

const activationModule: unknown = await import(pathToFileURL(activationScript).href);
assert.ok(typeof activationModule === "object" && activationModule !== null);
assert.equal(typeof (activationModule as ActivationModule).assertActivationRecord, "function");
const { assertActivationRecord, assertQmInstall, calculateQmPackageTreeDigest } = activationModule as ActivationModule;

function regionInventory(code = "jnb") {
  return JSON.stringify([
    {
      code,
      name: "Johannesburg",
      latitude: -26.2,
      longitude: 28.04,
      gateway_available: true,
      requires_paid_plan: false,
      deprecated: false,
      capacity: 1,
      geo_region: "africa",
    },
  ]);
}

function appInventory(name: string) {
  return JSON.stringify([{ Name: name, Organization: { Slug: "personal" } }]);
}

function mpgInventory(name: string) {
  return JSON.stringify([
    {
      id: "cluster-id",
      mpgd_cluster_id: "mpgd-cluster-id",
      version: 1,
      name,
      region: "jnb",
      status: "ready",
      plan: "basic",
      disk: 10,
      replicas: 2,
      organization: { Slug: "personal" },
      ip_assignments: { direct: "" },
      attached_apps: [],
    },
  ]);
}

function storageTable(rows: Array<[string, string]> = []) {
  const firstColumnWidth = Math.max(4, ...rows.map(([name]) => name.length));
  const secondColumnWidth = Math.max(3, ...rows.map(([, org]) => org.length));
  const lines = [
    ` ${"NAME".padEnd(firstColumnWidth)} │ ${"ORG".padEnd(secondColumnWidth)} `,
    ...rows.map(([name, org]) => ` ${name.padEnd(firstColumnWidth)} │ ${org.padEnd(secondColumnWidth)} `),
  ];
  return `${lines.join("\n")}\n\n`;
}

function fieldFromError(run: () => void): string {
  let message = "";
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof Error);
    message = error.message;
    return true;
  });
  return message;
}

function cli(record: unknown) {
  const root = mkdtempSync(join(tmpdir(), "qm-activation-cli-"));
  const input = join(root, "activation.json");
  writeFileSync(input, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  const result = spawnSync(process.execPath, [activationScript, "--input", input], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  rmSync(root, { force: true, recursive: true });
  return result;
}

function cliPath(input: string) {
  return spawnSync(process.execPath, [activationScript, "--input", input], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function writeShim(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}`, { mode: 0o700 });
}

function createQmInstallFixture() {
  const root = mkdtempSync(join(tmpdir(), "qm-install-verification-"));
  const packageRoot = join(root, "node_modules", "@yc-software", "qm");
  const packageBinRoot = join(packageRoot, "dist", "bin");
  const binRoot = join(root, "node_modules", ".bin");
  mkdirSync(packageBinRoot, { recursive: true });
  mkdirSync(binRoot, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { "@yc-software/qm": "0.1.4" } }));
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { dependencies: { "@yc-software/qm": "0.1.4" } },
        "node_modules/@yc-software/qm": {
          version: "0.1.4",
          resolved: "https://registry.npmjs.org/@yc-software/qm/-/qm-0.1.4.tgz",
          integrity: "sha512-L3WWtV+yjhBq7ARYJxNzTpV4cdvw8ZCYXVk0kRUUPjKwH7NObz8newikeCZwijvpmEEEnDLTi02O+nowQTDC4Q==",
        },
      },
    }),
  );
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "@yc-software/qm", version: "0.1.4", bin: { qm: "dist/bin/qm.js" } }),
  );
  writeFileSync(join(packageRoot, "README.md"), "fixture\n");
  const executable = join(packageBinRoot, "qm.js");
  writeFileSync(executable, "#!/usr/bin/env node\n", { mode: 0o755 });
  chmodSync(executable, 0o755);
  symlinkSync("../@yc-software/qm/dist/bin/qm.js", join(binRoot, "qm"));
  const digest = calculateQmPackageTreeDigest(packageRoot);
  return { root, executable, digest, cleanup: () => rmSync(root, { force: true, recursive: true }) };
}

function createPreflightScenario(scenario: PreflightScenario = {}): PreflightResult {
  const root = mkdtempSync(join(tmpdir(), "qm-hosted-preflight-"));
  const shimRoot = join(root, "shims");
  const scriptRoot = join(root, "scripts", "alpha-ticker-stage-a-hosted");
  const deploymentRoot = join(root, hostedRoot);
  const generatedRoot = dirname(join(root, activationRelativePath));
  const qmBinRoot = join(deploymentRoot, "node_modules", ".bin");
  const qmPackageBinRoot = join(deploymentRoot, "node_modules", "@yc-software", "qm", "dist", "bin");
  const callLog = join(root, "external-calls.log");
  mkdirSync(shimRoot, { recursive: true });
  mkdirSync(scriptRoot, { recursive: true });
  mkdirSync(deploymentRoot, { recursive: true });
  mkdirSync(generatedRoot, { recursive: true });
  mkdirSync(qmBinRoot, { recursive: true });
  mkdirSync(qmPackageBinRoot, { recursive: true });
  copyFileSync(activationScript, join(scriptRoot, "activation-record.mjs"));
  copyFileSync(preflightScript, join(scriptRoot, "preflight.sh"));
  chmodSync(join(scriptRoot, "preflight.sh"), 0o700);

  const envPath = join(deploymentRoot, ".env");
  const envContent = `${envSecretName}=${envSecretValue}\n`;
  if (scenario.envState === "symlink") {
    const envTarget = join(root, "synthetic-test.env");
    writeFileSync(envTarget, envContent, { mode: 0o600 });
    symlinkSync(envTarget, envPath);
  } else if (scenario.envState !== "missing") {
    writeFileSync(envPath, envContent, { mode: scenario.envMode ?? 0o600 });
    chmodSync(envPath, scenario.envMode ?? 0o600);
  }
  writeFileSync(join(root, activationRelativePath), `${JSON.stringify(scenario.activation ?? acceptedRecord)}\n`, {
    mode: 0o600,
  });

  const realNode = process.execPath;
  writeShim(
    join(shimRoot, "node"),
    `if [ "\${1-}" = "--version" ]; then\n` +
      `  printf '%s\\n' ${shellQuote(scenario.nodeVersion ?? "v24.18.1")}\n` +
      `  printf '%s\\n' ${shellQuote(sentinel)} >&2\n` +
      `  exit 0\n` +
      `fi\n` +
      `case "\${1-}" in\n` +
      `  */check-boundary.mjs) printf '%s\\n' ${shellQuote(sentinel)} >&2; exit ${scenario.boundaryExit ?? 0} ;;\n` +
      `esac\n` +
      `if [ "\${2-}" = "--verify-qm-install" ]; then\n` +
      `  printf '%s\\n' ${shellQuote(sentinel)} >&2\n` +
      `  exit ${scenario.qmInstallExit ?? (scenario.qmBinary === "present" || scenario.qmBinary === undefined ? 0 : 1)}\n` +
      `fi\n` +
      `exec ${shellQuote(realNode)} "$@"\n`,
  );

  writeShim(
    join(shimRoot, "npm"),
    `if [ "\${1-}" = "--version" ]; then\n` +
      `  printf '%s\\n' ${shellQuote(scenario.npmVersion ?? "11.16.0")}\n` +
      `  printf '%s\\n' ${shellQuote(sentinel)} >&2\n` +
      `  exit 0\n` +
      `fi\n` +
      `printf '%s\\n' 'npm-network-capable-command' >> ${shellQuote(callLog)}\n` +
      `exit 99\n`,
  );

  if (scenario.qmBinary !== "missing") {
    writeShim(
      join(qmPackageBinRoot, "qm.js"),
      `case "$*" in\n` +
        `  "check") printf '%s\\n' ${shellQuote(sentinel)} >&2; ${scenario.mutateEnvAfterQmCheck ? `rm -f .env; printf '%s\\n' ${shellQuote(envContent.trim())} > .env; chmod 600 .env` : ":"}; exit ${scenario.qmCheckExit ?? 0} ;;\n` +
        `  "sandbox build --dry-run") printf '%s\\n' ${shellQuote(sentinel)} >&2; exit ${scenario.qmBuildExit ?? 0} ;;\n` +
        `  "plan") [ "\${NO_COLOR-}" = "1" ] || { printf '%s\\n' 'colorized-output'; exit 1; }; printf '%s\\n' ${shellQuote(scenario.qmPlanOutput ?? `error: ${missingImagePin}`)}; exit ${scenario.qmPlanExit ?? 1} ;;\n` +
        `  *) exit 99 ;;\n` +
        `esac\n`,
    );
    if (scenario.qmBinary === "unexpected-symlink") {
      symlinkSync("../@yc-software/qm/dist/bin/not-qm.js", join(qmBinRoot, "qm"));
    } else {
      symlinkSync("../@yc-software/qm/dist/bin/qm.js", join(qmBinRoot, "qm"));
    }
  }

  writeShim(
    join(shimRoot, "git"),
    `printf '%s\\n' ${shellQuote(sentinel)} >&2\n` +
      `case "$*" in\n` +
      `  "status --porcelain --untracked-files=no") ${scenario.dirtyTracked ? `printf '%s\\n' ' M tracked-file'` : ":"}; exit 0 ;;\n` +
      `  "check-ignore --quiet ${hostedRoot}/.env") exit ${scenario.envIgnored === false ? 1 : 0} ;;\n` +
      `  *) exit 99 ;;\n` +
      `esac\n`,
  );

  writeShim(
    join(shimRoot, "docker"),
    `printf '%s\\n' 'docker' >> ${shellQuote(callLog)}\n` +
      `printf '%s\\n' ${shellQuote(sentinel)} >&2\n` +
      `if [ "$*" = "buildx version" ]; then exit ${scenario.buildxExit ?? 0}; fi\n` +
      `exit 99\n`,
  );

  writeShim(
    join(shimRoot, "fly"),
    `printf '%s\\n' 'fly' >> ${shellQuote(callLog)}\n` +
      `printf '%s\\n' ${shellQuote(sentinel)} >&2\n` +
      `case "$*" in\n` +
      `  "auth whoami") ${scenario.flyAuthDelaySeconds ? `sleep ${scenario.flyAuthDelaySeconds};` : ":"} printf '%s\\n' ${shellQuote("private-operator-identity")}; exit ${scenario.flyAuthExit ?? 0} ;;\n` +
      `  "platform regions --json") printf '%s\\n' ${shellQuote(scenario.regions ?? regionInventory())}; exit ${scenario.regionsExit ?? 0} ;;\n` +
      `  "apps list --org personal --json") printf '%s\\n' ${shellQuote(scenario.appOutput ?? "[]")}; exit ${scenario.appsExit ?? 0} ;;\n` +
      `  "mpg list --json --org personal") printf '%s' ${shellQuote(scenario.mpgOutput ?? "No managed postgres clusters found in organization personal\n")}; exit ${scenario.mpgExit ?? 0} ;;\n` +
      `  "storage list --org personal") printf '%s' ${shellQuote(scenario.storageOutput ?? storageTable())}; exit ${scenario.storageExit ?? 0} ;;\n` +
      `  *) exit 99 ;;\n` +
      `esac\n`,
  );

  const result = spawnSync("bash", [join(scriptRoot, "preflight.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${shimRoot}:${process.env.PATH ?? ""}`,
      ALPHA_TICKER_PREFLIGHT_TIMEOUT_SECONDS: "2",
      NO_COLOR: "",
      FORCE_COLOR: "",
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    root,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

function assertPreflightFailure(scenario: PreflightScenario, check: string) {
  const result = createPreflightScenario(scenario);
  try {
    assert.notEqual(result.status, 0);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, new RegExp(`(^|\\n)${check}: fail\\n?$`));
    assert.doesNotMatch(output, new RegExp(sentinel));
    assert.doesNotMatch(output, /private-operator-identity/);
    assert.equal(output.includes(envSecretName), false);
    assert.equal(output.includes(envSecretValue), false);
  } finally {
    result.cleanup();
  }
}

test("activation record accepts only the approved non-secret record", () => {
  assert.doesNotThrow(() => assertActivationRecord(acceptedRecord));
  const result = cli(acceptedRecord);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "activation-record: pass\n");
  assert.equal(result.stderr, "");
});

test("activation record rejects every changed required control without echoing values", () => {
  const changes: Array<[keyof typeof acceptedRecord, unknown]> = [
    ["sponsorApproved", false],
    ["flyOrg", "private-org-do-not-leak"],
    ["flyRegion", "private-region-do-not-leak"],
    ["provider", "private-provider-do-not-leak"],
    ["providerProjectDedicated", false],
    ["providerMaxExposureUsd", 49],
    ["autoRecharge", true],
    ["retentionReviewed", false],
    ["syntheticOnly", false],
    ["participantCount", 4],
    ["teardownScheduled", false],
  ];
  for (const [field, value] of changes) {
    const message = fieldFromError(() => assertActivationRecord({ ...acceptedRecord, [field]: value }));
    assert.match(message, new RegExp(field));
    assert.equal(message.includes(String(value)), false);
  }
});

test("activation record rejects extra and recursively secret-bearing fields", () => {
  const secretValue = "sk-private-value-that-must-not-appear";
  const cases: Array<[unknown, string]> = [
    [{ ...acceptedRecord, unexpectedControl: true }, "unexpectedControl"],
    [{ ...acceptedRecord, metadata: { nested: { apiToken: secretValue } } }, "apiToken"],
    [{ ...acceptedRecord, metadata: { nested: { clientSecret: secretValue } } }, "clientSecret"],
    [{ ...acceptedRecord, metadata: { password: secretValue } }, "password"],
  ];
  for (const [record, field] of cases) {
    const message = fieldFromError(() => assertActivationRecord(record));
    assert.match(message, new RegExp(field));
    assert.equal(message.includes(secretValue), false);
  }
});

test("activation record rejects participant identities and email addresses", () => {
  const privateName = "Private Participant Name";
  const privateEmail = "private.participant@example.invalid";
  const cases: Array<[unknown, string, string]> = [
    [{ ...acceptedRecord, participantNames: [privateName] }, "participantNames", privateName],
    [{ ...acceptedRecord, participants: [{ name: privateName }] }, "participants", privateName],
    [{ ...acceptedRecord, note: privateEmail }, "note", privateEmail],
  ];
  for (const [record, field, value] of cases) {
    const message = fieldFromError(() => assertActivationRecord(record));
    assert.match(message, new RegExp(field));
    assert.equal(message.includes(value), false);
  }
});

test("activation record rejects inherited, non-enumerable, and symbol extras", () => {
  const inherited = Object.assign(Object.create({ inheritedExtra: true }), acceptedRecord);
  const nonEnumerable = { ...acceptedRecord };
  Object.defineProperty(nonEnumerable, "nonEnumerableExtra", { value: true });
  const symbolExtra = { ...acceptedRecord, [Symbol("symbolExtra")]: true };

  for (const record of [inherited, nonEnumerable, symbolExtra]) {
    assert.throws(() => assertActivationRecord(record), /invalid activation field:/);
  }
});

test("activation record rejects accessors without executing getters", () => {
  let getterExecuted = false;
  const record = { ...acceptedRecord } as Record<string, unknown>;
  Object.defineProperty(record, "flyOrg", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return "personal";
    },
  });

  assert.throws(() => assertActivationRecord(record), /invalid activation field: flyOrg/);
  assert.equal(getterExecuted, false);
});

test("activation CLI failures name only the invalid field", () => {
  const privateValue = "private-org-do-not-leak";
  const result = cli({ ...acceptedRecord, flyOrg: privateValue });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "activation-record: fail flyOrg\n");
  assert.equal(`${result.stdout}${result.stderr}`.includes(privateValue), false);
});

test("activation CLI sanitizes an unsafe field name instead of reflecting it", () => {
  const injectedField = "unsafe-field\\nprivate-value-do-not-leak";
  const result = cli({ ...acceptedRecord, [injectedField]: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "activation-record: fail record\n");
  assert.equal(`${result.stdout}${result.stderr}`.includes("private-value-do-not-leak"), false);
});

test("activation module import through node stdin does not execute or crash", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `await import(${JSON.stringify(pathToFileURL(activationScript).href)});\n`,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("activation CLI rejects symlinked and oversized inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "qm-activation-input-"));
  try {
    const target = join(root, "target.json");
    const link = join(root, "activation-link.json");
    const oversized = join(root, "activation-oversized.json");
    writeFileSync(target, `${JSON.stringify(acceptedRecord)}\n`, { mode: 0o600 });
    symlinkSync(target, link);
    writeFileSync(oversized, " ".repeat(65_537), { mode: 0o600 });

    for (const input of [link, oversized]) {
      const result = cliPath(input);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "activation-record: fail input\n");
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("QM install verification enforces metadata and the deterministic package digest", () => {
  assert.equal(typeof calculateQmPackageTreeDigest, "function");
  assert.equal(typeof assertQmInstall, "function");
  const fixture = createQmInstallFixture();
  try {
    assert.doesNotThrow(() => assertQmInstall(fixture.root, fixture.digest));
    writeFileSync(fixture.executable, "#!/usr/bin/env node\n// tampered\n", { mode: 0o755 });
    assert.throws(() => assertQmInstall(fixture.root, fixture.digest), /invalid activation field: qmTreeDigest/);
  } finally {
    fixture.cleanup();
  }
});

test("QM install verification rejects dependency, lock, and installed metadata drift", () => {
  const cases: Array<[string, (root: string) => void]> = [
    [
      "packageDependency",
      (root) =>
        writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { "@yc-software/qm": "0.1.5" } })),
    ],
    [
      "lockVersion",
      (root) => {
        const lockPath = join(root, "package-lock.json");
        const lock = JSON.parse(readFileSync(lockPath, "utf8"));
        lock.packages["node_modules/@yc-software/qm"].version = "0.1.5";
        writeFileSync(lockPath, JSON.stringify(lock));
      },
    ],
    [
      "lockResolved",
      (root) => {
        const lockPath = join(root, "package-lock.json");
        const lock = JSON.parse(readFileSync(lockPath, "utf8"));
        lock.packages["node_modules/@yc-software/qm"].resolved = "https://example.invalid/qm.tgz";
        writeFileSync(lockPath, JSON.stringify(lock));
      },
    ],
    [
      "lockIntegrity",
      (root) => {
        const lockPath = join(root, "package-lock.json");
        const lock = JSON.parse(readFileSync(lockPath, "utf8"));
        lock.packages["node_modules/@yc-software/qm"].integrity = "sha512-invalid";
        writeFileSync(lockPath, JSON.stringify(lock));
      },
    ],
    [
      "installedPackage",
      (root) => {
        const installedPath = join(root, "node_modules", "@yc-software", "qm", "package.json");
        writeFileSync(
          installedPath,
          JSON.stringify({ name: "@yc-software/qm", version: "0.1.5", bin: { qm: "dist/bin/qm.js" } }),
        );
      },
    ],
    [
      "qmExecutable",
      (root) => {
        const link = join(root, "node_modules", ".bin", "qm");
        rmSync(link);
        symlinkSync("../@yc-software/qm/README.md", link);
      },
    ],
  ];

  for (const [field, mutate] of cases) {
    const fixture = createQmInstallFixture();
    try {
      mutate(fixture.root);
      assert.throws(
        () => assertQmInstall(fixture.root, fixture.digest),
        new RegExp(`invalid activation field: ${field}`),
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("timeout helper kills a SIGTERM-ignoring process group by the hard deadline", () => {
  const root = mkdtempSync(join(tmpdir(), "qm-timeout-hard-deadline-"));
  try {
    const command = join(root, "ignore-term.sh");
    writeShim(command, "trap '' TERM\nsleep 6\n");
    const startedAt = Date.now();
    const result = spawnSync(process.execPath, [activationScript, "--run-timeout", "1000", "--", command], {
      encoding: "utf8",
      timeout: 5_000,
      killSignal: "SIGKILL",
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.status, 124);
    assert.ok(elapsedMs < 3_000, `timeout helper exceeded hard deadline: ${elapsedMs}ms`);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("hosted preflight passes with only named status output", () => {
  const result = createPreflightScenario();
  try {
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(
      result.stdout,
      [
        "runtime: pass",
        "worktree: pass",
        "hosted-boundary: pass",
        "qm-binary: pass",
        "docker-buildx: pass",
        "fly-auth: pass",
        "fly-region: pass",
        "fly-app-names: pass",
        "fly-data-resource-names: pass",
        "activation-record: pass",
        "env-file: pass",
        "qm-check: pass",
        "qm-sandbox-dry-run: pass",
        "qm-plan-missing-image-pin: pass",
        "hosted-preflight: pass",
        "",
      ].join("\n"),
    );
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, new RegExp(sentinel));
    assert.doesNotMatch(result.stdout, /private-operator-identity/);
    assert.equal(result.stdout.includes(envSecretName), false);
    assert.equal(result.stdout.includes(envSecretValue), false);
  } finally {
    result.cleanup();
  }
});

test("hosted preflight fails closed on runtime, worktree, boundary, tooling, and region checks", () => {
  assertPreflightFailure({ nodeVersion: "v24.18.0" }, "runtime");
  assertPreflightFailure({ npmVersion: "11.15.9" }, "runtime");
  assertPreflightFailure({ dirtyTracked: true }, "worktree");
  assertPreflightFailure({ boundaryExit: 1 }, "hosted-boundary");
  assertPreflightFailure({ qmBinary: "missing" }, "qm-binary");
  assertPreflightFailure({ qmBinary: "unexpected-symlink" }, "qm-binary");
  assertPreflightFailure({ buildxExit: 1 }, "docker-buildx");
  assertPreflightFailure({ flyAuthExit: 1 }, "fly-auth");
  assertPreflightFailure({ regionsExit: 1 }, "fly-region");
  assertPreflightFailure({ regions: regionInventory("jnb2") }, "fly-region");
});

test("hosted preflight detects a missing local QM binary before network-capable commands", () => {
  const result = createPreflightScenario({ qmBinary: "missing" });
  try {
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /qm-binary: fail/);
    const logPath = join(result.root, "external-calls.log");
    let calls = "";
    try {
      calls = readFileSync(logPath, "utf8");
    } catch {
      // No call log is the expected strongest outcome.
    }
    assert.equal(calls, "");
  } finally {
    result.cleanup();
  }
});

test("hosted preflight times out external commands without leaking their output", () => {
  assertPreflightFailure({ flyAuthDelaySeconds: 3 }, "fly-auth");
});

test("hosted preflight fails closed when Fly inventory commands fail", () => {
  assertPreflightFailure({ appsExit: 1 }, "fly-app-names");
  assertPreflightFailure({ mpgExit: 1 }, "fly-data-resource-names");
  assertPreflightFailure({ storageExit: 1 }, "fly-data-resource-names");
});

test("hosted preflight rejects each exact app collision but permits near matches", () => {
  const appNames = [
    "alpha-ticker-stage-a-hosted-core",
    "alpha-ticker-stage-a-hosted-web-ui",
    "alpha-ticker-stage-a-hosted-admin",
    "alpha-ticker-stage-a-hosted-portal",
    "alpha-ticker-stage-a-hosted-auth",
    "alpha-ticker-stage-a-hosted-sandboxes",
    "alpha-ticker-stage-a-egress",
  ];
  for (const name of appNames) {
    assertPreflightFailure({ appOutput: appInventory(name) }, "fly-app-names");
  }

  const result = createPreflightScenario({
    appOutput: appInventory("alpha-ticker-stage-a-hosted-core-near"),
  });
  try {
    assert.equal(result.status, 0);
  } finally {
    result.cleanup();
  }
});

test("hosted preflight rejects exact Managed Postgres and Tigris collisions", () => {
  assertPreflightFailure({ mpgOutput: mpgInventory("alpha-ticker-stage-a-hosted-pg") }, "fly-data-resource-names");
  assertPreflightFailure(
    { storageOutput: storageTable([["alpha-ticker-stage-a-hosted-data", "personal"]]) },
    "fly-data-resource-names",
  );
});

test("hosted preflight accepts real non-empty MPG JSON and Tigris table output", () => {
  const result = createPreflightScenario({
    mpgOutput: mpgInventory("available-stage-a-pg"),
    storageOutput: storageTable([["available-stage-a-data", "personal"]]),
  });
  try {
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    result.cleanup();
  }
});

test("hosted preflight rejects malformed or invented Fly inventory forms", () => {
  assertPreflightFailure({ regions: "not-json" }, "fly-region");
  assertPreflightFailure({ regions: '{"regions":[]}' }, "fly-region");
  assertPreflightFailure({ regions: '[{"Code":"jnb"}]' }, "fly-region");
  assertPreflightFailure({ appOutput: '[{"name":"untrusted-casing"}]' }, "fly-app-names");
  assertPreflightFailure({ appOutput: '[{"Name":["not-a-string"]}]' }, "fly-app-names");
  assertPreflightFailure({ mpgOutput: '{"data":[]}' }, "fly-data-resource-names");
  assertPreflightFailure(
    { mpgOutput: "No managed postgres clusters found in organization personal\n[]\n" },
    "fly-data-resource-names",
  );
  assertPreflightFailure({ mpgOutput: `${mpgInventory("bad,punctuation")}` }, "fly-data-resource-names");
  assertPreflightFailure({ storageOutput: "[]\n" }, "fly-data-resource-names");
  assertPreflightFailure({ storageOutput: "NAME  ORG\n\n" }, "fly-data-resource-names");
  assertPreflightFailure({ storageOutput: " NAME | ORG \n\n" }, "fly-data-resource-names");
  assertPreflightFailure({ storageOutput: " NAME │ ORG │ EXTRA \n\n" }, "fly-data-resource-names");
  assertPreflightFailure({ storageOutput: storageTable([["bad,punctuation", "personal"]]) }, "fly-data-resource-names");
  assertPreflightFailure({ storageOutput: storageTable([["valid-name", "another-org"]]) }, "fly-data-resource-names");
});

test("hosted preflight rejects invalid activation and unsafe env-file state", () => {
  assertPreflightFailure({ activation: { ...acceptedRecord, syntheticOnly: false } }, "activation-record");
  assertPreflightFailure({ envState: "missing" }, "env-file");
  assertPreflightFailure({ envState: "symlink" }, "env-file");
  assertPreflightFailure({ envMode: 0o640 }, "env-file");
  assertPreflightFailure({ envIgnored: false }, "env-file");
});

test("hosted preflight rejects QM check and sandbox dry-run failures", () => {
  assertPreflightFailure({ qmCheckExit: 1 }, "qm-check");
  assertPreflightFailure({ qmBuildExit: 1 }, "qm-sandbox-dry-run");
});

test("hosted preflight rejects env replacement between QM commands", () => {
  assertPreflightFailure({ mutateEnvAfterQmCheck: true }, "env-file");
});

test("hosted preflight accepts only the known fail-closed missing-image-pin plan result", () => {
  assertPreflightFailure({ qmPlanExit: 0, qmPlanOutput: "plan unexpectedly passed" }, "qm-plan-missing-image-pin");
  assertPreflightFailure({ qmPlanExit: 2, qmPlanOutput: `error: ${missingImagePin}` }, "qm-plan-missing-image-pin");
  assertPreflightFailure({ qmPlanExit: 1, qmPlanOutput: "some other failure" }, "qm-plan-missing-image-pin");
  assertPreflightFailure(
    { qmPlanExit: 1, qmPlanOutput: `${missingImagePin}\nanother failure` },
    "qm-plan-missing-image-pin",
  );
});

test("the activation source and preflight never contain test sentinel or secret values", () => {
  const source = `${readFileSync(activationScript, "utf8")}\n${readFileSync(preflightScript, "utf8")}`;
  assert.doesNotMatch(source, new RegExp(sentinel));
  assert.doesNotMatch(source, /sk-private-value-that-must-not-appear|private\.participant@example\.invalid/);
  assert.doesNotMatch(source, /npm exec(?:\s|$)/);
});
