# Alpha Ticker QM Hosted Stage A Runbook

Status: repository-ready; cloud execution not authorized

## Operating Contract

This runbook governs a five-business-day, public-synthetic evaluation for three admitted participants. Tasks 1-9 are repository-only. Stop before Gate H0 unless the sponsor gives separate cloud-mutation approval. Architecture approval does not authorize provider setup, Fly mutation, secret transfer, or model use.

Fixed configuration:

- Fly organization: `personal`
- QM organization id: `alpha-ticker-stage-a-hosted`
- Region: `jnb`
- Provider: `openai`
- Model: `gpt-5.6-terra`
- Harness: `pi`
- Public origin: `https://alpha-ticker-stage-a-hosted-portal.fly.dev`
- Egress proxy: `https://alpha-ticker-stage-a-egress.fly.dev`
- Budget window: `BUDGET_WINDOW_MS=604800000`
- Per-person brake: `BUDGET_USD_PER_WINDOW=20`
- Organization brake: `ORG_BUDGET_USD_PER_WINDOW=45`
- Provider maximum authorized exposure: US$50, with auto-recharge disabled

The QM organization id is an application-level identifier. It is distinct from, and must never be substituted for, the Fly organization `personal`.

The US$50 provider control must deny additional spend; a dashboard notification alone is insufficient. Notify the sponsor at US$33.75. At US$40.50, allow only runs needed to complete missing required workflow-participant pairs. At US$45, stop every model turn.

No secret value or identity output may be printed. Do not record identities, email addresses, account identifiers, credentials, prompts, responses, fixture content, packet content, or provider request content in committed files or minimized evidence.

Vercel, Railway, Supabase, production data, personal LLM subscriptions, and connectors remain outside scope. The same applies to Slack, Telegram, GitHub, Google Drive, browser access, brokerage systems, publishing, public links, external actions, and production credentials.

## Fixed Resource Inventory

Only these Fly application names belong to this pilot:

- `alpha-ticker-stage-a-hosted-core`
- `alpha-ticker-stage-a-hosted-web-ui`
- `alpha-ticker-stage-a-hosted-admin`
- `alpha-ticker-stage-a-hosted-portal`
- `alpha-ticker-stage-a-hosted-auth`
- `alpha-ticker-stage-a-hosted-sandboxes`
- `alpha-ticker-stage-a-egress`

The separately managed data resources are:

- Managed Postgres: `alpha-ticker-stage-a-hosted-pg`
- Tigris object storage: `alpha-ticker-stage-a-hosted-data`

Never use wildcard selection, prefix-wide deletion, or broad cleanup commands.

## Repository-Only Readiness

These commands do not authorize or perform cloud mutation. Run from the repository root with the pinned Node and npm versions:

```bash
npm run typecheck
npm run lint
npm run test:all
node --test 'test/alpha-ticker-stage-a-hosted-*.test.ts'
node scripts/alpha-ticker-stage-a/check-boundary.mjs
node scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs
git diff --check
bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --dry-run
```

