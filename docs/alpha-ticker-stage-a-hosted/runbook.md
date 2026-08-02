# Alpha Ticker QM Hosted Stage A Runbook

Status: repository-ready; cloud execution not authorized

## Operating Contract

This runbook governs a five-business-day, public-synthetic evaluation for three admitted participants. Tasks 1-9 are repository-only. Stop before Gate H0 unless the sponsor gives separate cloud-mutation approval. Architecture approval does not authorize provider setup, Fly mutation, secret transfer, or model use.

Fixed configuration:

- Fly organization: `personal`
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

Static hosted QM verification uses the lockfile-installed binary and disables npm package acquisition:

```bash
cd deploy/layers/alpha-ticker-stage-a-hosted
npm exec --no -- qm check
npm exec --no -- qm sandbox build --dry-run
npm exec --no -- qm plan
cd ../../..
```

Before H1, `check` and the sandbox dry-run must pass. `plan` must fail with the single known missing immutable sandbox-image pin. Any other result blocks H0.

## Live Commands

Everything in this section requires the gate-specific approval and operator prerequisites. Do not run it during repository-only readiness.

### Gate H0: Preflight And Control Setup

H0 may establish the dedicated, capped provider project and revocable pilot SMTP grant. It must not create Fly resources, upload deployment secrets, or make billable model calls.

After the non-secret activation record and local mode-`0600` ignored `.env` are prepared without exposing their contents, run:

```bash
node scripts/alpha-ticker-stage-a-hosted/activation-record.mjs \
  --input .generated/alpha-ticker-stage-a-hosted/activation.json
bash scripts/alpha-ticker-stage-a-hosted/preflight.sh
```

The expected final line is `hosted-preflight: pass`. A name collision, unavailable `jnb`, failed hard US$50 provider control, retention gap, runtime mismatch, dirty tracked tree, boundary failure, or unexpected QM plan result stops H0.

### Gate H1: Egress And Immutable Sandbox

Create the exact egress and sandbox-registry applications only after H0 passes:

```bash
fly apps create alpha-ticker-stage-a-egress --org personal
fly deploy . \
  --app alpha-ticker-stage-a-egress \
  --config deploy/layers/alpha-ticker-stage-a-hosted/egress-proxy.fly.toml \
  --dockerfile deploy/egress-proxy/Dockerfile \
  --remote-only \
  --yes
node -- scripts/alpha-ticker-stage-a-hosted/probe-egress.mjs \
  --proxy https://alpha-ticker-stage-a-egress.fly.dev \
  --env-file deploy/layers/alpha-ticker-stage-a-hosted/.env \
  --host example.com
fly apps create alpha-ticker-stage-a-hosted-sandboxes --org personal
cd deploy/layers/alpha-ticker-stage-a-hosted
npm exec --no -- qm check
npm exec --no -- qm sandbox publish
npm exec --no -- qm check
npm exec --no -- qm plan
cd ../../..
```

Transfer the capability credential by a write-only operator path before proxy deployment; never echo it or place it in argv. The egress probe must first complete its silent authenticated positive canary, then print only `unsigned-deny: pass` and `signed-unapproved-host-deny: pass`. The committed sandbox image must be digest-pinned.

### Gate H2: Controlled Deployment

Push secrets through the pinned local QM package, review the plan, deploy the minimum service set, and run live checks:

```bash
cd deploy/layers/alpha-ticker-stage-a-hosted
npm exec --no -- qm secrets push
npm exec --no -- qm plan
npm exec --no -- qm up
npm exec --no -- qm doctor
npm exec --no -- qm check --live
npm exec --no -- qm conformance
npm exec --no -- qm up
npm exec --no -- qm check --live
npm exec --no -- qm status
cd ../../..
```

Before the first participant turn, read back a durable organization sandbox allowlist containing exactly `alpha-ticker-stage-a-hosted-portal.fly.dev`. No external-data host is allowed. Confirm only `pi` and `gpt-5.6-terra` are selectable, connector providers are unconfigured, and browser, Slack, public-link, and publishing capabilities are absent.

### Gate H3: Safety Drills

Prove distinct personal scopes, shared-room revocation, proxy denial, the temporary zero-budget denial path, provider-key revocation isolation, persistence, and exact inventory ownership. Restore the organization brake to `45` immediately after the budget drill. Verify the teardown target list with:

```bash
bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --dry-run
```

H4 may begin only when every isolation, egress, budget, revocation, durability, and inventory check passes.

### Gate H4: Five-Day Evaluation

Complete exactly one scored run of each of the five approved workflows for each of `P1`, `P2`, and `P3`: 15 unique workflow-participant pairs. Append only minimized score records to the mode-`0600` ledger and evaluate after each score:

```bash
node scripts/alpha-ticker-stage-a-hosted/evaluation-ledger.mjs \
  --input .generated/alpha-ticker-stage-a-hosted/scores.jsonl
```

A pass requires all 15 disclosures, at least 12 of 15 accepted with no more than minor edits, median usefulness and factual consistency of at least 4, median elapsed time no more than 90,000 ms, total scored cost no more than US$45, and no incident. Apply spend controls to the greater of QM-recorded all-turn spend and reconciled provider usage, not only the score ledger.

Any identity, isolation, egress, secret, data-class, revocation, or scope failure stops the pilot immediately. Freeze new turns and proceed to H5 after the sample completes or any stop condition occurs.

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
