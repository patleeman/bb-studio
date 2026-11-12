import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { BotThreads, type Signals, type ThreadFacts } from "./bot-threads";
import { buildDigest, DIGEST_HEADER, digestFor, registerLiveActivity, registerTurnContext, toolTitle, type DigestConversation, type DigestWorker } from "./live-activity";
import { MIGRATIONS } from "./migrations";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = 1_000 * HOUR;

/**
 * Dot (primary, Main thr_main) with conversations "redesign" (Fork redesign)
 * and "prep" (Launch prep), workers "lead" (from redesign) and "review"
 * (from prep); Scout (Main thr_scout) with its own conversation "trip".
 */
async function setup(options: { hook?: boolean } = {}) {
  const threads = new Map<string, ThreadFacts>([
    ["thr_main", { id: "thr_main", title: "Chief of Staff", createdAt: 1, status: "idle" }],
    ["thr_scout", { id: "thr_scout", title: "Scout", createdAt: 2, status: "idle" }],
    ["redesign", { id: "redesign", title: "Fork redesign", createdAt: 3, status: "idle" }],
    ["prep", { id: "prep", title: "Launch prep", createdAt: 4, status: "idle" }],
    ["lead", { id: "lead", title: "Fable lead: sidebar rewrite", createdAt: 5, parentThreadId: "redesign", status: "active", environmentBranchName: "exp/studio-native", environmentPath: "/w/bb-studio-native" }],
    ["review", { id: "review", title: "Reviewer: plan page", createdAt: 6, parentThreadId: "prep", status: "idle" }],
    ["trip", { id: "trip", title: "Great Wolf trip", createdAt: 7, status: "idle" }],
  ]);
  const events = vi.fn(async (_args: unknown): Promise<unknown[]> => []);
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: (async (args: { threadIds?: string[]; offset?: number; limit?: number }) => [...threads.values()].filter((thread) => !args.threadIds || args.threadIds.includes(thread.id)).slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 200))) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw new Error("Not found"); return thread; }) as never,
      events: { list: events as never },
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  let now = T0;
  const signals: Signals = {
    bots: [{ id: "dot", threadId: "thr_main", chain: ["thr_main"] }, { id: "scout", threadId: "thr_scout", chain: ["thr_scout"] }],
    focusedBotId: null, sideThread: () => null, runnerBot: () => null, leadThreads: new Set(), internal: new Set(), managedBot: () => null,
  };
  const store = new BotThreads({ db, sdk: bb.sdk, signals: () => signals, changed: () => {}, now: () => now });
  await store.backfill();
  // Trip is Scout's.
  db.prepare("UPDATE bot_threads SET bot_id = 'scout' WHERE thread_id = 'trip'").run();
  const turnContext = vi.fn();
  if (options.hook) Object.assign(bb.experimental_hooks as object, { experimental_turnContext: turnContext });
  const live = registerLiveActivity(bb, db, { threads: store, actingBot: async () => null, log: () => {}, now: () => now });
  return { bb, harness, db, store, live, threads, events, turnContext, tick: (ms: number) => { now += ms; }, now: () => now };
}

it("keeps one row per thread from BB's events: running, its reply's first line when idle, failed, waiting, gone", async () => {
  const x = await setup();
  const thread = x.threads.get("lead")!;
  await x.harness.emitThreadEvent("thread.created", { thread: thread as never });
  expect(x.live.activity.get("lead")).toMatchObject({ state: "running", title: "Fable lead: sidebar rewrite", tag: "bb-studio-native", branch: "exp/studio-native" });
  await x.harness.emitThreadEvent("thread.active", { thread: thread as never });
  expect(x.live.activity.get("lead")).toMatchObject({ state: "running", startedAt: T0 });
  x.tick(5 * MIN);
  await x.harness.emitThreadEvent("thread.idle", { thread: thread as never, lastAssistantText: "**Sidebar done.** Two notes left.\n\nDetails…" } as never);
  expect(x.live.activity.get("lead")).toMatchObject({ state: "idle", line: "Sidebar done. Two notes left.", endedAt: T0 + 5 * MIN });
  // A quiet [PASS] keeps the last line.
  await x.harness.emitThreadEvent("thread.idle", { thread: thread as never, lastAssistantText: "[PASS]" } as never);
  expect(x.live.activity.get("lead")!.line).toBe("Sidebar done. Two notes left.");
  await x.harness.emitThreadEvent("interaction.pending", { thread: thread as never } as never);
  expect(x.live.activity.get("lead")!.state).toBe("needs-you");
  await x.harness.emitThreadEvent("thread.failed", { thread: thread as never, error: "boom" } as never);
  expect(x.live.activity.get("lead")!.state).toBe("failed");
  await x.harness.emitThreadEvent("thread.deleted", { thread: thread as never });
  expect(x.live.activity.get("lead")).toBeNull();
});

