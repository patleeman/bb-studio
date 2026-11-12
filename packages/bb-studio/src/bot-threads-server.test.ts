import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import type { ThreadFacts } from "./bot-threads";
import { libraryItems, libraryKind, registerBotThreads } from "./bot-threads-server";
import type { IndexedItem } from "./item-index";
import { MIGRATIONS } from "./migrations";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

/**
 * Dot (primary, Main thr_main) and Home (Main thr_home). Patrick's
 * conversation "redesign" started the worker "lead", which started "review".
 */
async function setup() {
  const threads = new Map<string, ThreadFacts>([
    ["thr_main", { id: "thr_main", title: "Chief of Staff", projectId: "proj_personal", createdAt: 1, status: "idle" }],
    ["thr_home", { id: "thr_home", title: "Home", projectId: "proj_personal", createdAt: 2, status: "idle" }],
    ["redesign", { id: "redesign", title: "Fork redesign", projectId: "proj_studio", createdAt: 3, status: "idle", hasPendingInteraction: false }],
    ["lead", { id: "lead", title: "Fable lead: sidebar rewrite", projectId: "proj_studio", parentThreadId: "redesign", createdAt: 4, status: "active", environmentBranchName: "exp/studio-native", environmentPath: "/w/bb-studio-native" }],
    ["review", { id: "review", title: "Reviewer", projectId: "proj_studio", parentThreadId: "lead", createdAt: 5, updatedAt: Date.now(), status: "idle" }],
  ]);
  const send = vi.fn(async (_args: unknown) => ({ ok: true }));
  const fork = vi.fn(async (args: { sourceThreadId: string }) => {
    const id = `fork_${threads.size}`;
    // BB's fork of a busy thread: the classification alone would call it an agent's (a worker).
    threads.set(id, { id, title: "Fork", projectId: "proj_studio", originKind: "fork", sourceThreadId: args.sourceThreadId, createdAt: 9, status: "idle" });
    return { id, projectId: "proj_studio", providerId: "claude" };
  });
  // + New's threads, and what each thread runs on (threads.update changes the model in place).
  const spawn = vi.fn(async (args: { projectId: string; providerId: string; model: string }) => {
    const id = `new_${threads.size}`;
    threads.set(id, { id, title: null, projectId: args.projectId, createdAt: 10, status: "active" });
    models.set(id, args.model);
    return { id, projectId: args.projectId };
  });
  const models = new Map<string, string>();
  const update = vi.fn(async ({ threadId, model }: { threadId: string; model?: string }) => { if (model) models.set(threadId, model); return {}; });
  /** Each Bot's default model (src/bot.ts). */
  const defaults = new Map<string, { providerId: string; model: string; reasoning: "low" | "medium" | "high" | null }>();
  const lastEvent = new Map<string, number>();
  const interactions = new Map<string, unknown[]>();
  /** Each thread's replies, newest first (item/completed agentMessage events). */
  const replies = new Map<string, string[]>([["thr_main", ["[PASS]", "[PASS]", "Morning brief is out: 3 things for today", "older"]]]);
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: (async (args: { threadIds?: string[]; offset?: number; limit?: number }) => [...threads.values()].filter((thread) => !args.threadIds || args.threadIds.includes(thread.id)).slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 200))) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw new Error("Not found"); return thread; }) as never,
      output: (async ({ threadId }: { threadId: string }) => ({ output: threadId === "redesign" ? "UX review is back with two notes" : null })) as never,
      send: send as never,
      fork: fork as never,
      spawn: spawn as never,
      update: update as never,
      interactions: { list: (async ({ threadId }: { threadId: string }) => interactions.get(threadId) ?? []) as never } as never,
      // Each thread's latest real event: now, unless a test says otherwise.
      events: { list: (async ({ threadId, types }: { threadId: string; types?: string[] }) => types?.includes("item/completed") && replies.has(threadId)
        ? replies.get(threadId)!.map((text, at) => ({ seq: 10 - at, type: "item/completed", data: { item: { type: "agentMessage", text } } }))
        : [{ seq: 1, type: "turn/completed", createdAt: lastEvent.get(threadId) ?? Date.now() }]) as never },
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const changed = vi.fn();
  const server = registerBotThreads(bb, db, {
    bots: () => [{ id: "dot", name: "Dot", avatar: "🤖", primary: true, threadId: "thr_main" }, { id: "home", name: "Home", avatar: "🏠", threadId: "thr_home", theme: { colors: ["#22c55e"], mode: "light", grain: 0 } } as never],
    signals: () => ({ bots: [{ id: "dot", threadId: "thr_main", chain: ["thr_main"] }, { id: "home", threadId: "thr_home", chain: ["thr_home"] }], sideThread: () => null, runnerBot: () => null, leadThreads: new Set(), internal: new Set(), managedBot: () => null }),
    items: () => [],
    originThreads: () => new Map(),
    changed, log: () => {},
    actingBot: async () => null,
    defaultModel: (botId) => defaults.get(botId) ?? null,
  });
  await server.start();
  return { bb, harness, server, threads, send, fork, spawn, update, models, defaults, changed, lastEvent, replies, interactions };
}

