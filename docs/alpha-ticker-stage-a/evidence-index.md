# Stage A Evidence Index

This index records content-minimized evidence only. It must not contain exact prompts, responses, packet bodies, provider requests, secret values, environment values, or confidential data.

| Evidence                     | Required result                                                          | Status              |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------- |
| Upstream source pin          | Exact reviewed commit is an ancestor                                     | Verified            |
| Runtime pin                  | Node `24.18.1`, npm `11.16.0`                                            | Verified            |
| Upstream typecheck           | Zero errors                                                              | Verified            |
| Upstream baseline tests      | Zero failures                                                            | Verified            |
| Synthetic policy test        | Local, mock, connector-free                                              | Verified            |
| Alpha Packet CLI contract    | Four read-only synthetic commands; negative requests denied              | Verified            |
| Workflow contracts           | Five bounded, non-authoritative skills                                   | Verified            |
| Principal isolation          | Three personal scopes isolated; revocation immediate                     | Verified            |
| Adjacent authorization tests | Zero failures                                                            | Verified            |
| Boundary scanner             | Clean layer and successful canary detection                              | Verified            |
| Evidence-schema tests        | Forbidden content keys rejected                                          | Verified            |
| Teardown dry-run             | Exact-org guard and idempotence                                          | Verified            |
| Complete deterministic gate  | Tests and dry-run build pass; plan fails closed without hosted image pin | Blocked as designed |
| Actual teardown proof        | No matching Docker resource remains; repeated twice                      | Verified            |

## Generated Manifest

- Path: `.generated/alpha-ticker-stage-a/evidence-manifest.json`
- Git status: ignored
- File mode: `0600`
- Content captured: `false`
- SHA-256: `fe5e18dc53563967de47ba234e92e1a7426b69613d527388be9c0875eeb3f201`

## Test Counts

- Complete suite: 3,739 total; 3,601 passed; 138 environment-gated skips; zero failures on the accepted rerun.
- Stage A-specific suite: 21/21 passed.
- Adjacent authorization suite: 28/28 passed.
- One load-sensitive upstream OpenCode timeout assertion failed on an earlier full-suite run; its isolated suite passed 9/9 and the complete rerun passed.

## Sandbox Dry Run

- Base image: `ghcr.io/yc-software/qm/sandbox-base@sha256:52cb44a6e9d166da20638c8ce55e3f423384f5557eba49915684cb8ed16e5873`
- Tool copied: `alpha-packet`
- Mutation performed: none
- `qm plan`: refused because no published digest-pinned custom sandbox image exists

## Decision

`no-go-current-local-deployment`. The synthetic control package is retained, but no hosted or model-backed deployment is authorized.
