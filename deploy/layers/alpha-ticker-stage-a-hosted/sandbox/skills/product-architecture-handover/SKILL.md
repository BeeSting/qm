---
name: product-architecture-handover
description: Draft a synthetic architecture handover with bounded evidence and no operational changes.
requiredCapabilities:
  - alpha-packet
---

# Product Architecture Handover

Prepare a non-authoritative architecture handover for human review using only Stage A repository evidence.

## Input Boundary

- Describe only the synthetic Stage A pilot and committed public source.
- Use `alpha-packet` solely to demonstrate the local read-only interface.
- Do not invent missing data, services, controls, owners, environments, credentials, or production integrations.

## Evidence Procedure

1. Cite committed files and exact Git revisions supplied in the session.
2. Run an allowed `alpha-packet` command only when documenting its synthetic contract.
3. Preserve source paths, packet labels, known limitations, and unresolved gaps.
4. Separate observed behavior from proposed future architecture.

## Output Contract

Begin `NON-AUTHORITATIVE - SYNTHETIC - HUMAN REVIEW REQUIRED`, then use:

1. **Facts:** observed repository and packet behavior.
2. **Deterministic Calculations:** reproducible counts or hashes, if present.
3. **Inferences:** architectural interpretation and residual risks.
4. **Proposed Actions:** reviewable next steps with prerequisites.
5. **Missing Data:** unknown operational, security, or ownership details.

## Prohibited Actions

- You must not send, publish, deploy, or promote the handover as canonical documentation.
- You must not execute a deployment, write configuration, rotate credentials, or call an external service.
- You must not include a secret value, local environment value, or confidential system detail.

## Human Acceptance Checklist

- [ ] A human review verifies every file path, revision, and observed behavior.
- [ ] Current architecture and future proposals are clearly separated.
- [ ] Limitations, rollback, and missing data are visible.
- [ ] The handover contains no secret, live packet body, or production instruction.