it("answers a Bot's sidebar and one thread's place for the main view", async () => {
  const { server } = await setup();
  const view = await server.rpc.bot_threads_view({});
  expect(view.botId).toBe("dot");
  // Main's second line is its newest reply that says something, past its quiet [PASS] turns.
  expect(view.conversations.map((each) => [each.title, each.latest])).toEqual([["Main", "Morning brief is out: 3 things for today"], ["Fork redesign", "UX review is back with two notes"]]);
  expect(view.workers.map((each) => [each.title, each.status, each.ownerTitle, each.tag])).toEqual([["Fable lead: sidebar rewrite", "running", "Fork redesign", "bb-studio-native"], ["Reviewer", "done", "Fork redesign", null]]);
  const worker = (await server.rpc.bot_thread_info({ threadId: "review" })).info!;
  expect(worker).toMatchObject({ kind: "worker", botName: "Dot", owner: { threadId: "redesign", title: "Fork redesign" }, status: "done", waitingOn: null, startedAt: 5, workers: [] });
  const conversation = (await server.rpc.bot_thread_info({ threadId: "redesign" })).info!;
  expect(conversation).toMatchObject({ kind: "conversation", status: null, owner: null });
  // The line above its composer: what is going on first.
  expect(conversation.workers.map((each) => [each.threadId, each.status])).toEqual([["lead", "running"], ["review", "done"]]);
  expect((await server.rpc.bot_thread_info({ threadId: "nope" })).info).toBeNull();
});

it("follows the Bot the sidebar shows: Patrick's next thread is its conversation, and its dot turns amber when it needs him", async () => {
  const { server, harness, threads } = await setup();
  server.rpc.bot_focus({ botId: "home" });
  expect(() => server.rpc.bot_focus({ botId: "gone" })).toThrow();
  threads.set("trip", { id: "trip", title: "Great Wolf Lodge trip", createdAt: 9 });
  await harness.emitThreadEvent("thread.created", { thread: threads.get("trip") as never });
  expect(server.store.get("trip")).toMatchObject({ botId: "home", kind: "conversation" });
  expect((await server.rpc.bot_threads_view({})).botId).toBe("home");
  expect((await server.rpc.bot_spaces()).bots.map((bot) => [bot.id, bot.needsYou])).toEqual([["dot", false], ["home", false]]);
  server.rpc.bot_needs_you_set({ threadId: "trip", reason: "Pick a check-in time" });
  const spaces = await server.rpc.bot_spaces();
  expect(spaces.currentBotId).toBe("home");
  expect(spaces.bots.map((bot) => [bot.id, bot.needsYou])).toEqual([["dot", false], ["home", true]]);
  for (const each of spaces.bots) expect(each).not.toHaveProperty("theme");
});

it("a turn starting or ending in another Bot's thread shows in the switcher at the next read, not after the facts cache runs out", async () => {
  const { server, harness, threads } = await setup();
  expect((await server.rpc.bot_spaces()).bots.find((bot) => bot.id === "home")?.activity).toEqual({ turn: false, workers: 0 });
  threads.set("thr_home", { ...threads.get("thr_home")!, status: "active" });
  await harness.emitThreadEvent("thread.active", { thread: threads.get("thr_home") as never });
  expect((await server.rpc.bot_spaces()).bots.find((bot) => bot.id === "home")?.activity).toEqual({ turn: true, workers: 0 });
  threads.set("thr_home", { ...threads.get("thr_home")!, status: "idle" });
  await harness.emitThreadEvent("thread.idle", { thread: threads.get("thr_home") as never, lastAssistantText: "Done" } as never);
  expect((await server.rpc.bot_spaces()).bots.find((bot) => bot.id === "home")?.activity).toEqual({ turn: false, workers: 0 });
});

