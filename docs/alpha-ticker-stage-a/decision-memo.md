# QM Alpha Ticker Stage A Decision Memo

- **Decision date:** 2026-08-02
- **Accountable sponsor:** Nic
- **Gate commit:** `be2d56f8531a75ef16a254d9f4054097a5741dd6`
- **Decision:** `no-go-current-local-deployment`
- **Implementation status:** Synthetic control package complete; hosted/model-backed runtime not authorized

## Executive Decision

Retain the tested Stage A implementation, but do not start a QM agent deployment. The synthetic packet reader, five workflow skills, principal-isolation tests, boundary scanner, evidence collector, and teardown controls are complete. A runnable QM Docker control plane still requires a published, digest-pinned Fly sandbox image. Publishing that image would be a cloud mutation outside the approved boundary, so the local deployment gate correctly remains closed.

This is a no-go for the current local-deployment assumption, not a rejection of the pilot architecture. A separately authorized hosted Stage A may reuse this branch after Nic approves the exact Fly app or registry, immutable image, provider/model route, numeric spend cap, retention terms, and revocation operator. Named reviewers are not a prerequisite under Nic's 2026-08-02 instruction.

## Measured Facts

### Reproducibility

- QM source is pinned to `7f2c916360f1797a8ff2a77ce2ce40c5fabab087`.
- Deployment package is pinned to `@yc-software/qm@0.1.4`.
- The actual upstream engine contract required upgrading the written plan from Node `24.14.0` and npm `10.9.8` to Node `24.18.1` and npm `11.16.0`.
- TypeScript typecheck passed.
- ESLint passed.

### Test Results

- Complete suite: 3,739 tests, 3,601 passed, 138 environment-gated skips, zero failures.
- Stage A-specific suite: 21/21 passed.
- Adjacent authorization suite: 28/28 passed.
- One full-suite run produced a load-sensitive upstream OpenCode timeout assertion. The isolated test passed 9/9 immediately, and the complete suite then passed on rerun. No upstream code was changed.

### Security and Boundary Results

- Three synthetic principals could read only their own personal artifact and the shared room.
- Revoked shared-room access was denied immediately.
- Real/unknown scopes, refresh, SQL, write, fetch, and argument-smuggling requests were denied.
- The only tool has no egress, auth block, or write-capable approval.
- Five workflow skills require synthetic labels, source traces, missing-data disclosure, human review, and non-authoritative output.
- Boundary canaries for secret-shaped values, restricted environment names, real portfolio labels, sensitive classifications, non-loopback URLs, and unsafe tools were detected.
- The committed deployment layer passed the boundary scan.
- No `.env`, provider key, production credential, confidential fixture, live packet, production host, connector, or cloud resource entered the pilot.

### Build, Planning, and Teardown

- `qm check` passed.
- `qm sandbox build --dry-run` passed and resolved base image `ghcr.io/yc-software/qm/sandbox-base@sha256:52cb44a6e9d166da20638c8ce55e3f423384f5557eba49915684cb8ed16e5873`.
- `qm plan` failed closed because `sandbox.app` had no published digest-pinned `sandbox.image`.
- No image was fabricated or published.
- The initial empty-state `qm down --purge` exposed an upstream idempotence defect when expected volumes did not exist. The wrapper was hardened test-first to preflight exact Stage A resources and verify exact-label cleanup.
- Actual teardown then passed twice consecutively with no matching resource remaining.

### Evidence and Cost

- Evidence manifest SHA-256: `fe5e18dc53563967de47ba234e92e1a7426b69613d527388be9c0875eeb3f201`.
- The manifest contains revisions, statuses, hashes, counts, and a timestamp only; `contentCaptured` is `false`.
- Provider tokens used: zero.
- Model cost: USD 0.
- Cloud cost created by the pilot: USD 0.

## Workflow Quality

The five workflow contracts are structurally complete and enforce the intended output disciplines. Semantic output quality, edit burden, latency, and time saved were not measured because no real model was authorized. The current evidence supports control design and interface readiness, not investment-output quality.

## Residual Risks

1. QM's Docker target is not a self-contained local agent runtime; it retains a hosted Fly sandbox dependency.
2. A provider-backed trial still needs an explicit route, budget, retention position, and kill mechanism.
3. Upstream security limitations in `SECURITY.md` remain applicable, including bypassable command policy, conditional egress enforcement, plaintext credentials in use, incomplete screening, and durable-data retention concerns.
4. The full-suite OpenCode timeout test showed one load-sensitive transient failure and should be watched in future upgrades.
5. No live Alpha Ticker gateway, production database, portfolio packet, or confidential workflow was tested.

## Re-entry Conditions

A hosted Stage A may be proposed only after Nic approves:

1. exact Fly app or private registry destination;
2. immutable published sandbox digest;
3. exact provider and model identifier;
4. dedicated provider project/account;
5. numeric spend cap and 75%, 90%, and 100% behavior;
6. provider retention and no-training position;
7. operator able to revoke the key and destroy the deployment;
8. explicit confirmation that fixtures remain synthetic.

These inputs authorize only hosted synthetic Stage A. They do not authorize confidential data, live Alpha Packets, direct database access, external communication, or production integration.
