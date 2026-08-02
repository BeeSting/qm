import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const docsRoot = "docs/alpha-ticker-stage-a-hosted";
const documentNames = [
  "runbook.md",
  "evidence-index.md",
  "limitations.md",
  "activation-approval.md",
  "decision-memo.md",
] as const;

function readDocument(name: (typeof documentNames)[number]): string {
  const path = join(docsRoot, name);
  assert.equal(existsSync(path), true, `${path} must exist`);
  return readFileSync(path, "utf8");
}

function requireAll(text: string, required: readonly string[], label: string): void {
  for (const value of required) assert.ok(text.includes(value), `${label} must contain: ${value}`);
}

test("hosted runbook defines the complete H0-H5 operating boundary", () => {
  const runbook = readDocument("runbook.md");

  requireAll(runbook, ["Gate H0", "Gate H1", "Gate H2", "Gate H3", "Gate H4", "Gate H5"], "runbook");
  requireAll(
    runbook,
    [
      "Fly organization: `personal`",
      "Region: `jnb`",
      "Provider: `openai`",
      "Model: `gpt-5.6-terra`",
      "Harness: `pi`",
      "BUDGET_WINDOW_MS=604800000",
      "BUDGET_USD_PER_WINDOW=20",
      "ORG_BUDGET_USD_PER_WINDOW=45",
      "US$50",
      "US$33.75",
      "US$40.50",
      "US$45",
      "https://alpha-ticker-stage-a-hosted-portal.fly.dev",
      "https://alpha-ticker-stage-a-egress.fly.dev",
    ],
    "runbook",
  );

  requireAll(
    runbook,
    [
      "alpha-ticker-stage-a-hosted-core",
      "alpha-ticker-stage-a-hosted-web-ui",
      "alpha-ticker-stage-a-hosted-admin",
      "alpha-ticker-stage-a-hosted-portal",
      "alpha-ticker-stage-a-hosted-auth",
      "alpha-ticker-stage-a-hosted-sandboxes",
      "alpha-ticker-stage-a-egress",
      "alpha-ticker-stage-a-hosted-pg",
      "alpha-ticker-stage-a-hosted-data",
    ],
    "runbook",
  );

  requireAll(
    runbook,
    [
      "## Repository-Only Readiness",
      "## Live Commands",
      "npm run typecheck",
      "npm run lint",
      "npm run test:all",
      "node --test 'test/alpha-ticker-stage-a-hosted-*.test.ts'",
      "node scripts/alpha-ticker-stage-a/check-boundary.mjs",
      "node scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs",
      "git diff --check",
      "bash scripts/alpha-ticker-stage-a-hosted/preflight.sh",
      "npm exec --no -- qm check",
      "npm exec --no -- qm sandbox build --dry-run",
      "npm exec --no -- qm plan",
      "fly apps create alpha-ticker-stage-a-egress --org personal",
      "npm exec --no -- qm sandbox publish",
      "npm exec --no -- qm secrets push",
      "npm exec --no -- qm up",
      "npm exec --no -- qm doctor",
      "npm exec --no -- qm check --live",
      "npm exec --no -- qm conformance",
      "node scripts/alpha-ticker-stage-a-hosted/collect-evidence.mjs",
      "bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --dry-run",
      "STAGE_A_DESTROY_CONFIRM=alpha-ticker-stage-a-hosted",
      "bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --execute",
      "manual-data-destruction-required",
    ],
    "runbook",
  );

  requireAll(
    runbook,
    [
      "Tasks 1-9 are repository-only",
      "Stop before Gate H0",
      "separate cloud-mutation approval",
      "No secret value or identity output may be printed",
      "Any identity, isolation, egress, secret, data-class, revocation, or scope failure stops the pilot immediately",
      "Vercel",
      "Railway",
      "Supabase",
      "production data",
      "personal LLM subscriptions",
      "connectors",
    ],
    "runbook",
  );
});

test("hosted evidence index is aggregate-only and names every controlled artifact", () => {
  const index = readDocument("evidence-index.md");
  requireAll(
    index,
    [
      ".generated/alpha-ticker-stage-a-hosted/activation.json",
      ".generated/alpha-ticker-stage-a-hosted/scores.jsonl",
      ".generated/alpha-ticker-stage-a-hosted/live-checks.json",
      ".generated/alpha-ticker-stage-a-hosted/resource-inventory.json",
      ".generated/alpha-ticker-stage-a-hosted/evidence-manifest.json",
      ".generated/alpha-ticker-stage-a-hosted/teardown-evidence.json",
      "mode `0600`",
      "contentCaptured: false",
      "15 unique workflow-participant pairs",
      "12 of 15",
      "90,000 ms",
      "US$45",
      "SHA-256",
    ],
    "evidence index",
  );
  assert.doesNotMatch(index, /(?:app|database|storage|sandbox)-private-[a-z0-9-]+/i);
});

test("hosted limitations document preserves every known Stage A limitation", () => {
  const limitations = readDocument("limitations.md");
  requireAll(
    limitations,
    [
      "upstream command-policy",
      "browser",
      "plaintext credential",
      "heuristic screening",
      "retention",
      "budget overshoot",
      "Sprite egress proxy",
      "unrestricted core egress",
      "Empty allowlist means unrestricted",
      "not a production-readiness or security certification",
    ],
    "limitations",
  );
});

test("activation approval separates design approval from permission to mutate cloud state", () => {
  const approval = readDocument("activation-approval.md");
  requireAll(
    approval,
    [
      "Architecture approval: approved",
      "Cloud-mutation approval: not granted",
      "H0 status: not-run",
      "Named reviewers are not a prerequisite",
      "Sponsor approval is required before Gate H0",
      "No Fly resource, provider project, secret upload, or billable model call is authorized by this document",
    ],
    "activation approval",
  );
});

test("decision memo starts not-run and permits only the three approved final outcomes", () => {
  const memo = readDocument("decision-memo.md");
  assert.match(memo, /^# Alpha Ticker QM Hosted Stage A Decision Memo\n\nStatus: `not-run`/);
  requireAll(memo, ["`stop`", "`repeat-synthetic`", "`design-stage-b`"], "decision memo");
  assert.match(memo, /Only one of the three values above may replace `not-run`/);
  assert.match(memo, /does not authorize production data, connectors, Slack, browser access, or external actions/i);
  assert.doesNotMatch(memo, /\b(?:proceed|go-live|production-ready|certified)\b/i);
});

test("hosted operating documents exclude identities, secrets, captured content, and dangerous scope expansion", () => {
  const corpus = documentNames.map(readDocument).join("\n");

  assert.doesNotMatch(corpus, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(corpus, /(?:sk|ghp|xox[baprs]|AKIA)[-_A-Za-z0-9]{12,}/);
  assert.doesNotMatch(corpus, /(?:API_KEY|PASSWORD|PRIVATE_KEY|CLIENT_SECRET)\s*=\s*[^<\s`]+/i);
  assert.doesNotMatch(corpus, /(?:prompt|response|packet|provider request) bod(?:y|ies)\s*:/i);
  assert.doesNotMatch(
    corpus,
    /^\s*(?:[-*]\s+)?(?:enable|connect|integrate|grant access to)\b.{0,80}\b(?:Slack|Telegram|GitHub|Google Drive|Supabase|Railway|Vercel|brokerage|production data)\b/im,
  );
  assert.doesNotMatch(
    corpus,
    /(?:fly apps destroy --all|docker (?:system|volume|network) prune|rm -rf|--auto-approve)/i,
  );
});
