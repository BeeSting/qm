import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseSkillFrontmatter } from "../cli/src/sandbox-layer.ts";

const skillRoot = "deploy/layers/alpha-ticker-stage-a/sandbox/skills";
const workflows = [
  "daily-portfolio-briefing",
  "investment-question",
  "partner-meeting-preparation",
  "product-architecture-handover",
  "decision-memory-draft",
] as const;

for (const workflow of workflows) {
  test(`${workflow} is bounded, reviewable, and non-authoritative`, () => {
    const path = `${skillRoot}/${workflow}/SKILL.md`;
    const body = readFileSync(path, "utf8");
    const frontmatter = parseSkillFrontmatter(body, path);

    assert.equal(frontmatter.name, workflow);
    assert.deepEqual(frontmatter.requiredCapabilities, ["alpha-packet"]);
    assert.match(body, /## Input Boundary/);
    assert.match(body, /## Evidence Procedure/);
    assert.match(body, /## Output Contract/);
    assert.match(body, /## Prohibited Actions/);
    assert.match(body, /## Human Acceptance Checklist/);
    assert.match(body, /non-authoritative/i);
    assert.match(body, /human review/i);
    assert.match(body, /missing data/i);
    assert.match(body, /source|packet/i);
    assert.match(body, /must not send/i);
    assert.match(body, /must not execute/i);
    assert.match(body, /do not invent/i);
    assert.match(body, /Facts/);
    assert.match(body, /Deterministic Calculations/);
    assert.match(body, /Inferences/);
    assert.match(body, /Proposed Actions/);
  });
}
