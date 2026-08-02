import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";

import {
  assertScoreRecord,
  readScoreLedger,
  summarizeScoreRecords,
  // @ts-expect-error The production CLI is intentionally a standalone ESM script.
} from "../scripts/alpha-ticker-stage-a-hosted/evaluation-ledger.mjs";

const script = "scripts/alpha-ticker-stage-a-hosted/evaluation-ledger.mjs";
const participants = ["P1", "P2", "P3"] as const;
const workflows = [
  "daily-portfolio-briefing",
  "investment-question",
  "partner-meeting-preparation",
  "product-architecture-handover",
  "decision-memory-draft",
] as const;
const aggregateKeys = [
  "sampleSize",
  "disclosurePasses",
  "acceptedWithMinorOrLess",
  "medianUsefulness",
  "medianFactualConsistency",
  "medianElapsedMs",
  "totalCostUsd",
  "incidentCount",
  "pass",
] as const;

const valid = {
  outputId: "P1:daily-portfolio-briefing",
  workflow: "daily-portfolio-briefing",
  participant: "P1",
  sourceTrace: true,
  syntheticDisclosure: true,
  missingDataDisclosure: true,
  humanReviewLanguage: true,
  usefulness: 4,
  factualConsistency: 5,
  editBurden: "minor",
  elapsedMs: 45000,
  inputTokens: 1200,
  outputTokens: 700,
  costUsd: 0.02,
  model: "gpt-5.6-terra",
  deploymentRevision: "a".repeat(40),
  incidentCategory: "none",
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function cloneValid(overrides: Record<string, unknown> = {}) {
  return { ...valid, ...overrides };
}

function completeSample(overrides: (record: Record<string, unknown>, index: number) => void = () => {}) {
  let index = 0;
  return participants.flatMap((participant) =>
    workflows.map((workflow) => {
      const record: Record<string, unknown> = cloneValid({
        outputId: `${participant}:${workflow}`,
        participant,
        workflow,
      });
      overrides(record, index);
      index += 1;
      return record;
    }),
  );
}

function writeLedger(records: unknown[], suffix = "scores.jsonl") {
  const directory = mkdtempSync(join(tmpdir(), "qm-hosted-evaluation-"));
  temporaryDirectories.push(directory);
  const path = join(directory, suffix);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, {
    mode: 0o600,
  });
  return path;
}

