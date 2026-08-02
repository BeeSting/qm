# Alpha Ticker QM Hosted Stage A Evidence Index

Status: `not-run`

All generated evidence stays ignored under `.generated/alpha-ticker-stage-a-hosted/` with mode `0600`. Committed documents retain only pass/fail identifiers, dates, revisions, approved aggregates, and hashes. They never retain identities, credential values, prompts, responses, packet content, provider request content, or raw resource identifiers.

## Generated Inputs

| Path                                                             | Purpose                                                                                     | Retention                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `.generated/alpha-ticker-stage-a-hosted/activation.json`         | Exact non-secret H0 activation record                                                       | Hash in manifest                           |
| `.generated/alpha-ticker-stage-a-hosted/scores.jsonl`            | Fifteen minimized score records                                                             | Aggregate and hash only                    |
| `.generated/alpha-ticker-stage-a-hosted/live-checks.json`        | Check identifiers, status, timestamps, revisions, resource-name hashes, and aggregate spend | Aggregate and hash only                    |
| `.generated/alpha-ticker-stage-a-hosted/resource-inventory.json` | Exact private resource identifiers and H2 reconciliation lifecycle needed for teardown      | Hash only; delete after verified teardown  |
| `.generated/alpha-ticker-stage-a-hosted/teardown-evidence.json`  | Managed Postgres and Tigris deletion booleans and timestamps                                | Retain minimized status                    |
| `.generated/alpha-ticker-stage-a-hosted/evidence-manifest.json`  | Aggregate decision evidence                                                                 | Retain with independently verified SHA-256 |

The evidence manifest must state `contentCaptured: false` and remain mode `0600`.

## Live-Check Status Semantics

The private live-check input must contain the complete fixed H2/H3 register. Every entry has exactly one of these statuses: `pass`, `fail`, or `not-run`. Collection is fail-closed: any `fail` or `not-run` status makes the aggregate `live-checks` check fail and sets the overall manifest `pass: false`.

The retained aggregate manifest does not retain the granular H2/H3 statuses or check identifiers. It retains the input hash and aggregate result, preventing private operational detail from leaking into decision evidence while preserving a verifiable fail-closed outcome.

## Early-Stop Evidence

Evidence collection supports zero through fourteen scored outputs, including a missing `scores.jsonl` when no workflow completed. This path is valid only for a non-passing manifest backed by the complete fixed H2/H3 register with at least one `fail` or `not-run` status. A missing or partial ledger can never produce a passing decision.

A partial approved inventory is also accepted only when the H2/H3 register is non-passing. At H1, the validator's fixed-output external-only mode first proves every external value and both independent identity lists are present without exposing them. Pinned QM then runs once in an attached TTY to generate only its local cryptographic material. The full validator establishes the complete independent secret set, exact hexadecimal generation shape, and importable P-256 private JWK; the private `.env` must remain byte-identical across validation and `qm check`, and neither values nor identity lists enter evidence. Starting at H1, capture each successfully created approved resource immediately, before the next cloud mutation. The exact `h2ResourceReconciliation` lifecycle begins as `not-started`; the committed `reconcile-resources.mjs --begin` command changes it atomically to `unresolved` immediately before every H2/H3 `qm up`, and `--reconcile` changes it to `complete` only after exact Fly app, Managed Postgres, and Tigris provider reconciliation succeeds. Fly app ownership is validated from the provider's `Organization.Slug` field. Every previously captured approved Fly app must remain present with the same provider-supplied immutable ID; absence, replacement, or collision fails reconciliation. Fly apps and Managed Postgres retain provider-supplied immutable IDs. Because Fly's Tigris list surface exposes only `NAME` and `ORG`, object storage uses an explicit `identityKind: "name-bound"` and exact `deletionKey`; it must never be represented as though the bucket name were a separate immutable ID. Before H2, `null` data-resource fields under `not-started` mean no H2 deployment has been attempted. After an H2 attempt, `null` means provider-confirmed absent only under `complete`; under `unresolved`, nullability is ambiguous and final teardown success is refused. In a fresh shell after interruption, rerun `--reconcile` without another `qm up`, then proceed to controlled teardown. The reconciler updates only the ignored mode-`0600` resource inventory: no raw provider snapshot, manual reconciliation input, or editor-maintained reconciliation artifact is retained. A passing live register still requires the complete resource inventory with `h2ResourceReconciliation` set to `complete`.

The collector writes an auditable non-passing manifest before returning a nonzero process status. For a missing ledger, the evaluation-ledger artifact hash is `null` and the recorded sample size is zero; this is an explicit early-stop state, not missing evidence.

## Teardown Evidence Lifecycle

Before the first H5 teardown dry-run or execute, both deletion booleans begin `false` and both deletion timestamps are `null` in the ignored mode-`0600` teardown-evidence file. They change to `true` only after Managed Postgres and Tigris deletion are independently confirmed, at which point valid UTC deletion timestamps are recorded. The transition is one-way and never substitutes for the final absence checks.

## Hashed Artifacts

The manifest hashes these eight artifacts:

1. Activation record.
2. Hosted policy.
3. Hosted QM config.
4. Egress-proxy config.
5. Evaluation ledger.
6. Resource inventory.
7. Live checks.
8. Sandbox bundle.

Each artifact is represented by a SHA-256 value. Resource identifiers are never copied from the private inventory into the manifest.

## Acceptance Summary

A passing evaluation requires:

- 15 unique workflow-participant pairs across five workflows and three pseudonymous participants;
- all four required disclosures on all 15 outputs;
- at least 12 of 15 outputs accepted with `none` or `minor` edit burden;
- median usefulness and factual consistency of at least 4;
- median elapsed time no more than 90,000 ms;
- scored-output cost no more than US$45;
- zero incident categories other than `none`;
- every live isolation, egress, budget, revocation, durability, and teardown check passing.

The final decision must also use all-turn model spend, provider reconciliation, and Fly spend. The score ledger is not the sole budget control.

## Gate Register

| Gate | Status    | Permitted committed update                                              |
| ---- | --------- | ----------------------------------------------------------------------- |
| H0   | `not-run` | Date, commit, and pass/fail check identifiers                           |
| H1   | `not-run` | Immutable sandbox digest and check identifiers                          |
| H2   | `not-run` | Check identifiers and content-minimized hashes                          |
| H3   | `not-run` | Safety-drill check identifiers                                          |
| H4   | `not-run` | No raw evaluation content                                               |
| H5   | `not-run` | Manifest SHA-256, aggregate result, teardown status, and final decision |
