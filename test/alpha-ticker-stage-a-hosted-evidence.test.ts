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
import { assertEvidenceSafe, collectEvidence } from "../scripts/alpha-ticker-stage-a-hosted/collect-evidence.mjs";

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
const hostedDeployment = resolve("deploy/layers/alpha-ticker-stage-a-hosted");

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

function writeLiveChecks(generated: string, allTurnModelCostUsd = 4.5, flyCostUsd = 1.25) {
  writeJson(join(generated, "live-checks.json"), {
    checks: [
      {
        id: "hosted-conformance",
        status: "pass",
        timestamp: "2026-08-02T00:00:00.000Z",
        revision: "revision-1",
        resourceNameSha256: sha256("alpha-ticker-stage-a-hosted-core"),
      },
    ],
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

  writeJson(join(root, "UPSTREAM.lock.json"), { commit: "b".repeat(40) }, 0o644);
  for (const file of ["stage-a-hosted-policy.json", "qm.config.jsonc", "egress-proxy.fly.toml"]) {
    writeFileSync(join(deployment, file), readFileSync(join(hostedDeployment, file)));
  }
  writeFileSync(join(sandbox, "skills", "workflow", "SKILL.md"), "synthetic workflow\n");
  writeFileSync(join(sandbox, "tools", "alpha-packet", "tool.json"), '{"name":"alpha-packet"}\n');

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
  writeFileSync(
    ledgerPath,
    `${scoreRecords()
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  chmodSync(ledgerPath, 0o600);

  const privateAppId = "app-private-identifier-do-not-retain";
  const privateDatabaseId = "database-private-identifier-do-not-retain";
  writeJson(join(generated, "resource-inventory.json"), {
    flyOrg: "personal",
    apps: hostedApps.map((name, index) => ({
      name,
      id: index === 0 ? privateAppId : `private-app-identifier-${index}`,
    })),
    managedPostgres: { name: "alpha-ticker-stage-a-hosted-pg", id: privateDatabaseId },
    objectStorage: { name: "alpha-ticker-stage-a-hosted-data", id: "storage-private-id" },
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
      "qmBaseline",
      "sandboxDigest",
      "scoreSummary",
      "spendSummary",
      "timestamp",
    ]);
    assert.equal(manifest.contentCaptured, false);
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
