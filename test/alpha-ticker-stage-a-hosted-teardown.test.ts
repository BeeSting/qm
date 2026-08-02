import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const sourceTeardown = resolve("scripts/alpha-ticker-stage-a-hosted/teardown.sh");
const sourceActivation = resolve("scripts/alpha-ticker-stage-a-hosted/activation-record.mjs");
const sourceDeployment = resolve("deploy/layers/alpha-ticker-stage-a-hosted");
const apps = [
  "alpha-ticker-stage-a-hosted-core",
  "alpha-ticker-stage-a-hosted-web-ui",
  "alpha-ticker-stage-a-hosted-admin",
  "alpha-ticker-stage-a-hosted-portal",
  "alpha-ticker-stage-a-hosted-auth",
  "alpha-ticker-stage-a-hosted-sandboxes",
  "alpha-ticker-stage-a-egress",
];
const dataResources = ["alpha-ticker-stage-a-hosted-pg", "alpha-ticker-stage-a-hosted-data"];
const allResources = [...apps, ...dataResources];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function writeExecutable(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}`, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function writeNodeExecutable(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/usr/bin/env node\n${body}`, { mode: 0o700 });
  chmodSync(path, 0o700);
}

interface TeardownScenario {
  confirmation?: string;
  qmExit?: number;
  flyOrg?: string;
  flyJson?: string;
  flyIdMismatch?: boolean;
  flySleepSeconds?: number;
  qmSleepSeconds?: number;
  qmPackageVersion?: string;
  qmBinaryTarget?: "valid" | "wrong" | "missing";
  managedPostgresDeleted?: boolean;
  objectStorageDeleted?: boolean;
  mutateEvidenceAfterQmDown?: boolean;
  inventorySymlink?: boolean;
  evidenceSymlink?: boolean;
  retainDestroyedApps?: boolean;
  useRealQmVerifier?: boolean;
  tamperQmExecutable?: boolean;
  flyLeaderExitsDescendantIgnores?: boolean;
  capturedApps?: string[];
  captureDataResources?: boolean;
  captureSandboxRegistry?: boolean;
  h2ResourceReconciliation?: string;
  omitH2ResourceReconciliation?: boolean;
  omitTeardownEvidence?: boolean;
  inventoryApps?: Array<{ name: string; id: string }>;
}

