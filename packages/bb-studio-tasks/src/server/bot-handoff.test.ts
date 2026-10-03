import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import plugin from "../../server";

async function setup() {
  let nextThread = 0;
  const archived = new Set<string>();
  const host = createFakePluginHost({
    pluginId: "studio-tasks",
    sdk: {
      plugins: {
        callRpc: async ({ pluginId, method }) => {
          if (pluginId === "bot-teams" && method === "newConversation") return { threadId: `thr_bot_${++nextThread}` } as never;
          if (pluginId === "bot-teams" && method === "threadProfile") return { botId: "bot_one" } as never;
          throw new Error("Optional Studio service unavailable");
        },
      },
      threads: {
        get: async ({ threadId }) => makeThreadResponse({ id: threadId, status: "idle", archivedAt: archived.has(threadId) ? 1 : null }),
        send: async () => ({} as never),
        interactions: { list: async () => [] },
      },
    },
  });
  await plugin(host.bb);
  const create = async () => {
    const result = await host.harness.behavior.callRpc("create", { title: "Review the launch", projectId: "proj_test", assignee: "bot:bot_one" }) as { task: { id: string } };
    return result.task.id;
  };
  const hand = (id: string) => host.harness.behavior.callRpc("handOffBot", { id, note: null }) as Promise<{ threadId: string }>;
  const get = (id: string) => host.harness.behavior.callRpc("get", { id }) as Promise<{ task: { status: string }; handoffs: { threadId: string; state: string; note: string | null }[] }>;
  return { ...host, create, hand, get, archived };
}

it("follows bot work through reply, agent readiness and review feedback", async () => {
  const { harness, create, hand, get } = await setup();
  try {
    const id = await create();
    const { threadId } = await hand(id);
    expect(await get(id)).toMatchObject({ task: { status: "in_progress" }, handoffs: [{ threadId, state: "starting" }] });
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: threadId, status: "active" }) });
    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: threadId }), lastAssistantText: "Draft ready" });
    expect(await get(id)).toMatchObject({ task: { status: "review" }, handoffs: [{ state: "replied", note: "Draft ready" }] });
    await harness.behavior.callAgentTool("tasks_update", { status: "review", note: "Checked the launch" }, { threadId });
    expect(await get(id)).toMatchObject({ handoffs: [{ state: "ready", note: "Checked the launch" }] });
    expect(await harness.behavior.callRpc("sendBack", { id, message: "Check the dates too" })).toEqual({ threadId });
    expect(await get(id)).toMatchObject({ task: { status: "in_progress" } });
    const sent = harness.inspection.sdk.callsTo("threads.send");
    expect(JSON.stringify(sent)).toContain("When the work is ready for review");
    expect(JSON.stringify(sent)).toContain("Check the dates too");
  } finally { await harness.lifecycle.dispose(); }
});

it("reuses its latest bot handoff without duplicating it, but never steals another task's thread", async () => {
  const { harness, create, hand, get } = await setup();
  try {
    const first = await create();
    const { threadId } = await hand(first);
    expect(await hand(first)).toEqual({ threadId });
    expect((await get(first)).handoffs).toHaveLength(1);
    const second = await create();
    await harness.behavior.callRpc("link", { id: second, link: { target: "thread", pluginId: null, itemId: threadId, label: "Bot work: Imported link", href: `/threads/${threadId}` } });
    const other = await hand(second);
    expect(other.threadId).not.toBe(threadId);
    expect((await get(first)).handoffs[0]?.threadId).toBe(threadId);
    expect((await get(second)).handoffs[0]?.threadId).toBe(other.threadId);
  } finally { await harness.lifecycle.dispose(); }
});

it("starts a new bot thread after its previous one is archived", async () => {
  const { harness, create, hand, get, archived } = await setup();
  try {
    const id = await create();
    const first = await hand(id);
    archived.add(first.threadId);
    const next = await hand(id);
    expect(next.threadId).not.toBe(first.threadId);
    expect((await get(id)).handoffs[0]?.threadId).toBe(next.threadId);
  } finally { await harness.lifecycle.dispose(); }
});

it("reuses its bot handoff after the conversation link gets a human title", async () => {
  const { harness, create, hand, get } = await setup();
  try {
    const id = await create();
    const { threadId } = await hand(id);
    await harness.behavior.callRpc("link", { id, link: { target: "thread", pluginId: null, itemId: threadId, label: "Reviewed the launch", href: `/threads/${threadId}` } });
    expect(await hand(id)).toEqual({ threadId });
    expect((await get(id)).handoffs).toHaveLength(1);
    expect(harness.inspection.sdk.callsTo("plugins.callRpc").filter(args => (args[0] as { method: string }).method === "newConversation")).toHaveLength(1);
  } finally { await harness.lifecycle.dispose(); }
});

it("shows send failures in the recorded handoff", async () => {
  const { harness, create, hand, get } = await setup();
  try {
    harness.inspection.sdk.stub("threads.send", async () => { throw new Error("Bot unavailable"); });
    const id = await create();
    await expect(hand(id)).rejects.toThrow("Bot unavailable");
    expect(await get(id)).toMatchObject({ handoffs: [{ state: "failed", note: "Bot unavailable" }] });
  } finally { await harness.lifecycle.dispose(); }
});

it("records the handoff before a fast bot emits its reply", async () => {
  const { harness, create, hand, get } = await setup();
  try {
    harness.inspection.sdk.stub("threads.send", async ({ threadId }) => {
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: threadId, status: "active" }) });
      await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: threadId }), lastAssistantText: "Already checked" });
      return {} as never;
    });
    const id = await create();
    await hand(id);
    expect(await get(id)).toMatchObject({ task: { status: "review" }, handoffs: [{ state: "replied", note: "Already checked" }] });
  } finally { await harness.lifecycle.dispose(); }
});
