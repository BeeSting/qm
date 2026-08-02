import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const reconciler = resolve("scripts/alpha-ticker-stage-a-hosted/reconcile-resources.mjs");
const approvedApps = [
  "alpha-ticker-stage-a-hosted-core",
  "alpha-ticker-stage-a-hosted-web-ui",
  "alpha-ticker-stage-a-hosted-admin",
  "alpha-ticker-stage-a-hosted-portal",
  "alpha-ticker-stage-a-hosted-auth",
  "alpha-ticker-stage-a-hosted-sandboxes",
  "alpha-ticker-stage-a-egress",
];
const mpgName = "alpha-ticker-stage-a-hosted-pg";
const storageName = "alpha-ticker-stage-a-hosted-data";
const mpgEmpty = "No managed postgres clusters found in organization personal\n";

type ReconciliationState = "not-started" | "unresolved" | "complete";
type InventoryEntry = { name: string; id: string };
type NameBoundInventoryEntry = { name: string; identityKind: "name-bound"; deletionKey: string };
interface Inventory {
  flyOrg: "personal";
  h2ResourceReconciliation: ReconciliationState;
  apps: InventoryEntry[];
  managedPostgres: InventoryEntry | null;
  objectStorage: NameBoundInventoryEntry | null;
  sandboxRegistry: InventoryEntry | null;
}

interface FlyScenario {
  appsOutput?: string;
  mpgOutput?: string;
  storageOutput?: string;
  appsExit?: number;
  mpgExit?: number;
  storageExit?: number;
  appsSleepSeconds?: number;
  descendantIgnoresTermination?: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function writeExecutable(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}`, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function inventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    flyOrg: "personal",
    h2ResourceReconciliation: "not-started",
    apps: [{ name: approvedApps[6]!, id: "existing-egress-id" }],
    managedPostgres: null,
    objectStorage: null,
    sandboxRegistry: { name: approvedApps[5]!, id: "existing-sandbox-registry-id" },
    ...overrides,
  };
}

function appOutput(rows: Array<[string, string]>): string {
  return JSON.stringify(
    rows.map(([name, id]) => ({
      ID: id,
      Name: name,
      Status: "deployed",
      Organization: { Slug: "personal", Name: "Personal" },
    })),
  );
}

function mpgEntry(name: string, id: unknown = "current-postgres-id"): Record<string, unknown> {
  return {
    id,
    mpgd_cluster_id: "mpgd-current-postgres-id",
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
  };
}

function storageTable(rows: Array<[string, string]> = []): string {
  const nameWidth = Math.max(4, ...rows.map(([name]) => name.length));
  const orgWidth = Math.max(3, ...rows.map(([, org]) => org.length));
  const lines = [
    ` ${"NAME".padEnd(nameWidth)} │ ${"ORG".padEnd(orgWidth)} `,
    ...rows.map(([name, org]) => ` ${name.padEnd(nameWidth)} │ ${org.padEnd(orgWidth)} `),
  ];
  return `${lines.join("\n")}\n\n`;
}

function readInventory(path: string): Inventory {
  return JSON.parse(readFileSync(path, "utf8")) as Inventory;
}

function createHarness(initial: Inventory = inventory()) {
  const root = mkdtempSync(join(tmpdir(), "hosted-reconcile-"));
  const inventoryPath = join(root, "resource-inventory.json");
  const shims = join(root, "shims");
  const callLog = join(root, "calls.log");
  const processFile = join(root, "processes.txt");
  writePrivateJson(inventoryPath, initial);
  mkdirSync(shims, { recursive: true });
  writeFileSync(callLog, "");

  const setFlyScenario = (scenario: FlyScenario = {}): void => {
    const apps = scenario.appsOutput ?? appOutput([[approvedApps[6]!, "existing-egress-id"]]);
    const mpg = scenario.mpgOutput ?? mpgEmpty;
    const storage = scenario.storageOutput ?? storageTable();
    const descendant = scenario.descendantIgnoresTermination
      ? `process_file=${shellQuote(processFile)}
trap 'exit 0' TERM
(
  trap '' TERM
  exec ${shellQuote(process.execPath)} -e 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
) &
descendant_pid=$!
printf '%s %s\n' "$$" "$descendant_pid" > "$process_file"
wait "$descendant_pid"
`
      : "";
    writeExecutable(
      join(shims, "fly"),
      `printf 'fly:%s\\n' "$*" >> ${shellQuote(callLog)}
printf '%s\\n' 'private-provider-id-must-not-leak' >&2
case "$*" in
  "apps list --org personal --json")
    ${scenario.appsSleepSeconds ? `sleep ${scenario.appsSleepSeconds}` : ":"}
    ${descendant}
    printf '%s' ${shellQuote(apps)}
    exit ${scenario.appsExit ?? 0}
    ;;
  "mpg list --json --org personal") printf '%s' ${shellQuote(mpg)}; exit ${scenario.mpgExit ?? 0} ;;
  "storage list --org personal") printf '%s' ${shellQuote(storage)}; exit ${scenario.storageExit ?? 0} ;;
  *) exit 99 ;;
