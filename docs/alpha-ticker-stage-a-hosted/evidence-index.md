# Alpha Ticker QM Hosted Stage A Evidence Index

Status: `not-run`

All generated evidence stays ignored under `.generated/alpha-ticker-stage-a-hosted/` with mode `0600`. Committed documents retain only pass/fail identifiers, dates, revisions, approved aggregates, and hashes. They never retain identities, credential values, prompts, responses, packet content, provider request content, or raw resource identifiers.

## Generated Inputs

| Path                                                             | Purpose                                                                                     | Retention                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `.generated/alpha-ticker-stage-a-hosted/activation.json`         | Exact non-secret H0 activation record                                                       | Hash in manifest                           |
| `.generated/alpha-ticker-stage-a-hosted/scores.jsonl`            | Fifteen minimized score records                                                             | Aggregate and hash only                    |
| `.generated/alpha-ticker-stage-a-hosted/live-checks.json`        | Check identifiers, status, timestamps, revisions, resource-name hashes, and aggregate spend | Aggregate and hash only                    |
| `.generated/alpha-ticker-stage-a-hosted/resource-inventory.json` | Exact private resource identifiers needed only for teardown                                 | Hash only; delete after verified teardown  |
| `.generated/alpha-ticker-stage-a-hosted/teardown-evidence.json`  | Managed Postgres and Tigris deletion booleans and timestamps                                | Retain minimized status                    |
| `.generated/alpha-ticker-stage-a-hosted/evidence-manifest.json`  | Aggregate decision evidence                                                                 | Retain with independently verified SHA-256 |

The evidence manifest must state `contentCaptured: false` and remain mode `0600`.

## Live-Check Status Semantics

The private live-check input must contain the complete fixed H2/H3 register. Every entry has exactly one of these statuses: `pass`, `fail`, or `not-run`. Collection is fail-closed: any `fail` or `not-run` status makes the aggregate `live-checks` check fail and sets the overall manifest `pass: false`.

The retained aggregate manifest does not retain the granular H2/H3 statuses or check identifiers. It retains the input hash and aggregate result, preventing private operational detail from leaking into decision evidence while preserving a verifiable fail-closed outcome.

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
