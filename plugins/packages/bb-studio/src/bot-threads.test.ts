import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { ADOPT_RECENT, agentFork, BotThreads, botNeedsYou, classifyThread, forkMessageIdOf, latestLine, olderView, repoTag, threadRunning, threadsView, workerStatus, type Signals, type ThreadFacts } from "./bot-threads";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const HOUR = 60 * 60_000;

/** Dot (primary, chat thr_main, handed off from thr_old) and Scout (chat thr_scout). */
function signals(over: Partial<Signals> = {}): Signals {
  return {
    bots: [{ id: "bot_dot", threadId: "thr_main", chain: ["thr_main", "thr_old"] }, { id: "bot_scout", threadId: "thr_scout", chain: ["thr_scout"] }],
    focusedBotId: null,
    sideThread: (id) => (id === "thr_side" ? { botId: "bot_dot", sourceThreadId: "thr_main", messageId: "msg_7" } : null),
    runnerBot: (id) => (id === "thr_runner" ? "bot_scout" : null),
    leadThreads: new Set(["thr_lead"]),
    internal: new Set(["thr_review"]),
    managedBot: (id) => (id === "thr_run" ? "bot_scout" : null),
    ...over,
  };
}

function setup(threads: ThreadFacts[], over: Partial<Signals> = {}) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: (async (args: { offset?: number; limit?: number; threadIds?: string[] }) => {
        const all = [...byId.values()].filter((thread) => !args.threadIds || args.threadIds.includes(thread.id));
        return all.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 200));
      }) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = byId.get(threadId); if (!thread) throw new Error("Not found"); return thread; }) as never,
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  let changes = 0;
  let now = 1_000_000;
  const store = new BotThreads({ db, sdk: bb.sdk, signals: () => signals(over), changed: () => { changes++; }, now: () => now });
  return { store, db, byId, changes: () => changes, tick: (ms: number) => { now += ms; } };
}

const none = () => null;

it("classifies a thread by the first rule that fits", () => {
  const s = signals();
  type K = { botId: string; kind: "conversation" | "worker"; ownerConversationId: string | null; isMain: boolean };
  const rows: Record<string, K> = { thr_main: { botId: "bot_dot", kind: "conversation", ownerConversationId: null, isMain: true }, thr_conv: { botId: "bot_scout", kind: "conversation", ownerConversationId: null, isMain: false }, thr_w: { botId: "bot_scout", kind: "worker", ownerConversationId: "thr_conv", isMain: false } };
  const known = (id: string): K | null => rows[id] ?? null;
  expect(classifyThread({ id: "thr_main" }, s, none)).toMatchObject({ botId: "bot_dot", kind: "conversation", isMain: true, archived: false });
  // An older thread of the handoff chain is an archived conversation.
  expect(classifyThread({ id: "thr_old" }, s, none)).toMatchObject({ kind: "conversation", isMain: false, archived: true });
  expect(classifyThread({ id: "thr_side", originKind: "fork", sourceThreadId: "thr_main" }, s, none)).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "msg_7" } });
  expect(classifyThread({ id: "thr_runner" }, s, none)).toMatchObject({ botId: "bot_scout", kind: "worker", ownerConversationId: "thr_scout" });
  expect(classifyThread({ id: "thr_lead" }, s, none)).toMatchObject({ botId: "bot_dot", kind: "worker", ownerConversationId: "thr_main" });
  expect(classifyThread({ id: "thr_review", sourceThreadId: "thr_main", originKind: "fork" }, s, known)).toMatchObject({ kind: "worker", archived: true, ownerConversationId: "thr_main" });
  // BB's fork from a message: a conversation of the source's Bot, linked back.
  expect(classifyThread({ id: "f1", originKind: "fork", sourceThreadId: "thr_conv", experimental_sourceMessageId: "m9" } as ThreadFacts, s, known)).toMatchObject({ botId: "bot_scout", kind: "conversation", forkedFrom: { threadId: "thr_conv", messageId: "m9" } });
  // An agent's or a tool's fork is a worker of the conversation that owns its source: hidden, spawned, of a worker, or cut mid-turn.
  expect(classifyThread({ id: "f3", originKind: "fork", visibility: "hidden", sourceThreadId: "thr_conv" }, s, known)).toMatchObject({ botId: "bot_scout", kind: "worker", forkedFrom: null, ownerConversationId: "thr_conv" });
  expect(classifyThread({ id: "f5", originKind: "fork", lifecycleOwnerThreadId: "thr_w", sourceThreadId: "thr_conv" }, s, known)).toMatchObject({ kind: "worker", ownerConversationId: "thr_conv" });
  expect(classifyThread({ id: "f6", originKind: "fork", sourceThreadId: "thr_w" }, s, known)).toMatchObject({ kind: "worker", ownerConversationId: "thr_conv" });
  expect(classifyThread({ id: "f7", originKind: "fork", sourceThreadId: "thr_conv", sourceBusy: true }, s, known)).toMatchObject({ kind: "worker", ownerConversationId: "thr_conv" });
  expect(classifyThread({ id: "f10", originKind: "fork", sourceThreadId: "thr_unknown", sourceIsWorker: true }, s, known)).toMatchObject({ kind: "worker", ownerConversationId: "thr_main" });
  // An agent's fork of a source Studio doesn't know yet belongs to its spawner's conversation, else Main.
  expect(classifyThread({ id: "f8", originKind: "fork", sourceThreadId: "thr_unknown", parentThreadId: "thr_w" }, s, known)).toMatchObject({ botId: "bot_scout", kind: "worker", ownerConversationId: "thr_conv" });
  expect(classifyThread({ id: "f9", originKind: "fork", visibility: "hidden", sourceThreadId: "thr_unknown" }, s, known)).toMatchObject({ botId: "bot_dot", kind: "worker", ownerConversationId: "thr_main" });
  // A child of a conversation is its worker; a worker's child belongs to the same conversation.
  expect(classifyThread({ id: "c1", parentThreadId: "thr_conv" }, s, known)).toMatchObject({ botId: "bot_scout", kind: "worker", ownerConversationId: "thr_conv" });
  expect(classifyThread({ id: "c2", lifecycleOwnerThreadId: "thr_w" }, s, known)).toMatchObject({ kind: "worker", ownerConversationId: "thr_conv" });
  expect(classifyThread({ id: "c3", parentThreadId: "thr_unknown" }, s, known)).toBe("parent-unknown");
  expect(classifyThread({ id: "thr_run" }, s, none)).toMatchObject({ botId: "bot_scout", kind: "worker", ownerConversationId: "thr_scout" });
  expect(classifyThread({ id: "a1", originPluginId: "automations" }, s, none)).toMatchObject({ kind: "worker", ownerConversationId: "thr_main" });
  expect(classifyThread({ id: "h1", visibility: "hidden" }, s, none)).toMatchObject({ kind: "worker" });
  // A thread Patrick starts: a conversation of the current Bot, else the primary.
  expect(classifyThread({ id: "r1" }, s, none)).toMatchObject({ botId: "bot_dot", kind: "conversation", forkedFrom: null, authoritative: false });
  expect(classifyThread({ id: "r2" }, signals({ focusedBotId: "bot_scout" }), none)).toMatchObject({ botId: "bot_scout", kind: "conversation" });
  expect(classifyThread({ id: "r3" }, signals({ bots: [] }), none)).toBeNull();
});