function runCli(path: string) {
  return spawnSync(process.execPath, [script, "--input", path], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

test("accepts the canonical score record and rejects unsupported top-level keys", () => {
  assert.doesNotThrow(() => assertScoreRecord(valid));
  assert.throws(() => assertScoreRecord(cloneValid({ unexpected: true })), /unexpected/);
  assert.throws(() => assertScoreRecord(Object.fromEntries(Object.entries(valid).slice(1))), /outputId/);
});

test("recursively rejects forbidden keys before unsupported-container handling", () => {
  for (const key of ["prompt", "response", "packetBody", "providerRequest", "secret", "tokenValue", "email", "name"]) {
    assert.throws(
      () => assertScoreRecord(cloneValid({ metadata: { nested: [{ [key]: "DO_NOT_LEAK" }] } })),
      new RegExp(key),
    );
  }
});

test("enforces fixed participant, workflow, and model domains plus non-empty string identifiers", () => {
  const invalid: Array<[string, unknown]> = [
    ["participant", "P4"],
    ["participant", 1],
    ["workflow", "portfolio-writeback"],
    ["model", "gpt-5.6"],
    ["outputId", ""],
    ["outputId", "   "],
    ["outputId", 1],
    ["deploymentRevision", ""],
    ["deploymentRevision", "\t"],
    ["deploymentRevision", null],
    ["incidentCategory", ""],
    ["incidentCategory", "\n"],
    ["incidentCategory", false],
  ];

  for (const [field, value] of invalid) {
    assert.throws(() => assertScoreRecord(cloneValid({ [field]: value })), new RegExp(field));
  }

  assert.doesNotThrow(() =>
    assertScoreRecord(
      cloneValid({
        outputId: "run 1 / output",
        deploymentRevision: "release candidate 7",
        incidentCategory: "identity boundary",
      }),
    ),
  );
});

test("enforces disclosure booleans, score integers, and edit-burden values", () => {
  for (const field of ["sourceTrace", "syntheticDisclosure", "missingDataDisclosure", "humanReviewLanguage"]) {
    assert.throws(() => assertScoreRecord(cloneValid({ [field]: "true" })), new RegExp(field));
    assert.doesNotThrow(() => assertScoreRecord(cloneValid({ [field]: false })));
  }

  for (const field of ["usefulness", "factualConsistency"]) {
    for (const value of [0, 6, 3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => assertScoreRecord(cloneValid({ [field]: value })), new RegExp(field));
    }
  }

  for (const editBurden of ["none", "minor", "major", "rejected"]) {
    assert.doesNotThrow(() => assertScoreRecord(cloneValid({ editBurden })));
  }
  assert.throws(() => assertScoreRecord(cloneValid({ editBurden: "accepted" })), /editBurden/);
});

test("enforces finite non-negative numeric telemetry and accepts fractions", () => {
  for (const field of ["elapsedMs", "inputTokens", "outputTokens", "costUsd"]) {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      assert.throws(() => assertScoreRecord(cloneValid({ [field]: value })), new RegExp(field));
    }
    assert.doesNotThrow(() => assertScoreRecord(cloneValid({ [field]: 1.5 })));
  }
});

test("summarizes only aggregate fields and passes a complete required sample", () => {
  const records = completeSample((record, index) => {
    record.usefulness = index < 7 ? 3 : 4;
    record.factualConsistency = index < 7 ? 3 : 4;
    record.elapsedMs = index < 7 ? 100_000 : 90_000;
    record.costUsd = index === 0 ? 44.999986 : 0.000001;
    record.editBurden = index < 3 ? "major" : "minor";
  });

  const summary = summarizeScoreRecords(records);

  assert.deepEqual(Object.keys(summary), aggregateKeys);
  assert.deepEqual(summary, {
    sampleSize: 15,
    disclosurePasses: 15,
    acceptedWithMinorOrLess: 12,
    medianUsefulness: 4,
    medianFactualConsistency: 4,
    medianElapsedMs: 90000,
    totalCostUsd: 45,
    incidentCount: 0,
    pass: true,
  });
  assert.doesNotMatch(JSON.stringify(summary), /outputId|workflow|participant|deploymentRevision/);
});

test("requires every unique workflow-participant pair and rejects duplicate ids or pairs", () => {
  const records = completeSample();
  assert.throws(
    () => summarizeScoreRecords([...records, { ...records[0]!, outputId: records[1]!.outputId }]),
    /outputId/,
  );

  const missingPair = records.slice(1);
  assert.equal(summarizeScoreRecords(missingPair).pass, false);

  const repeatedPair = [...missingPair, { ...records[1]!, outputId: "repeat-output-id" }];
  assert.equal(repeatedPair.length, 15);
  assert.throws(() => summarizeScoreRecords(repeatedPair), /workflow-participant pair/);

  const completeWithInvestigativeRepeat = [...records, { ...records[0]!, outputId: "investigation-repeat" }];
  assert.throws(() => summarizeScoreRecords(completeWithInvestigativeRepeat), /workflow-participant pair/);
});

test("a repeated pair cannot inflate acceptance, disclosure, median, latency, or cost votes", () => {
  const records = completeSample((record, index) => {
    if (index < 4) record.editBurden = "major";
  });
  assert.equal(summarizeScoreRecords(records).pass, false);

  const duplicateAcceptedVote = {
    ...records[4]!,
    outputId: "unique-output-id-for-duplicate-pair",
    sourceTrace: true,
    syntheticDisclosure: true,
    missingDataDisclosure: true,
    humanReviewLanguage: true,
    usefulness: 5,
    factualConsistency: 5,
    editBurden: "none",
    elapsedMs: 1,
    costUsd: 0,
  };

  assert.throws(() => summarizeScoreRecords([...records, duplicateAcceptedVote]), /workflow-participant pair/);
});

test("fails each disclosure, quality, latency, cost, and incident threshold independently", () => {
  const cases: Array<(records: Record<string, unknown>[]) => void> = [
    (records) => {
      records[0]!.sourceTrace = false;
    },
    (records) => {
      for (let index = 0; index < 4; index += 1) records[index]!.editBurden = "major";
    },
    (records) => {
      for (let index = 0; index < 8; index += 1) records[index]!.usefulness = 3;
    },
    (records) => {
      for (let index = 0; index < 8; index += 1) records[index]!.factualConsistency = 3;
    },
    (records) => {
      for (let index = 0; index < 8; index += 1) records[index]!.elapsedMs = 90_001;
    },
    (records) => {
      records[0]!.costUsd = 45.0000001;
    },
    (records) => {
      records[0]!.incidentCategory = "quality-anomaly";
    },
  ];

  for (const mutate of cases) {
    const records = completeSample();
    mutate(records);
    assert.equal(summarizeScoreRecords(records).pass, false);
  }
});

test("computes even medians for an incomplete unique sample and rounds cost to six places", () => {
  const records = completeSample().slice(0, 14);
  records[0]!.usefulness = 3;
  records[13]!.usefulness = 5;
  records[0]!.elapsedMs = 44_998;
  records[13]!.elapsedMs = 45_002;
  records[0]!.costUsd = 0.0000019;
  records[1]!.costUsd = 0.0000019;

  const summary = summarizeScoreRecords(records);
  assert.equal(summary.medianUsefulness, 4);
  assert.equal(summary.medianFactualConsistency, 5);
  assert.equal(summary.medianElapsedMs, 45000);
  assert.equal(summary.totalCostUsd, 0.240004);
  assert.equal(summary.pass, false);
});

test("reads non-empty JSONL lines and never logs or exposes record bodies", () => {
  const records = completeSample();
  const path = writeLedger(records);
  const padded = readFileSync(path, "utf8").replace("\n", "\n   \n");
  writeFileSync(path, padded, { mode: 0o600 });

  assert.deepEqual(readScoreLedger(path), records);

  const sentinel = "PRIVATE_RECORD_BODY_SENTINEL";
  writeFileSync(path, `${JSON.stringify(valid)}\n{"outputId":"${sentinel}",bad}\n`, { mode: 0o600 });
  assert.throws(
    () => readScoreLedger(path),
    (error: unknown) => error instanceof Error && !error.message.includes(sentinel),
  );
});

test("CLI prints only aggregate JSON and uses pass/fail exit status", () => {
  const passingPath = writeLedger(completeSample());
  const passing = runCli(passingPath);
  assert.equal(passing.status, 0);
  assert.equal(passing.stderr, "");
  assert.deepEqual(Object.keys(JSON.parse(passing.stdout)), aggregateKeys);
  assert.equal(JSON.parse(passing.stdout).pass, true);
  assert.equal(passing.stdout.trim().split("\n").length, 1);

  const failingRecords = completeSample();
  failingRecords[0]!.sourceTrace = false;
  const failing = runCli(writeLedger(failingRecords));
  assert.equal(failing.status, 1);
  assert.equal(failing.stderr, "");
  assert.equal(JSON.parse(failing.stdout).pass, false);
  assert.equal(failing.stdout.trim().split("\n").length, 1);
});

test("CLI invalid-ledger errors do not leak supplied bodies or paths", () => {
  const sentinel = "SECRET_OUTPUT_SENTINEL";
  const path = writeLedger([cloneValid({ outputId: sentinel, prompt: sentinel })], `${sentinel}.jsonl`);
  chmodSync(path, 0o600);

  const result = runCli(path);
  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(sentinel));
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "evaluation-ledger: invalid\n");
});
