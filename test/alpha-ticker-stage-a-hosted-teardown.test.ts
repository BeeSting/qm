import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const sourceTeardown = resolve("scripts/alpha-ticker-stage-a-hosted/teardown.sh");
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

interface TeardownScenario {
  confirmation?: string;
  qmExit?: number;
  flyOrg?: string;
  flyJson?: string;
  managedPostgresDeleted?: boolean;
  objectStorageDeleted?: boolean;
  inventorySymlink?: boolean;
  evidenceSymlink?: boolean;
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
  mkdirSync(generated, { recursive: true });
  mkdirSync(shimRoot, { recursive: true });
  writeFileSync(script, readFileSync(sourceTeardown));
  chmodSync(script, 0o700);

  const inventory = {
    flyOrg: "personal",
    apps: apps.map((name, index) => ({ name, id: `private-app-id-${index}` })),
    managedPostgres: { name: dataResources[0], id: "private-postgres-id" },
    objectStorage: { name: dataResources[1], id: "private-storage-id" },
    sandboxRegistry: { name: "alpha-ticker-stage-a-hosted-sandboxes", id: "private-sandbox-id" },
  };
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
  if (scenario.evidenceSymlink) symlinkSync(evidenceTarget, evidencePath);
  else writeFileSync(evidencePath, readFileSync(evidenceTarget), { mode: 0o600 });
  if (!scenario.evidenceSymlink) chmodSync(evidencePath, 0o600);

  writeExecutable(
    join(deployment, "node_modules", ".bin", "qm"),
    `printf 'qm:%s\\n' "$*" >> ${shellQuote(callLog)}\nexit ${scenario.qmExit ?? 0}\n`,
  );

  const defaultFlyJson = JSON.stringify(
    apps.map((name) => ({ Name: name, Organization: scenario.flyOrg ?? "personal" })),
  );
  writeExecutable(
    join(shimRoot, "fly"),
    `printf 'fly:%s\\n' "$*" >> ${shellQuote(callLog)}\n` +
      `case "$*" in\n` +
      `  "apps list --org personal --json") printf '%s\n' ${shellQuote(scenario.flyJson ?? defaultFlyJson)} ;;\n` +
      `  "apps destroy "*" --yes") : ;;\n` +
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
    },
  });
  return {
    ...result,
    root,
    callLog,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
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
  assert.doesNotMatch(body, /fly apps destroy\s+--all|docker (?:system|volume|network) prune|\*\.fly\.dev|rm -rf/);
  assert.doesNotMatch(body, /fly apps destroy\s+\$?\{?[^"\n ]+\}?\s+--yes/);
});

test("hosted teardown requires exact confirmation before any command", () => {
  const result = createTeardownScenario({ confirmation: "wrong-confirmation" });
  try {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /teardown-confirmation-required/);
    assert.throws(() => readFileSync(result.callLog, "utf8"));
  } finally {
    result.cleanup();
  }
});

test("hosted teardown runs pinned local qm down before one-at-a-time Fly destruction", () => {
  const result = createTeardownScenario({ managedPostgresDeleted: false, objectStorageDeleted: false });
  try {
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "manual-data-destruction-required\n");
    const calls = readFileSync(result.callLog, "utf8").trim().split("\n");
    assert.equal(calls[0], "qm:down");
    assert.equal(calls.filter((line) => line === "fly:apps list --org personal --json").length, apps.length);
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
    assert.match(result.stderr, /qm-down-failed/);
    const calls = readFileSync(result.callLog, "utf8");
    assert.equal(calls, "qm:down\n");
  } finally {
    result.cleanup();
  }
});

test("hosted teardown structurally verifies exact Fly organization ownership", () => {
  for (const scenario of [
    { flyOrg: "other-org" },
    { flyJson: "not-json" },
    { flyJson: JSON.stringify([{ Name: apps[0], Organization: { Slug: "personal" } }]) },
    { flyJson: JSON.stringify([{ Name: [apps[0]], Organization: "personal" }]) },
  ]) {
    const result = createTeardownScenario(scenario);
    try {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /fly-inventory-invalid|fly-ownership-refused/);
      const calls = readFileSync(result.callLog, "utf8");
      assert.doesNotMatch(calls, /fly:apps destroy/);
    } finally {
      result.cleanup();
    }
  }
});

test("hosted teardown does not touch absent or near-name apps", () => {
  const flyJson = JSON.stringify([
    { Name: apps[0], Organization: "personal" },
    { Name: `${apps[1]}-near`, Organization: "personal" },
  ]);
  const result = createTeardownScenario({ flyJson });
  try {
    assert.equal(result.status, 3);
    const calls = readFileSync(result.callLog, "utf8");
    assert.match(calls, new RegExp(`fly:apps destroy ${apps[0]} --yes`));
    for (const app of apps.slice(1)) assert.doesNotMatch(calls, new RegExp(`fly:apps destroy ${app} --yes`));
    assert.doesNotMatch(calls, /-near --yes/);
  } finally {
    result.cleanup();
  }
});

test("hosted teardown accepts completion only after both minimized deletion statuses", () => {
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

test("hosted teardown rejects symlinked private inventory and deletion evidence without leaking ids", () => {
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