it("reads a fork's message id under the fork's field names", () => {
  expect(forkMessageIdOf({ sourceMessageId: "m1" })).toBe("m1");
  expect(forkMessageIdOf({ experimental_sourceMessageId: "m2" })).toBe("m2");
  expect(forkMessageIdOf({})).toBeNull();
});

it("backfills every open thread: Main, side threads as forks, workers under the conversation that spawned them", async () => {
  const { store } = setup([
    { id: "thr_main", createdAt: 1, updatedAt: 50 },
    { id: "thr_scout", createdAt: 2 },
    { id: "thr_side", createdAt: 3, originKind: "fork", sourceThreadId: "thr_main", visibility: "hidden" },
    { id: "w_side", createdAt: 4, parentThreadId: "thr_side" },
    { id: "w_deep", createdAt: 5, parentThreadId: "w_side" },
    { id: "thr_runner", createdAt: 6 },
    { id: "mine", createdAt: 7, updatedAt: 70 },
    { id: "w_mine", createdAt: 8, lifecycleOwnerThreadId: "mine" },
    { id: "w_orphan", createdAt: 9, parentThreadId: "archived_parent" },
  ]);
  expect(await store.backfill()).toEqual({ conversations: 4, workers: 5, archived: 0 });
  expect(store.get("thr_main")).toMatchObject({ botId: "bot_dot", kind: "conversation", isMain: true, source: "backfill" });
  expect(store.get("thr_side")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "msg_7", turnId: null } });
  expect(store.get("w_side")).toMatchObject({ kind: "worker", ownerConversationId: "thr_side" });
  expect(store.get("w_deep")).toMatchObject({ kind: "worker", ownerConversationId: "thr_side" });
  expect(store.get("thr_runner")).toMatchObject({ botId: "bot_scout", kind: "worker", ownerConversationId: "thr_scout" });
  expect(store.get("mine")).toMatchObject({ botId: "bot_dot", kind: "conversation" });
  expect(store.get("w_mine")).toMatchObject({ ownerConversationId: "mine" });
  // Its spawner is archived (not listed): Main owns it.
  expect(store.get("w_orphan")).toMatchObject({ kind: "worker", ownerConversationId: "thr_main" });
  expect(store.backfilledAt()).not.toBeNull();
  // Once only.
  expect(await store.backfill()).toEqual({ conversations: 0, workers: 0, archived: 0 });
});

it("keeps the newest standalone threads in the sidebar and archives older ones as searchable conversations", async () => {
  const roots = Array.from({ length: ADOPT_RECENT + 5 }, (_, n): ThreadFacts => ({ id: `t${n}`, createdAt: 100 + n, updatedAt: 1000 + n }));
  const { store } = setup([{ id: "thr_main", createdAt: 1 }, ...roots]);
  const counts = await store.backfill();
  expect(counts.archived).toBe(5);
  const listed = store.listed("bot_dot").filter((rec) => rec.kind === "conversation" && !rec.isMain).map((rec) => rec.threadId);
  expect(listed).toHaveLength(ADOPT_RECENT);
  expect(listed).not.toContain("t0");
  expect(store.get("t0")).toMatchObject({ kind: "conversation", botId: "bot_dot" });
  expect(store.get("t0")!.archivedAt).not.toBeNull();
  expect(store.get(`t${ADOPT_RECENT + 4}`)!.archivedAt).toBeNull();
});

