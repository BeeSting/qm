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

At H0, leave `FLY_SANDBOX_API_TOKEN` unset. Supply every other H0 input through the interactive local setup without exposing values, then enforce the local-file controls:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOSTED_ROOT="$REPO_ROOT/deploy/layers/alpha-ticker-stage-a-hosted"
QM_BIN="$HOSTED_ROOT/node_modules/.bin/qm"
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
cd "$HOSTED_ROOT"
"$QM_BIN" setup
chmod 600 "$HOSTED_ROOT/.env"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
cd "$REPO_ROOT"
node scripts/alpha-ticker-stage-a-hosted/activation-record.mjs \
  --input .generated/alpha-ticker-stage-a-hosted/activation.json
bash scripts/alpha-ticker-stage-a-hosted/preflight.sh
```

The expected final line is `hosted-preflight: pass`. A name collision, unavailable `jnb`, failed hard US$50 provider control, retention gap, runtime mismatch, dirty tracked tree, boundary failure, or unexpected QM plan result stops H0. Do not continue to H1 unless preflight passes.

### Gate H1: Egress And Immutable Sandbox

Create the exact egress application only after H0 passes. Import the capability secret through a write-only pipe before deployment; never echo it, place it in argv, or persist it outside the ignored mode-`0600` input:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOSTED_ROOT="$REPO_ROOT/deploy/layers/alpha-ticker-stage-a-hosted"
QM_BIN="$HOSTED_ROOT/node_modules/.bin/qm"
fly apps create alpha-ticker-stage-a-egress --org personal
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

Run `"$QM_BIN" setup` a second time and add only the missing `FLY_SANDBOX_API_TOKEN`. Reassert mode and ignore protections, verify the pinned installation again, then publish and plan:

```bash
cd "$HOSTED_ROOT"
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
"$QM_BIN" setup
chmod 600 "$HOSTED_ROOT/.env"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
"$QM_BIN" check
"$QM_BIN" sandbox publish
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

For the budget drill, freeze participant turns, set `ORG_BUDGET_USD_PER_WINDOW=0` through the approved local setup path, and deploy only core through the verified local executable:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOSTED_ROOT="$REPO_ROOT/deploy/layers/alpha-ticker-stage-a-hosted"
QM_BIN="$HOSTED_ROOT/node_modules/.bin/qm"
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
cd "$HOSTED_ROOT"
"$QM_BIN" setup
chmod 600 "$HOSTED_ROOT/.env"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
"$QM_BIN" up --only core
```

The next synthetic turn must be denied before any provider request. Restore `ORG_BUDGET_USD_PER_WINDOW=45` immediately through the same approved local path, verify the install again, deploy core, and revalidate:

```bash
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
"$QM_BIN" setup
chmod 600 "$HOSTED_ROOT/.env"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
"$QM_BIN" up --only core
"$QM_BIN" doctor
"$QM_BIN" check --live
"$QM_BIN" conformance
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs"
node --test "$REPO_ROOT/test/alpha-ticker-stage-a-hosted-policy.test.ts" \
  "$REPO_ROOT/test/alpha-ticker-stage-a-hosted-boundary.test.ts"
```

Never commit the temporary zero-budget setting. For the provider-key drill, revoke only the dedicated pilot key and prove the next turn fails while unrelated projects remain unaffected. Then replace the revoked key in the same dedicated provider project through the approved write-only setup path and recover with:

```bash
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
"$QM_BIN" setup
chmod 600 "$HOSTED_ROOT/.env"
git -C "$REPO_ROOT" check-ignore --quiet deploy/layers/alpha-ticker-stage-a-hosted/.env
node "$REPO_ROOT/scripts/alpha-ticker-stage-a-hosted/activation-record.mjs" \
  --verify-qm-install --root "$HOSTED_ROOT"
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

Generate the aggregate-only manifest before deleting state:

```bash
node scripts/alpha-ticker-stage-a-hosted/collect-evidence.mjs
chmod 600 .generated/alpha-ticker-stage-a-hosted/evidence-manifest.json
```

Verify `contentCaptured: false`, calculate the manifest SHA-256 independently, and then revoke in this order:

1. Revoke the dedicated pilot OpenAI key.
2. Revoke the sandbox-scoped Fly token.
3. Revoke the pilot SMTP credential grant.
4. Freeze all remaining turns.
5. Destroy only the fixed resources.

Plan and execute fixed-resource teardown with:

```bash
bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --dry-run
STAGE_A_DESTROY_CONFIRM=alpha-ticker-stage-a-hosted \
  bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --execute
```

The teardown uses the verified repository-local QM binary for `down`, then destroys each exact Fly app individually. The bounded status `manual-data-destruction-required` is expected while either separately managed data resource exists.

Use the ignored, mode-`0600` resource inventory in the sponsor-controlled Fly dashboard to delete Managed Postgres `alpha-ticker-stage-a-hosted-pg` and Tigris object storage `alpha-ticker-stage-a-hosted-data`. Record only deletion booleans and timestamps in `.generated/alpha-ticker-stage-a-hosted/teardown-evidence.json`. Re-run teardown, independently prove every exact resource and sandbox is absent, verify the retained manifest hash, and delete the raw inventory.

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
