import assert from "node:assert/strict";
import { test } from "node:test";

import { createAclStore } from "../src/acl/acl-store.ts";
import { createApp, type App, type AppDeps } from "../src/api/app.ts";
import { createCronStore } from "../src/cron/cron-store.ts";
import { createMemoryDurableByteStore } from "../src/files/durable-byte-store.ts";
import { createMemoryFileArtifactStore } from "../src/files/file-artifact-store.ts";
import { createSkillStore } from "../src/skills/skill-store.ts";
import { scopeId } from "../src/types.ts";

const NIC = "nic.stage-a@alpha-ticker.invalid";
const THOMAS = "thomas.stage-a@alpha-ticker.invalid";
const LIEN = "lien.stage-a@alpha-ticker.invalid";
const PRINCIPALS = [NIC, THOMAS, LIEN] as const;
const ROOM = scopeId("channel", "alpha-ticker-stage-a-room");

async function setupStageA(): Promise<{
  app: App;
  revokeRoom: (principal: string) => void;
}> {
  const members = new Set<string>(PRINCIPALS);
  const skills = createSkillStore();

  for (const principal of PRINCIPALS) {
    await skills.create({
      scopeId: scopeId("personal", principal),
      manifest: {
        name: `private-${principal.split(".")[0]}`,
        description: "Synthetic personal Stage A artifact.",
        requiredCapabilities: [],
        body: "Synthetic personal artifact.",
      },
      createdBy: principal,
    });
  }

  await skills.create({
    scopeId: ROOM,
    manifest: {
      name: "shared-pilot-room",
      description: "Synthetic shared Stage A artifact.",
      requiredCapabilities: [],
      body: "Synthetic shared artifact.",
    },
    createdBy: NIC,
  });

  const roomId = "alpha-ticker-stage-a-room";
  const deps = {
    files: createMemoryFileArtifactStore(createMemoryDurableByteStore()),
    crons: createCronStore(),
    acl: createAclStore(),
    skills,
    identity: {
      classify: (id: string) => ({ id, type: "internal" }),
      isInternal: (principal: { type: string }) => principal.type === "internal",
    },
    directory: {
      listChannelsFor: async (principal: string) =>
        members.has(principal) ? [{ channelId: roomId, name: "stage-a-room", isPrivate: true }] : [],
      channelMember: async (channelId: string, principal: string) => channelId === roomId && members.has(principal),
      channelPrivacy: async (channelId: string): Promise<boolean | undefined> =>
        channelId === roomId ? true : undefined,
    },
    sessions: { listByParticipant: async () => [] },
    deploy: { listDeployments: async () => [] },
  };

  return {
    app: createApp(deps as unknown as AppDeps),
    revokeRoom: (principal: string) => {
      members.delete(principal);
    },
  };
}

test("three principals can read only their personal artifact and the shared room", async () => {
  const { app } = await setupStageA();

  for (const principal of PRINCIPALS) {
    const personal = await app.listScopeResources(principal, scopeId("personal", principal));
    assert.ok(personal);
    assert.deepEqual(
      personal.skills.map((skill) => skill.name),
      [`private-${principal.split(".")[0]}`],
    );

    const shared = await app.listScopeResources(principal, ROOM);
    assert.ok(shared);
    assert.deepEqual(
      shared.skills.map((skill) => skill.name),
      ["shared-pilot-room"],
    );

    for (const other of PRINCIPALS) {
      if (other === principal) continue;
      assert.equal(await app.listScopeResources(principal, scopeId("personal", other)), null);
    }
  }
});

test("shared-room access is lost immediately after revocation", async () => {
  const { app, revokeRoom } = await setupStageA();

  assert.ok(await app.listScopeResources(THOMAS, ROOM));
  revokeRoom(THOMAS);
  assert.equal(await app.listScopeResources(THOMAS, ROOM), null);
  assert.ok(await app.listScopeResources(NIC, ROOM));
  assert.ok(await app.listScopeResources(LIEN, ROOM));
});