it("classifies new threads as they are made: Patrick's go to the current Bot, spawned ones to the conversation that spawned them", async () => {
  const { store, byId } = setup([{ id: "thr_main" }, { id: "thr_scout" }]);
  await store.backfill();
  store.setFocus("bot_scout");
  await store.created({ id: "new_conv" });
  expect(store.get("new_conv")).toMatchObject({ botId: "bot_scout", kind: "conversation", source: "created" });
  // A child whose parent Studio hasn't seen: the parent is read and classified first.
  byId.set("p", { id: "p", parentThreadId: "new_conv" });
  await store.created({ id: "child", parentThreadId: "p" });
  expect(store.get("p")).toMatchObject({ kind: "worker", ownerConversationId: "new_conv" });
  expect(store.get("child")).toMatchObject({ kind: "worker", botId: "bot_scout", ownerConversationId: "new_conv" });
  await store.created({ id: "fork", originKind: "fork", sourceThreadId: "new_conv", sourceMessageId: "m3" } as ThreadFacts);
  expect(store.get("fork")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "new_conv", messageId: "m3" } });
  // Twice is once.
  await store.created({ id: "fork" });
  expect(store.get("fork")!.forkedFrom).toEqual({ threadId: "new_conv", messageId: "m3", turnId: null });
  // BB's fork point names the last turn it copied.
  expect(store.forksWithoutTurn(10).map((rec) => rec.threadId)).toEqual([]);
  await store.created({ id: "fork2", originKind: "fork", sourceThreadId: "new_conv" });
  expect(store.forksWithoutTurn(10).map((rec) => rec.threadId)).toEqual(["fork2"]);
  expect(store.forkedAt("fork2", { sourceThreadId: "new_conv", turnId: "turn_4" })).toBe(true);
  expect(store.get("fork2")!.forkedFrom).toEqual({ threadId: "new_conv", messageId: null, turnId: "turn_4" });
  expect(store.forkedAt("fork2", { sourceThreadId: "new_conv", turnId: "turn_4" })).toBe(false);
});

it("reconciles authoritative facts over a guess, follows a handoff, and leaves Patrick's own changes alone", async () => {
  let runner: string | null = null;
  let bots: Signals["bots"] = [{ id: "bot_dot", threadId: "thr_main", chain: ["thr_main"] }];
  const { store, db } = setup([{ id: "thr_main" }, { id: "late_runner" }, { id: "kept" }]);
  const over = () => signals({ bots, runnerBot: (id) => (id === runner ? "bot_dot" : null) });
  // A store that reads the changing signals.
  const live = new BotThreads({ db, sdk: (store as unknown as { deps: { sdk: never } }).deps.sdk, signals: over, changed: () => {} });
  await live.backfill();
  expect(live.get("late_runner")).toMatchObject({ kind: "conversation" });
  runner = "late_runner";
  expect(live.reconcile()).toBeGreaterThan(0);
  expect(live.get("late_runner")).toMatchObject({ kind: "worker", ownerConversationId: "thr_main", source: "reconciled" });
  // Handed off to a new chat: it is Main now, and the old chat an archived conversation.
  bots = [{ id: "bot_dot", threadId: "thr_new", chain: ["thr_new", "thr_main"] }];
  live.reconcile();
  expect(live.get("thr_new")).toMatchObject({ isMain: true, archivedAt: null });
  expect(live.get("thr_main")).toMatchObject({ isMain: false, kind: "conversation" });
  expect(live.get("thr_main")!.archivedAt).not.toBeNull();
  // Patrick's own row stays his.
  db.prepare("UPDATE bot_threads SET source = 'user' WHERE thread_id = 'kept'").run();
  runner = "kept";
  live.reconcile();
  expect(live.get("kept")).toMatchObject({ kind: "conversation" });
});

it("marks a conversation as needing Patrick and clears it when the worker's wait is over or he archives it", async () => {
  const { store } = setup([{ id: "thr_main" }, { id: "conv" }, { id: "w", parentThreadId: "conv" }]);
  await store.backfill();
  expect(store.conversationFor("w")).toBe("conv");
  expect(store.setNeedsYou("conv", "Fable lead: waiting on your approval", "w")).toBe(true);
  expect(store.get("conv")!.needsYou).toMatchObject({ reason: "Fable lead: waiting on your approval", source: "w" });
  // A worker row is never marked; only conversations are.
  expect(store.setNeedsYou("w", "no")).toBe(false);
  expect(store.clearNeedsYouFrom("other")).toBe(0);
  expect(store.clearNeedsYouFrom("w")).toBe(1);
  expect(store.get("conv")!.needsYou).toBeNull();
  store.setNeedsYou("conv", "Pick a date", "bot");
  store.archived("conv", true);
  expect(store.get("conv")).toMatchObject({ needsYou: null });
  expect(store.get("conv")!.archivedAt).not.toBeNull();
  store.archived("conv", false);
  expect(store.get("conv")!.archivedAt).toBeNull();
});

