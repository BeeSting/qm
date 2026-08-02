import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PARTICIPANTS = ["P1", "P2", "P3"];
const WORKFLOWS = [
  "daily-portfolio-briefing",
  "investment-question",
  "partner-meeting-preparation",
  "product-architecture-handover",
  "decision-memory-draft",
];
const EDIT_BURDENS = new Set(["none", "minor", "major", "rejected"]);
const FORBIDDEN_KEYS = new Set([
  "prompt",
  "response",
  "packetBody",
  "providerRequest",
  "secret",
  "tokenValue",
  "email",
  "name",
]);
const SCORE_RECORD_KEYS = [
  "outputId",
  "workflow",
  "participant",
  "sourceTrace",
  "syntheticDisclosure",
  "missingDataDisclosure",
  "humanReviewLanguage",
  "usefulness",
  "factualConsistency",
  "editBurden",
  "elapsedMs",
  "inputTokens",
  "outputTokens",
  "costUsd",
  "model",
  "deploymentRevision",
  "incidentCategory",
];
const SCORE_RECORD_KEY_SET = new Set(SCORE_RECORD_KEYS);
const REQUIRED_PAIRS = new Set(
  PARTICIPANTS.flatMap((participant) => WORKFLOWS.map((workflow) => `${participant}:${workflow}`)),
);

function fail(field) {
  throw new TypeError(`Invalid score record field: ${field}`);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectForbiddenKeys(value, seen = new WeakSet()) {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail(key);
    rejectForbiddenKeys(value[key], seen);
  }
}

function assertBoolean(record, field) {
  if (typeof record[field] !== "boolean") fail(field);
}

function assertScore(record, field) {
  const value = record[field];
  if (!Number.isInteger(value) || value < 1 || value > 5) fail(field);
}

function assertNonEmptyString(record, field) {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") fail(field);
}

function assertNonNegativeNumber(record, field) {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(field);
  }
}

export function assertScoreRecord(record) {
  if (!isObject(record)) fail("record");
  rejectForbiddenKeys(record);

  const keys = Object.keys(record);
  for (const key of keys) {
    if (!SCORE_RECORD_KEY_SET.has(key)) fail(key);
  }
  for (const key of SCORE_RECORD_KEYS) {
    if (!Object.hasOwn(record, key)) fail(key);
  }

  assertNonEmptyString(record, "outputId");
  if (!WORKFLOWS.includes(record.workflow)) fail("workflow");
  if (!PARTICIPANTS.includes(record.participant)) fail("participant");

  for (const field of ["sourceTrace", "syntheticDisclosure", "missingDataDisclosure", "humanReviewLanguage"]) {
    assertBoolean(record, field);
  }
  assertScore(record, "usefulness");
  assertScore(record, "factualConsistency");
  if (!EDIT_BURDENS.has(record.editBurden)) fail("editBurden");
  assertNonNegativeNumber(record, "elapsedMs");
  assertNonNegativeNumber(record, "inputTokens");
  assertNonNegativeNumber(record, "outputTokens");
  assertNonNegativeNumber(record, "costUsd");
  if (record.model !== "gpt-5.6-terra") fail("model");
  assertNonEmptyString(record, "deploymentRevision");
  assertNonEmptyString(record, "incidentCategory");

  return record;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function summarizeScoreRecords(records) {
  if (!Array.isArray(records)) throw new TypeError("Invalid score records");

  const outputIds = new Set();
  const workflowParticipantPairs = new Set();
  let disclosurePasses = 0;
  let acceptedWithMinorOrLess = 0;
  let totalCostUsdRaw = 0;
  let incidentCount = 0;
  const usefulness = [];
  const factualConsistency = [];
  const elapsedMs = [];

  for (const record of records) {
    assertScoreRecord(record);
    if (outputIds.has(record.outputId)) fail("outputId");
    outputIds.add(record.outputId);
    const workflowParticipantPair = `${record.participant}:${record.workflow}`;
    if (workflowParticipantPairs.has(workflowParticipantPair)) fail("workflow-participant pair");
    workflowParticipantPairs.add(workflowParticipantPair);

    if (
      record.sourceTrace &&
      record.syntheticDisclosure &&
      record.missingDataDisclosure &&
      record.humanReviewLanguage
    ) {
      disclosurePasses += 1;
    }
    if (record.editBurden === "none" || record.editBurden === "minor") {
      acceptedWithMinorOrLess += 1;
    }
    usefulness.push(record.usefulness);
    factualConsistency.push(record.factualConsistency);
    elapsedMs.push(record.elapsedMs);
    totalCostUsdRaw += record.costUsd;
    if (record.incidentCategory !== "none") incidentCount += 1;
  }

  const medianUsefulness = median(usefulness);
  const medianFactualConsistency = median(factualConsistency);
  const medianElapsedMs = median(elapsedMs);
  const hasRequiredPairs =
    workflowParticipantPairs.size === REQUIRED_PAIRS.size &&
    [...REQUIRED_PAIRS].every((pair) => workflowParticipantPairs.has(pair));
  const pass =
    hasRequiredPairs &&
    disclosurePasses === records.length &&
    acceptedWithMinorOrLess >= 12 &&
    medianUsefulness !== null &&
    medianUsefulness >= 4 &&
    medianFactualConsistency !== null &&
    medianFactualConsistency >= 4 &&
    medianElapsedMs !== null &&
    medianElapsedMs <= 90_000 &&
    totalCostUsdRaw <= 45 &&
    incidentCount === 0;

  return {
    sampleSize: records.length,
    disclosurePasses,
    acceptedWithMinorOrLess,
    medianUsefulness,
    medianFactualConsistency,
    medianElapsedMs,
    totalCostUsd: Math.round(totalCostUsdRaw * 1_000_000) / 1_000_000,
    incidentCount,
    pass,
  };
}

export function readScoreLedger(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const records = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "") continue;
    try {
      const record = JSON.parse(line);
      assertScoreRecord(record);
      records.push(record);
    } catch {
      throw new Error(`Invalid score ledger record at line ${index + 1}`);
    }
  }

  return records;
}

function parseCliInput(argv) {
  if (argv.length !== 2 || argv[0] !== "--input" || argv[1] === "") {
    throw new Error("Invalid CLI arguments");
  }
  return argv[1];
}

function isDirectExecution() {
  return process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  try {
    const input = parseCliInput(process.argv.slice(2));
    const summary = summarizeScoreRecords(readScoreLedger(input));
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    process.exitCode = summary.pass ? 0 : 1;
  } catch {
    process.stderr.write("evaluation-ledger: invalid\n");
    process.exitCode = 1;
  }
}
