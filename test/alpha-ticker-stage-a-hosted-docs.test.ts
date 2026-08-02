import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function fencedBlocks(text: string, language: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp("```" + language + "\\n([\\s\\S]*?)\\n```", "g");
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== undefined) blocks.push(match[1]);
  }
  return blocks;
}

function embeddedNodeBodies(text: string): string[] {
  const bodies: string[] = [];
  const pattern = /node --input-type=module <<'NODE'[^\n]*\n([\s\S]*?)\nNODE/g;
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== undefined) bodies.push(match[1]);
  }
  return bodies;
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
      'if ! "$QM_BIN" setup >/dev/null 2>&1; then',
      "stdin remains attached to the terminal",
      "no prompts or identity derivation are expected",
      "qm-setup-validation-failed",
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
      '"h2ResourceReconciliation": "not-started"',
      "teardown",
    ],
    "H1 progressive inventory",
  );

  assert.doesNotMatch(h0, /"\$QM_BIN" setup <\/dev\/null/);
  assert.equal(runbook.match(/^(?:if ! )?"\$QM_BIN" setup(?: >\/dev\/null 2>&1; then)?$/gm)?.length ?? 0, 2);
});

test("H2 reconciles exact private Fly identities after every qm up outcome", () => {
  const runbook = readDocument("runbook.md");
  const h2 = section(runbook, "### Gate H2", "### Gate H3");

  requireAll(
    h2,
    [
      "reconcile_hosted_apps()",
      'FLY_APPS_SNAPSHOT="$(mktemp',
      'chmod 600 "$FLY_APPS_SNAPSHOT"',
      'fly apps list --org personal --json >"$FLY_APPS_SNAPSHOT" 2>/dev/null',
      "JSON.parse",
      'entry.Organization !== "personal"',
      'typeof entry.ID !== "string"',
      'typeof entry.Name !== "string"',
      "duplicate Fly app identity refused",
      "unknown approved-name collision refused",
      "immutable Fly app ID mismatch refused",
      '"h2ResourceReconciliation"',
      'H2_ALLOWED_STATES="not-started,complete"',
      'H2_NEXT_STATE="unresolved"',
      'H2_NEXT_STATE="complete"',
      "mark_h2_resources_unresolved",
      'H2_DATA_RECONCILIATION="$RECONCILE_ROOT/h2-data-reconciliation.private.json"',
      "prepare_h2_data_reconciliation_input",
      "complete_h2_resource_reconciliation",
      "renameSync(temporary, inventoryPath)",
      "chmodSync(inventoryPath, 0o600)",
      'git -C "$REPO_ROOT" check-ignore --quiet .generated/alpha-ticker-stage-a-hosted/resource-inventory.json',
      'UP_STATUS=0\n"$QM_BIN" up || UP_STATUS=$?\nreconcile_hosted_apps',
      "qm-up-failed-after-inventory-reconciliation",
      "leave `h2ResourceReconciliation` as `unresolved`",
      "Managed Postgres",
      "Tigris",
      "before controlled teardown",
      "exact immutable identifier",
      '"$MPG_SNAPSHOT" "$TIGRIS_SNAPSHOT" "$H2_DATA_RECONCILIATION"',
    ],
    "H2 app reconciliation",
  );

  for (const app of [
    "alpha-ticker-stage-a-hosted-core",
    "alpha-ticker-stage-a-hosted-web-ui",
    "alpha-ticker-stage-a-hosted-admin",
    "alpha-ticker-stage-a-hosted-portal",
    "alpha-ticker-stage-a-hosted-auth",
    "alpha-ticker-stage-a-hosted-sandboxes",
    "alpha-ticker-stage-a-egress",
  ]) {
    assert.ok(h2.includes(`"${app}"`), `H2 reconciliation must pin ${app}`);
  }

  assert.equal(h2.match(/^"\$QM_BIN" up \|\| UP_STATUS=\$\?$/gm)?.length ?? 0, 2);
  assert.equal(h2.match(/^reconcile_hosted_apps$/gm)?.length ?? 0, 2);
  assert.equal(h2.match(/^mark_h2_resources_unresolved$/gm)?.length ?? 0, 2);
  assert.equal(h2.match(/^complete_h2_resource_reconciliation$/gm)?.length ?? 0, 2);
  assert.equal(h2.match(/^prepare_h2_data_reconciliation_input$/gm)?.length ?? 0, 2);
  assert.equal(h2.match(/^ {2}"\$MPG_SNAPSHOT" "\$TIGRIS_SNAPSHOT" "\$H2_DATA_RECONCILIATION"$/gm)?.length ?? 0, 2);
  assert.doesNotMatch(
    h2,
    /"\$MPG_SNAPSHOT" "\$TIGRIS_SNAPSHOT" "\$INVENTORY_PATH"/,
    "operator must not edit the lifecycle-bearing inventory directly",
  );
  const firstMark = h2.indexOf("mark_h2_resources_unresolved\n");
  const firstUp = h2.indexOf('"$QM_BIN" up || UP_STATUS=$?');
  const firstReconcile = h2.indexOf("reconcile_hosted_apps\n");
  const firstComplete = h2.indexOf("complete_h2_resource_reconciliation\n");
  assert.ok(firstMark >= 0 && firstMark < firstUp && firstUp < firstReconcile && firstReconcile < firstComplete);
  assert.doesNotMatch(h2, /fly apps list --org personal --json(?! >"\$FLY_APPS_SNAPSHOT" 2>\/dev\/null)/);
});