it("keeps a conversation's latest reply, skips quiet ones, and hands a deleted conversation's workers to Main", async () => {
  const { store } = setup([{ id: "thr_main" }, { id: "conv" }, { id: "w", parentThreadId: "conv" }]);
  await store.backfill();
  store.idle("conv", "**Done.** The draft is on the page.\n\nMore below.");
  expect(store.get("conv")!.latest?.text).toBe("Done. The draft is on the page.");
  store.idle("conv", "[PASS]");
  expect(store.get("conv")!.latest?.text).toBe("Done. The draft is on the page.");
  // A worker has no second line.
  store.idle("w", "hello");
  expect(store.get("w")!.latest).toBeNull();
  store.deleted("conv");
  expect(store.get("conv")).toBeNull();
  expect(store.get("w")!.ownerConversationId).toBe("thr_main");
});

it("lets Patrick rename and archive a conversation, but not archive Main", async () => {
  const { store } = setup([{ id: "thr_main" }, { id: "conv" }]);
  await store.backfill();
  expect(store.update("conv", { title: "  Launch prep " }).title).toBe("Launch prep");
  expect(() => store.update("thr_main", { archived: true })).toThrow(/Main/);
  expect(store.update("conv", { archived: true }).archivedAt).not.toBeNull();
  expect(() => store.update("nope", { title: "x" })).toThrow();
});

const rec = (over: Partial<ReturnType<BotThreads["get"]> & object> & { threadId: string }) => ({
  botId: "bot_dot", kind: "conversation" as const, isMain: false, forkedFrom: null, ownerConversationId: null, title: null, archivedAt: null,
  finishedSummary: null, needsYou: null, latest: null, activityAt: null as number | null, source: "backfill" as const, createdAt: 0, updatedAt: 0, ...over,
});

it("draws the sidebar: Main first, conversations by activity, the needs-you reason, a fork's state on its parent, workers by status", () => {
  const now = 100 * HOUR;
  const records = [
    rec({ threadId: "main", isMain: true }),
    rec({ threadId: "old", latest: { text: "Return window ends Nov 15", at: 10 * HOUR } }),
    rec({ threadId: "fork", forkedFrom: { threadId: "redesign", messageId: "m1", turnId: null }, needsYou: { reason: "Cut titles at the end or the middle?", at: 90 * HOUR, source: "w2" } }),
    rec({ threadId: "redesign", title: "Fork redesign" }),
    rec({ threadId: "asks" }),
    rec({ threadId: "gone", archivedAt: 5 }),
    rec({ threadId: "scout_conv", botId: "bot_scout" }),
    rec({ threadId: "w1", kind: "worker", ownerConversationId: "redesign" }),
    rec({ threadId: "w2", kind: "worker", ownerConversationId: "fork" }),
    rec({ threadId: "w3", kind: "worker", ownerConversationId: "main" }),
    rec({ threadId: "w4", kind: "worker", ownerConversationId: "main" }),
  ];
  const threads = new Map<string, ThreadFacts>([
    ["main", { id: "main", updatedAt: 1 * HOUR, title: "Chief of Staff" }],
    ["redesign", { id: "redesign", updatedAt: 99 * HOUR, status: "active", title: "BB title" }],
    ["fork", { id: "fork", updatedAt: 80 * HOUR, title: "Tree truncation" }],
    ["asks", { id: "asks", updatedAt: 20 * HOUR, hasPendingInteraction: true, title: "Asks" }],
    ["w1", { id: "w1", status: "active", updatedAt: 50 * HOUR, title: "Fable lead", environmentBranchName: "exp/studio-native", environmentPath: "/w/bb-studio-native" }],
    ["w2", { id: "w2", status: "error", updatedAt: 98 * HOUR, title: "Codex: iOS build" }],
    ["w3", { id: "w3", status: "idle", updatedAt: 99 * HOUR, title: "Reviewer" }],
    ["w4", { id: "w4", status: "idle", updatedAt: 1 * HOUR, title: "Ancient" }],
  ]);
  const view = threadsView("bot_dot", records, threads, now);
  expect(view.conversations.map((each) => each.threadId)).toEqual(["main", "redesign", "asks", "old"]);
  expect(view.conversations[0]).toMatchObject({ title: "Main", isMain: true });
  expect(view.conversations[1]).toMatchObject({ title: "Fork redesign", running: true, needsYou: { reason: "Cut titles at the end or the middle?" } });
  expect(view.conversations[2]!.needsYou?.reason).toBe("Asked you a question");
  expect(view.conversations[3]).toMatchObject({ latest: "Return window ends Nov 15", needsYou: null });
  // Running first, then the finished ones by recency; done ones older than two days are counted, not shown.
  expect(view.workers.map((each) => [each.threadId, each.status])).toEqual([["w1", "running"], ["w3", "done"], ["w2", "failed"]]);
  expect(view.workers[0]).toMatchObject({ tag: "bb-studio-native", branch: "exp/studio-native", ownerTitle: "Fork redesign" });
  expect(view.hiddenWorkers).toBe(1);
  // The amber space dot: a conversation of that Bot needs Patrick.
  expect(botNeedsYou("bot_dot", records, threads)).toBe(true);
  expect(botNeedsYou("bot_scout", records, threads)).toBe(false);
});

