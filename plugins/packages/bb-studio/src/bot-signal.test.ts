import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { registerBotFinish } from "./bot-finish";
import { BotSignal } from "./bot-signal";
import type { ThreadFacts } from "./bot-threads";
import { BOT_THREADS_CHANNEL } from "./bot-threads-contract";
import { registerBotThreads } from "./bot-threads-server";
import { MIGRATIONS } from "./migrations";
import { twoBots } from "./test/bot-fixture";
import { defaultPresence } from "./presence/schema";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const fn of dispose.splice(0)) await fn(); });

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup() {
  const threads = new Map<string, ThreadFacts>([
    ["thr_main", { id: "thr_main", title: "Chief of Staff", projectId: "proj_personal", createdAt: 1, status: "idle" }],
    ["thr_home", { id: "thr_home", title: "Home", projectId: "proj_personal", createdAt: 2, status: "idle" }],
    ["redesign", { id: "redesign", title: "Fork redesign", projectId: "proj_studio", createdAt: 3, status: "idle" }],
    ["lead", { id: "lead", title: "Sidebar rewrite", projectId: "proj_studio", parentThreadId: "redesign", createdAt: 4, status: "active" }],
  ]);
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: (async (args: { threadIds?: string[]; offset?: number; limit?: number }) => [...threads.values()].filter((thread) => !args.threadIds || args.threadIds.includes(thread.id)).slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 200))) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw new Error("Not found"); return thread; }) as never,
      send: (async () => ({ ok: true })) as never,
      fork: (async (args: { sourceThreadId: string }) => {
        const id = `fork_${threads.size}`;
        threads.set(id, { id, title: "Fork", projectId: "proj_studio", originKind: "fork", sourceThreadId: args.sourceThreadId, createdAt: 9, status: "idle" });
        return { id, projectId: "proj_studio", providerId: "claude" };
      }) as never,
      spawn: (async (args: { projectId: string }) => {
        const id = `new_${threads.size}`;
        threads.set(id, { id, title: null, projectId: args.projectId, createdAt: 10, status: "active" });
        return { id, projectId: args.projectId };
      }) as never,
      archive: (async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: 9 }); return {}; }) as never,
      unarchive: (async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: null }); return {}; }) as never,
      output: (async () => ({ output: null })) as never,
      interactions: { list: (async () => []) as never } as never,
      events: { list: (async () => [{ seq: 1, type: "turn/completed", createdAt: Date.now() }, { seq: 2, type: "item/completed", createdAt: Date.now(), data: { item: { type: "agentMessage", text: "Done." } } }]) as never },
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const signal = new BotSignal((event) => bb.realtime.publish(BOT_THREADS_CHANNEL, event), 250);
  dispose.push(async () => signal.dispose());
  const server = registerBotThreads(bb, db, {
    bots: () => [{ id: "dot", name: "Dot", avatar: "🤖", primary: true, threadId: "thr_main" }, { id: "home", name: "Home", avatar: "🏠", threadId: "thr_home" }],
    signals: () => ({ bots: [{ id: "dot", threadId: "thr_main", chain: ["thr_main"] }, { id: "home", threadId: "thr_home", chain: ["thr_home"] }], sideThread: () => null, runnerBot: () => null, leadThreads: new Set(), internal: new Set(), managedBot: () => null }),
    items: () => [], originThreads: () => new Map(),
    changed: (changes) => signal.add(changes), log: () => {},
    actingBot: async () => null, defaultModel: () => null,
  });
  const finish = registerBotFinish(bb, {
    db, threads: server.store, mainOf: (botId) => (botId === "dot" ? "thr_main" : botId === "home" ? "thr_home" : null),
    memory: { add: () => {}, count: () => 0 },
    changed: (changes) => signal.add(changes), log: () => {},
  });
  await server.start();
  let seen = harness.realtimeSignals.length;
  const emitted = () => {
    signal.flush();
    const fresh = harness.realtimeSignals.slice(seen).filter((each) => each.channel === BOT_THREADS_CHANNEL).map((each) => each.payload);
    seen = harness.realtimeSignals.length;
    return fresh;
  };
  emitted();
  return { harness, server, finish, threads, emitted };
}

it("merges a burst into one event per Bot, its changes in a fixed order, after the delay", async () => {
  vi.useFakeTimers();
  const published: unknown[] = [];
  const signal = new BotSignal((event) => published.push(event), 250);
  signal.add([{ botId: "dot", kinds: ["needs-you"] }, { botId: "home", kinds: ["workers"] }]);
  signal.add([{ botId: "dot", kinds: ["conversations", "needs-you"] }, { botId: "home", kinds: [] }]);
  expect(published).toEqual([]);
  vi.advanceTimersByTime(250);
  expect(published).toEqual([{ botId: "dot", changes: ["conversations", "needs-you"] }, { botId: "home", changes: ["workers"] }]);
  vi.advanceTimersByTime(1000);
  expect(published).toHaveLength(2);
  signal.add([{ botId: "dot", kinds: [] }]);
  vi.advanceTimersByTime(1000);
  expect(published).toHaveLength(2);
  signal.dispose();
});