it("sends a question about a worker to the Bot in the conversation that started it, with a link to the worker", async () => {
  const { server, send } = await setup();
  expect(await server.rpc.bot_worker_ask({ threadId: "review", text: " Is it done? " })).toEqual({ conversationId: "redesign", projectId: "proj_studio" });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ threadId: "redesign", mode: "auto", input: [{ type: "text", text: "About the worker [Reviewer](/projects/proj_studio/threads/review): Is it done?", mentions: [] }] }));
  await expect(server.rpc.bot_worker_ask({ threadId: "redesign", text: "hi" })).rejects.toThrow(/isn't a worker/);
});

it("lets a conversation raise something with the user, and refuses it in a worker", async () => {
  const { server, harness } = await setup();
  expect(await harness.callAgentTool("bot_needs_you", { reason: "Approve the push" }, { threadId: "redesign" })).toMatch(/Marked/);
  expect(server.store.get("redesign")!.needsYou?.reason).toBe("Approve the push");
  expect(await harness.callAgentTool("bot_needs_you", { reason: "x" }, { threadId: "lead" })).toMatch(/worker doesn't talk to the user/);
  expect(await harness.callAgentTool("bot_needs_you", { reason: null }, { threadId: "redesign" })).toBe("Cleared.");
  const listed = String(await harness.callAgentTool("bot_conversations", {}, { threadId: "redesign" }));
  expect(listed).toContain("- Main (/threads/thr_main) [Main]");
  expect(listed).toContain("- Fable lead: sidebar rewrite (/threads/lead): running, from Fork redesign, in bb-studio-native (exp/studio-native)");
  // The old name lists the same.
  expect(String(await harness.callAgentTool("bot_threads_list", {}, { threadId: "redesign" }))).toBe(listed);
});

it("follows BB's archive and delete", async () => {
  const { server, harness, threads } = await setup();
  await harness.emitThreadEvent("thread.archived", { thread: threads.get("redesign") as never });
  expect((await server.rpc.bot_threads_view({})).conversations.map((each) => each.threadId)).toEqual(["thr_main"]);
  await harness.emitThreadEvent("thread.unarchived", { thread: threads.get("redesign") as never });
  expect(server.store.get("redesign")!.archivedAt).toBeNull();
  await harness.emitThreadEvent("thread.deleted", { thread: threads.get("redesign") as never });
  expect(server.store.get("redesign")).toBeNull();
  expect(server.store.get("lead")!.ownerConversationId).toBe("thr_main");
});

const indexed = (over: Partial<IndexedItem> & { id: string }): IndexedItem => ({ pluginId: "pages", family: "page", type: "doc", title: over.id, projectId: null, parentId: null, createdAt: 1, updatedAt: 1, archived: false, template: false, ...over });

it("lists the Bot's files: what its conversations and workers made, and for the primary Bot what Patrick made himself", () => {
  const records = new Map([
    ["redesign", { botId: "dot", kind: "conversation" as const, threadId: "redesign", ownerConversationId: null }],
    ["lead", { botId: "dot", kind: "worker" as const, threadId: "lead", ownerConversationId: "redesign" }],
    ["trip", { botId: "home", kind: "conversation" as const, threadId: "trip", ownerConversationId: null }],
  ]);
  const items = [
    indexed({ id: "pg_plan", updatedAt: 5 }),
    indexed({ id: "art_diff", pluginId: "artifacts", family: "app", type: "artifact", updatedAt: 9 }),
    indexed({ id: "pg_trip", updatedAt: 7 }),
    indexed({ id: "pg_mine", updatedAt: 3 }),
    indexed({ id: "pg_old", archived: true }),
    indexed({ id: "pg_tpl", template: true }),
  ];
  const origins = new Map([["pages:pg_plan", "redesign"], ["artifacts:art_diff", "lead"], ["pages:pg_trip", "trip"]]);
  const titles: Record<string, string> = { redesign: "Fork redesign", lead: "Fable lead", trip: "Trip" };
  const list = (botId: string) => libraryItems({ botId, primaryId: "dot", items, origins, record: (id) => (records.get(id) as never) ?? null, title: (id) => titles[id] ?? id });
  expect(list("dot").map((each) => [each.id, each.kind, each.madeIn?.kind ?? null, each.madeIn?.conversationTitle ?? null])).toEqual([
    ["art_diff", "artifact", "worker", "Fork redesign"], ["pg_plan", "page", "conversation", "Fork redesign"], ["pg_mine", "page", null, null],
  ]);
  expect(list("home").map((each) => each.id)).toEqual(["pg_trip"]);
  expect(list("dot")[1]!.href).toBe("/plugins/studio/studio/pages/pg_plan");
  expect(["doc", "whiteboard", "design", "mini", "dashboard", "artifact", null].map(libraryKind)).toEqual(["page", "whiteboard", "design", "app", "app", "artifact", "other"]);
  // Made through a conversation by one of the Bot's workers (its first activity names the worker): the worker gets the credit.
  const credited = libraryItems({ botId: "dot", primaryId: "dot", items, origins, creators: new Map([["pages:pg_plan", "lead"], ["pages:pg_trip", "lead"]]), record: (id) => (records.get(id) as never) ?? null, title: (id) => titles[id] ?? id });
  expect(credited.find((each) => each.id === "pg_plan")!.madeIn).toMatchObject({ threadId: "lead", kind: "worker", conversationTitle: "Fork redesign" });
  // Not across Bots: Trip is Home's conversation, the lead Dot's worker.
  expect(credited.some((each) => each.id === "pg_trip")).toBe(false);
});

it("lists what the sidebar leaves out, and finished conversations, for the older list; info says when one is finishing", async () => {
  const { server, threads, bb, lastEvent } = await setup();
  const db = bb.storage.database();
  const old = Date.now() - 30 * 24 * 60 * 60_000;
  lastEvent.set("stale", old);
  // Mirrored by the fork's importer a minute ago: BB's updated_at and the row's times are the copy's, its last real event is a month old.
  threads.set("stale", { id: "stale", title: "GORUCK return", createdAt: old, updatedAt: Date.now() - 60_000, status: "idle" });
  db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, source, created_at, updated_at, latest, latest_at) VALUES ('stale', 'dot', 'conversation', 0, 'created', ?, ?, 'Return window ends Nov 15', ?)").run(Date.now(), Date.now(), Date.now() - 60_000);
  db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, title, source, created_at, updated_at, archived_at, finished_summary) VALUES ('prep', 'dot', 'conversation', 0, 'Launch prep', 'created', 1, 1, 50, '**Decisions**')").run();
  const view = await server.rpc.bot_threads_view({});
  expect(view.olderConversations).toBe(1);
  expect(view.conversations.map((each) => each.threadId)).not.toContain("stale");
  const older = await server.rpc.bot_threads_older({});
  expect(older.conversations.map((each) => [each.threadId, each.title, each.updatedAt])).toEqual([["stale", "GORUCK return", old]]);
  expect(older.finished).toEqual([{ threadId: "prep", title: "Launch prep", finishedAt: 50, summary: "**Decisions**" }]);
  expect((await server.rpc.bot_thread_info({ threadId: "redesign" })).info!.finishing).toBe(false);
  db.prepare("INSERT INTO bot_finishes (thread_id, bot_id, title, state, requested_at, deadline_at) VALUES ('redesign', 'dot', 'Fork redesign', 'finishing', 1, 2)").run();
  expect((await server.rpc.bot_thread_info({ threadId: "redesign" })).info!.finishing).toBe(true);
});