it("shortens a reply to its first line and reads a repo tag only off a git checkout", () => {
  expect(latestLine("::page{id=\"pg_1\"}\n\n# Heading")).toBe("Heading");
  expect(latestLine("x".repeat(400))!.length).toBe(160);
  expect(latestLine("  ")).toBeNull();
  expect(latestLine("Recap: The [Spring menu draft](bb://page/pg_1) has [3 items](/threads/thr_1).")).toBe("Recap: The Spring menu draft has 3 items.");
  expect(repoTag({ environmentPath: "/a/b", environmentBranchName: null })).toBeNull();
  expect(repoTag({ environmentName: "larkspur", environmentBranchName: "main" })).toEqual({ tag: "larkspur", branch: "main" });
});

it("tells an agent's fork from Patrick's by its spawner, its visibility, its source and the source's turn", () => {
  expect(agentFork({ visibility: "visible" }, { kind: "conversation" })).toBe(false);
  expect(agentFork({ parentThreadId: "p" }, null)).toBe(true);
  expect(agentFork({ visibility: "hidden" }, { kind: "conversation" })).toBe(true);
  expect(agentFork({}, { kind: "worker" })).toBe(true);
  expect(agentFork({ sourceIsWorker: true }, null)).toBe(true);
  expect(agentFork({ sourceBusy: true }, null)).toBe(true);
  expect(agentFork({ sourceBusy: false, sourceIsWorker: false }, null)).toBe(false);
});

it("records a new fork made while its source was mid-turn as a worker, and Patrick's forks as conversations", async () => {
  const { store, byId } = setup([{ id: "thr_main" }, { id: "conv", createdAt: 5 }]);
  await store.backfill();
  byId.set("conv", { id: "conv", status: "active" });
  await store.created({ id: "agent_fork", originKind: "fork", sourceThreadId: "conv" });
  expect(store.get("agent_fork")).toMatchObject({ kind: "worker", ownerConversationId: "conv", forkedFrom: null });
  await store.created({ id: "hidden_fork", originKind: "fork", visibility: "hidden", sourceThreadId: "conv" });
  expect(store.get("hidden_fork")).toMatchObject({ kind: "worker", ownerConversationId: "conv" });
  byId.set("conv", { id: "conv", status: "idle" });
  await store.created({ id: "idle_fork", originKind: "fork", sourceThreadId: "conv", visibility: "visible" });
  expect(store.get("idle_fork")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "conv" } });
});

it("moves forks agents made, recorded as conversations before, to workers once; Patrick's own stay", async () => {
  const { store, db } = setup([{ id: "thr_main" }, { id: "conv", createdAt: 5 }]);
  await store.backfill();
  const insert = db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, forked_from_thread_id, owner_conversation_id, source, created_at, updated_at) VALUES (?, 'bot_dot', 'conversation', 0, 'conv', NULL, ?, 1, 1)");
  insert.run("audit_lane", "backfill");
  insert.run("mine", "backfill");
  insert.run("moved_by_me", "user");
  const facts = new Map<string, ThreadFacts>([
    ["audit_lane", { id: "audit_lane", originKind: "fork", visibility: "hidden", sourceThreadId: "conv" }],
    ["mine", { id: "mine", originKind: "fork", visibility: "visible", sourceThreadId: "conv" }],
    ["moved_by_me", { id: "moved_by_me", originKind: "fork", visibility: "hidden", sourceThreadId: "conv" }],
  ]);
  expect(store.forkConversations().map((each) => each.threadId).sort()).toEqual(["audit_lane", "mine"]);
  expect(await store.reclassifyForks(facts)).toBe(1);
  expect(store.get("audit_lane")).toMatchObject({ kind: "worker", ownerConversationId: "conv", forkedFrom: null, source: "reconciled" });
  expect(store.get("mine")).toMatchObject({ kind: "conversation" });
  expect(store.get("moved_by_me")).toMatchObject({ kind: "conversation", source: "user" });
  expect(store.marked("x")).toBe(false);
  store.mark("x");
  expect(store.marked("x")).toBe(true);
});

