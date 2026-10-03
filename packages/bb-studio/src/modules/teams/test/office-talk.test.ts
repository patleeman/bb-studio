import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import plugin from "../server";
import { setup } from "./bots-fixture";

it("creates one durable DM and normal profile thread across concurrent calls", async () => {
  const x = setup();
  x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) => makeThreadResponse({ id: threadId, projectId: x.a.projectId, status: "idle" }));
  await plugin(x.bb);
  try {
    expect(await x.harness.behavior.callRpc("office_direct", { botId: x.a.id })).toEqual({ conversationId: null, threadId: null });
    const [first, second] = await Promise.all([1,2].map(() => x.harness.behavior.callRpc("office_dm", { botId: x.a.id }))) as { conversationId: string; threadId: string }[];
    expect(second).toEqual(first);
    expect(x.store.byThread(first!.threadId)?.botId).toBe(x.a.id);
    expect(x.store.db.prepare("SELECT * FROM conversations").all()).toHaveLength(1);
    expect(x.store.db.prepare("SELECT * FROM bot_threads").all()).toHaveLength(1);
    expect(await x.harness.behavior.callRpc("office_direct", { botId: x.a.id })).toEqual(first);
    expect(await x.harness.behavior.callRpc("office_talk", {})).toMatchObject({ conversations: [{ id: first!.conversationId, projectId: x.a.projectId, memberBotIds: [x.a.id], isDirect: true }] });
    const spawns = x.harness.inspection.sdk.callsTo("threads.spawn");
    expect(spawns).toHaveLength(1);
    expect(spawns[0]![0]).toMatchObject({ visibility: "visible", permissionMode: "accept-edits" });
  } finally { await x.close(); }
});

it("creates hidden task work in its folder while preserving bot identity and trust", async () => {
  const x = setup();
  x.harness.inspection.sdk.stub("projects.get", async () => ({ id: "folder", sources: [{ isDefault: true, path: "/safe/Spaces/Work/Drafts", hostId: "folder-host" }] }) as never);
  await plugin(x.bb);
  try {
    const result = await x.harness.behavior.callRpc("newConversation", { id: x.a.id, projectId: "folder" }) as { threadId: string };
    expect(x.store.byThread(result.threadId)?.botId).toBe(x.a.id);
    expect(x.harness.inspection.sdk.callsTo("threads.spawn")[0]![0]).toMatchObject({
      projectId: "folder", visibility: "hidden", permissionMode: "accept-edits",
      environment: { type: "host", hostId: "folder-host", workspace: { type: "unmanaged", path: "/safe/Spaces/Work/Drafts" } },
    });
  } finally { await x.close(); }
});