it("moves forks agents made, recorded as conversations by an earlier start, to workers once at the next start", async () => {
  const { server, threads, bb } = await setup();
  const db = bb.storage.database();
  threads.set("lane1", { id: "lane1", title: "EvalHarvest audit lane 1", originKind: "fork", visibility: "hidden", sourceThreadId: "redesign", createdAt: 9, status: "idle" });
  db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, forked_from_thread_id, source, created_at, updated_at) VALUES ('lane1', 'dot', 'conversation', 0, 'redesign', 'backfill', 9, 9)").run();
  // The marker was set by the first start: nothing moves until it is cleared (a store from before the rule has none).
  await server.start();
  expect(server.store.get("lane1")!.kind).toBe("conversation");
  // A store that ran the first version of the pass (v1) runs this one.
  db.prepare("DELETE FROM bot_threads_state WHERE key = 'reclassified_forks_v3'").run();
  server.store.mark("reclassified_forks_v1");
  await server.start();
  expect(server.store.get("lane1")).toMatchObject({ kind: "worker", ownerConversationId: "redesign", forkedFrom: null });
  expect(server.store.marked("reclassified_forks_v3")).toBe(true);
});

it("clears a worker's mark on its conversation once the worker stops waiting, however it was answered", async () => {
  const { server, threads } = await setup();
  server.store.setNeedsYou("redesign", "Approve: git push --force", "lead");
  threads.set("lead", { ...threads.get("lead")!, hasPendingInteraction: true });
  expect((await server.rpc.bot_threads_view({})).conversations.find((each) => each.threadId === "redesign")!.needsYou?.reason).toBe("Approve: git push --force");
  // Answered in BB (or from the card); a read made well after the mark.
  const marked = server.store.get("redesign")!.needsYou!.at;
  vi.useFakeTimers({ now: marked + 10_000, toFake: ["Date"] });
  try {
    threads.set("lead", { ...threads.get("lead")!, hasPendingInteraction: false });
    expect((await server.rpc.bot_threads_view({})).conversations.find((each) => each.threadId === "redesign")!.needsYou).toBeNull();
    expect(server.store.get("redesign")!.needsYou).toBeNull();
  } finally { vi.useRealTimers(); }
});