Static hosted QM verification must use only the lockfile-installed repository executable. There is no package-manager lookup or remote fallback:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOSTED_ROOT="$REPO_ROOT/deploy/layers/alpha-ticker-stage-a-hosted"
QM_BIN="$HOSTED_ROOT/node_modules/.bin/qm"
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
cd "$HOSTED_ROOT"
"$QM_BIN" check
"$QM_BIN" sandbox build --dry-run
"$QM_BIN" plan
```

Before H1, `check` and the sandbox dry-run must pass. `plan` must fail with the single known missing immutable sandbox-image pin. Any other result blocks H0.

## Live Commands

Everything in this section requires the gate-specific approval and operator prerequisites. Do not run it during repository-only readiness.

Every operational QM block below re-verifies the repository-local install immediately before use. The H0 preflight is required before the first Fly mutation; after H1 pins the sandbox image, use the install verifier rather than rerunning the H0 missing-pin expectation.

### Gate H0: Preflight And Control Setup

H0 may establish the dedicated, capped provider project and revocable pilot SMTP grant. It must not create Fly resources, upload deployment secrets, or make billable model calls.

At H0, leave `FLY_SANDBOX_API_TOKEN` unset. Before setup, use a secure local editor configured without swap, backup, history, or cloud synchronization to populate both `ADMIN_GRANTS` and `AUTH_ALLOWED_EMAILS` directly in the private `.env` before setup. Populate the remaining H0-available inputs there as well. The two identity lists are independent: setup is validation-only and must not derive one identity list from the other.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOSTED_ROOT="$REPO_ROOT/deploy/layers/alpha-ticker-stage-a-hosted"
QM_BIN="$HOSTED_ROOT/node_modules/.bin/qm"
umask 077
"${EDITOR:?set EDITOR to a secure local editor}" "$HOSTED_ROOT/.env"
test -f "$HOSTED_ROOT/.env"
test ! -L "$HOSTED_ROOT/.env"
chmod 600 "$HOSTED_ROOT/.env"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
cd "$HOSTED_ROOT"
"$QM_BIN" setup </dev/null >/dev/null 2>&1
chmod 600 "$HOSTED_ROOT/.env"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
cd "$REPO_ROOT"
node scripts/alpha-ticker-stage-a-hosted/activation-record.mjs \
  --input .generated/alpha-ticker-stage-a-hosted/activation.json
bash scripts/alpha-ticker-stage-a-hosted/preflight.sh
```

Identity output may never be retained in terminal capture, logs, evidence, shell history, or committed files. The suppressed setup command must validate the directly supplied values without printing, rewriting, or deriving either identity list; if the pinned command cannot do that, stop H0. The expected preflight final line is `hosted-preflight: pass`. A name collision, unavailable `jnb`, failed hard US$50 provider control, retention gap, runtime mismatch, dirty tracked tree, boundary failure, or unexpected QM plan result stops H0. Do not continue to H1 unless preflight passes.

### Gate H1: Egress And Immutable Sandbox

Create the exact egress application only after H0 passes. H1 uses progressive private inventory: immediately after each successful create and before the next cloud mutation, capture that resource's exact approved name and immutable identifier in `.generated/alpha-ticker-stage-a-hosted/resource-inventory.json`. Keep the partial inventory ignored and mode `0600` so an H1 stop can use the hardened teardown path.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOSTED_ROOT="$REPO_ROOT/deploy/layers/alpha-ticker-stage-a-hosted"
QM_BIN="$HOSTED_ROOT/node_modules/.bin/qm"
INVENTORY_PATH="$REPO_ROOT/.generated/alpha-ticker-stage-a-hosted/resource-inventory.json"
mkdir -p "$(dirname "$INVENTORY_PATH")"
chmod 700 "$(dirname "$INVENTORY_PATH")"
fly apps create alpha-ticker-stage-a-egress --org personal
```

Before importing or deploying anything else, use a secure local inventory path to record the egress app under `apps`. Set `flyOrg` to `personal` and leave `managedPostgres`, `objectStorage`, and `sandboxRegistry` as `null` until those resources actually exist. Never print the immutable identifier:

```bash
"${EDITOR:?set EDITOR to a secure local inventory editor}" "$INVENTORY_PATH"
chmod 600 "$INVENTORY_PATH"
git -C "$REPO_ROOT" check-ignore --quiet .generated/alpha-ticker-stage-a-hosted/resource-inventory.json
awk -F= '$1 == "CAPABILITY_SECRET" { print }' "$HOSTED_ROOT/.env" |
  fly secrets import -a alpha-ticker-stage-a-egress
fly deploy "$REPO_ROOT" \
  --app alpha-ticker-stage-a-egress \
  --config "$HOSTED_ROOT/egress-proxy.fly.toml" \
  --dockerfile "$REPO_ROOT/deploy/egress-proxy/Dockerfile" \
  --remote-only \
  --yes
