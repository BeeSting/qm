import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
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
const MICRODOLLARS_PER_USD = 1_000_000;
const COST_LIMIT_MICRODOLLARS = 45_000_000;
const MAX_LEDGER_BYTES = 64 * 1024;
const MAX_LEDGER_LINE_BYTES = 16 * 1024;
const MAX_LEDGER_RECORDS = 15;

function fail(field) {
  throw new TypeError(`Invalid score record field: ${field}`);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectForbiddenKeys(value, seen = new WeakSet()) {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);

  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("record");
  }

  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key === "symbol") fail("unsupportedKey");
    if (FORBIDDEN_KEYS.has(key)) fail(key);

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !descriptor.writable ||
      !descriptor.configurable
    ) {
      fail(key);
    }
    rejectForbiddenKeys(descriptor.value, seen);
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

function costToMicrodollars(value, field = "costUsd") {
  const fixed = value.toFixed(6);
  if (!/^(?:0|[1-9]\d*)\.\d{6}$/.test(fixed) || Number(fixed) !== value) fail(field);

  const [whole, fraction] = fixed.split(".");
  const microdollars = BigInt(whole) * BigInt(MICRODOLLARS_PER_USD) + BigInt(fraction);
  if (microdollars > BigInt(Number.MAX_SAFE_INTEGER)) fail(field);
  return Number(microdollars);
}

export function assertScoreRecord(record) {
  if (!isObject(record)) fail("record");
  rejectForbiddenKeys(record);

  const keys = Reflect.ownKeys(record);
  for (const key of keys) {
    if (typeof key === "symbol") fail("unsupportedKey");
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
  costToMicrodollars(record.costUsd);
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
  if (records.length < 1) fail("sampleSize");

  const outputIds = new Set();
  const workflowParticipantPairs = new Set();
  let disclosurePasses = 0;
  let acceptedWithMinorOrLess = 0;
  let totalCostMicrodollars = 0;
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
    const recordCostMicrodollars = costToMicrodollars(record.costUsd);
    if (recordCostMicrodollars > Number.MAX_SAFE_INTEGER - totalCostMicrodollars) {
      fail("totalCostUsd");
    }
    totalCostMicrodollars += recordCostMicrodollars;
    if (record.incidentCategory !== "none") incidentCount += 1;
  }
  if (records.length > MAX_LEDGER_RECORDS) fail("sampleSize");

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
    totalCostMicrodollars <= COST_LIMIT_MICRODOLLARS &&
    incidentCount === 0;

  return {
    sampleSize: records.length,
    disclosurePasses,
    acceptedWithMinorOrLess,
    medianUsefulness,
    medianFactualConsistency,
    medianElapsedMs,
    totalCostUsd: totalCostMicrodollars / MICRODOLLARS_PER_USD,
    incidentCount,
    pass,
  };
}

class LedgerInputError extends TypeError {}

function ledgerFail(field) {
  throw new LedgerInputError(`Invalid score ledger field: ${field}`);
}

function readBoundedLedger(path) {
  let pathStat;
  try {
    pathStat = lstatSync(path);
  } catch {
    ledgerFail("file");
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) ledgerFail("file");
  if (pathStat.size > MAX_LEDGER_BYTES) ledgerFail("fileBytes");
  if (!Number.isInteger(constants.O_NOFOLLOW)) ledgerFail("file");

  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    ledgerFail("file");
  }

  try {
    const descriptorStat = fstatSync(descriptor);
    if (!descriptorStat.isFile() || descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
      ledgerFail("file");
    }
    if (descriptorStat.size > MAX_LEDGER_BYTES) ledgerFail("fileBytes");

    const buffer = Buffer.allocUnsafe(MAX_LEDGER_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > MAX_LEDGER_BYTES) ledgerFail("fileBytes");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (error instanceof LedgerInputError) throw error;
    ledgerFail("file");
  } finally {
    try {
      closeSync(descriptor);
    } catch {
      // The descriptor is already unusable; preserve the sanitized primary result.
    }
  }
}

export function readScoreLedger(path) {
  const content = readBoundedLedger(path);
  const lines = content.split("\n");
  const records = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (Buffer.byteLength(rawLine, "utf8") > MAX_LEDGER_LINE_BYTES) ledgerFail("lineBytes");
    const line = rawLine.trim();
    if (line === "") continue;
    if (records.length === MAX_LEDGER_RECORDS) ledgerFail("sampleSize");
    try {
      const record = JSON.parse(line);
      assertScoreRecord(record);
      records.push(record);
    } catch {
      ledgerFail("record");
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
