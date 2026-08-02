# QM Alpha Ticker Stage A Runbook

## Purpose

Operate and verify the disposable, local, public-synthetic QM pilot. This runbook does not authorize confidential information, live Alpha Packets, a model provider, external communication, or production integration.

## Fixed Boundary

- Repository: `/Users/nicklopper/Claude/QMAlphaTickerPilot`
- Deployment directory: `deploy/layers/alpha-ticker-stage-a`
- Organization: `alpha-ticker-stage-a`
- Target: Docker on loopback only
- Harness: `mock`
- Allowed tool: `alpha-packet`
- Allowed data: committed synthetic fixtures only
- Principals: three synthetic `.invalid` identities used by tests

## Prerequisites

1. Node.js `24.18.1` and npm `11.16.0` are first on `PATH`.
2. The Git branch descends from QM commit `7f2c916360f1797a8ff2a77ce2ce40c5fabab087`.
3. Docker is available only when a local build or teardown is being tested.
4. No `.env` file, provider key, production credential, or confidential fixture is present.

## Deterministic Verification

From the repository root:

```bash
npm run typecheck
npm run lint
npm run test:all
node --test test/alpha-ticker-stage-a-*.test.ts
node scripts/alpha-ticker-stage-a/check-boundary.mjs
```

From the deployment directory:

```bash
npm exec qm -- check
npm exec qm -- sandbox build --dry-run
npm exec qm -- plan
```

Stop if a command requests a provider secret, cloud resource, public URL, connector, or external mutation.

## Synthetic Packet Health

Run each supported command directly and confirm JSON output is marked `synthetic: true` and `advisoryOnly: true`:

```bash
sandbox/tools/alpha-packet/alpha-packet thesis --ticker SYNTH
sandbox/tools/alpha-packet/alpha-packet portfolio-health --portfolio SYNTHETIC_NUCLEUS
sandbox/tools/alpha-packet/alpha-packet alerts --portfolio SYNTHETIC_NUCLEUS
sandbox/tools/alpha-packet/alpha-packet signal-trace --ticker SYNTH
```

Do not retain packet bodies in the evidence pack.

## Principal-Isolation Evidence

Run:

```bash
node --test test/alpha-ticker-stage-a-scope-isolation.test.ts
```

Acceptance requires personal-scope isolation for all three principals, shared-room access for current members, and immediate denial after revocation.

## Evidence Collection

After the complete deterministic suite, provide the observed test and failure counts:

```bash
node scripts/alpha-ticker-stage-a/collect-evidence.mjs --tests <count> --failures 0
```

The generated manifest is ignored by Git, mode `0600`, and contains only hashes, counts, revisions, statuses, and a timestamp.

## Emergency Stop

Run:

```bash
scripts/alpha-ticker-stage-a/teardown.sh
```

If cleanup cannot be proven, stop all pilot work and report the failing resource class to Nic. Do not broaden the cleanup command or use a global Docker prune.

## Normal Stop and Cleanup Verification

1. Run the teardown script.
2. Run it a second time to prove idempotence.
3. Confirm no container with label `qm.org=alpha-ticker-stage-a` remains.
4. Confirm no `qm-alpha-ticker-stage-a` network remains.
5. Confirm no volume beginning `qm-alpha-ticker-stage-a-` remains.
6. Confirm the repository contains no `.env` or generated evidence artifact in Git status.

## Escalation

Any scope leakage, secret detection, non-loopback address, failed denial, unexplained skipped security test, unbounded spend path, or incomplete teardown is a no-go. Nic is the accountable sponsor for the synthetic Stage A decision.
