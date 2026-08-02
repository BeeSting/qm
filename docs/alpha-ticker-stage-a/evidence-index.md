# Stage A Evidence Index

This index records content-minimized evidence only. It must not contain exact prompts, responses, packet bodies, provider requests, secret values, environment values, or confidential data.

| Evidence | Required result | Status |
|---|---|---|
| Upstream source pin | Exact reviewed commit is an ancestor | Verified |
| Runtime pin | Node `24.18.1`, npm `11.16.0` | Verified |
| Upstream typecheck | Zero errors | Verified |
| Upstream baseline tests | Zero failures | Verified |
| Synthetic policy test | Local, mock, connector-free | Verified |
| Alpha Packet CLI contract | Four read-only synthetic commands; negative requests denied | Verified |
| Workflow contracts | Five bounded, non-authoritative skills | Verified |
| Principal isolation | Three personal scopes isolated; revocation immediate | Verified |
| Adjacent authorization tests | Zero failures | Verified |
| Boundary scanner | Clean layer and successful canary detection | Verified |
| Evidence-schema tests | Forbidden content keys rejected | Verified |
| Teardown dry-run | Exact-org guard and idempotence | Verified |
| Complete deterministic gate | Full suite, dry-run build, plan, manifest | Pending |
| Actual teardown proof | No matching Docker resource remains | Pending |

## Generated Manifest

- Path: `.generated/alpha-ticker-stage-a/evidence-manifest.json`
- Git status: ignored
- File mode: `0600`
- Content captured: `false`
- SHA-256: recorded after the complete deterministic gate

## Decision

Pending completion of the deterministic gate and teardown proof.