node -- "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/probe-egress.mjs" \
  --proxy https://alpha-ticker-stage-a-egress.fly.dev \
  --env-file "$HOSTED_ROOT/.env" \
  --host example.com
fly apps create alpha-ticker-stage-a-hosted-sandboxes --org personal
```

Pause again before setup or publication. Append only the newly created sandbox app to the approved `apps` list, re-run the mode-`0600` and ignore checks, and leave `sandboxRegistry` null until publication returns its separate immutable registry identifier. After publication, capture that registry identifier before planning. A partial inventory may contain only resources confirmed to exist; it must never contain placeholders or expected-but-uncreated resources.

Run `"$QM_BIN" setup` a second time and add only the missing `FLY_SANDBOX_API_TOKEN`. Reassert mode and ignore protections, verify the pinned installation again, then publish and plan:

```bash
cd "$HOSTED_ROOT"
"${EDITOR:?set EDITOR to a secure local inventory editor}" "$INVENTORY_PATH"
chmod 600 "$INVENTORY_PATH"
git -C "$REPO_ROOT" check-ignore --quiet .generated/alpha-ticker-stage-a-hosted/resource-inventory.json
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
"$QM_BIN" setup
chmod 600 "$HOSTED_ROOT/.env"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
"$QM_BIN" check
"$QM_BIN" sandbox publish
"${EDITOR:?set EDITOR to a secure local inventory editor}" "$INVENTORY_PATH"
chmod 600 "$INVENTORY_PATH"
git -C "$REPO_ROOT" check-ignore --quiet .generated/alpha-ticker-stage-a-hosted/resource-inventory.json
"$QM_BIN" check
"$QM_BIN" plan
```

The egress probe must first complete its silent authenticated positive canary, then print only `unsigned-deny: pass` and `signed-unapproved-host-deny: pass`. The committed sandbox image must be digest-pinned. Any unexpected output or capability blocks H2.

### Gate H2: Controlled Deployment

Push secrets through the verified repository-local QM executable, review the plan, deploy the minimum service set, and run live checks:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOSTED_ROOT="$REPO_ROOT/deploy/layers/alpha-ticker-stage-a-hosted"
QM_BIN="$HOSTED_ROOT/node_modules/.bin/qm"
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
cd "$HOSTED_ROOT"
"$QM_BIN" secrets push
"$QM_BIN" plan
"$QM_BIN" up
"$QM_BIN" doctor
"$QM_BIN" check --live
"$QM_BIN" conformance
"$QM_BIN" up
"$QM_BIN" check --live
"$QM_BIN" status
```

The second deployment, live check, and status readback prove idempotency. Before the first participant turn, read back a durable organization sandbox allowlist containing exactly `alpha-ticker-stage-a-hosted-portal.fly.dev`. No external-data host is allowed. Confirm only `pi` and `gpt-5.6-terra` are selectable, connector providers are unconfigured, and browser, Slack, public-link, and publishing capabilities are absent.

### Gate H3: Safety Drills

Prove distinct personal scopes, shared-room revocation, proxy denial, the temporary zero-budget denial path, provider-key revocation isolation, persistence, and exact inventory ownership.

Inside an approved sandbox, run the exact negative-egress probe:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://example.com
```

Expected output is exactly `403`. Any successful external fetch or different result stops the pilot.

For the budget drill, freeze participant turns. The temporary brake is a one-field, reversible mutation of the tracked qconfig; do not use setup. **Pre-mutation boundary and policy checks** must pass while the committed value is `ORG_BUDGET_USD_PER_WINDOW=45`:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOSTED_ROOT="$REPO_ROOT/deploy/layers/alpha-ticker-stage-a-hosted"
QM_BIN="$HOSTED_ROOT/node_modules/.bin/qm"
QCONFIG="$HOSTED_ROOT/qm.config.jsonc"
DRILL_ROOT="$REPO_ROOT/.generated/alpha-ticker-stage-a-hosted"
mkdir -p "$DRILL_ROOT"
chmod 700 "$DRILL_ROOT"
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs"
node --test "$REPO_ROOT/test/alpha-ticker-stage-a-hosted-policy.test.ts" \
  "$REPO_ROOT/test/alpha-ticker-stage-a-hosted-boundary.test.ts"
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
```