it("lists recent conversations and workers only, and counts the rest for the older lists", () => {
  const DAY = 24 * HOUR;
  const now = 100 * DAY;
  const records = [
    rec({ threadId: "main", isMain: true }),
    rec({ threadId: "recent", latest: { text: "x", at: now - 2 * DAY } }),
    rec({ threadId: "stale", latest: { text: "x", at: now - 20 * DAY } }),
    rec({ threadId: "stale_needs", needsYou: { reason: "Approve", at: now - 30 * DAY, source: "bot" } }),
    rec({ threadId: "stale_running" }),
    rec({ threadId: "w_run", kind: "worker", ownerConversationId: "main" }),
    rec({ threadId: "w_failed_6d", kind: "worker", ownerConversationId: "main" }),
    rec({ threadId: "w_failed_8d", kind: "worker", ownerConversationId: "main" }),
    rec({ threadId: "w_done_1d", kind: "worker", ownerConversationId: "main" }),
    rec({ threadId: "w_done_3d", kind: "worker", ownerConversationId: "main" }),
  ];
  const threads = new Map<string, ThreadFacts>([
    ["main", { id: "main", updatedAt: now - 60 * DAY }],
    ["stale_running", { id: "stale_running", updatedAt: now - 40 * DAY, status: "active" }],
    ["w_run", { id: "w_run", title: "w_run", status: "active", updatedAt: now - 50 * DAY }],
    ["w_failed_6d", { id: "w_failed_6d", title: "w_failed_6d", status: "error", updatedAt: now - 6 * DAY }],
    ["w_failed_8d", { id: "w_failed_8d", title: "w_failed_8d", status: "error", updatedAt: now - 8 * DAY }],
    ["w_done_1d", { id: "w_done_1d", title: "w_done_1d", status: "idle", updatedAt: now - 1 * DAY }],
    ["w_done_3d", { id: "w_done_3d", title: "w_done_3d", status: "idle", updatedAt: now - 3 * DAY }],
  ]);
  const view = threadsView("bot_dot", records, threads, now);
  expect(view.conversations.map((each) => each.threadId)).toEqual(["main", "recent", "stale_needs", "stale_running"]);
  expect(view.olderConversations).toBe(1);
  expect(view.workers.map((each) => each.threadId)).toEqual(["w_run", "w_done_1d", "w_failed_6d"]);
  expect(view.hiddenWorkers).toBe(2);
  const older = olderView("bot_dot", records, threads, now);
  expect(older.conversations.map((each) => each.threadId)).toEqual(["stale"]);
  // Newest first.
  expect(older.workers.map((each) => each.threadId)).toEqual(["w_done_3d", "w_failed_8d"]);
});

it("shows every running or waiting worker, then the five newest finished, one title folded into ×N; the rest are counted, today's apart", () => {
  const now = 100 * 24 * HOUR;
  const at = (hours: number) => now - hours * HOUR;
  const workers: [string, string, string, number][] = [
    ["run1", "Runner", "active", 50 * 24], ["ask", "Codex", "idle", 30 * 24],
    ["rev1", "Chief of Staff · skill review", "idle", 1], ["rev2", "Chief of Staff · skill review", "idle", 2], ["rev3", "Chief of Staff · skill review", "idle", 3],
    ["a", "A", "idle", 4], ["b", "B", "error", 5], ["c", "C", "idle", 6], ["d", "D", "idle", 7], ["e", "E", "idle", 8], ["f", "F", "idle", 30],
  ];
  const records = [rec({ threadId: "main", isMain: true }), ...workers.map(([id]) => rec({ threadId: id, kind: "worker", ownerConversationId: "main" }))];
  const threads = new Map<string, ThreadFacts>([["main", { id: "main" }], ...workers.map(([id, title, status, hours]): [string, ThreadFacts] => [id, { id, title, status, updatedAt: at(hours), hasPendingInteraction: id === "ask" }])]);
  const view = threadsView("bot_dot", records, threads, now);
  expect(view.workers.map((each) => [each.threadId, each.sameTitle])).toEqual([["ask", 1], ["run1", 1], ["rev1", 3], ["a", 1], ["b", 1], ["c", 1], ["d", 1]]);
  // e (8h) and f (30h) are left out; e finished today.
  expect([view.hiddenWorkers, view.hiddenToday]).toEqual([2, 1]);
  // The older list has the folded namesakes too, newest first.
  expect(olderView("bot_dot", records, threads, now).workers.map((each) => each.threadId)).toEqual(["rev2", "rev3", "e", "f"]);
});

it("finishes a conversation (archived with its summary, needs-you cleared) and reopens it; Main and workers can't be", async () => {
  const { store } = setup([{ id: "thr_main" }, { id: "conv" }, { id: "w", parentThreadId: "conv" }]);
  await store.backfill();
  store.setNeedsYou("conv", "Pick one", "bot");
  const done = store.finish("conv", "**Decisions**\n- One mock a day");
  expect(done).toMatchObject({ finishedSummary: "**Decisions**\n- One mock a day", needsYou: null });
  expect(done.archivedAt).not.toBeNull();
  expect(store.listed("bot_dot").map((each) => each.threadId)).not.toContain("conv");
  expect(() => store.finish("thr_main", "x")).toThrow(/Main/);
  expect(() => store.finish("w", "x")).toThrow();
  expect(store.reopen("conv")).toMatchObject({ archivedAt: null, finishedSummary: "**Decisions**\n- One mock a day" });
  store.setLatest("thr_main", "Finished “Launch prep” · summary saved");
  expect(store.get("thr_main")!.latest?.text).toBe("Finished “Launch prep” · summary saved");
});

/**
 * The Larkspur shape, from a copy of real data: thr_demo000011 (a plain
 * thread, archived) ran `bb thread fork … --visibility hidden`, making
 * thr_demo000023 (archived), which in a turn forked thr_demo000018 the same
 * way. BB's records carry no origin; only the visibility, the chain and the
 * source's turn events say an agent made them.
 */