test("embedded H2 reconciler atomically preserves IDs and rejects an unknown-name ID collision", () => {
  const runbook = readDocument("runbook.md");
  const h2 = section(runbook, "### Gate H2", "### Gate H3");
  const [reconciler] = embeddedNodeBodies(h2);
  assert.ok(reconciler, "H2 must contain its embedded reconciler");

  const root = mkdtempSync(join(tmpdir(), "hosted-doc-reconcile-"));
  const snapshotPath = join(root, "fly-apps.json");
  const inventoryPath = join(root, "resource-inventory.json");
  const writePrivateJson = (path: string, value: unknown): void => {
    writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  };
  try {
    writePrivateJson(inventoryPath, {
      flyOrg: "personal",
      apps: [{ name: "alpha-ticker-stage-a-egress", id: "fixture-egress-id" }],
      managedPostgres: null,
      objectStorage: null,
      sandboxRegistry: null,
      h2ResourceReconciliation: "unresolved",
    });
    writePrivateJson(snapshotPath, [
      {
        ID: "fixture-egress-id",
        Name: "alpha-ticker-stage-a-egress",
        Organization: "personal",
      },
      {
        ID: "fixture-core-id",
        Name: "alpha-ticker-stage-a-hosted-core",
        Organization: "personal",
      },
      { ID: "fixture-unrelated-id", Name: "unrelated-personal-app", Organization: "personal" },
    ]);
    const success = spawnSync(process.execPath, ["--input-type=module"], {
      encoding: "utf8",
      env: { ...process.env, FLY_APPS_SNAPSHOT: snapshotPath, INVENTORY_PATH: inventoryPath },
      input: reconciler,
    });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stdout, "");
    assert.equal(statSync(inventoryPath).mode & 0o777, 0o600);
    const merged = JSON.parse(readFileSync(inventoryPath, "utf8"));
    assert.deepEqual(merged.apps, [
      { name: "alpha-ticker-stage-a-hosted-core", id: "fixture-core-id" },
      { name: "alpha-ticker-stage-a-egress", id: "fixture-egress-id" },
    ]);

    const beforeCollision = readFileSync(inventoryPath, "utf8");
    writePrivateJson(snapshotPath, [
      { ID: "fixture-core-id", Name: "unrelated-personal-app", Organization: "personal" },
    ]);
    const collision = spawnSync(process.execPath, ["--input-type=module"], {
      encoding: "utf8",
      env: { ...process.env, FLY_APPS_SNAPSHOT: snapshotPath, INVENTORY_PATH: inventoryPath },
      input: reconciler,
    });
    assert.notEqual(collision.status, 0);
    assert.match(collision.stderr, /unknown approved-name collision refused/);
    assert.equal(readFileSync(inventoryPath, "utf8"), beforeCollision);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
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
      "Run exactly one synthetic denial probe",
      "No further turn is permitted",
      "original 45 configuration is restored and redeployed",
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
  assert.ok(h3.indexOf("replacementCount !== 1") < h3.indexOf("Run exactly one synthetic denial probe"));
  assert.ok(h3.indexOf("Run exactly one synthetic denial probe") < h3.indexOf("restore the exact original bytes"));
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
      "partial H1/H2 inventory skips `qm down`",
      "directly destroys only the captured apps",
      "exact immutable ID and `personal` organization verification",
      "complete five-app QM-managed inventory",
      "verified `qm down` first",
      "An `unresolved` H2 resource lifecycle refuses final teardown success",
      "h2-resource-reconciliation-required",
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
      "`h2ResourceReconciliation`",
      "`not-started`",
      "`unresolved`",
      "`complete`",
    ],
    "early-stop evidence",
  );
  requireAll(
    limitations,
    [
      "Early-stop evidence limitation",
      "non-passing decision evidence",
      "Cryptographic QM verification",
      "timeouts",
      "H2 resource-reconciliation limitation",
      "unresolved",
      "refuses final teardown success",
    ],
    "limitations",
  );
});

test("runbook command fences and embedded Node programs are syntactically valid", () => {
  const runbook = readDocument("runbook.md");
  const fenceCount = runbook.match(/^```/gm)?.length ?? 0;
  assert.equal(fenceCount % 2, 0, "markdown code fences must be balanced");

  const bashBlocks = fencedBlocks(runbook, "bash");
  assert.ok(bashBlocks.length > 0, "runbook must contain Bash command blocks");
  for (const [index, body] of bashBlocks.entries()) {
    const result = spawnSync("bash", ["-n"], { encoding: "utf8", input: body });
    assert.equal(result.status, 0, `bash fence ${index + 1} must parse: ${result.stderr}`);
  }

  const nodeBodies = embeddedNodeBodies(runbook);
  assert.ok(nodeBodies.length > 0, "runbook must contain embedded Node programs");
  for (const [index, body] of nodeBodies.entries()) {
    const result = spawnSync(process.execPath, ["--input-type=module", "--check"], {
      encoding: "utf8",
      input: body,
    });
    assert.equal(result.status, 0, `embedded Node program ${index + 1} must parse: ${result.stderr}`);
  }
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
  assert.doesNotMatch(corpus, /"\$QM_BIN" setup <\/dev\/null/);
  assert.doesNotMatch(
    corpus,
    /^\s*(?:\$\s*)?qm\s+(?:check|plan|sandbox|setup|secrets|up|doctor|conformance|status|down)\b/im,
  );
});