it("lists the approvals a conversation's workers wait on, for its live cards; a worker with no conversation's go to Main", async () => {
  const { server, threads, interactions } = await setup();
  const approval = (id: string, at: number) => ({ id, status: "pending", createdAt: at, payload: { kind: "approval", reason: null, availableDecisions: ["allow_once", "deny"], subject: { kind: "command", itemId: "i", command: `git push ${id}` } } });
  threads.set("lead", { ...threads.get("lead")!, hasPendingInteraction: true });
  interactions.set("lead", [approval("int_2", 2), { id: "int_q", status: "pending", payload: { kind: "user_question" } }, { ...approval("int_old", 0), status: "resolved" }, approval("int_1", 1)]);
  const listed = await server.rpc.bot_conversation_approvals({ threadId: "redesign" });
  expect(listed.approvals.map((each) => [each.worker.threadId, each.approval.id, each.approval.short])).toEqual([["lead", "int_1", "git push int_1"], ["lead", "int_2", "git push int_2"]]);
  expect((await server.rpc.bot_conversation_approvals({ threadId: "thr_main" })).approvals).toEqual([]);
  expect((await server.rpc.bot_conversation_approvals({ threadId: "lead" })).approvals).toEqual([]);
  // Its conversation finished: the approval shows in Main.
  server.store.archived("redesign", true);
  expect((await server.rpc.bot_conversation_approvals({ threadId: "thr_main" })).approvals.map((each) => each.approval.id)).toEqual(["int_1", "int_2"]);
  // BB says it no longer waits: no card.
  threads.set("lead", { ...threads.get("lead")!, hasPendingInteraction: false });
  await new Promise((resolve) => setTimeout(resolve, 3_100));
  expect((await server.rpc.bot_conversation_approvals({ threadId: "thr_main" })).approvals).toEqual([]);
}, 10_000);

it("forks a conversation from a message: BB forks after it, and the fork is the same Bot's conversation linked back, whatever was guessed first", async () => {
  const { server, fork, threads } = await setup();
  threads.set("redesign", { ...threads.get("redesign")!, status: "active" });
  const made = await server.rpc.bot_fork_conversation({ threadId: "redesign", messageId: "msg_7", turnId: "turn_3", sourceSeqEnd: 42 });
  expect(fork).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "redesign", sourceSeqEnd: 42, visibility: "visible" }));
  expect(made).toEqual({ threadId: "fork_5", projectId: "proj_studio" });
  // BB's thread.created comes after: it doesn't move Patrick's fork.
  await server.store.created(threads.get("fork_5")!);
  expect(server.store.get("fork_5")).toMatchObject({ botId: "dot", kind: "conversation", forkedFrom: { threadId: "redesign", messageId: "msg_7", turnId: "turn_3" }, source: "user" });
  const view = await server.rpc.bot_threads_view({});
  expect(view.conversations.find((each) => each.threadId === "fork_5")?.forkedFrom).toMatchObject({ threadId: "redesign", title: "Fork redesign" });
  await expect(server.rpc.bot_fork_conversation({ threadId: "nope", messageId: "m", turnId: null, sourceSeqEnd: 1 })).rejects.toThrow(/isn't one of a Bot's/);
});

const newRequest = (model: string) => ({
  projectId: "proj_personal", providerId: "claude", model, reasoningLevel: "high" as const, permissionMode: "accept-edits" as const,
  executionInputSources: { providerId: "explicit" as const, model: "explicit" as const }, environment: { type: "project-default" }, input: [{ type: "text", text: "Plan the trip", mentions: [] }],
}) as never;