function larkspur(overrides: Record<string, Partial<ThreadFacts>> = {}) {
  const threads = new Map<string, ThreadFacts>([
    ["thr_main", { id: "thr_main", createdAt: 1, updatedAt: 1, status: "idle" }],
    ["thr_demo000011", { id: "thr_demo000011", visibility: "visible", createdAt: 1787593076494, archivedAt: 1787627748680, status: "idle" }],
    ["thr_demo000023", { id: "thr_demo000023", originKind: "fork", sourceThreadId: "thr_demo000011", parentThreadId: null, lifecycleOwnerThreadId: null, originPluginId: null, visibility: "hidden", createdAt: 1787608960525, archivedAt: 1787627748673, status: "idle" }],
    ["thr_demo000018", { id: "thr_demo000018", title: "Larkspur collector workflow review", originKind: "fork", sourceThreadId: "thr_demo000023", parentThreadId: null, lifecycleOwnerThreadId: null, originPluginId: null, visibility: "hidden", createdAt: 1787608996295, updatedAt: 1787609304726, status: "idle" }],
  ]);
  for (const [id, over] of Object.entries(overrides)) threads.set(id, { ...threads.get(id), id, ...over } as ThreadFacts);
  const events = new Map<string, { seq: number; type: string; createdAt: number }[]>([
    ["thr_demo000023", [
      { seq: 1, type: "client/turn/requested", createdAt: 1787608960525 },
      { seq: 8, type: "turn/started", createdAt: 1787608962201 },
      { seq: 9, type: "turn/input/accepted", createdAt: 1787608962201 },
      { seq: 654, type: "turn/completed", createdAt: 1787609496535 },
    ]],
    ["thr_demo000018", [{ seq: 277, type: "turn/completed", createdAt: 1787609304726 }]],
  ]);
  const list = async (args: { threadId: string; order?: string; limit?: string; types?: string[]; beforeSeq?: string }) => {
    const rows = (events.get(args.threadId) ?? []).filter((row) => (!args.types || args.types.includes(row.type)) && (args.beforeSeq === undefined || row.seq < Number(args.beforeSeq)));
    const ordered = args.order === "desc" ? [...rows].reverse() : rows;
    return ordered.slice(0, Number(args.limit ?? 100));
  };
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: (async (args: { threadIds?: string[]; offset?: number; limit?: number }) => [...threads.values()].filter((thread) => (args.threadIds ? args.threadIds.includes(thread.id) : !thread.archivedAt)).slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 200))) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw new Error("Not found"); return thread; }) as never,
      events: { list: list as never },
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new BotThreads({ db, sdk: bb.sdk, signals: () => signals(), changed: () => {} });
  return { store, db, threads, events };
}

it("makes the Larkspur review fork a worker: hidden, forked mid-turn from an agent's hidden fork of an archived thread", async () => {
  const { store } = larkspur();
  await store.backfill();
  expect(store.get("thr_demo000018")).toMatchObject({ kind: "worker", botId: "bot_dot", ownerConversationId: "thr_main", forkedFrom: null });
  // The archived chain stays out of Studio's record.
  expect(store.get("thr_demo000023")).toBeNull();
});

it("decides the same fork without the hidden flag: from its source chain, else from the source's turn at fork time", async () => {
  // Visible, and its source an agent's hidden fork Studio has no row for: the chain says worker.
  const chain = larkspur({ thr_demo000018: { visibility: "visible" } });
  await chain.store.backfill();
  expect(chain.store.get("thr_demo000018")).toMatchObject({ kind: "worker" });
  // Visible, its source a visible thread with nothing to say: the source was mid-turn at fork time (turn/started 1787608962201, completed 1787609496535).
  const turn = larkspur({ thr_demo000018: { visibility: "visible" }, thr_demo000023: { visibility: "visible", originKind: null, sourceThreadId: null } });
  expect(await turn.store.midTurn("thr_demo000023", 1787608996295)).toBe(true);
  expect(await turn.store.midTurn("thr_demo000023", 1787609500000)).toBe(false);
  expect(await turn.store.midTurn("thr_demo000023", 1787608961000)).toBe(false);
  await turn.store.backfill();
  expect(turn.store.get("thr_demo000018")).toMatchObject({ kind: "worker" });
  // Made after the source's turn completed, from a plain thread: Patrick's fork, a conversation.
  const mine = larkspur({ thr_demo000018: { visibility: "visible", createdAt: 1787609600000 }, thr_demo000023: { visibility: "visible", originKind: null, sourceThreadId: null } });
  await mine.store.backfill();
  expect(mine.store.get("thr_demo000018")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_demo000023" } });
});

it("moves the Larkspur fork, recorded as a conversation by the backfill before, to a worker on the next pass", async () => {
  const { store, db } = larkspur();
  db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, forked_from_thread_id, source, created_at, updated_at) VALUES ('thr_demo000018', 'bot_dot', 'conversation', 0, 'thr_demo000023', 'backfill', 1787608996295, 1794369507951)").run();
  expect(await store.reclassifyForks(await store.facts(["thr_demo000018"]))).toBe(1);
  expect(store.get("thr_demo000018")).toMatchObject({ kind: "worker", ownerConversationId: "thr_main", source: "reconciled" });
});

