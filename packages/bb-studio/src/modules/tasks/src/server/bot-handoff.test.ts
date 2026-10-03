import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import plugin from "../../server";

async function setup() {
  let nextThread = 0;
  const archived = new Set<string>();
  const host = createFakePluginHost({
    pluginId: "studio",
    sdk: {
      plugins: {
        callRpc: async ({ pluginId, method }) => {
          if (pluginId === "bot-teams" && method === "newConversation") return { threadId: `thr_bot_${++nextThread}` } as never;
          if (pluginId === "bot-teams" && method === "threadProfile") return { botId: "bot_one" } as never;
          throw new Error("Optional Studio service unavailable");
        },
      },
      threads: {
        get: async ({ threadId }) => makeThreadResponse({ id: threadId, projectId: "proj_test", status: "idle", archivedAt: archived.has(threadId) ? 1 : null }),
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
    const id = await create();
    harness.inspection.sdk.stub("threads.send", async () => { throw new Error("Bot unavailable"); });
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


it("starts bot assignments from create and update without restarting unchanged assignments", async () => {
  const { harness, create, get } = await setup();
  try {
    const id = await create();
    expect(await get(id)).toMatchObject({ task: { status: "in_progress" }, handoffs: [{ state: "starting" }] });
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1);
    await harness.behavior.callRpc("update", { id, assignee: "bot:bot_one", title: "Reworded" });
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1);
    const { task } = await harness.behavior.callRpc("create", { title: "Unassigned", projectId: "proj_test" }) as { task: { id: string } };
    await harness.behavior.callRpc("update", { id: task.id, assignee: "bot:bot_one" });
    expect((await get(task.id)).handoffs).toHaveLength(1);
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(2);
  } finally { await harness.lifecycle.dispose(); }
});

it("keeps the task and failed handoff when dispatch during assignment fails", async () => {
  const { harness, create } = await setup();
  try {
    harness.inspection.sdk.stub("threads.send", async () => { throw new Error("Bot unavailable"); });
    await expect(create()).rejects.toThrow("was saved, but its bot could not start");
    const board = await harness.behavior.callRpc("board", {}) as { tasks: { assignee: string; handoff: { state: string } }[] };
    expect(board.tasks).toMatchObject([{ assignee: "bot:bot_one", handoff: { state: "failed" } }]);
  } finally { await harness.lifecycle.dispose(); }
});


it("publishes a completion report with task outputs in the task's folder", async () => {
  const { harness, create, get } = await setup();
  try {
    const id = await create();
    const threadId = (await get(id)).handoffs[0]!.threadId;
    const published: unknown[] = [];
    harness.inspection.sdk.stub("plugins.callRpc", async ({ pluginId, method, input }) => {
      if (pluginId === "feed" && method === "publish") { published.push(input); return {} as never; }
      throw new Error("Optional service unavailable");
    });
    await harness.behavior.callRpc("link", { id, link: { target: "item", pluginId: "studio", itemId: "page", label: "Result", href: "/plugins/studio/pages/page" } });
    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: threadId }), lastAssistantText: "Ready for review" });
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).toMatchObject({ projectId: "proj_test", threadId, story: `task:${id}`, title: "Review the launch" });
    expect((published[0] as { body: string }).body).toContain("[Result](/plugins/studio/pages/page)");
    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: threadId }), lastAssistantText: "Ready for review" });
    expect(published).toHaveLength(1);
  } finally { await harness.lifecycle.dispose(); }
});

it("prepares scheduled work without sending immediately and tracks each later run", async () => {
  const { harness, get } = await setup();
  try {
    const { task } = await harness.behavior.callRpc("create", { title: "Daily check", projectId: "proj_test" }) as { task: { id: string } };
    harness.inspection.sdk.stub("threads.defaultExecutionOptions", async () => ({ model: "model", reasoningLevel: "medium" }) as never);
    const schedules: unknown[] = [];
    harness.inspection.sdk.stub("plugins.callRpc", async ({ method, input }) => {
      if (method === "get") return { bot: { trust: "ask" } } as never;
      if (method === "newConversation") return { threadId: "scheduled-thread" } as never;
      if (method === "threadProfile") return { botId: "bot_one" } as never;
      if (method === "automations_list") return [] as never;
      if (method === "automations_create") { schedules.push(input); return { ...input as object, id: "automation" } as never; }
      return {} as never;
    });
    await harness.behavior.callRpc("scheduleBot", { id: task.id, botId: "bot_one", schedule: "daily" });
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
    expect(schedules).toHaveLength(1);
    expect(await get(task.id)).toMatchObject({ task: { schedule: "daily", status: "todo" } });
    const thread = makeThreadResponse({ id: "scheduled-thread", status: "active" });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(await get(task.id)).toMatchObject({ task: { status: "in_progress" } });
    await harness.behavior.emitThreadEvent("thread.idle", { thread: { ...thread, status: "idle" }, lastAssistantText: "Done" });
    expect(await get(task.id)).toMatchObject({ task: { status: "review" } });
    await harness.behavior.callRpc("move", { id: task.id, status: "done" });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(await get(task.id)).toMatchObject({ task: { status: "in_progress" } });
    await harness.behavior.callRpc("archive", { id: task.id, archived: true });
    await harness.behavior.callRpc("archive", { id: task.id, archived: false });
    await harness.behavior.callRpc("delete", { id: task.id });
    const controls = harness.inspection.sdk.callsTo("plugins.callRpc").map(call => (call[0] as { method: string }).method).filter(method => ["automations_pause", "automations_resume", "automations_delete"].includes(method));
    expect(controls).toEqual(["automations_resume", "automations_pause", "automations_resume", "automations_delete"]);
  } finally { await harness.lifecycle.dispose(); }
});
