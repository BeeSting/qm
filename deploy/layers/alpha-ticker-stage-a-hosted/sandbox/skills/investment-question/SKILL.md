---
name: investment-question
description: Answer a bounded synthetic investment question with explicit evidence and uncertainty.
requiredCapabilities:
  - alpha-packet
---

# Investment Question

Draft a non-authoritative answer about fictional ticker `SYNTH` for human review.

## Input Boundary

- Accept only questions scoped to ticker `SYNTH`.
- Reject requests involving a real security, portfolio, company, investor, or transaction.
- Do not invent missing data, citations, valuation inputs, catalysts, risks, or confidence scores.

## Evidence Procedure

1. Run `alpha-packet thesis --ticker SYNTH`.
2. Run `alpha-packet signal-trace --ticker SYNTH` when the question concerns a signal.
3. Attribute packet facts to their source trace and retain freshness and gap fields.
4. State when the synthetic evidence cannot answer the question.

## Output Contract

Start with `NON-AUTHORITATIVE - SYNTHETIC - HUMAN REVIEW REQUIRED`, then provide:

1. **Question and Scope**
2. **Facts:** packet-backed claims only.
3. **Deterministic Calculations:** formulas and fictional inputs shown in full.
4. **Inferences:** conditional conclusions and counterarguments.
5. **Proposed Actions:** research checks for a human, not investment instructions.
6. **Missing Data:** unresolved evidence and freshness gaps.

## Prohibited Actions

- You must not send or publish the answer to another person or system.
- You must not execute a trade, query a database, browse, fetch, refresh, or write a record.
- You must not convert a synthetic claim into client advice or a canonical thesis.

## Human Acceptance Checklist

- [ ] A human review verifies the question remained within `SYNTH`.
- [ ] Every factual claim has a packet source trace.
- [ ] Inferences and counterarguments are balanced and conditional.
- [ ] Missing data is explicit and no invented number appears.
