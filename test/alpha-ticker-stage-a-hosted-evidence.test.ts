import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

function createEvidenceFixture() {
  const root = mkdtempSync(join(tmpdir(), "qm-hosted-evidence-"));
  const generated = join(root, ".generated", "alpha-ticker-stage-a-hosted");
  const deployment = join(root, "deploy", "layers", "alpha-ticker-stage-a-hosted");
  const sandbox = join(deployment, "sandbox");
  mkdirSync(join(sandbox, "skills", "workflow"), { recursive: true });
  mkdirSync(join(sandbox, "tools", "alpha-packet"), { recursive: true });

  writeJson(join(root, "UPSTREAM.lock.json"), { commit: "b".repeat(40) }, 0o644);
  writeFileSync(join(deployment, "stage-a-hosted-policy.json"), '{"stage":"A"}\n');
  writeFileSync(join(deployment, "qm.config.jsonc"), '{"publicUrl":"https://example.test"}\n');
  writeFileSync(join(deployment, "egress-proxy.fly.toml"), 'app = "alpha-ticker-stage-a-egress"\n');
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
  const records = scoreRecords();
  const ledgerPath = join(generated, "scores.jsonl");
  writeFileSync(ledgerPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, {
    mode: 0o600,
  });
  chmodSync(ledgerPath, 0o600);

  const privateAppId = "app-private-identifier-do-not-retain";
  const privateDatabaseId = "database-private-identifier-do-not-retain";
  writeJson(join(generated, "resource-inventory.json"), {
    flyOrg: "personal",
    apps: [{ name: "alpha-ticker-stage-a-hosted-core", id: privateAppId }],
    managedPostgres: { name: "alpha-ticker-stage-a-hosted-pg", id: privateDatabaseId },
    objectStorage: { name: "alpha-ticker-stage-a-hosted-data", id: "storage-private-id" },
    sandboxRegistry: { name: "alpha-ticker-stage-a-hosted-sandboxes", id: "sandbox-private-id" },
  });
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
      allTurnModelCostUsd: 4.5,
      flyCostUsd: 1.25,
      totalCostUsd: 5.75,
    },
  });

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

test("hosted evidence is exact-schema, aggregate-only, and content-minimized", () => {
  const fixture = createEvidenceFixture();
  try {
    const output = join(fixture.generated, "evidence-manifest.json");
    const manifest = collectEvidence({
      repoRoot: fixture.root,
      commit: "a".repeat(40),
      timestamp: "2026-08-02T01:02:03.000Z",
      output,
    });

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

    const serialized = readFileSync(output, "utf8");
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.doesNotMatch(serialized, /outputId|participant|workflow|prompt|response|packetBody|providerRequest/);
    assert.doesNotMatch(serialized, new RegExp(fixture.privateAppId));
    assert.doesNotMatch(serialized, new RegExp(fixture.privateDatabaseId));
    assert.match(serialized, /resource-inventory/);
    assert.match(serialized, /^[\s\S]*[a-f0-9]{64}[\s\S]*$/);
  } finally {
    fixture.cleanup();
  }
});

test("hosted evidence hashes every approved artifact and runtime input", () => {
  const fixture = createEvidenceFixture();
  try {
    const manifest = collectEvidence({
      repoRoot: fixture.root,
      commit: "a".repeat(40),
      timestamp: "2026-08-02T01:02:03.000Z",
      output: join(fixture.generated, "evidence-manifest.json"),
    });
    assert.deepEqual(manifest.checks.map((check: { id: string }) => check.id).sort(), [
      "activation-record",
      "egress-proxy-config",
      "evaluation-ledger",
      "hosted-config",
      "hosted-policy",
      "live-checks",
      "resource-inventory",
      "sandbox-bundle",
    ]);
    assert.equal(
      manifest.sandboxDigest,
      manifest.checks.find((check: { id: string }) => check.id === "sandbox-bundle")?.artifactSha256,
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
    const manifest = { contentCaptured: false, nested: { [key]: "private-value" } };
    assert.throws(() => assertEvidenceSafe(manifest), /forbidden evidence key|unsupported evidence key/i);
  }
});

test("hosted evidence rejects hidden, symbolic, accessor, inherited, and extra properties", () => {
  const base = { contentCaptured: false } as Record<PropertyKey, unknown>;
  const hidden = { ...base };
  Object.defineProperty(hidden, "secret", { enumerable: false, value: "private" });
  assert.throws(() => assertEvidenceSafe(hidden), /forbidden|unsupported/i);

  const symbolic = { ...base, [Symbol("secret")]: "private" };
  assert.throws(() => assertEvidenceSafe(symbolic), /unsupported/i);

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

test("hosted evidence fails closed on symlinked, oversized, and malformed runtime inputs", () => {
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
      assert.throws(
        () =>
          collectEvidence({
            repoRoot: fixture.root,
            commit: "a".repeat(40),
            timestamp: "2026-08-02T01:02:03.000Z",
            output: join(fixture.generated, "evidence-manifest.json"),
          }),
        /evidence input|sandbox bundle/i,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("hosted evidence refuses symlink output and leaves no private data in errors", () => {
  const fixture = createEvidenceFixture();
  try {
    const target = join(fixture.generated, "target.json");
    const output = join(fixture.generated, "evidence-manifest.json");
    writeFileSync(target, "do-not-overwrite");
    symlinkSync(target, output);
    assert.throws(
      () =>
        collectEvidence({
          repoRoot: fixture.root,
          commit: "a".repeat(40),
          timestamp: "2026-08-02T01:02:03.000Z",
          output,
        }),
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
});