esac
`,
    );
  };
  setFlyScenario();

  const run = (mode: "--begin" | "--reconcile", commandTimeoutMs = 5_000) =>
    spawnSync(process.execPath, [reconciler, mode, "--inventory", inventoryPath], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${shims}:${process.env.PATH ?? ""}`,
        ALPHA_TICKER_RECONCILE_TIMEOUT_MS: String(commandTimeoutMs),
      },
      timeout: 8_000,
      killSignal: "SIGKILL",
    });

  return {
    root,
    inventoryPath,
    callLog,
    processFile,
    run,
    setFlyScenario,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function assertFixedFailure(result: ReturnType<ReturnType<typeof createHarness>["run"]>): void {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "resource-reconciliation-failed\n");
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /private|existing|postgres|storage|sandbox|inventory/i);
}

test("resource reconciler begin atomically transitions only safe inventories to unresolved", () => {
  for (const state of ["not-started", "complete"] as const) {
    const harness = createHarness(inventory({ h2ResourceReconciliation: state }));
    try {
      const result = harness.run("--begin");
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "resource-reconciliation: unresolved\n");
      assert.equal(result.stderr, "");
      assert.equal(readInventory(harness.inventoryPath).h2ResourceReconciliation, "unresolved");
      assert.equal(lstatSync(harness.inventoryPath).mode & 0o777, 0o600);
    } finally {
      harness.cleanup();
    }
  }

  for (const unsafe of ["wrong-mode", "symlink", "hardlink"] as const) {
    const harness = createHarness();
    try {
      const original = readFileSync(harness.inventoryPath);
      if (unsafe === "wrong-mode") chmodSync(harness.inventoryPath, 0o644);
      if (unsafe === "symlink") {
        const target = `${harness.inventoryPath}.target`;
        writeFileSync(target, original, { mode: 0o600 });
        rmSync(harness.inventoryPath);
        symlinkSync(target, harness.inventoryPath);
      }
      if (unsafe === "hardlink") linkSync(harness.inventoryPath, `${harness.inventoryPath}.link`);
      const result = harness.run("--begin");
      assertFixedFailure(result);
      assert.equal(readFileSync(harness.inventoryPath).equals(original), true);
    } finally {
      harness.cleanup();
    }
  }
});

test("resource reconciler rejects non-exact inventory schemas and lifecycle misuse without mutation", () => {
  const cases: unknown[] = [
    { ...inventory(), unexpected: true },
    { ...inventory(), h2ResourceReconciliation: "pending" },
    {
      ...inventory(),
      managedPostgres: { name: mpgName, id: "unexpected-pre-h2-postgres-id" },
    },
    {
      ...inventory(),
      h2ResourceReconciliation: "complete",
      objectStorage: { name: storageName, id: storageName },
    },
    {
      ...inventory(),
      h2ResourceReconciliation: "complete",
      objectStorage: { name: storageName, identityKind: "name-bound", deletionKey: `${storageName}-other` },
    },
    { ...inventory(), apps: [] },
  ];
  for (const value of cases) {
    const harness = createHarness();
    try {
      writePrivateJson(harness.inventoryPath, value);
      const before = readFileSync(harness.inventoryPath);
      assertFixedFailure(harness.run("--begin"));
      assert.equal(readFileSync(harness.inventoryPath).equals(before), true);
    } finally {
      harness.cleanup();
    }
  }

  const unresolved = createHarness(inventory({ h2ResourceReconciliation: "unresolved" }));
  try {
    const before = readFileSync(unresolved.inventoryPath);
    assertFixedFailure(unresolved.run("--begin"));
    assert.equal(readFileSync(unresolved.inventoryPath).equals(before), true);
  } finally {
    unresolved.cleanup();
  }
});