it("conversation start and fork each emit once for their Bot", async () => {
  const x = await setup();
  await x.server.rpc.bot_conversation_start({ botId: "home", request: { projectId: "proj_personal", providerId: "claude", model: "m", reasoningLevel: "low", permissionMode: "auto", executionInputSources: {}, environment: {}, input: [{ type: "text", text: "hi" }] } as never });
  expect(x.emitted()).toEqual([{ botId: "home", changes: ["conversations"] }]);
  await x.server.rpc.bot_fork_conversation({ threadId: "redesign", messageId: "msg_1", turnId: null, sourceSeqEnd: 4 });
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["conversations"] }]);
});

it("finish and reopen each emit once, with needs-you when the finished conversation was marked", async () => {
  const x = await setup();
  x.server.rpc.bot_needs_you_set({ threadId: "redesign", reason: "Pick one" });
  x.emitted();
  await x.finish.rpc.bot_finish({ threadId: "redesign" });
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["conversations"] }]);
  await x.harness.callAgentTool("bot_finish_done", { summary: "**Decisions**\n- Ship it." }, { threadId: "redesign" });
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["conversations", "needs-you"] }]);
  await x.finish.rpc.bot_reopen({ threadId: "redesign" });
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["conversations"] }]);
});

it("a worker starting, working and finishing emits workers for its Bot, once per event", async () => {
  const x = await setup();
  x.threads.set("tests", { id: "tests", title: "Run tests", projectId: "proj_studio", parentThreadId: "redesign", createdAt: 11, status: "active" });
  await x.harness.emitThreadEvent("thread.created", { thread: x.threads.get("tests") as never });
  await settle();
  expect(x.server.store.get("tests")).toMatchObject({ botId: "dot", kind: "worker" });
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["workers"] }]);
  await x.harness.emitThreadEvent("thread.active", { thread: x.threads.get("tests") as never });
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["workers"] }]);
  await x.harness.emitThreadEvent("thread.idle", { thread: x.threads.get("tests") as never, lastAssistantText: "Done" } as never);
  await settle();
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["workers"] }]);
  await x.harness.emitThreadEvent("thread.failed", { thread: x.threads.get("lead") as never, error: "boom" });
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["workers"] }]);
});

it("a conversation's turn and archive emit conversations; a thread no Bot has emits nothing", async () => {
  const x = await setup();
  await x.harness.emitThreadEvent("thread.active", { thread: x.threads.get("thr_home") as never });
  expect(x.emitted()).toEqual([{ botId: "home", changes: ["conversations"] }]);
  await x.harness.emitThreadEvent("thread.idle", { thread: x.threads.get("thr_home") as never, lastAssistantText: "All set for Friday" } as never);
  await settle();
  expect(x.emitted()).toEqual([{ botId: "home", changes: ["conversations"] }]);
  await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("redesign") as never });
  await settle();
  expect(new Set(x.emitted().map((each) => JSON.stringify(each)))).toEqual(new Set([JSON.stringify({ botId: "dot", changes: ["conversations"] })]));
  await x.harness.emitThreadEvent("thread.active", { thread: { id: "stranger" } as never });
  expect(x.emitted()).toEqual([]);
});

it("needs-you set and clear each emit once; clearing an unmarked conversation emits nothing", async () => {
  const x = await setup();
  x.server.rpc.bot_needs_you_set({ threadId: "thr_home", reason: "Pick a check-in time" });
  expect(x.emitted()).toEqual([{ botId: "home", changes: ["needs-you"] }]);
  x.server.rpc.bot_needs_you_set({ threadId: "thr_home", reason: null });
  expect(x.emitted()).toEqual([{ botId: "home", changes: ["needs-you"] }]);
  x.server.rpc.bot_needs_you_set({ threadId: "thr_home", reason: null });
  expect(x.emitted()).toEqual([]);
});

it("a worker's approval raised and resolved each emit once: workers and needs-you", async () => {
  const x = await setup();
  await x.harness.emitThreadEvent("interaction.pending", { thread: x.threads.get("lead") as never } as never);
  x.server.store.setNeedsYou("redesign", "Sidebar rewrite wants to run a command", "lead");
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["workers", "needs-you"] }]);
  x.server.threadChanged("lead");
  x.server.store.clearNeedsYouFrom("lead");
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["workers", "needs-you"] }]);
  await x.harness.emitThreadEvent("interaction.pending", { thread: x.threads.get("thr_main") as never } as never);
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["conversations", "needs-you"] }]);
});

it("a thread moved to another Bot emits for both Bots", async () => {
  const x = await setup();
  x.server.store.recordConversation("redesign", "home");
  expect(x.emitted()).toEqual([{ botId: "dot", changes: ["conversations"] }, { botId: "home", changes: ["conversations"] }]);
});

it("a Bot's presence or appearance change emits presence for that Bot", async () => {
  const x = await twoBots();
  x.bots.setPresence({ botId: "bot_scout", presence: defaultPresence("bot_scout", false) });
  await x.bots.setAppearance({ botId: "bot_scout", appearance: null });
  expect(x.presence).toEqual(["bot_scout", "bot_scout"]);
});