it("ages, orders and cuts rows by the latest real event, not by when the importer copied the thread", async () => {
  const { store, db, threads } = larkspur({ thr_demo000018: { visibility: "visible", createdAt: 1787609600000, updatedAt: 1794370110076 }, thr_demo000023: { visibility: "visible", originKind: null, sourceThreadId: null } });
  await store.backfill();
  // The copy stamped the row and BB's record; the thread's last real event is from August.
  db.prepare("UPDATE bot_threads SET latest = 'Old reply', latest_at = 1794370110076 WHERE thread_id = 'thr_demo000018'").run();
  const now = 1794371155000;
  expect(threadsView("bot_dot", store.all("bot_dot"), threads, now).conversations.map((each) => each.threadId)).toContain("thr_demo000018");
  for (const rec of store.missingActivity(10)) { const at = await store.lastActivity(rec.threadId, rec.createdAt); if (at !== null) store.fillActivity(rec.threadId, at); }
  expect(store.get("thr_demo000018")!.activityAt).toBe(1787609304726);
  const view = threadsView("bot_dot", store.all("bot_dot"), threads, now);
  expect(view.conversations.map((each) => each.threadId)).toEqual(["thr_main"]);
  expect(view.olderConversations).toBe(1);
  expect(olderView("bot_dot", store.all("bot_dot"), threads, now).conversations[0]).toMatchObject({ threadId: "thr_demo000018", updatedAt: 1787609304726 });
  // Real use moves it again: a turn ending now.
  store.idle("thr_demo000018", "Picked it back up");
  expect(threadsView("bot_dot", store.all("bot_dot"), threads, Date.now()).conversations.map((each) => each.threadId)).toContain("thr_demo000018");
  // A lazy fill of the latest line doesn't count as activity.
  db.prepare("UPDATE bot_threads SET latest = NULL, latest_at = NULL, activity_at = 5 WHERE thread_id = 'thr_main'").run();
  store.fillLatest("thr_main", "Morning card");
  expect(store.get("thr_main")!.latest).toEqual({ text: "Morning card", at: 5 });
});

it("keeps a hidden \"Reply in thread\" side thread of Main a conversation, over the hidden and spawned rules, live, in the backfill and in the pass", async () => {
  // Studio's record (bot_side_threads) names thr_side: a hidden fork of Main, owned by it, at msg_7.
  const side: ThreadFacts = { id: "thr_side", originKind: "fork", sourceThreadId: "thr_main", lifecycleOwnerThreadId: "thr_main", visibility: "hidden", createdAt: 5 };
  // BB's side-chat plugin's own: no Studio record, its plugin says what it is.
  const chat: ThreadFacts = { id: "thr_demo000002", originKind: "fork", originPluginId: "side-chat", sourceThreadId: "thr_main", lifecycleOwnerThreadId: "thr_main", visibility: "hidden", createdAt: 6 };
  expect(classifyThread(side, signals(), none)).toMatchObject({ botId: "bot_dot", kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "msg_7" }, authoritative: true });
  expect(classifyThread(chat, signals(), none)).toMatchObject({ botId: "bot_dot", kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: null }, authoritative: true });
  const { store, db } = setup([{ id: "thr_main", createdAt: 1 }, side, chat]);
  await store.backfill();
  expect(store.get("thr_side")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "msg_7" } });
  expect(store.get("thr_demo000002")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main" } });
  // Live.
  await store.created({ ...chat, id: "thr_live_chat" });
  expect(store.get("thr_live_chat")).toMatchObject({ kind: "conversation" });
  // Rows an earlier pass made workers come back.
  db.prepare("UPDATE bot_threads SET kind = 'worker', owner_conversation_id = 'thr_main', forked_from_thread_id = NULL, forked_from_message_id = NULL, source = 'reconciled' WHERE thread_id IN ('thr_side', 'thr_demo000002')").run();
  expect(await store.reclassifyForks(await store.facts(["thr_side", "thr_demo000002"]))).toBe(2);
  expect(store.get("thr_side")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "msg_7" }, ownerConversationId: null });
  expect(store.get("thr_demo000002")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main" } });
  // An agent's hidden fork stays a worker in the same pass.
  db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, owner_conversation_id, source, created_at, updated_at) VALUES ('agent_w', 'bot_dot', 'worker', 0, 'thr_main', 'reconciled', 7, 7)").run();
  expect(await store.reclassifyForks(new Map([["agent_w", { id: "agent_w", originKind: "fork", sourceThreadId: "thr_main", visibility: "hidden" }]]))).toBe(0);
});

it("lists every Bot's open conversations latest activity first for the New Tab page", () => {
  const { store, tick } = setup([]);
  store.recordConversation("thr_a", "bot_dot");
  tick(1000);
  store.recordConversation("thr_b", "bot_scout");
  tick(1000);
  store.recordConversation("thr_c", "bot_dot");
  store.fillActivity("thr_a", 5_000_000);
  store.update("thr_c", { archived: true });
  expect(store.recent(10).map((rec) => rec.threadId)).toEqual(["thr_a", "thr_b"]);
  expect(store.recent(1).map((rec) => rec.threadId)).toEqual(["thr_a"]);
});

it("counts a thread as running only once a turn can be under way", () => {
  expect(threadRunning({ status: "pending", queuedMessageCount: 0 })).toBe(false);
  expect(threadRunning({ status: "pending" })).toBe(false);
  expect(threadRunning({ status: "pending", queuedMessageCount: 1 })).toBe(true);
  expect(threadRunning({ status: "active" })).toBe(true);
  expect(threadRunning({ status: "idle" })).toBe(false);
  expect(workerStatus({ status: "pending", queuedMessageCount: 0 })).toBe("done");
});
