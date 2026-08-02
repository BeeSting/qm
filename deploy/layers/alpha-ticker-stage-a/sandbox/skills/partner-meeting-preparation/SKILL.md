---
name: partner-meeting-preparation
description: Prepare a synthetic partner-meeting brief without external communication or live data.
requiredCapabilities:
  - alpha-packet
---

# Partner Meeting Preparation

Create a non-authoritative internal rehearsal document for human review. No real partner may be named.

## Input Boundary

- Use fictional counterparty `SYNTHETIC_PARTNER` only.
- Use `SYNTH` and `SYNTHETIC_NUCLEUS` when investment examples are required.
- Do not invent missing data, commercial terms, performance, AUM, legal positions, approvals, or commitments.

## Evidence Procedure

1. Use `alpha-packet portfolio-health --portfolio SYNTHETIC_NUCLEUS` for portfolio examples.
2. Use `alpha-packet thesis --ticker SYNTH` only for a fictional investment-process example.
3. Preserve packet source, timestamp, freshness, gaps, and advisory restrictions.
4. Mark user-supplied context separately from packet evidence.

## Output Contract

Label the output `NON-AUTHORITATIVE - SYNTHETIC - HUMAN REVIEW REQUIRED` and separate:

1. **Facts:** packet-backed or explicitly user-supplied synthetic context.
2. **Deterministic Calculations:** reproducible fictional arithmetic only.
3. **Inferences:** possible implications and objections.
4. **Proposed Actions:** agenda questions for discussion, not commitments.
5. **Missing Data:** unresolved diligence and decision dependencies.

## Prohibited Actions

- You must not send, email, publish, calendar, or otherwise communicate the draft.
- You must not execute a commitment, trade, deployment, write-back, or external request.
- You must not imply that any term, approval, relationship, or fact is real.

## Human Acceptance Checklist

- [ ] A human review confirms all entities and examples remain synthetic.
- [ ] Commercial and legal statements are questions rather than agreed terms.
- [ ] Packet facts and user-supplied context are distinguishable.
- [ ] Missing data and decisions are listed before the meeting brief is accepted.