Create a private byte-for-byte backup and pre-hash, install restoration traps, and replace exactly one hardcoded `"ORG_BUDGET_USD_PER_WINDOW": "45"` with `"ORG_BUDGET_USD_PER_WINDOW": "0"`. This is the temporary `ORG_BUDGET_USD_PER_WINDOW=0` deployment state. The mutation is atomic and prints no config content:

```bash
BUDGET_BACKUP="$(mktemp "$DRILL_ROOT/qconfig-budget.XXXXXX")"
chmod 600 "$BUDGET_BACKUP"
cp "$QCONFIG" "$BUDGET_BACKUP"
QCONFIG_PRE_SHA256="$(shasum -a 256 "$QCONFIG" | awk '{ print $1 }')"
export QCONFIG

restore_budget_config() {
  cp "$BUDGET_BACKUP" "$QCONFIG"
  cmp -s "$BUDGET_BACKUP" "$QCONFIG"
  test "$(shasum -a 256 "$QCONFIG" | awk '{ print $1 }')" = "$QCONFIG_PRE_SHA256"
}
abort_budget_drill() {
  restore_budget_config
  trap - EXIT HUP INT TERM
  exit 1
}
trap restore_budget_config EXIT
trap abort_budget_drill HUP INT TERM

node --input-type=module <<'NODE'
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const path = process.env.QCONFIG;
if (!path) throw new Error("missing qconfig path");
const source = readFileSync(path, "utf8");
const from = '"ORG_BUDGET_USD_PER_WINDOW": "45"';
const to = '"ORG_BUDGET_USD_PER_WINDOW": "0"';
const replacementCount = source.split(from).length - 1;
if (replacementCount !== 1 || source.includes(to)) throw new Error("budget mutation refused");
const updated = source.replace(from, to);
if (updated.includes(from) || updated.split(to).length - 1 !== 1) throw new Error("budget mutation invalid");
const temporary = `${path}.budget-drill.${process.pid}`;
writeFileSync(temporary, updated, { flag: "wx", mode: statSync(path).mode & 0o777 });
renameSync(temporary, path);
NODE

node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
cd "$HOSTED_ROOT"
"$QM_BIN" up --only core
```

The next synthetic turn must be denied before any provider request. Do not run another turn. Immediately restore the exact original bytes, prove the original hash and single `45` value, clear the traps, rerun policy checks, redeploy core, and revalidate:

```bash
restore_budget_config
trap - EXIT HUP INT TERM
node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const source = readFileSync(process.env.QCONFIG, "utf8");
const restored = '"ORG_BUDGET_USD_PER_WINDOW": "45"';
const temporary = '"ORG_BUDGET_USD_PER_WINDOW": "0"';
if (source.split(restored).length - 1 !== 1 || source.includes(temporary)) {
  throw new Error("budget restoration invalid");
}
NODE
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs"
node --test "$REPO_ROOT/test/alpha-ticker-stage-a-hosted-policy.test.ts" \
  "$REPO_ROOT/test/alpha-ticker-stage-a-hosted-boundary.test.ts"
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
cd "$HOSTED_ROOT"
"$QM_BIN" up --only core
"$QM_BIN" doctor
"$QM_BIN" check --live
"$QM_BIN" conformance
test -z "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)"
rm -- "$BUDGET_BACKUP"
```

Do not commit any budget-drill state. A failed restoration, hash comparison, policy test, deployment check, or clean tracked-worktree check stops the pilot.