test("resource reconciler records immutable MPG and explicitly name-bound Tigris identity", () => {
  const harness = createHarness(inventory({ h2ResourceReconciliation: "unresolved" }));
  try {
    harness.setFlyScenario({
      appsOutput: appOutput([
        [approvedApps[0]!, "current-core-id"],
        [approvedApps[6]!, "existing-egress-id"],
        ["unrelated-personal-app", "unrelated-app-id"],
      ]),
      mpgOutput: JSON.stringify([mpgEntry(mpgName), mpgEntry("unrelated-stage-a-pg", "unrelated-pg-id")]),
      storageOutput: storageTable([
        [storageName, "personal"],
        ["unrelated-stage-a-data", "personal"],
      ]),
    });
    const result = harness.run("--reconcile");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "resource-reconciliation: complete\n");
    assert.equal(result.stderr, "");
    const reconciled = readInventory(harness.inventoryPath);
    assert.equal(reconciled.h2ResourceReconciliation, "complete");
    assert.deepEqual(reconciled.apps, [
      { name: approvedApps[0], id: "current-core-id" },
      { name: approvedApps[6], id: "existing-egress-id" },
    ]);
    assert.deepEqual(reconciled.managedPostgres, { name: mpgName, id: "current-postgres-id" });
    assert.deepEqual(reconciled.objectStorage, {
      name: storageName,
      identityKind: "name-bound",
      deletionKey: storageName,
    });
    assert.deepEqual(reconciled.sandboxRegistry, {
      name: approvedApps[5],
      id: "existing-sandbox-registry-id",
    });
    assert.equal(lstatSync(harness.inventoryPath).mode & 0o777, 0o600);
    assert.deepEqual(readFileSync(harness.callLog, "utf8").trim().split("\n"), [
      "fly:apps list --org personal --json",
      "fly:mpg list --json --org personal",
      "fly:storage list --org personal",
    ]);
  } finally {
    harness.cleanup();
  }
});

test("resource reconciler records provider-confirmed data absence as null and complete", () => {
  const harness = createHarness(inventory({ h2ResourceReconciliation: "unresolved" }));
  try {
    const result = harness.run("--reconcile");
    assert.equal(result.status, 0, result.stderr);
    const reconciled = readInventory(harness.inventoryPath);
    assert.equal(reconciled.h2ResourceReconciliation, "complete");
    assert.equal(reconciled.managedPostgres, null);
    assert.equal(reconciled.objectStorage, null);
  } finally {
    harness.cleanup();
  }
});

test("resource reconciler refuses an exact MPG resource whose immutable id is null", () => {
  const harness = createHarness(inventory({ h2ResourceReconciliation: "unresolved" }));
  try {
    harness.setFlyScenario({ mpgOutput: JSON.stringify([mpgEntry(mpgName, null)]) });
    const before = readFileSync(harness.inventoryPath);
    const result = harness.run("--reconcile");
    assertFixedFailure(result);
    assert.equal(readFileSync(harness.inventoryPath).equals(before), true);
    assert.equal(readInventory(harness.inventoryPath).h2ResourceReconciliation, "unresolved");
  } finally {
    harness.cleanup();
  }
});

test("resource reconciler rejects stale, mismatched, and colliding immutable identities", () => {
  const scenarios: Array<{ initial: Inventory; fly: FlyScenario }> = [
    {
      initial: inventory({
        h2ResourceReconciliation: "unresolved",
        managedPostgres: { name: mpgName, id: "existing-postgres-id" },
      }),
      fly: { mpgOutput: mpgEmpty },
    },
    {
      initial: inventory({
        h2ResourceReconciliation: "unresolved",
        managedPostgres: { name: mpgName, id: "existing-postgres-id" },
      }),
      fly: { mpgOutput: JSON.stringify([mpgEntry(mpgName, "replacement-postgres-id")]) },
    },
    {
      initial: inventory({ h2ResourceReconciliation: "unresolved" }),
      fly: { appsOutput: appOutput([[approvedApps[6]!, "replacement-egress-id"]]) },
    },
    {
      initial: inventory({ h2ResourceReconciliation: "unresolved" }),
      fly: { appsOutput: appOutput([["unrelated-personal-app", "existing-egress-id"]]) },
    },
    {
      initial: inventory({
        h2ResourceReconciliation: "unresolved",
        objectStorage: { name: storageName, identityKind: "name-bound", deletionKey: storageName },
      }),
      fly: { storageOutput: storageTable() },
    },
  ];
  for (const scenario of scenarios) {
    const harness = createHarness(scenario.initial);
    try {
      harness.setFlyScenario(scenario.fly);
      const before = readFileSync(harness.inventoryPath);
      const result = harness.run("--reconcile");
      assertFixedFailure(result);
      assert.equal(readFileSync(harness.inventoryPath).equals(before), true);
    } finally {
      harness.cleanup();
    }
  }
});

