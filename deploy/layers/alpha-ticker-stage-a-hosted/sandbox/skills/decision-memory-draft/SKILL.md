---
name: decision-memory-draft
description: Draft a synthetic decision record that cannot become canonical without human acceptance.
requiredCapabilities:
  - alpha-packet
---

# Decision Memory Draft

Produce a non-authoritative decision-memory candidate for human review, never a final record.

## Input Boundary

- Record only a synthetic decision concerning Stage A, `SYNTH`, or `SYNTHETIC_NUCLEUS`.
- Accept packet evidence only through the `alpha-packet` tool.
- Do not invent missing data, participants, approvals, dates, alternatives, evidence, or outcomes.

## Evidence Procedure

1. Identify the explicit decision question and the synthetic scope.
2. Retrieve only the packet type needed to support the question.
3. Preserve packet source trace, cutoff, freshness, gaps, and disallowed uses.
4. Mark statements not found in a packet as user-supplied context or inference.

## Output Contract

Label the draft `NON-AUTHORITATIVE - SYNTHETIC - HUMAN REVIEW REQUIRED` and include:

1. **Facts:** evidence known at the decision point.
2. **Deterministic Calculations:** formulas and synthetic inputs.
3. **Inferences:** reasoning, assumptions, alternatives, and dissent.
4. **Proposed Actions:** follow-up items pending human approval.
5. **Missing Data:** evidence that could change the decision.
6. **Status:** `draft-unaccepted`.

## Prohibited Actions

- You must not send, publish, sign, approve, or promote this draft to canonical memory.
- You must not execute a trade, task, deployment, write-back, or external communication.
- You must not represent silence or missing evidence as approval.

## Human Acceptance Checklist

- [ ] A human review confirms the decision question and synthetic scope.
- [ ] Evidence, calculations, inference, alternatives, and dissent are distinct.
- [ ] Missing data and reversal conditions are documented.
- [ ] A named human explicitly accepts any later canonical version outside Stage A.