function createTeardownScenario(scenario: TeardownScenario = {}) {
  const root = mkdtempSync(join(tmpdir(), "qm-hosted-teardown-"));
  const script = join(root, "scripts", "alpha-ticker-stage-a-hosted", "teardown.sh");
  const deployment = join(root, "deploy", "layers", "alpha-ticker-stage-a-hosted");
  const generated = join(root, ".generated", "alpha-ticker-stage-a-hosted");
  const shimRoot = join(root, "shims");
  const callLog = join(root, "calls.log");
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(join(deployment, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(deployment, "node_modules", "@yc-software", "qm", "dist", "bin"), { recursive: true });
  mkdirSync(generated, { recursive: true });
  mkdirSync(shimRoot, { recursive: true });
  writeFileSync(script, readFileSync(sourceTeardown));
  chmodSync(script, 0o700);
  const realActivation = join(dirname(script), "activation-record-real.mjs");
  writeFileSync(realActivation, readFileSync(sourceActivation), { mode: 0o700 });
  chmodSync(realActivation, 0o700);
  writeNodeExecutable(
    join(dirname(script), "activation-record.mjs"),
    `import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "--verify-qm-install") appendFileSync(${JSON.stringify(callLog)}, "verify:qm-install\\n");
if (args[0] === "--verify-qm-install" && process.env.TEST_REAL_QM_VERIFIER !== "1") process.exit(0);
const result = spawnSync(process.execPath, [${JSON.stringify(realActivation)}, ...args], { stdio: "inherit" });
process.exit(Number.isInteger(result.status) ? result.status : 1);
`,
  );

  const inventory = {
    flyOrg: "personal",
    h2ResourceReconciliation:
      scenario.h2ResourceReconciliation ?? (scenario.captureDataResources === false ? "not-started" : "complete"),
    apps:
      scenario.inventoryApps ??
      apps
        .map((name, index) => ({ name, id: `private-app-id-${index}` }))
        .filter(({ name }) => (scenario.capturedApps ?? apps).includes(name)),
    managedPostgres:
      scenario.captureDataResources === false ? null : { name: dataResources[0], id: "private-postgres-id" },
    objectStorage:
      scenario.captureDataResources === false ? null : { name: dataResources[1], id: "private-storage-id" },
    sandboxRegistry:
      scenario.captureSandboxRegistry === false
        ? null
        : { name: "alpha-ticker-stage-a-hosted-sandboxes", id: "private-sandbox-id" },
  };
  if (scenario.omitH2ResourceReconciliation) delete (inventory as Partial<typeof inventory>).h2ResourceReconciliation;
  const inventoryPath = join(generated, "resource-inventory.json");
  const inventoryTarget = `${inventoryPath}.target`;
  writeFileSync(inventoryTarget, `${JSON.stringify(inventory)}\n`, { mode: 0o600 });
  chmodSync(inventoryTarget, 0o600);
  if (scenario.inventorySymlink) symlinkSync(inventoryTarget, inventoryPath);
  else writeFileSync(inventoryPath, readFileSync(inventoryTarget), { mode: 0o600 });
  if (!scenario.inventorySymlink) chmodSync(inventoryPath, 0o600);

  const teardownEvidence = {
    managedPostgresDeleted: scenario.managedPostgresDeleted ?? false,
    objectStorageDeleted: scenario.objectStorageDeleted ?? false,
    managedPostgresDeletedAt: scenario.managedPostgresDeleted ? "2026-08-02T00:00:00.000Z" : null,
    objectStorageDeletedAt: scenario.objectStorageDeleted ? "2026-08-02T00:01:00.000Z" : null,
  };
  const evidencePath = join(generated, "teardown-evidence.json");
  const evidenceTarget = `${evidencePath}.target`;
  writeFileSync(evidenceTarget, `${JSON.stringify(teardownEvidence)}\n`, { mode: 0o600 });
  chmodSync(evidenceTarget, 0o600);
  if (!scenario.omitTeardownEvidence) {
    if (scenario.evidenceSymlink) symlinkSync(evidenceTarget, evidencePath);
    else writeFileSync(evidencePath, readFileSync(evidenceTarget), { mode: 0o600 });
    if (!scenario.evidenceSymlink) chmodSync(evidencePath, 0o600);
  }

  const qmTarget = join(deployment, "node_modules", "@yc-software", "qm", "dist", "bin", "qm.js");
  const qmBin = join(deployment, "node_modules", ".bin", "qm");
  if (scenario.useRealQmVerifier) {
    cpSync(join(sourceDeployment, "package.json"), join(deployment, "package.json"));
    cpSync(join(sourceDeployment, "package-lock.json"), join(deployment, "package-lock.json"));
    cpSync(
      join(sourceDeployment, "node_modules", "@yc-software", "qm"),
      join(deployment, "node_modules", "@yc-software", "qm"),
      { recursive: true },
    );
    symlinkSync("../@yc-software/qm/dist/bin/qm.js", qmBin);
    if (scenario.tamperQmExecutable) {
      writeFileSync(qmTarget, `${readFileSync(qmTarget, "utf8")}\n// tampered expected executable\n`);
      chmodSync(qmTarget, 0o700);
    }
  } else {
    writeFileSync(
      join(deployment, "package.json"),
      `${JSON.stringify({ dependencies: { "@yc-software/qm": "0.1.4" } })}\n`,
    );
    writeFileSync(
      join(deployment, "package-lock.json"),
      `${JSON.stringify({
        packages: {
          "": { dependencies: { "@yc-software/qm": "0.1.4" } },
          "node_modules/@yc-software/qm": { version: "0.1.4" },
        },
      })}\n`,
    );
    writeFileSync(
      join(deployment, "node_modules", "@yc-software", "qm", "package.json"),
      `${JSON.stringify({ version: scenario.qmPackageVersion ?? "0.1.4", bin: { qm: "dist/bin/qm.js" } })}\n`,
    );
    writeExecutable(
      qmTarget,
      `${scenario.qmSleepSeconds ? `sleep ${scenario.qmSleepSeconds}\n` : ""}` +
        `printf 'qm:%s\\n' "$*" >> ${shellQuote(callLog)}\n` +
        `${
          scenario.mutateEvidenceAfterQmDown
            ? `printf '%s\\n' ${shellQuote(
                JSON.stringify({
                  managedPostgresDeleted: true,
                  objectStorageDeleted: true,
                  managedPostgresDeletedAt: "2026-08-02T00:00:00.000Z",
                  objectStorageDeletedAt: "2026-08-02T00:01:00.000Z",
                }),
              )} > ${shellQuote(evidencePath)}\n`
            : ""
        }` +
        `exit ${scenario.qmExit ?? 0}\n`,
    );
    if (scenario.qmBinaryTarget !== "missing") {
      if (scenario.qmBinaryTarget === "wrong") {
        const wrongTarget = join(deployment, "wrong-qm");
        writeExecutable(wrongTarget, "exit 0\n");
        symlinkSync(wrongTarget, qmBin);
      } else {
        symlinkSync("../@yc-software/qm/dist/bin/qm.js", qmBin);
      }
    }
  }

  const defaultFlyJson = JSON.stringify(
    apps.map((name, index) => ({
      ID: scenario.flyIdMismatch && index === 0 ? "replacement-app-id" : `private-app-id-${index}`,
      Name: name,
      Organization: scenario.flyOrg ?? "personal",
    })),
  );
  const flyState = join(root, "fly-state.json");
  const destroyedApps = join(root, "destroyed-apps.txt");
  const processFile = join(root, "processes.txt");
  writeFileSync(flyState, scenario.flyJson ?? defaultFlyJson);
  writeFileSync(destroyedApps, "");
  writeExecutable(
    join(shimRoot, "fly"),
    `${scenario.flySleepSeconds ? `sleep ${scenario.flySleepSeconds}\n` : ""}` +
      `printf 'fly:%s\\n' "$*" >> ${shellQuote(callLog)}\n` +
      `${
        scenario.flyLeaderExitsDescendantIgnores
          ? `process_file=${shellQuote(processFile)}
trap 'exit 0' TERM
(
  trap '' TERM
  exec ${shellQuote(process.execPath)} -e 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
) &
descendant_pid=$!
printf '%s %s\\n' "$$" "$descendant_pid" > "$process_file"
wait "$descendant_pid"
`
          : ""
      }` +
      `case "$*" in\n` +
      `  "apps list --org personal --json") node -e ${shellQuote(
        "const fs=require('node:fs');const all=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const removed=new Set(fs.readFileSync(process.argv[2],'utf8').split('\\n').filter(Boolean));process.stdout.write(JSON.stringify(all.filter((entry)=>!removed.has(entry.Name))));",
      )} ${shellQuote(flyState)} ${shellQuote(destroyedApps)} ;;\n` +
      `  "apps destroy "*" --yes") ${scenario.retainDestroyedApps ? ":" : `printf '%s\\n' "$3" >> ${shellQuote(destroyedApps)}`} ;;\n` +
      `  *) exit 99 ;;\n` +
      `esac\n`,
  );

  const result = spawnSync("bash", [script, "--execute"], {
    cwd: tmpdir(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${shimRoot}:${process.env.PATH ?? ""}`,
      STAGE_A_DESTROY_CONFIRM: scenario.confirmation ?? "alpha-ticker-stage-a-hosted",
      ALPHA_TICKER_TEARDOWN_TIMEOUT_MS: "500",
      TEST_REAL_QM_VERIFIER: scenario.useRealQmVerifier ? "1" : "0",
    },
    timeout: 8_000,
    killSignal: "SIGKILL",
  });
  return {
    ...result,
    root,
    callLog,
    processFile,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

function readCalls(result: ReturnType<typeof createTeardownScenario>) {
  try {
    return readFileSync(result.callLog, "utf8");
  } catch {
    return "";
  }
}

test("hosted teardown dry-run is cwd-independent, idempotent, and lists only fixed resources", () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync("bash", [sourceTeardown, "--dry-run"], {
      cwd: attempt === 0 ? process.cwd() : tmpdir(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdout.trim().split("\n"), allResources);
  }
});

test("hosted teardown source is exact-name bounded and prohibits broad destructive commands", () => {
  const body = readFileSync(sourceTeardown, "utf8");
  for (const resource of allResources) assert.match(body, new RegExp(resource));
  assert.match(body, /STAGE_A_DESTROY_CONFIRM/);
  assert.match(body, /--dry-run/);
  assert.match(body, /activation-record\.mjs/);
  assert.match(body, /--verify-qm-install/);
  assert.match(body, /--run-timeout/);
  assert.doesNotMatch(body, /timeout:\s*timeoutMs|killSignal:/);
  assert.doesNotMatch(body, /fly apps destroy\s+--all|docker (?:system|volume|network) prune|\*\.fly\.dev|rm -rf/);
});

test("hosted teardown requires exact confirmation before any command", () => {
  const result = createTeardownScenario({ confirmation: "wrong-confirmation" });
  try {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "teardown-confirmation-required\n");
    assert.equal(readCalls(result), "");
  } finally {
    result.cleanup();
  }
});

test("hosted teardown runs pinned local qm down before one-at-a-time Fly destruction", () => {
  const result = createTeardownScenario();
  try {
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "manual-data-destruction-required\n");
    const calls = readCalls(result).trim().split("\n");
    const verifierIndex = calls.indexOf("verify:qm-install");
    const qmIndex = calls.indexOf("qm:down");
    const firstDestroy = calls.findIndex((line) => line.startsWith("fly:apps destroy "));
    assert.ok(verifierIndex >= 0 && qmIndex > verifierIndex && firstDestroy > qmIndex);
    assert.equal(calls.filter((line) => line === "fly:apps list --org personal --json").length, apps.length + 2);
    assert.deepEqual(
      calls.filter((line) => line.startsWith("fly:apps destroy ")),
      apps.map((app) => `fly:apps destroy ${app} --yes`),
    );
    assert.doesNotMatch(calls.join("\n"), /npm|--all|\*/);
  } finally {
    result.cleanup();
  }
});

test("hosted teardown fails closed when qm down fails", () => {
  const result = createTeardownScenario({ qmExit: 9 });
  try {
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr, "qm-down-failed\n");
    assert.doesNotMatch(readCalls(result), /fly:apps destroy/);
  } finally {
    result.cleanup();
  }
});

test("hosted teardown verifies exact Fly organization and immutable app IDs", () => {
  for (const scenario of [
    { flyOrg: "other-org" },
    { flyIdMismatch: true },
    { flyJson: "not-json" },
    { flyJson: JSON.stringify([{ ID: "private-app-id-0", Name: apps[0], Organization: { Slug: "personal" } }]) },
    { flyJson: JSON.stringify([{ ID: "private-app-id-0", Name: [apps[0]], Organization: "personal" }]) },
    { flyJson: JSON.stringify([{ ID: "private-app-id-0", Name: `${apps[0]}-replacement`, Organization: "personal" }]) },
  ]) {
    const result = createTeardownScenario(scenario);
    try {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /fly-inventory-invalid|fly-ownership-refused|fly-identity-refused/);
      assert.doesNotMatch(readCalls(result), /qm:down|fly:apps destroy/);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /replacement-app-id|private-app-id/);
    } finally {
      result.cleanup();
    }
  }
});

test("hosted teardown does not touch absent or near-name apps", () => {
  const flyJson = JSON.stringify([
    { ID: "private-app-id-0", Name: apps[0], Organization: "personal" },
    { ID: "near-id", Name: `${apps[1]}-near`, Organization: "personal" },
  ]);
  const result = createTeardownScenario({ flyJson });
  try {
    assert.equal(result.status, 3, result.stderr);
    const calls = readCalls(result);
    assert.match(calls, new RegExp(`fly:apps destroy ${apps[0]} --yes`));
    for (const app of apps.slice(1)) assert.doesNotMatch(calls, new RegExp(`fly:apps destroy ${app} --yes`));
    assert.doesNotMatch(calls, /-near --yes/);
  } finally {
    result.cleanup();
  }
});

test("hosted teardown completes a pre-H2 not-started egress and published-sandbox teardown without qm down", () => {
  const capturedApps = ["alpha-ticker-stage-a-hosted-sandboxes", "alpha-ticker-stage-a-egress"];
  const flyJson = JSON.stringify(
    capturedApps.map((name) => ({
      ID: `private-app-id-${apps.indexOf(name)}`,
      Name: name,
      Organization: "personal",
    })),
  );
  const result = createTeardownScenario({
    capturedApps,
    captureDataResources: false,
    omitTeardownEvidence: true,
    flyJson,
    qmExit: 97,
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "teardown-complete\n");
    const calls = readCalls(result);
    assert.doesNotMatch(calls, /qm:down/);
    for (const app of capturedApps) assert.match(calls, new RegExp(`fly:apps destroy ${app} --yes`));
    for (const app of apps.filter((name) => !capturedApps.includes(name))) {
      assert.doesNotMatch(calls, new RegExp(`fly:apps destroy ${app} --yes`));
    }
  } finally {
    result.cleanup();
  }
});

test("hosted teardown cleans captured apps but refuses unresolved partial-H2 completion", () => {
  const capturedApps = ["alpha-ticker-stage-a-hosted-sandboxes", "alpha-ticker-stage-a-egress"];
  const flyJson = JSON.stringify(
    capturedApps.map((name) => ({
      ID: `private-app-id-${apps.indexOf(name)}`,
      Name: name,
      Organization: "personal",
    })),
  );
  const result = createTeardownScenario({
    capturedApps,
    captureDataResources: false,
    h2ResourceReconciliation: "unresolved",
    omitTeardownEvidence: true,
    flyJson,
    qmExit: 97,
  });
  try {
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "h2-resource-reconciliation-required\n");
    const calls = readCalls(result);
    assert.doesNotMatch(calls, /qm:down/);
    for (const app of capturedApps) assert.match(calls, new RegExp(`fly:apps destroy ${app} --yes`));
  } finally {
    result.cleanup();
  }
});

test("hosted teardown completes after H2 reconciliation confirms data resources absent", () => {
  const capturedApps = ["alpha-ticker-stage-a-egress"];
  const flyJson = JSON.stringify([
    { ID: `private-app-id-${apps.indexOf(capturedApps[0]!)}`, Name: capturedApps[0], Organization: "personal" },
  ]);
  const result = createTeardownScenario({
    capturedApps,
    captureDataResources: false,
    h2ResourceReconciliation: "complete",
    omitTeardownEvidence: true,
    flyJson,
    qmExit: 97,
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "teardown-complete\n");
    const calls = readCalls(result);
    assert.doesNotMatch(calls, /qm:down/);
    assert.match(calls, /fly:apps destroy alpha-ticker-stage-a-egress --yes/);
  } finally {
    result.cleanup();
  }
});

test("hosted teardown destroys a partial QM-managed app subset without qm down", () => {
  const capturedApps = ["alpha-ticker-stage-a-hosted-core", "alpha-ticker-stage-a-hosted-auth"];
  const flyJson = JSON.stringify(
    capturedApps.map((name) => ({
      ID: `private-app-id-${apps.indexOf(name)}`,
      Name: name,
      Organization: "personal",
    })),
  );
  const result = createTeardownScenario({
    capturedApps,
    captureDataResources: false,
    omitTeardownEvidence: true,
    flyJson,
    qmExit: 97,
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "teardown-complete\n");
    const calls = readCalls(result);
    assert.doesNotMatch(calls, /qm:down/);
    for (const app of capturedApps) assert.match(calls, new RegExp(`fly:apps destroy ${app} --yes`));
    for (const app of apps.filter((name) => !capturedApps.includes(name))) {
      assert.doesNotMatch(calls, new RegExp(`fly:apps destroy ${app} --yes`));
    }
  } finally {
    result.cleanup();
  }
});

test("hosted teardown refuses an approved live app missing from the captured inventory", () => {
  const capturedApps = ["alpha-ticker-stage-a-hosted-sandboxes", "alpha-ticker-stage-a-egress"];
  const flyJson = JSON.stringify([
    ...capturedApps.map((name) => ({
      ID: `private-app-id-${apps.indexOf(name)}`,
      Name: name,
      Organization: "personal",
    })),
    { ID: "uncaptured-core-id", Name: "alpha-ticker-stage-a-hosted-core", Organization: "personal" },
  ]);
  const result = createTeardownScenario({
    capturedApps,
    captureDataResources: false,
    omitTeardownEvidence: true,
    flyJson,
  });
  try {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "fly-uncaptured-app-refused\n");
    assert.doesNotMatch(readCalls(result), /qm:down|fly:apps destroy/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /uncaptured-core-id/);
  } finally {
    result.cleanup();
  }
});

test("hosted teardown rejects unknown app names and duplicate immutable IDs in partial inventory", () => {
  for (const inventoryApps of [
    [{ name: "alpha-ticker-stage-a-unknown", id: "private-unknown-id" }],
    [
      { name: "alpha-ticker-stage-a-egress", id: "private-duplicate-id" },
      { name: "alpha-ticker-stage-a-hosted-sandboxes", id: "private-duplicate-id" },
    ],
  ]) {
    const result = createTeardownScenario({
      inventoryApps,
      captureDataResources: false,
      omitTeardownEvidence: true,
      flyJson: "[]",
    });
    try {
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "resource-inventory-invalid\n");
      assert.equal(readCalls(result), "");
    } finally {
      result.cleanup();
    }
  }
});

test("hosted teardown rejects missing, unknown, and contradictory H2 reconciliation states", () => {
  for (const scenario of [
    { omitH2ResourceReconciliation: true },
    { h2ResourceReconciliation: "pending" },
    { h2ResourceReconciliation: "not-started" },
  ]) {
    const result = createTeardownScenario(scenario);
    try {
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "resource-inventory-invalid\n");
      assert.equal(readCalls(result), "");
    } finally {
      result.cleanup();
    }
  }
});

test("hosted teardown cryptographically verifies the exact QM package tree before any provider command", () => {
  const valid = createTeardownScenario({
    useRealQmVerifier: true,
    flyJson: "[]",
    managedPostgresDeleted: true,
    objectStorageDeleted: true,
  });
  try {
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout, "teardown-complete\n");
    assert.equal(readCalls(valid), "verify:qm-install\nfly:apps list --org personal --json\n");
  } finally {
    valid.cleanup();
  }

  const tampered = createTeardownScenario({
    useRealQmVerifier: true,
    tamperQmExecutable: true,
    flyJson: "[]",
    managedPostgresDeleted: true,
    objectStorageDeleted: true,
  });
  try {
    assert.notEqual(tampered.status, 0);
    assert.equal(tampered.stdout, "");
    assert.equal(tampered.stderr, "qm-install-invalid\n");
    assert.equal(readCalls(tampered), "verify:qm-install\n");
  } finally {
    tampered.cleanup();
  }
});

test("hosted teardown bounds hung QM and Fly commands", () => {
  const hungQm = createTeardownScenario({ qmSleepSeconds: 2 });
  try {
    assert.notEqual(hungQm.status, 0);
    assert.equal(hungQm.stderr, "qm-down-failed\n");
  } finally {
    hungQm.cleanup();
  }
  const hungFly = createTeardownScenario({ flySleepSeconds: 2 });
  try {
    assert.notEqual(hungFly.status, 0);
    assert.equal(hungFly.stderr, "fly-inventory-invalid\n");
  } finally {
    hungFly.cleanup();
  }
});

test("hosted teardown reaps a SIGTERM-ignoring descendant after the Fly leader exits", () => {
  const result = createTeardownScenario({ flyLeaderExitsDescendantIgnores: true });
  let descendantPid: number | undefined;
  try {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "fly-inventory-invalid\n");
    const [leaderText, descendantText] = readFileSync(result.processFile, "utf8").trim().split(" ");
    assert.ok(Number.isSafeInteger(Number(leaderText)));
    descendantPid = Number(descendantText);
    assert.ok(Number.isSafeInteger(descendantPid));
    assert.throws(() => process.kill(descendantPid!, 0), { code: "ESRCH" });
  } finally {
    if (descendantPid !== undefined) {
      try {
        process.kill(descendantPid, "SIGKILL");
      } catch {
        // The hardened timeout path is expected to have reaped it already.
      }
    }
    result.cleanup();
  }
});

test("hosted teardown parses minimized deletion evidence once before destruction", () => {
  const result = createTeardownScenario({ mutateEvidenceAfterQmDown: true });
  try {
    assert.equal(result.status, 3);
    assert.equal(result.stderr, "manual-data-destruction-required\n");
  } finally {
    result.cleanup();
  }
});

test("hosted teardown requires captured H2 data deletion evidence before completion", () => {
  const incomplete = createTeardownScenario({ managedPostgresDeleted: true, objectStorageDeleted: false });
  try {
    assert.equal(incomplete.status, 3);
    assert.equal(incomplete.stderr, "manual-data-destruction-required\n");
  } finally {
    incomplete.cleanup();
  }
  const complete = createTeardownScenario({ managedPostgresDeleted: true, objectStorageDeleted: true });
  try {
    assert.equal(complete.status, 0, complete.stderr);
    assert.equal(complete.stdout, "teardown-complete\n");
    assert.equal(complete.stderr, "");
  } finally {
    complete.cleanup();
  }
});

test("hosted teardown refuses completion when a captured immutable app remains after destruction", () => {
  const result = createTeardownScenario({
    managedPostgresDeleted: true,
    objectStorageDeleted: true,
    retainDestroyedApps: true,
  });
  try {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "fly-apps-still-present\n");
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /private-app-id/);
  } finally {
    result.cleanup();
  }
});

test("hosted teardown is idempotent when all fixed apps are already absent", () => {
  const result = createTeardownScenario({
    flyJson: "[]",
    managedPostgresDeleted: true,
    objectStorageDeleted: true,
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "teardown-complete\n");
    assert.equal(readCalls(result), "verify:qm-install\nfly:apps list --org personal --json\n");
  } finally {
    result.cleanup();
  }
});

test("hosted teardown rejects symlinked private inputs without leaking identifiers", () => {
  for (const scenario of [{ inventorySymlink: true }, { evidenceSymlink: true }]) {
    const result = createTeardownScenario(scenario);
    try {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /resource-inventory-invalid|teardown-evidence-invalid/);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /private-(?:app|postgres|storage|sandbox)-id/);
    } finally {
      result.cleanup();
    }
  }
});