test("resource reconciler failures remain unresolved, bounded, and identifier-free", () => {
  const oversized = "[" + " ".repeat(1_100_000) + "]";
  const scenarios: FlyScenario[] = [
    { appsOutput: "not-json" },
    {
      appsOutput: JSON.stringify([{ ID: "existing-egress-id", Name: approvedApps[6], Organization: "personal" }]),
    },
    { appsOutput: oversized },
    { appsSleepSeconds: 2 },
    { descendantIgnoresTermination: true },
    { mpgExit: 9 },
    { storageOutput: "NAME ORG\n" },
  ];
  for (const scenario of scenarios) {
    const harness = createHarness(inventory({ h2ResourceReconciliation: "unresolved" }));
    let descendantPid: number | undefined;
    try {
      harness.setFlyScenario(scenario);
      const before = readFileSync(harness.inventoryPath);
      const result = harness.run(
        "--reconcile",
        scenario.appsSleepSeconds || scenario.descendantIgnoresTermination ? 1_000 : 5_000,
      );
      assertFixedFailure(result);
      assert.equal(readFileSync(harness.inventoryPath).equals(before), true);
      assert.equal(readInventory(harness.inventoryPath).h2ResourceReconciliation, "unresolved");
      if (scenario.descendantIgnoresTermination) {
        const [, descendant] = readFileSync(harness.processFile, "utf8").trim().split(" ");
        descendantPid = Number(descendant);
        assert.ok(Number.isSafeInteger(descendantPid));
        assert.throws(() => process.kill(descendantPid!, 0), { code: "ESRCH" });
      }
    } finally {
      if (descendantPid !== undefined) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch {
          // The hardened activation timeout is expected to have reaped it.
        }
      }
      harness.cleanup();
    }
  }
});

test("resource reconciler recovers an unresolved inventory in a fresh process without qm up", () => {
  const harness = createHarness(inventory({ h2ResourceReconciliation: "unresolved" }));
  try {
    harness.setFlyScenario({ appsOutput: "not-json" });
    assertFixedFailure(harness.run("--reconcile"));
    assert.equal(readInventory(harness.inventoryPath).h2ResourceReconciliation, "unresolved");

    harness.setFlyScenario({
      appsOutput: appOutput([
        [approvedApps[6]!, "existing-egress-id"],
        ["unrelated-personal-app", "unrelated-app-id"],
      ]),
    });
    const recovered = harness.run("--reconcile");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(recovered.stdout, "resource-reconciliation: complete\n");
    assert.equal(readInventory(harness.inventoryPath).h2ResourceReconciliation, "complete");
    assert.doesNotMatch(readFileSync(harness.callLog, "utf8"), /qm.*up/i);
  } finally {
    harness.cleanup();
  }
});

test("resource reconciler supports a later H3 complete-to-unresolved reconciliation cycle", () => {
  const harness = createHarness(
    inventory({
      h2ResourceReconciliation: "complete",
      managedPostgres: { name: mpgName, id: "current-postgres-id" },
      objectStorage: { name: storageName, identityKind: "name-bound", deletionKey: storageName },
    }),
  );
  try {
    const begin = harness.run("--begin");
    assert.equal(begin.status, 0, begin.stderr);
    assert.equal(readInventory(harness.inventoryPath).h2ResourceReconciliation, "unresolved");
    harness.setFlyScenario({
      mpgOutput: JSON.stringify([mpgEntry(mpgName)]),
      storageOutput: storageTable([[storageName, "personal"]]),
    });
    const reconcile = harness.run("--reconcile");
    assert.equal(reconcile.status, 0, reconcile.stderr);
    assert.equal(reconcile.stdout, "resource-reconciliation: complete\n");
    const completed = readInventory(harness.inventoryPath);
    assert.equal(completed.h2ResourceReconciliation, "complete");
    assert.deepEqual(completed.managedPostgres, { name: mpgName, id: "current-postgres-id" });
    assert.deepEqual(completed.objectStorage, {
      name: storageName,
      identityKind: "name-bound",
      deletionKey: storageName,
    });
    assert.doesNotMatch(readFileSync(harness.callLog, "utf8"), /qm.*up/i);
  } finally {
    harness.cleanup();
  }
});

test("resource reconciler ignores unrelated resources without expanding approved inventory names", () => {
  const harness = createHarness(inventory({ h2ResourceReconciliation: "unresolved" }));
  try {
    harness.setFlyScenario({
      appsOutput: appOutput([["unrelated-personal-app", "unrelated-app-id"]]),
      mpgOutput: JSON.stringify([mpgEntry("unrelated-stage-a-pg", "unrelated-pg-id")]),
      storageOutput: storageTable([["unrelated-stage-a-data", "personal"]]),
    });
    const result = harness.run("--reconcile");
    assert.equal(result.status, 0, result.stderr);
    const reconciled = readInventory(harness.inventoryPath);
    assert.deepEqual(reconciled.apps, [{ name: approvedApps[6], id: "existing-egress-id" }]);
    assert.equal(reconciled.managedPostgres, null);
    assert.equal(reconciled.objectStorage, null);
    assert.ok(reconciled.apps.every(({ name }) => approvedApps.includes(name)));
  } finally {
    harness.cleanup();
  }
});
