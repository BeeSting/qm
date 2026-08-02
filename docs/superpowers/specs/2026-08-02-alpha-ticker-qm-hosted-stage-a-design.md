# Alpha Ticker QM Hosted Stage A Design

**Status:** Proposed for sponsor review

**Date:** 2026-08-02

**Purpose:** Convert the completed provider-free Stage A control package into a short, model-backed, public-synthetic hosted evaluation without changing the production Ticker Alpha platform.

## 1. Executive Decision

Run QM as an isolated Fly.io pilot while retaining the existing Ticker Alpha stack on Vercel, Railway, and Supabase. The pilot will use an Alpha Ticker-owned model-provider project, not team members' personal LLM subscriptions. It will process only the committed synthetic fixtures and will not connect to Ticker Alpha production systems.

The hosted pilot is a new deployment, not an in-place conversion of the local Docker configuration. The accepted local evidence and `no-go-current-local-deployment` decision remain immutable historical records.

## 2. Selected Approach

### 2.1 Hosting

- Official QM target: Fly.io.
- New deployment directory: `deploy/layers/alpha-ticker-stage-a-hosted`.
- Public services: `portal`, `web-ui`, and the authentication callback only.
- Private services: `core`, `admin`, Managed Postgres, Tigris object storage, and per-scope sandbox Machines.
- Sandbox image: built from the pinned QM base, published once, and recorded by immutable digest.
- Region: choose the nearest Fly region available to the Alpha Ticker Fly organization during preflight. Stop rather than silently deploying to an unapproved region.

Fly is a specialist execution layer for QM. It does not replace or modify Vercel, Railway, Supabase, or any Ticker Alpha production deployment.

### 2.2 Model Route

- Provider: OpenAI through a dedicated Alpha Ticker API project.
- Harness: `pi`, because the pinned QM implementation records model cost for this harness and can enforce its database-backed budget controls.
- Primary model: `gpt-5.6-terra`, which the pinned QM registry exposes as a base model at half the listed input and output rates of `gpt-5.6-sol`.
- Model picker: restricted to the primary model for the evaluation.
- Automatic fallback: disabled. An unavailable or unauthorized model is a failed preflight, not permission to select another provider or model.

The dedicated API key is write-only, never committed, never printed, and removable independently of Alpha Ticker's existing provider credentials.

### 2.3 Identity

- Sign-in: QM's built-in email broker over an existing Alpha Ticker SMTP transport.
- Admission: exactly three sponsor-approved work-email addresses.
- Administrator: one of those addresses receives `org_admin`; the other two remain ordinary principals.
- Slack sign-in, Slack bot access, anonymous playground access, public links, and general-domain admission are disabled.

Authentication email is the only permitted external communication. The agent itself may not send email or messages.

## 3. Spend Controls

The US$50 amount is a maximum authorized model-spend exposure for the complete hosted evaluation, not a QM fee and not an infrastructure budget.

Configure the QM budget window to seven days so that the entire five-business-day evaluation falls inside one window:

```text
BUDGET_WINDOW_MS=604800000
BUDGET_USD_PER_WINDOW=20
ORG_BUDGET_USD_PER_WINDOW=45
```

Controls operate in layers:

1. **Per-person brake:** Each principal is denied new turns after recording US$20 in the evaluation window.
2. **QM organization brake:** New turns are denied after recorded organization spend reaches US$45.
3. **Provider buffer:** The dedicated provider project may expose no more than US$50 of authorized spend. The US$5 difference absorbs a final in-flight request because QM checks recorded spend before the next turn rather than reserving the estimated cost of the current turn.
4. **Operational thresholds:** At US$33.75 recorded spend, notify the sponsor. At US$40.50, pause non-essential runs and complete only the acceptance matrix. At US$45, no additional model turns are permitted.
5. **No auto-recharge:** Any provider mechanism that could raise the available balance or budget automatically must be disabled. If the provider cannot establish a reliable US$50 maximum exposure, activation remains a no-go.

Fly.io compute, Managed Postgres, object storage, and sandbox costs are tracked separately. Resource counts are fixed to the minimum required for three users, idle suspension remains enabled, and the deployment has a scheduled teardown date.

## 4. Data and Capability Boundary

### Allowed

- Five approved Stage A workflow skills.
- The read-only `alpha-packet` tool.
- Existing committed fixtures marked `synthetic: true` and `advisoryOnly: true`.
- Three named pilot identities and one explicitly created shared room.
- Provider requests necessary to generate model responses.
- Authentication email necessary to sign in.

### Prohibited

- Live Alpha Packets or production portfolio information.
- Ticker Alpha databases, APIs, repositories, email, Telegram, Slack bot, Google Drive, brokerage systems, or cloud consoles.
- Browser tools, arbitrary egress, publishing, public links, code deployment, database writes, trade execution, or external communication.
- Production credentials, personal provider subscriptions, customer information, partner information, investor information, or confidential documents.
- Any integration with Vercel, Railway, or Supabase.

The hosted boundary scanner must reject a deployment that contains a production hostname, restricted environment name, secret-shaped value, unsupported tool, or non-synthetic fixture.

## 5. Evaluation Protocol

### Duration and sample

- Deployment window: five consecutive business days within one seven-day budget window.
- Participants: three admitted team members.
- Minimum sample: 15 scored outputs, comprising one scored run of each of the five workflows by each participant.
- Repeats: permitted only to investigate a recorded failure or inconsistency and remain subject to the same budget.

### Scoring fields

Each output receives a content-minimized score record containing:

- workflow identifier;
- participant pseudonym;
- pass or fail for source trace, synthetic disclosure, missing-data disclosure, and human-review language;
- usefulness score from 1 to 5;
- factual-consistency score from 1 to 5 against the fixture;
- edit burden: none, minor, major, or rejected;
- elapsed response time;
- input tokens, output tokens, and recorded cost;
- model and deployment revision;
- incident or anomaly category, if any.

Prompts, responses, fixture bodies, credentials, and personal email addresses do not enter the evidence manifest.

### Acceptance thresholds

Hosted Stage A passes only when all of the following are true:

1. Zero identity-boundary, scope-revocation, secret, or data-class violations.
2. All 15 required outputs carry the four mandatory workflow disclosures.
3. At least 12 of 15 outputs are accepted with no more than minor edits.
4. Median usefulness and factual-consistency scores are each at least 4 out of 5.
5. No unsupported claim conflicts with its committed fixture.
6. Median response time is no more than 90 seconds.
7. The full required sample is completed within the US$45 QM organization brake.
8. Provider-key revocation stops model responses and does not affect any production provider project.
9. Shared-room revocation is enforced immediately in the hosted environment.
10. Teardown removes every owned Fly service, sandbox Machine, volume, database, and object store selected for destruction, while retaining only the minimized decision evidence.

Failure of any security or isolation threshold is an immediate no-go. Quality or cost threshold failures may support one revised synthetic pilot, but do not authorize live data.

## 6. Rollout Gates

### Gate H0: Preflight, no mutation

- Verify Fly organization access and billing ownership.
- Verify app-name and region availability.
- Confirm SMTP transport and the three allowlisted addresses without committing them.
- Create or identify the dedicated OpenAI project and prove that auto-recharge is disabled.
- Confirm the provider can enforce the US$50 maximum exposure.
- Run source pin, dependency pin, typecheck, lint, full tests, Stage A tests, boundary scan, `qm check`, sandbox dry-run, and `qm plan` against the proposed hosted directory.

Any failed item stops before cloud mutation.

### Gate H1: Immutable sandbox publication

- Create the dedicated Fly sandbox registry app.
- Publish the Stage A sandbox image once.
- Record and verify its immutable digest.
- Re-run the boundary scan against the exact published layer inputs.

No agent deployment is started at this gate.

### Gate H2: Controlled deployment

- Push write-only secrets.
- Deploy the minimum service set.
- Verify TLS, authentication allowlisting, admin separation, database durability, object-storage round trip, sandbox identity metadata, and idempotent redeployment.
- Verify that no connector, Slack bot, browser, public link, or production endpoint is available.

### Gate H3: Safety drills

- Prove personal-scope isolation across all three identities.
- Prove shared-room grant and immediate revocation.
- Prove provider-key revocation.
- Prove the QM budget denial path using a temporary test ceiling, then restore and independently verify the approved values.
- Prove exact-resource teardown in dry-run mode.

### Gate H4: Five-day evaluation

- Execute and score the 15-run minimum sample.
- Review spend after every scored run.
- Notify at 75 percent and restrict activity at 90 percent of the QM organization brake.
- Record incidents immediately and stop on any boundary failure.

### Gate H5: Teardown and decision

- Freeze new turns.
- Export the minimized evidence manifest and score summary.
- Revoke the provider key and SMTP credential grant.
- Destroy all pilot resources selected for destruction and verify absence independently.
- Issue one decision: stop, repeat synthetic Stage A with a bounded change, or design Stage B.

Stage B requires a separate design and explicit sponsor approval. Hosted Stage A never rolls into live-data access automatically.

## 7. Operational Ownership

Named reviewers are not an activation prerequisite. Before Gate H1, the sponsor records role assignments for:

- sponsor and final go/no-go authority;
- deployment and teardown operator;
- billing and provider-key revocation operator;
- incident-response operator.

One person may hold multiple roles. The record contains role ownership but does not require a review committee.

## 8. Alternatives Considered

### OpenRouter through `pi`

This offers provider flexibility and potentially simpler prepaid controls, but adds another processor and complicates retention and downstream-model diligence. It is the fallback only if direct OpenAI spend cannot be bounded adequately before mutation.

### Codex harness with OpenAI

This aligns closely with individual coding-agent use, but the pinned harness reports token counts with `costUsd: 0`. It therefore cannot be trusted as the primary enforcement path for the QM dollar budget in this pilot.

### Railway or Vercel hosting

Railway could host parts of the control plane and Vercel could host a custom frontend, but neither is an official QM cloud target in the pinned release. Building deployment and per-scope sandbox adapters would test custom infrastructure rather than QM's product value, so it is deferred until after a successful hosted evaluation.

## 9. Deliverables

The hosted Stage A work produces:

1. A separate Fly deployment directory with pinned configuration.
2. Tests for the hosted policy, spend values, service list, provider route, and prohibited capabilities.
3. A hosted operations runbook covering deployment, monitoring, incident response, revocation, and teardown.
4. A minimized evidence schema and scoring ledger.
5. Live conformance, identity-isolation, budget, revocation, durability, and teardown evidence.
6. A sponsor decision memo that does not overstate security or production readiness.

## 10. Non-Goals

- Production rollout.
- Personal LLM subscription billing.
- Live portfolio monitoring.
- Alpha Ticker database or API integration.
- Ticker Alpha UI embedding.
- Slack, Telegram, email-agent, GitHub, browser, or Google connectors.
- Model routing across multiple providers.
- Railway or Vercel migration.
- Automated actions, trades, deployments, or external messages.