it("fills rows for the Bots' threads that have none from BB's records, as old as BB says", async () => {
  const x = await setup();
  x.threads.set("redesign", { ...x.threads.get("redesign")!, updatedAt: T0 - 2 * HOUR });
  await x.live.start();
  expect(x.live.activity.get("lead")).toMatchObject({ state: "running" });
  expect(x.live.activity.get("redesign")).toMatchObject({ state: "idle", updatedAt: T0 - 2 * HOUR });
  // Rows already there are left alone.
  x.live.activity.idle({ id: "lead" }, "Done");
  await x.live.start();
  expect(x.live.activity.get("lead")!.state).toBe("idle");
});

const conv = (over: Partial<DigestConversation> & { threadId: string }): DigestConversation => ({ title: over.threadId, isMain: false, running: false, needsYou: null, line: null, at: T0, ...over });
const work = (over: Partial<DigestWorker> & { threadId: string }): DigestWorker => ({ title: over.threadId, status: "running", owner: null, tag: null, at: T0, ...over });

it("builds the digest newest first in each part, with states, ages, owners and tags", () => {
  const text = buildDigest({
    now: T0,
    conversations: [
      conv({ threadId: "old", title: "GORUCK return", at: T0 - 3 * HOUR, line: "Return window ends Nov 15" }),
      conv({ threadId: "thr_main", title: "Main", isMain: true, running: true, at: T0 - 1 * MIN }),
      conv({ threadId: "trunc", title: "Tree truncation", needsYou: "cut titles at the end or the middle?", at: T0 - 30 * MIN }),
    ],
    workers: [
      work({ threadId: "ios", title: "Codex: iOS build", status: "failed", owner: "Main", tag: "bb-studio", at: T0 - 2 * HOUR }),
      work({ threadId: "lead", title: "Fable lead", owner: "this conversation", tag: "bb-studio-native", at: T0 - 5 * MIN }),
    ],
  });
  expect(text.split("\n")).toEqual([
    DIGEST_HEADER,
    "Conversations:",
    "- Main (thr_main) working · 1m ago",
    "- \"Tree truncation\" (trunc) needs the user: cut titles at the end or the middle? · 30m ago",
    "- \"GORUCK return\" (old) idle · 3h ago · \"Return window ends Nov 15\"",
    "Workers:",
    "- \"Fable lead\" (lead) running · 5m ago · for this conversation · bb-studio-native",
    "- \"Codex: iOS build\" (ios) failed · 2h ago · for \"Main\" · bb-studio",
    "Details: bot_activity_lookup { threadId }; the full list: bot_conversations.",
  ]);
  expect(buildDigest({ now: T0, conversations: [], workers: [] })).toMatch(/^Elsewhere: no other conversation was active/);
});

it("caps the digest and counts what didn't fit", () => {
  const conversations = Array.from({ length: 40 }, (_, n) => conv({ threadId: `c${n}`, title: `Conversation number ${n} with a longer title`, at: T0 - n * MIN, line: "A latest line that takes some room in the digest" }));
  const workers = Array.from({ length: 10 }, (_, n) => work({ threadId: `w${n}`, at: T0 - n * MIN }));
  const text = buildDigest({ now: T0, conversations, workers, cap: 1500 });
  expect(text.length).toBeLessThanOrEqual(1500);
  const shown = text.split("\n").filter((line) => line.startsWith("- ")).length;
  expect(text).toContain(`…and ${50 - shown} more. Details: bot_activity_lookup`);
  // The newest ones are the ones kept.
  expect(text).toContain("(c0)");
  expect(text).not.toContain("(c39)");
});

