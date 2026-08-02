import "./support/auto-fake-sprites.ts";

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAclStore } from "../src/acl/acl-store.ts";
import { createAuditLog } from "../src/audit/audit-log.ts";
import { createOrchestrator } from "../src/core/orchestrator.ts";
import { createDeployService } from "../src/deploy/deploy-service.ts";
import { createDeployStore } from "../src/deploy/deploy-store.ts";
import { createDockerDeployProvider } from "../src/deploy/docker-deploy-provider.ts";
import { createMemoryDurableByteStore } from "../src/files/durable-byte-store.ts";
import { createMemoryFileArtifactStore } from "../src/files/file-artifact-store.ts";
import { createMockHarness } from "../src/harness/mock-harness.ts";
import type { Harness } from "../src/harness/harness.ts";
import { createIdentityService } from "../src/identity/identity-service.ts";
import { createMemoryService } from "../src/memory/memory-service.ts";
import { createModelGateway } from "../src/model/model-gateway.ts";
import { createBudgetTracker } from "../src/ratelimit/budget.ts";
import { createRateLimiter } from "../src/ratelimit/rate-limiter.ts";
import { createMemoryConfigStore } from "../src/resolution/config-store.ts";
import { createResolutionService } from "../src/resolution/resolution-service.ts";
import type { Sandbox } from "../src/sandbox/sandbox.ts";
import { createMemorySessionStore } from "../src/sessions/memory-session-store.ts";
import { createLocalWorkspaceStore } from "../src/workspace/workspace-store.ts";

const PROBE = "STAGE_A_ZERO_BUDGET_DENIAL_PROBE";

function unreachableSandbox(): Sandbox {
  const unreachable = () => {
    throw new Error("zero-budget denial crossed the sandbox boundary");
  };
  return {
    profile: { backend: "unreachable", writablePersistence: "snapshot_to_workspace", processSessions: false },
    provision: unreachable as never,
    run: unreachable as never,
    readFile: unreachable as never,
    writeFile: unreachable as never,
    writeFileBytes: unreachable as never,
    readFileBytes: unreachable as never,
    listDir: unreachable as never,
    removeDir: unreachable as never,
    teardown: unreachable as never,
  };
}

test("zero org budget refuses the Stage A probe before the harness/provider boundary", async () => {
  const org = "default-org";
  const config = createMemoryConfigStore(org);
  const acl = createAclStore();
  const auditLog = createAuditLog();
  const workspace = createLocalWorkspaceStore(mkdtempSync(join(tmpdir(), "stage-a-budget-boundary-")));
  const baseHarness = createMockHarness();
  let harnessCalls = 0;
  const harness: Harness = {
    ...baseHarness,
    turns: {
      ...baseHarness.turns,
      runTurn: async (input) => {
        harnessCalls += 1;
        return baseHarness.turns.runTurn(input);
      },
    },
  };
  const deploy = createDeployService({
    deployStore: createDeployStore(),
    provider: createDockerDeployProvider(),
    deployDir: join(tmpdir(), "stage-a-budget-boundary-deploy"),
    auditLog,
    acl,
  });
  const orchestrator = createOrchestrator({
    identity: createIdentityService(),
    resolution: createResolutionService(org, config, acl),
    sessions: createMemorySessionStore(),
    workspace,
    files: createMemoryFileArtifactStore(createMemoryDurableByteStore()),
    sandbox: unreachableSandbox(),
    modelGateway: createModelGateway(),
    auditLog,
    rateLimiter: createRateLimiter({ maxPerWindow: 1000, windowMs: 60_000 }),
    budget: createBudgetTracker({ orgLimitUsd: 0, windowMs: 60_000 }),
    harness,
    memory: createMemoryService(workspace),
    deploy,
    acl,
  });

  const result = await orchestrator.handleTurn({
    surface: "test",
    actor: { id: "P1", type: "internal" },
    conversation: {
      kind: "dm",
      threadRef: "dm:P1:stage-a-zero-budget",
      audience: [{ id: "P1", type: "internal" }],
    },
    origin: { kind: "direct" },
    text: PROBE,
  });

  assert.deepEqual(result, {
    status: "refused",
    reason: "budget exceeded ($0.00 of $0); try again later",
  });
  assert.equal(harnessCalls, 0, "the zero-budget refusal must occur before any harness/provider call");
});
