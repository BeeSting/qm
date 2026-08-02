---
name: daily-portfolio-briefing
description: Prepare a synthetic, source-traced portfolio briefing for human review.
requiredCapabilities:
  - alpha-packet
---

# Daily Portfolio Briefing

Produce a non-authoritative Stage A draft from synthetic packets only.

## Input Boundary

- Accept only portfolio `SYNTHETIC_NUCLEUS`.
- Treat every value as fictional and synthetic.
- Do not invent missing data, prices, positions, returns, benchmarks, dates, or risk metrics.

## Evidence Procedure

1. Run `alpha-packet portfolio-health --portfolio SYNTHETIC_NUCLEUS`.
2. Run `alpha-packet alerts --portfolio SYNTHETIC_NUCLEUS`.
3. Preserve packet timestamps, freshness labels, gaps, and source traces.
4. Stop and state the limitation when a required fact is absent.

## Output Contract

Label the draft `NON-AUTHORITATIVE - SYNTHETIC - HUMAN REVIEW REQUIRED` and separate:

1. **Facts:** statements present in the packets, with source trace.
2. **Deterministic Calculations:** arithmetic reproducible from stated synthetic inputs.
3. **Inferences:** interpretations with assumptions and uncertainty.
4. **Proposed Actions:** hypothetical review questions, never instructions.
5. **Missing Data:** every gap that prevents a conclusion.

## Prohibited Actions

- You must not send, publish, promote, or store the briefing as a canonical record.
- You must not execute a trade, refresh, database query, external request, or write-back.
- Never remove synthetic, advisory-only, stale, or gap labels.

## Human Acceptance Checklist

- [ ] A human review confirms every cited packet and timestamp.
- [ ] Facts, calculations, inferences, and proposed actions are visibly separated.
- [ ] Missing data and uncertainty are complete.
- [ ] No output is used for trading, client advice, or an external communication.
