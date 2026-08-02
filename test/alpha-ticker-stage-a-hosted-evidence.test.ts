import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

// @ts-expect-error -- Task 8 intentionally exposes an .mjs CLI without a separate declaration file.
import * as evidenceModule from "../scripts/alpha-ticker-stage-a-hosted/collect-evidence.mjs";

const { assertEvidenceSafe, collectEvidence } = evidenceModule;

const workflows = [
  "daily-portfolio-briefing",
  "investment-question",
  "partner-meeting-preparation",
  "product-architecture-handover",
  "decision-memory-draft",
];
const hostedApps = [
  "alpha-ticker-stage-a-hosted-core",
  "alpha-ticker-stage-a-hosted-web-ui",
  "alpha-ticker-stage-a-hosted-admin",
  "alpha-ticker-stage-a-hosted-portal",
  "alpha-ticker-stage-a-hosted-auth",
  "alpha-ticker-stage-a-hosted-sandboxes",
  "alpha-ticker-stage-a-egress",
];
const checkIds = [
  "activation-record",
  "hosted-policy",
  "hosted-config",
  "egress-proxy-config",
  "sandbox-bundle",
  "evaluation-ledger",
  "resource-inventory",
  "live-checks",
];
const liveCheckIds = [
  "h2-qm-doctor",
  "h2-qm-live-check",
  "h2-qm-conformance",
  "h2-egress-allowlist",
  "h2-model-harness-provider",
  "h2-connectors-unconfigured",
  "h2-prohibited-capabilities-absent",
  "h2-identity-admission",
  "h2-personal-scope-isolation",
  "h2-synthetic-advisory-response",
  "h2-durable-personal-computer",
  "h2-idempotent-deployment",
  "h3-sandbox-egress-denial",
  "h3-alpha-packet-allowed",
  "h3-shared-room-access",
  "h3-shared-room-revocation",
  "h3-zero-budget-denial",
  "h3-budget-restored",
  "h3-provider-key-revocation-isolation",
  "h3-model-health-recovery",
  "h3-exact-teardown-plan",
  "h3-inventory-ownership",
];
const hostedDeployment = resolve("deploy/layers/alpha-ticker-stage-a-hosted");
const realUpstreamLock = JSON.parse(readFileSync(resolve("UPSTREAM.lock.json"), "utf8"));

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function scoreRecords() {
  return ["P1", "P2", "P3"].flatMap((participant) =>
    workflows.map((workflow, index) => ({
      outputId: `${participant}-${workflow}`,
      workflow,
      participant,
      sourceTrace: true,
      syntheticDisclosure: true,
      missingDataDisclosure: true,
      humanReviewLanguage: true,
      usefulness: 4,
      factualConsistency: 5,
      editBurden: index === 0 ? "minor" : "none",
      elapsedMs: 1_000 + index,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.2,
      model: "gpt-5.6-terra",
      deploymentRevision: "revision-1",
      incidentCategory: "none",
    })),
  );
}

function writeJson(path: string, value: unknown, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode });
  chmodSync(path, mode);
}