it("gives a conversation the others of its own Bot: not itself, not archived, not stale, not another Bot's; a worker one line", async () => {
  const x = await setup();
  await x.live.start();
  x.live.activity.idle({ id: "thr_main" }, "Morning card is out");
  x.live.activity.idle({ id: "review" }, "Plan page reviewed");
  x.store.idle("prep", "Deep dives reached at minute 24");
  x.store.setNeedsYou("redesign", "Approve the push", "bot");
  // An idle conversation from two days ago, and an archived one: left out.
  x.db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, source, created_at, updated_at, latest, latest_at) VALUES ('stale', 'dot', 'conversation', 0, 'created', 1, 1, 'Old news', ?)").run(T0 - 48 * HOUR);
  x.db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, source, created_at, updated_at, archived_at) VALUES ('gone', 'dot', 'conversation', 0, 'created', ?, 1, 5)").run(T0);
  const text = digestFor(x.db, "prep", x.now())!;
  expect(text).toContain("- Main (thr_main) idle · now · \"Morning card is out\"");
  expect(text).toContain("- \"Fork redesign\" (redesign) needs the user: Approve the push");
  expect(text).toContain("- \"Fable lead: sidebar rewrite\" (lead) running");
  expect(text).toContain("for \"Fork redesign\" · bb-studio-native");
  expect(text).toContain("- \"Reviewer: plan page\" (review) finished · now · for this conversation");
  for (const left of ["(prep)", "(stale)", "(gone)", "(trip)", "Great Wolf"]) expect(text).not.toContain(left);
  // A finished worker past six hours drops out; a running one stays.
  x.tick(7 * HOUR);
  const later = digestFor(x.db, "prep", x.now())!;
  expect(later).not.toContain("(review)");
  expect(later).toContain("(lead) running");
  // A worker is told only whose it is; a thread no Bot has gets nothing.
  expect(digestFor(x.db, "lead", x.now())).toBe("You are a worker for your Bot's conversation \"Fork redesign\" (redesign); report through your result.");
  expect(digestFor(x.db, "nobody", x.now())).toBeNull();
  // Scout's conversation sees only Scout's.
  expect(digestFor(x.db, "trip", x.now())).not.toContain("redesign");
});

it("registers the digest on the per-turn context hook where BB has it, and nothing where it doesn't", async () => {
  const x = await setup({ hook: true });
  expect(x.live.hooked).toBe(true);
  const provider = x.turnContext.mock.calls[0]![0] as (context: { threadId: string }) => string | null;
  expect(provider({ threadId: "prep" })).toMatch(/^Elsewhere: no other conversation/);
  await x.live.start();
  expect(provider({ threadId: "prep" })).toContain(DIGEST_HEADER);
  expect(provider({ threadId: "nobody" })).toBeNull();
  expect(registerTurnContext({}, () => "x")).toBe(false);
  expect(registerTurnContext({ experimental_hooks: {} }, () => "x")).toBe(false);
  // A throwing provider answers null rather than failing the turn.
  const hooks = { experimental_turnContext: vi.fn() };
  registerTurnContext({ experimental_hooks: hooks }, () => { throw new Error("db closed"); });
  expect((hooks.experimental_turnContext.mock.calls[0]![0] as (context: { threadId: string }) => unknown)({ threadId: "t" })).toBeNull();
  const plain = await setup();
  expect(plain.live.hooked).toBe(false);
});

it("looks one thread up for its own Bot: state, latest reply, owner, workers and last tool calls", async () => {
  const x = await setup();
  await x.live.start();
  x.events.mockResolvedValue([
    { data: { item: { type: "agentMessage", text: "The sidebar is rewritten; two review notes are left." } } },
    { data: { item: { type: "commandExecution", command: "pnpm exec vitest run" } } },
    { data: { item: { type: "toolCall", server: "bb-bridge", tool: "pages_edit" } } },
    { data: { item: { type: "fileChange", changes: [{ path: "/w/src/ui/Sidebar.tsx" }] } } },
    { data: { item: { type: "reasoning", text: "…" } } },
  ]);
  const text = String(await x.harness.callAgentTool("bot_activity_lookup", { threadId: "lead" }, { threadId: "redesign" }));
  expect(text).toContain("Worker \"Fable lead: sidebar rewrite\" (lead)");
  expect(text).toContain("State: running since");
  expect(text).toContain("in bb-studio-native (exp/studio-native)");
  expect(text).toContain("Works for: \"Fork redesign\" (redesign)");
  expect(text).toContain("Latest reply: The sidebar is rewritten; two review notes are left.");
  expect(text).toContain("- $ pnpm exec vitest run\n- bb-bridge.pages_edit\n- edited Sidebar.tsx");
  const conversation = String(await x.harness.callAgentTool("bot_activity_lookup", { threadId: "redesign" }, { threadId: "prep" }));
  expect(conversation).toContain("Its workers:\n- \"Fable lead: sidebar rewrite\" (lead): running");
  // Another Bot's thread is out of reach.
  expect(String(await x.harness.callAgentTool("bot_activity_lookup", { threadId: "trip" }, { threadId: "prep" }))).toMatch(/isn't one of your conversations/);
});

it("names tool calls the way the timeline does", () => {
  expect(toolTitle({ type: "toolCall", tool: "memory_add", presentation: { title: "Saved a memory" } })).toBe("Saved a memory");
  expect(toolTitle({ type: "webSearch", queries: ["sqlite fts5 bm25"] })).toBe("searched \"sqlite fts5 bm25\"");
  expect(toolTitle({ type: "agentMessage", text: "hi" })).toBeNull();
  expect(toolTitle({ type: "commandExecution", command: "x".repeat(300) })!.length).toBe(100);
});
