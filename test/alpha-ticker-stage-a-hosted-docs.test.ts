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

function section(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing section start: ${start}`);
  assert.ok(endIndex > startIndex, `missing section end: ${end}`);
  return text.slice(startIndex, endIndex);
}

test("hosted runbook defines the complete H0-H5 operating boundary", () => {
  const runbook = readDocument("runbook.md");

  requireAll(runbook, ["Gate H0", "Gate H1", "Gate H2", "Gate H3", "Gate H4", "Gate H5"], "runbook");
  requireAll(
    runbook,
    [
      "Fly organization: `personal`",
      "QM organization id: `alpha-ticker-stage-a-hosted`",
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
      'HOSTED_ROOT="$REPO_ROOT/deploy/layers/alpha-ticker-stage-a-hosted"',
      'QM_BIN="$HOSTED_ROOT/node_modules/.bin/qm"',
      'node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \\\n  --verify-qm-install --root "$HOSTED_ROOT"',
      '"$QM_BIN" check',
      '"$QM_BIN" sandbox build --dry-run',
      '"$QM_BIN" plan',
      "fly apps create alpha-ticker-stage-a-egress --org personal",
      '"$QM_BIN" sandbox publish',
      '"$QM_BIN" secrets push',
      '"$QM_BIN" up',
      '"$QM_BIN" doctor',
      '"$QM_BIN" check --live',
      '"$QM_BIN" conformance',
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

  requireAll(
    runbook,
    [
      '"$QM_BIN" setup',
      'chmod 600 "$HOSTED_ROOT/.env"',
      'git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env',
      "At H0, leave `FLY_SANDBOX_API_TOKEN` unset",
      'awk -F= \'$1 == "CAPABILITY_SECRET" { print }\' "$HOSTED_ROOT/.env" |',
      "fly secrets import -a alpha-ticker-stage-a-egress",
      'Run `"$QM_BIN" setup` a second time',
      "FLY_SANDBOX_API_TOKEN",
      "curl -sS -o /dev/null -w '%{http_code}\\n' https://example.com",
      "Expected output is exactly `403`",
      "ORG_BUDGET_USD_PER_WINDOW=0",
      "denied before any provider request",
      "ORG_BUDGET_USD_PER_WINDOW=45",
      '"$QM_BIN" up --only core',
      "replace the revoked key",
      'node --test "$REPO_ROOT/test/alpha-ticker-stage-a-hosted-policy.test.ts" \\\n  "$REPO_ROOT/test/alpha-ticker-stage-a-hosted-boundary.test.ts"',
      "UTC start timestamp",
      "fifth consecutive business day",
      "no later than 168 hours",
      "daily-portfolio-briefing",
      "investment-question",
      "partner-meeting-preparation",
      "product-architecture-handover",
      "decision-memory-draft",
    ],
    "runbook execution contract",
  );

  const verifier = runbook.indexOf("--verify-qm-install --root");
  const firstQmCommand = runbook.indexOf('"$QM_BIN" check');
  const preflight = runbook.indexOf("bash scripts/alpha-ticker-stage-a-hosted/preflight.sh");
  const firstFlyMutation = runbook.indexOf("fly apps create alpha-ticker-stage-a-egress --org personal");
  assert.ok(verifier >= 0 && verifier < firstQmCommand, "local QM verification must precede QM commands");
  assert.ok(preflight >= 0 && preflight < firstFlyMutation, "H0 preflight must precede Fly mutation");
});

test("H0 and H1 protect identity inputs and capture progressive private inventory", () => {
  const runbook = readDocument("runbook.md");
  const h0 = section(runbook, "### Gate H0", "### Gate H1");
  const h1 = section(runbook, "### Gate H1", "### Gate H2");

  requireAll(
    h0,
    [
      "ADMIN_GRANTS",
      "AUTH_ALLOWED_EMAILS",
      "directly in the private `.env` before setup",
      '"$QM_BIN" setup </dev/null >/dev/null 2>&1',
      "validation-only",
      "must not derive one identity list from the other",
      "Identity output may never be retained",
      'chmod 600 "$HOSTED_ROOT/.env"',
      'git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env',
    ],
    "H0 identity setup",
  );

  requireAll(
    h1,
    [
      ".generated/alpha-ticker-stage-a-hosted/resource-inventory.json",
      "partial inventory",
      "immediately after each successful create and before the next cloud mutation",
      "mode `0600`",
      "ignored",
      "teardown",
    ],
    "H1 progressive inventory",
  );

  assert.equal(runbook.match(/^"\$QM_BIN" setup(?: <\/dev\/null >\/dev\/null 2>&1)?$/gm)?.length ?? 0, 2);
});

test("H3 uses a reversible qconfig drill and manual in-place provider-key replacement", () => {
  const runbook = readDocument("runbook.md");
  const h3 = section(runbook, "### Gate H3", "### Gate H4");

  requireAll(
    h3,
    [
      'QCONFIG="$HOSTED_ROOT/qm.config.jsonc"',
      'BUDGET_BACKUP="$(mktemp',
      'chmod 600 "$BUDGET_BACKUP"',
      "QCONFIG_PRE_SHA256",
      "restore_budget_config",
      "trap restore_budget_config EXIT",
      "trap abort_budget_drill HUP INT TERM",
      '"ORG_BUDGET_USD_PER_WINDOW": "45"',
      '"ORG_BUDGET_USD_PER_WINDOW": "0"',
      "replacementCount !== 1",
      "Pre-mutation boundary and policy checks",
      "The next synthetic turn must be denied before any provider request",
      'cmp -s "$BUDGET_BACKUP" "$QCONFIG"',
      "restore the exact original bytes",
      '"$QM_BIN" up --only core',
      '"$QM_BIN" doctor',
      '"$QM_BIN" check --live',
      '"$QM_BIN" conformance',
      'test -z "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)"',
      "Do not commit any budget-drill state",
      "secure local editor",
      "ENV_DEVICE_INODE_BEFORE",
      "stat -f '%d:%i'",
      'must not use `"$QM_BIN" setup`',
      '"$QM_BIN" secrets push',
    ],
    "H3 safe mutation",
  );

  assert.doesNotMatch(h3, /^"\$QM_BIN" setup(?:\s|$)/m);
  assert.ok(h3.indexOf("Pre-mutation boundary and policy checks") < h3.indexOf("replacementCount !== 1"));
  assert.ok(h3.indexOf("replacementCount !== 1") < h3.indexOf("denied before any provider request"));
  assert.ok(h3.indexOf("denied before any provider request") < h3.indexOf("restore the exact original bytes"));
  assert.ok(h3.indexOf("restore the exact original bytes") < h3.lastIndexOf('"$QM_BIN" up --only core'));
});

test("H5 initializes deletion evidence and documents early-stop and cryptographic teardown semantics", () => {
  const runbook = readDocument("runbook.md");
  const index = readDocument("evidence-index.md");
  const limitations = readDocument("limitations.md");
  const h5 = section(runbook, "### Gate H5", "## Incident Stop Conditions");

  requireAll(
    h5,
    [
      "before the first H5 teardown dry-run or execute",
      'TEARDOWN_EVIDENCE="$REPO_ROOT/.generated/alpha-ticker-stage-a-hosted/teardown-evidence.json"',
      '"managedPostgresDeleted": false',
      '"objectStorageDeleted": false',
      '"managedPostgresDeletedAt": null',
      '"objectStorageDeletedAt": null',
      'chmod 600 "$TEARDOWN_EVIDENCE"',
      "update both deletion booleans to `true`",
      "UTC deletion timestamps",
      "cryptographically verifies the exact lockfile-pinned QM package tree",
      "hardened process-group timeouts",
    ],
    "H5 teardown evidence",
  );
  assert.ok(h5.indexOf("before the first H5 teardown dry-run or execute") < h5.indexOf("teardown.sh --dry-run"));

  requireAll(
    index,
    [
      "zero through fourteen scored outputs",
      "missing `scores.jsonl`",
      "non-passing manifest",
      "partial approved inventory",
      "only when the H2/H3 register is non-passing",
      "both deletion booleans begin `false`",
      "change to `true` only after",
    ],
    "early-stop evidence",
  );
  requireAll(
    limitations,
    ["Early-stop evidence limitation", "non-passing decision evidence", "Cryptographic QM verification", "timeouts"],
    "limitations",
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
      "`pass`, `fail`, or `not-run`",
      "complete fixed H2/H3 register",
      "any `fail` or `not-run` status",
      "overall manifest `pass: false`",
      "does not retain the granular H2/H3 statuses",
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
  assert.doesNotMatch(corpus, /\bnpm\s+exec\b|\bnpx\b/i);
  assert.doesNotMatch(
    corpus,
    /^\s*(?:\$\s*)?qm\s+(?:check|plan|sandbox|setup|secrets|up|doctor|conformance|status|down)\b/im,
  );
});