function writeScoreLedger(path: string, records: ReturnType<typeof scoreRecords>) {
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}${records.length ? "\n" : ""}`, {
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

function writeLiveChecks(
  generated: string,
  allTurnModelCostUsd = 4.5,
  flyCostUsd = 1.25,
  checks: Array<{ id: string; status: "pass" | "fail" | "not-run" }> = liveCheckIds.map((id) => ({
    id,
    status: "pass",
  })),
) {
  writeJson(join(generated, "live-checks.json"), {
    checks: checks.map((check) => ({
      ...check,
      timestamp: "2026-08-02T00:00:00.000Z",
      revision: "revision-1",
      resourceNameSha256: sha256(`alpha-ticker-stage-a-hosted:${check.id}`),
    })),
    spendSummary: {
      allTurnModelCostUsd,
      flyCostUsd,
      totalCostUsd: allTurnModelCostUsd + flyCostUsd,
    },
  });
}

function createEvidenceFixture() {
  const root = mkdtempSync(join(tmpdir(), "qm-hosted-evidence-"));
  const generated = join(root, ".generated", "alpha-ticker-stage-a-hosted");
  const deployment = join(root, "deploy", "layers", "alpha-ticker-stage-a-hosted");
  const sandbox = join(deployment, "sandbox");
  mkdirSync(join(sandbox, "skills", "workflow"), { recursive: true });
  mkdirSync(join(sandbox, "tools", "alpha-packet"), { recursive: true });

  writeJson(join(root, "UPSTREAM.lock.json"), realUpstreamLock, 0o644);
  for (const file of ["stage-a-hosted-policy.json", "qm.config.jsonc", "egress-proxy.fly.toml"]) {
    writeFileSync(join(deployment, file), readFileSync(join(hostedDeployment, file)));
  }
  writeFileSync(join(sandbox, "skills", "workflow", "SKILL.md"), "synthetic workflow\n");
  writeFileSync(join(sandbox, "tools", "alpha-packet", "tool.json"), '{"name":"alpha-packet"}\n');
  chmodSync(join(sandbox, "skills", "workflow", "SKILL.md"), 0o644);
  chmodSync(join(sandbox, "tools", "alpha-packet", "tool.json"), 0o644);

  writeJson(join(generated, "activation.json"), {
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
  const ledgerPath = join(generated, "scores.jsonl");
  writeScoreLedger(ledgerPath, scoreRecords());

  const privateAppId = "app-private-identifier-do-not-retain";
  const privateDatabaseId = "database-private-identifier-do-not-retain";
  writeJson(join(generated, "resource-inventory.json"), {
    flyOrg: "personal",
    h2ResourceReconciliation: "complete",
    apps: hostedApps.map((name, index) => ({
      name,
      id: index === 0 ? privateAppId : `private-app-identifier-${index}`,
    })),
    managedPostgres: { name: "alpha-ticker-stage-a-hosted-pg", id: privateDatabaseId },
    objectStorage: {
      name: "alpha-ticker-stage-a-hosted-data",
      identityKind: "name-bound",
      deletionKey: "alpha-ticker-stage-a-hosted-data",
    },
    sandboxRegistry: { name: "alpha-ticker-stage-a-hosted-sandboxes", id: "sandbox-private-id" },
  });
  writeLiveChecks(generated);

  return {
    root,
    generated,
    deployment,
    ledgerPath,
    privateAppId,
    privateDatabaseId,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

function collect(fixture: ReturnType<typeof createEvidenceFixture>, extra: Record<string, unknown> = {}) {
  return collectEvidence({
    repoRoot: fixture.root,
    commit: "a".repeat(40),
    timestamp: "2026-08-02T01:02:03.000Z",
    output: join(fixture.generated, "evidence-manifest.json"),
    ...extra,
  });
}

test("hosted evidence is exact-schema, aggregate-only, and content-minimized", () => {
  const fixture = createEvidenceFixture();
  try {
    const manifest = collect(fixture);
    assert.deepEqual(Object.keys(manifest).sort(), [
      "checks",
      "commit",
      "contentCaptured",
      "counts",
      "pass",
      "qmBaseline",
      "sandboxDigest",
      "scoreSummary",
      "spendSummary",
      "timestamp",
    ]);
    assert.equal(manifest.contentCaptured, false);
    assert.equal(manifest.pass, true);
    assert.deepEqual(manifest.counts, { principals: 3, scoredOutputs: 15 });
    assert.equal(manifest.scoreSummary.sampleSize, 15);
    assert.equal(manifest.scoreSummary.pass, true);
    assert.deepEqual(manifest.spendSummary, {
      allTurnModelCostUsd: 4.5,
      flyCostUsd: 1.25,
      scoredOutputCostUsd: 3,
      totalCostUsd: 5.75,
    });
    assert.doesNotThrow(() => assertEvidenceSafe(manifest));

    const output = join(fixture.generated, "evidence-manifest.json");
    const serialized = readFileSync(output, "utf8");
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.doesNotMatch(serialized, /outputId|participant|workflow|prompt|response|packetBody|providerRequest/);
    assert.doesNotMatch(serialized, new RegExp(fixture.privateAppId));
    assert.doesNotMatch(serialized, new RegExp(fixture.privateDatabaseId));
  } finally {
    fixture.cleanup();
  }
});

test("hosted evidence accepts the real nine-field upstream lock shape and rejects schema drift", () => {
  const valid = createEvidenceFixture();
  try {
    const manifest = collect(valid);
    assert.equal(manifest.qmBaseline, realUpstreamLock.commit);
  } finally {
    valid.cleanup();
  }

  const reordered = createEvidenceFixture();
  try {
    writeJson(
      join(reordered.root, "UPSTREAM.lock.json"),
      Object.fromEntries(Object.entries(realUpstreamLock).reverse()),
      0o644,
    );
    assert.doesNotThrow(() => collect(reordered));
  } finally {
    reordered.cleanup();
  }

  for (const mutate of [
    (value: Record<string, unknown>) => delete value.repository,
    (value: Record<string, unknown>) => (value.extra = true),
    (value: Record<string, unknown>) => (value.commit = "not-a-commit"),
  ]) {
    const fixture = createEvidenceFixture();
    try {
      const value = structuredClone(realUpstreamLock);
      mutate(value);
      writeJson(join(fixture.root, "UPSTREAM.lock.json"), value, 0o644);
      assert.throws(() => collect(fixture), /evidence (?:input|qmBaseline)/i);
    } finally {
      fixture.cleanup();
    }
  }
});

test("committed repository inputs validate from the production root without generated live files", () => {
  assert.equal(typeof evidenceModule.validateRepositoryEvidenceInputs, "function");
  const result = evidenceModule.validateRepositoryEvidenceInputs({ repoRoot: resolve(".") });
  assert.deepEqual(result, {
    qmBaseline: realUpstreamLock.commit,
    sandboxDigest: result.sandboxDigest,
  });
  assert.match(result.sandboxDigest, /^[a-f0-9]{64}$/);
});

test("hosted evidence uses the exact fixed eight validated check identifiers", () => {
  const fixture = createEvidenceFixture();
  try {
    const manifest = collect(fixture);
    assert.deepEqual(
      manifest.checks.map((check: { id: string }) => check.id),
      checkIds,
    );
    assert.equal(
      manifest.sandboxDigest,
      manifest.checks.find((check: { id: string }) => check.id === "sandbox-bundle")?.artifactSha256,
    );
    const changed = structuredClone(manifest);
    changed.checks[0].id = "different-check";
    assert.throws(() => assertEvidenceSafe(changed), /check id/i);
  } finally {
    fixture.cleanup();
  }
});

test("hosted evidence enforces the US$45 all-turn model brake and scored-spend floor", () => {
  for (const [allTurnModelCostUsd, shouldPass] of [
    [45, true],
    [50, false],
    [2.99, false],
  ] as const) {
    const fixture = createEvidenceFixture();
    try {
      writeLiveChecks(fixture.generated, allTurnModelCostUsd, 1);
      if (shouldPass) assert.doesNotThrow(() => collect(fixture));
      else assert.throws(() => collect(fixture), /spendSummary/i);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence records complete all-pass, failed, and early not-run H2/H3 registers truthfully", () => {
  const scenarios = [
    {
      checks: liveCheckIds.map((id) => ({ id, status: "pass" as const })).reverse(),
      expectedPass: true,
    },
    {
      checks: liveCheckIds.map((id, index) => ({
        id,
        status: index === 4 ? ("fail" as const) : ("pass" as const),
      })),
      expectedPass: false,
    },
    {
      checks: liveCheckIds.map((id, index) => ({
        id,
        status: index < 3 ? ("pass" as const) : ("not-run" as const),
      })),
      expectedPass: false,
    },
  ];
  for (const { checks, expectedPass } of scenarios) {
    const fixture = createEvidenceFixture();
    try {
      writeLiveChecks(fixture.generated, 4.5, 1.25, checks);
      const manifest = collect(fixture);
      assert.equal(manifest.pass, expectedPass);
      assert.equal(
        manifest.checks.find((check: { id: string }) => check.id === "live-checks")?.status,
        expectedPass ? "pass" : "fail",
      );
      const serialized = readFileSync(join(fixture.generated, "evidence-manifest.json"), "utf8");
      assert.doesNotMatch(serialized, /h2-|h3-|not-run/);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence rejects missing, arbitrary, and duplicate live-check identifiers", () => {
  const invalidRegisters = [
    liveCheckIds.slice(1).map((id) => ({ id, status: "pass" as const })),
    [...liveCheckIds, "arbitrary-check"].map((id) => ({ id, status: "pass" as const })),
    liveCheckIds.map((id, index) => ({ id: index === 1 ? liveCheckIds[0]! : id, status: "pass" as const })),
  ];
  for (const checks of invalidRegisters) {
    const fixture = createEvidenceFixture();
    try {
      writeLiveChecks(fixture.generated, 4.5, 1.25, checks);
      assert.throws(() => collect(fixture), /evidence live-checks/i);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence CLI returns nonzero after writing an auditable non-passing manifest", () => {
  const fixture = createEvidenceFixture();
  try {
    writeLiveChecks(
      fixture.generated,
      4.5,
      1.25,
      liveCheckIds.map((id, index) => ({ id, status: index === 0 ? "fail" : "not-run" })),
    );
    let stdout = "";
    let stderr = "";
    assert.equal(typeof evidenceModule.runEvidenceCli, "function");
    const exitCode = evidenceModule.runEvidenceCli(
      {
        repoRoot: fixture.root,
        commit: "a".repeat(40),
        timestamp: "2026-08-02T01:02:03.000Z",
        output: join(fixture.generated, "evidence-manifest.json"),
      },
      {
        stdout: { write: (value: string) => (stdout += value) },
        stderr: { write: (value: string) => (stderr += value) },
      },
    );
    assert.equal(exitCode, 1);
    assert.equal(stdout, ".generated/alpha-ticker-stage-a-hosted/evidence-manifest.json\n");
    assert.equal(stderr, "");
    assert.equal(JSON.parse(readFileSync(join(fixture.generated, "evidence-manifest.json"), "utf8")).pass, false);
  } finally {
    fixture.cleanup();
  }
});

test("hosted evidence writes early-stop manifests with a missing or partial score ledger", () => {
  for (const sampleSize of [0, 7, 14]) {
    const fixture = createEvidenceFixture();
    try {
      writeLiveChecks(
        fixture.generated,
        4.5,
        1.25,
        liveCheckIds.map((id, index) => ({ id, status: index === 0 ? "fail" : "not-run" })),
      );
      if (sampleSize === 0) rmSync(fixture.ledgerPath);
      else writeScoreLedger(fixture.ledgerPath, scoreRecords().slice(0, sampleSize));

      const manifest = collect(fixture);
      assert.equal(manifest.pass, false);
      assert.equal(manifest.counts.scoredOutputs, sampleSize);
      assert.equal(manifest.scoreSummary.sampleSize, sampleSize);
      assert.equal(manifest.scoreSummary.pass, false);
      const ledgerCheck = manifest.checks.find((check: { id: string }) => check.id === "evaluation-ledger");
      assert.equal(ledgerCheck?.status, "fail");
      if (sampleSize === 0) {
        assert.equal(ledgerCheck?.artifactSha256, null);
        const forged = structuredClone(manifest);
        forged.counts.scoredOutputs = 1;
        forged.scoreSummary.sampleSize = 1;
        assert.throws(() => assertEvidenceSafe(forged), /scoreSummary/i);
      }
      assert.doesNotMatch(
        readFileSync(join(fixture.generated, "evidence-manifest.json"), "utf8"),
        /outputId|participant/,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence rejects an all-pass live register without exactly fifteen scores", () => {
  for (const sampleSize of [0, 14]) {
    const fixture = createEvidenceFixture();
    try {
      if (sampleSize === 0) rmSync(fixture.ledgerPath);
      else writeScoreLedger(fixture.ledgerPath, scoreRecords().slice(0, sampleSize));
      assert.throws(() => collect(fixture), /evidence (?:input|scoreSummary)/i);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence permits partial approved inventory only for a non-passing H2/H3 register", () => {
  for (const livePass of [false, true]) {
    const fixture = createEvidenceFixture();
    try {
      const inventoryPath = join(fixture.generated, "resource-inventory.json");
      const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
      inventory.apps = inventory.apps.filter(({ name }: { name: string }) =>
        ["alpha-ticker-stage-a-hosted-sandboxes", "alpha-ticker-stage-a-egress"].includes(name),
      );
      inventory.managedPostgres = null;
      inventory.objectStorage = null;
      inventory.sandboxRegistry = null;
      writeJson(inventoryPath, inventory);
      if (!livePass) {
        writeLiveChecks(
          fixture.generated,
          4.5,
          1.25,
          liveCheckIds.map((id, index) => ({ id, status: index === 0 ? "fail" : "not-run" })),
        );
      }

      if (livePass) assert.throws(() => collect(fixture), /evidence inventory/i);
      else assert.equal(collect(fixture).pass, false);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence requires all infrastructure identities for an all-pass H2/H3 register", () => {
  for (const livePass of [false, true]) {
    const fixture = createEvidenceFixture();
    try {
      const inventoryPath = join(fixture.generated, "resource-inventory.json");
      const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
      inventory.managedPostgres = null;
      inventory.objectStorage = null;
      inventory.sandboxRegistry = null;
      writeJson(inventoryPath, inventory);
      if (!livePass) {
        writeLiveChecks(
          fixture.generated,
          4.5,
          1.25,
          liveCheckIds.map((id, index) => ({ id, status: index === 0 ? "fail" : "not-run" })),
        );
      }

      if (livePass) assert.throws(() => collect(fixture), /evidence inventory/i);
      else assert.equal(collect(fixture).pass, false);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence requires complete H2 resource reconciliation for an all-pass register", () => {
  for (const livePass of [false, true]) {
    const fixture = createEvidenceFixture();
    try {
      const inventoryPath = join(fixture.generated, "resource-inventory.json");
      const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
      inventory.h2ResourceReconciliation = "unresolved";
      writeJson(inventoryPath, inventory);
      if (!livePass) {
        writeLiveChecks(
          fixture.generated,
          4.5,
          1.25,
          liveCheckIds.map((id, index) => ({ id, status: index === 0 ? "fail" : "not-run" })),
        );
      }

      if (livePass) assert.throws(() => collect(fixture), /evidence inventory/i);
      else assert.equal(collect(fixture).pass, false);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence requires private modes on runtime score, inventory, and live-check files", () => {
  for (const relativePath of ["scores.jsonl", "resource-inventory.json", "live-checks.json"]) {
    const fixture = createEvidenceFixture();
    try {
      chmodSync(join(fixture.generated, relativePath), 0o644);
      assert.throws(() => collect(fixture), /evidence input/i);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence rejects invalid policy, config, egress, and inventory artifacts", () => {
  const mutations: Array<(fixture: ReturnType<typeof createEvidenceFixture>) => void> = [
    (fixture) => {
      const path = join(fixture.generated, "activation.json");
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.syntheticOnly = false;
      writeJson(path, value);
    },
    (fixture) => {
      const path = join(fixture.deployment, "stage-a-hosted-policy.json");
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.cloudMutation = "ungated";
      writeFileSync(path, JSON.stringify(value));
    },
    (fixture) => {
      const path = join(fixture.deployment, "qm.config.jsonc");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          '"publicUrl": "https://alpha-ticker-stage-a-hosted-portal.fly.dev",',
          '"publicUrl": "https://alpha-ticker-stage-a-hosted-portal.fly.dev",\n  "\\u0070ublicUrl": "https://other.fly.dev",',
        ),
      );
    },
    (fixture) => {
      const path = join(fixture.deployment, "egress-proxy.fly.toml");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace('EGRESS_TOKENLESS = "deny"', 'EGRESS_TOKENLESS = "allow"'),
      );
    },
    (fixture) => {
      const path = join(fixture.generated, "resource-inventory.json");
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.apps[1].id = value.apps[0].id;
      writeJson(path, value);
    },
    (fixture) => {
      const path = join(fixture.generated, "resource-inventory.json");
      const value = JSON.parse(readFileSync(path, "utf8"));
      delete value.h2ResourceReconciliation;
      writeJson(path, value);
    },
    (fixture) => {
      const path = join(fixture.generated, "resource-inventory.json");
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.h2ResourceReconciliation = "pending";
      writeJson(path, value);
    },
    (fixture) => {
      const path = join(fixture.generated, "resource-inventory.json");
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.h2ResourceReconciliation = "not-started";
      writeJson(path, value);
    },
  ];
  for (const mutate of mutations) {
    const fixture = createEvidenceFixture();
    try {
      mutate(fixture);
      assert.throws(() => collect(fixture), /evidence (?:input|activation|policy|config|egress|inventory)/i);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence derives validation and hashes from one artifact snapshot", () => {
  const fixture = createEvidenceFixture();
  try {
    const policyPath = join(fixture.deployment, "stage-a-hosted-policy.json");
    const originalHash = sha256(readFileSync(policyPath));
    let mutations = 0;
    const manifest = collect(fixture, {
      afterSnapshot(id: string) {
        if (id !== "hosted-policy") return;
        mutations += 1;
        writeFileSync(policyPath, '{"stage":"tampered"}\n');
      },
    });
    assert.equal(mutations, 1);
    assert.equal(
      manifest.checks.find((check: { id: string }) => check.id === "hosted-policy")?.artifactSha256,
      originalHash,
    );
  } finally {
    fixture.cleanup();
  }
});

test("hosted evidence rejects an inode replacement during an open artifact snapshot", () => {
  const fixture = createEvidenceFixture();
  try {
    const policyPath = join(fixture.deployment, "stage-a-hosted-policy.json");
    assert.throws(
      () =>
        collect(fixture, {
          afterOpen(id: string) {
            if (id !== "hosted-policy") return;
            renameSync(policyPath, `${policyPath}.replaced`);
            writeFileSync(policyPath, readFileSync(`${policyPath}.replaced`));
          },
        }),
      /evidence input/i,
    );
  } finally {
    fixture.cleanup();
  }
});

test("sandbox digest takes changed mode, size, and bytes from the opened file snapshot", () => {
  const fixture = createEvidenceFixture();
  try {
    const skillPath = join(fixture.deployment, "sandbox", "skills", "workflow", "SKILL.md");
    const toolPath = join(fixture.deployment, "sandbox", "tools", "alpha-packet", "tool.json");
    const changedSkill = "synthetic workflow changed after directory listing\n";
    const manifest = collect(fixture, {
      afterSandboxList() {
        writeFileSync(skillPath, changedSkill);
        chmodSync(skillPath, 0o600);
      },
    });
    const expected = sha256(
      [
        `skills/workflow/SKILL.md:600:${sha256(changedSkill)}`,
        `tools/alpha-packet/tool.json:644:${sha256(readFileSync(toolPath))}`,
      ].join("\n"),
    );
    assert.equal(manifest.sandboxDigest, expected);
  } finally {
    fixture.cleanup();
  }
});

test("hosted evidence rejects sandbox roots and nested directories symlinked outside the repository", () => {
  for (const target of ["root", "nested"] as const) {
    const fixture = createEvidenceFixture();
    const outside = mkdtempSync(join(tmpdir(), "qm-hosted-sandbox-outside-"));
    try {
      writeFileSync(join(outside, "outside.txt"), "outside\n");
      const sandbox = join(fixture.deployment, "sandbox");
      if (target === "root") {
        renameSync(sandbox, `${sandbox}.original`);
        symlinkSync(outside, sandbox);
      } else {
        const nested = join(sandbox, "skills");
        renameSync(nested, `${nested}.original`);
        symlinkSync(outside, nested);
      }
      assert.throws(() => collect(fixture), /sandbox bundle/i);
    } finally {
      fixture.cleanup();
      rmSync(outside, { force: true, recursive: true });
    }
  }
});

test("hosted evidence rejects sandbox-root replacement after directory enumeration", () => {
  const fixture = createEvidenceFixture();
  const outside = mkdtempSync(join(tmpdir(), "qm-hosted-sandbox-replacement-"));
  try {
    writeFileSync(join(outside, "outside.txt"), "outside\n");
    const sandbox = join(fixture.deployment, "sandbox");
    assert.throws(
      () =>
        collect(fixture, {
          afterSandboxList() {
            renameSync(sandbox, `${sandbox}.original`);
            symlinkSync(outside, sandbox);
          },
        }),
      /sandbox bundle/i,
    );
  } finally {
    fixture.cleanup();
    rmSync(outside, { force: true, recursive: true });
  }
});

test("hosted evidence recursively rejects content, identity, secret, and raw-id keys", () => {
  for (const key of [
    "prompt",
    "response",
    "packetBody",
    "providerRequest",
    "secret",
    "tokenValue",
    "email",
    "name",
    "id",
    "resourceId",
  ]) {
    assert.throws(
      () => assertEvidenceSafe({ contentCaptured: false, nested: { [key]: "private-value" } }),
      /forbidden evidence key|unsupported evidence key/i,
    );
  }
});

test("hosted evidence rejects hidden, symbolic, accessor, inherited, and extra properties", () => {
  const base = { contentCaptured: false } as Record<PropertyKey, unknown>;
  const hidden = { ...base };
  Object.defineProperty(hidden, "secret", { enumerable: false, value: "private" });
  assert.throws(() => assertEvidenceSafe(hidden), /forbidden|unsupported/i);
  assert.throws(() => assertEvidenceSafe({ ...base, [Symbol("secret")]: "private" }), /unsupported/i);

  let getterRan = false;
  const accessor = { ...base };
  Object.defineProperty(accessor, "commit", {
    enumerable: true,
    get() {
      getterRan = true;
      return "a".repeat(40);
    },
  });
  assert.throws(() => assertEvidenceSafe(accessor), /unsupported/i);
  assert.equal(getterRan, false);
  const inherited = Object.create({ secret: "private" });
  inherited.contentCaptured = false;
  assert.throws(() => assertEvidenceSafe(inherited), /unsupported/i);
  assert.throws(() => assertEvidenceSafe({ ...base, extra: true }), /unsupported evidence key/i);
});

test("hosted evidence fails closed on symlinked, oversized, malformed, and unsupported inputs", () => {
  for (const mutate of [
    (fixture: ReturnType<typeof createEvidenceFixture>) => {
      const target = `${fixture.ledgerPath}.target`;
      writeFileSync(target, readFileSync(fixture.ledgerPath));
      rmSync(fixture.ledgerPath);
      symlinkSync(target, fixture.ledgerPath);
    },
    (fixture: ReturnType<typeof createEvidenceFixture>) => {
      writeFileSync(join(fixture.generated, "live-checks.json"), "x".repeat(65_537));
    },
    (fixture: ReturnType<typeof createEvidenceFixture>) => {
      writeFileSync(join(fixture.generated, "resource-inventory.json"), "not-json");
    },
    (fixture: ReturnType<typeof createEvidenceFixture>) => {
      symlinkSync("../../outside", join(fixture.deployment, "sandbox", "escaped-link"));
    },
  ]) {
    const fixture = createEvidenceFixture();
    try {
      mutate(fixture);
      assert.throws(() => collect(fixture), /evidence input|sandbox bundle/i);
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence refuses symlink and hard-linked output without leaking private values", () => {
  for (const link of ["symlink", "hardlink"] as const) {
    const fixture = createEvidenceFixture();
    try {
      const target = join(fixture.generated, "target.json");
      const output = join(fixture.generated, "evidence-manifest.json");
      writeFileSync(target, "do-not-overwrite", { mode: 0o600 });
      if (link === "symlink") symlinkSync(target, output);
      else linkSync(target, output);
      assert.throws(
        () => collect(fixture),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.doesNotMatch(message, new RegExp(fixture.privateAppId));
          assert.doesNotMatch(message, new RegExp(fixture.root));
          return /evidence output/i.test(message);
        },
      );
      assert.equal(readFileSync(target, "utf8"), "do-not-overwrite");
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence rejects symlinked output parent chains", () => {
  const fixture = createEvidenceFixture();
  try {
    const moved = `${fixture.generated}.target`;
    renameSync(fixture.generated, moved);
    symlinkSync(moved, fixture.generated);
    assert.throws(() => collect(fixture), /evidence (?:input|output)/i);
  } finally {
    fixture.cleanup();
  }
});

test("hosted evidence leaves no private temporary output residue", () => {
  const fixture = createEvidenceFixture();
  try {
    collect(fixture);
    assert.deepEqual(
      readdirSync(fixture.generated).filter((name) => name.includes("evidence-manifest.json.tmp")),
      [],
    );
  } finally {
    fixture.cleanup();
  }
});