For the provider-key drill, revoke only the dedicated pilot key and prove the next turn fails while unrelated projects remain unaffected, then replace the revoked key manually in the existing private `.env` using a secure local editor configured for in-place writes with no swap, backup, shell-history value, terminal output, or cloud synchronization. Provider-key replacement must not use `"$QM_BIN" setup`. Verify the file is the same regular inode, mode `0600`, and ignored before pushing:

```bash
ENV_PATH="$HOSTED_ROOT/.env"
test -f "$ENV_PATH"
test ! -L "$ENV_PATH"
chmod 600 "$ENV_PATH"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
ENV_DEVICE_INODE_BEFORE="$(stat -f '%d:%i' "$ENV_PATH")"
umask 077
"${EDITOR:?set EDITOR to a secure in-place local editor}" "$ENV_PATH"
test -f "$ENV_PATH"
test ! -L "$ENV_PATH"
test "$(stat -f '%d:%i' "$ENV_PATH")" = "$ENV_DEVICE_INODE_BEFORE"
test "$(stat -f '%Lp' "$ENV_PATH")" = "600"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
cd "$HOSTED_ROOT"
"$QM_BIN" secrets push
"$QM_BIN" up --only core
"$QM_BIN" doctor
"$QM_BIN" check --live
```

Require model recovery without widening scope. Verify the fixed teardown target list with:

```bash
bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --dry-run
```

H4 may begin only when every isolation, egress, budget, revocation, durability, and inventory check passes.

### Gate H4: Five-Day Evaluation

Record the UTC start timestamp in `.generated/alpha-ticker-stage-a-hosted/live-checks.json`. At activation, schedule H5 teardown for the end of the fifth consecutive business day and no later than 168 hours after that UTC start timestamp; use the earlier deadline if those limits differ.

The five approved workflow IDs are exactly:

1. `daily-portfolio-briefing`
2. `investment-question`
3. `partner-meeting-preparation`
4. `product-architecture-handover`
5. `decision-memory-draft`

Complete exactly one scored run of each workflow for each of `P1`, `P2`, and `P3`: 15 unique workflow-participant pairs. Append only minimized score records to the mode-`0600` ledger and evaluate after each score:

```bash
node scripts/alpha-ticker-stage-a-hosted/evaluation-ledger.mjs \
  --input .generated/alpha-ticker-stage-a-hosted/scores.jsonl
```

A pass requires all 15 disclosures, at least 12 of 15 accepted with no more than minor edits, median usefulness and factual consistency of at least 4, median elapsed time no more than 90,000 ms, total scored cost no more than US$45, and no incident. Apply spend controls to the greater of QM-recorded all-turn spend and reconciled provider usage, not only the score ledger.

Any identity, isolation, egress, secret, data-class, revocation, or scope failure stops the pilot immediately. Freeze new turns and proceed to H5 after the sample completes, the scheduled deadline arrives, or any stop condition occurs.

### Gate H5: Evidence, Revocation, Teardown, Decision

Generate the aggregate-only manifest before deleting state. Early-stop collection is supported with a missing ledger or any sample from 0 through 14 only when the complete H2/H3 register is non-passing; the collector writes a non-passing manifest and returns nonzero. Preserve that manifest rather than treating the nonzero status as a collection failure:

```bash
EVIDENCE_EXIT=0
node scripts/alpha-ticker-stage-a-hosted/collect-evidence.mjs || EVIDENCE_EXIT=$?
test -f .generated/alpha-ticker-stage-a-hosted/evidence-manifest.json
chmod 600 .generated/alpha-ticker-stage-a-hosted/evidence-manifest.json
```

Verify `contentCaptured: false`, calculate the manifest SHA-256 independently, and then revoke in this order:

1. Revoke the dedicated pilot OpenAI key.
2. Revoke the sandbox-scoped Fly token.
3. Revoke the pilot SMTP credential grant.
4. Freeze all remaining turns.
5. Destroy only the fixed resources.

Create the ignored mode-`0600` deletion-evidence file before the first H5 teardown dry-run or execute, with both deletion booleans `false` and both timestamps `null`. Its initial exact shape is:

```json
{
  "managedPostgresDeleted": false,
  "objectStorageDeleted": false,
  "managedPostgresDeletedAt": null,
  "objectStorageDeletedAt": null
}
```

Create it without overwriting prior evidence:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
TEARDOWN_EVIDENCE="$REPO_ROOT/.generated/alpha-ticker-stage-a-hosted/teardown-evidence.json"
export TEARDOWN_EVIDENCE
umask 077
node --input-type=module <<'NODE'
import { writeFileSync } from "node:fs";

const value = {
  managedPostgresDeleted: false,
  objectStorageDeleted: false,
  managedPostgresDeletedAt: null,
  objectStorageDeletedAt: null,
};
writeFileSync(process.env.TEARDOWN_EVIDENCE, `${JSON.stringify(value, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
NODE
chmod 600 "$TEARDOWN_EVIDENCE"
git -C "$REPO_ROOT" check-ignore --quiet .generated/alpha-ticker-stage-a-hosted/teardown-evidence.json
```

Plan and execute fixed-resource teardown with:

```bash
bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --dry-run
STAGE_A_DESTROY_CONFIRM=alpha-ticker-stage-a-hosted \
  bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --execute
```

Before any provider command, teardown cryptographically verifies the exact lockfile-pinned QM package tree, including the executable target. It runs QM and Fly subprocesses through hardened process-group timeouts. It then uses the verified repository-local QM binary for `down` and destroys each captured exact Fly app individually. The bounded status `manual-data-destruction-required` is expected while either separately managed data resource exists.

Use the ignored, mode-`0600` resource inventory in the sponsor-controlled Fly dashboard to delete Managed Postgres `alpha-ticker-stage-a-hosted-pg` and Tigris object storage `alpha-ticker-stage-a-hosted-data`. Only after both manual deletions are independently confirmed, update both deletion booleans to `true` and record UTC deletion timestamps:

```bash
node --input-type=module <<'NODE'
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const path = process.env.TEARDOWN_EVIDENCE;
const current = JSON.parse(readFileSync(path, "utf8"));
if (
  current.managedPostgresDeleted !== false ||
  current.objectStorageDeleted !== false ||
  current.managedPostgresDeletedAt !== null ||
  current.objectStorageDeletedAt !== null
) {
  throw new Error("teardown evidence transition refused");
}
const timestamp = new Date().toISOString();
const next = {
  managedPostgresDeleted: true,
  objectStorageDeleted: true,
  managedPostgresDeletedAt: timestamp,
  objectStorageDeletedAt: timestamp,
};
const temporary = `${path}.${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
  flag: "wx",
  mode: statSync(path).mode & 0o777,
});
renameSync(temporary, path);
NODE
chmod 600 "$TEARDOWN_EVIDENCE"
git -C "$REPO_ROOT" check-ignore --quiet .generated/alpha-ticker-stage-a-hosted/teardown-evidence.json
```

Re-run teardown, independently prove every exact resource and sandbox is absent, verify the retained manifest hash, and delete the raw inventory.

Complete the decision memo with exactly one permitted outcome: `stop`, `repeat-synthetic`, or `design-stage-b`. No outcome authorizes production access.

## Incident Stop Conditions

Stop new turns, preserve minimized evidence, revoke credentials, and move to controlled teardown after any of these events:

- identity admission, scope isolation, or shared-room revocation failure;
- secret, production-data, or prohibited-data exposure;
- successful unapproved Sprite egress or tokenless proxy access;
- unexpected browser, connector, Slack, publishing, public-link, deployment, database-write, brokerage, or external-action capability;
- budget denial failure, provider exposure above the approved maximum, or automatic recharge;
- missing or unowned resources, unexplained inventory, or inability to revoke the pilot provider key independently;
- evidence containing captured content, identities, credential material, or raw resource identifiers.

Do not diagnose by printing sensitive input. Record only the check identifier, pass/fail status, timestamp, revision, incident category, and approved aggregate measures.