it("+ New starts a conversation of that Bot on the model its composer sent, and a later default switches no conversation", async () => {
  const { server, spawn, update, models, defaults, threads } = await setup();
  defaults.set("home", { providerId: "claude", model: "opus", reasoning: "high" });
  // The composer was seeded with the default and Patrick kept it.
  const first = await server.rpc.bot_conversation_start({ botId: "home", request: newRequest("opus") });
  expect(spawn).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: "claude", model: "opus", pluginMetadata: { botConversation: "home" } }));
  expect(server.store.get(first.threadId)).toMatchObject({ botId: "home", kind: "conversation", isMain: false, source: "user" });
  // BB's thread.created comes after: the conversation stays Home's.
  await server.store.created(threads.get(first.threadId)!);
  expect(server.store.get(first.threadId)).toMatchObject({ botId: "home", kind: "conversation" });
  // A second one where Patrick picked another model before sending.
  const second = await server.rpc.bot_conversation_start({ botId: "home", request: newRequest("sonnet") });
  expect(models.get(second.threadId)).toBe("sonnet");
  // The default changes: both conversations keep their model.
  defaults.set("home", { providerId: "claude", model: "haiku", reasoning: "low" });
  await server.rpc.bot_threads_view({ botId: "home" });
  expect(update).not.toHaveBeenCalled();
  expect([models.get(first.threadId), models.get(second.threadId)]).toEqual(["opus", "sonnet"]);
  await expect(server.rpc.bot_conversation_start({ botId: "nope", request: newRequest("opus") })).rejects.toThrow(/No Bot/);
});

it("Ask from the omnibar sends to a conversation (a worker's goes to its conversation), or starts a new one of the Bot on its default model", async () => {
  const { server, send, spawn, defaults } = await setup();
  expect(await server.rpc.bot_ask({ text: "Status?", to: { kind: "thread", threadId: "redesign" } })).toEqual({ threadId: "redesign", projectId: "proj_studio" });
  expect(send).toHaveBeenLastCalledWith({ threadId: "redesign", mode: "auto", input: [{ type: "text", text: "Status?", mentions: [] }] });
  expect((await server.rpc.bot_ask({ text: "Done?", to: { kind: "thread", threadId: "review" } })).threadId).toBe("redesign");
  defaults.set("home", { providerId: "claude", model: "opus", reasoning: "high" });
  const made = await server.rpc.bot_ask({ text: "Plan the trip", to: { kind: "new", botId: "home" } });
  expect(spawn).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "proj_personal", providerId: "claude", model: "opus", reasoningLevel: "high", pluginMetadata: { botConversation: "home" }, input: [{ type: "text", text: "Plan the trip", mentions: [] }] }));
  expect(server.store.get(made.threadId)).toMatchObject({ botId: "home", kind: "conversation", isMain: false });
  expect((await server.rpc.bot_spaces()).currentBotId).toBe("home");
  defaults.delete("home");
  const plain = await server.rpc.bot_ask({ text: "Hi", to: { kind: "new", botId: null } });
  expect(spawn.mock.lastCall?.[0]).not.toHaveProperty("model");
  expect(server.store.get(plain.threadId)).toMatchObject({ botId: "home", kind: "conversation" });
  await expect(server.rpc.bot_ask({ text: "Hi", to: { kind: "new", botId: "nope" } })).rejects.toThrow(/No Bot/);
});

it("a fork from a message starts on the Bot's default model on the fork's provider, else keeps its source's", async () => {
  const { server, update, defaults } = await setup();
  defaults.set("dot", { providerId: "claude", model: "sonnet", reasoning: "medium" });
  const made = await server.rpc.bot_fork_conversation({ threadId: "redesign", messageId: "msg_1", turnId: null, sourceSeqEnd: 4 });
  expect(update).toHaveBeenCalledWith({ threadId: made.threadId, model: "sonnet", reasoningLevel: "medium" });
  expect(update).toHaveBeenCalledTimes(1);
  // A default on another provider: BB keeps a fork on its source's provider, so the fork keeps the source's model.
  defaults.set("dot", { providerId: "codex", model: "gpt-5", reasoning: null });
  await server.rpc.bot_fork_conversation({ threadId: "redesign", messageId: "msg_2", turnId: null, sourceSeqEnd: 5 });
  expect(update).toHaveBeenCalledTimes(1);
});
