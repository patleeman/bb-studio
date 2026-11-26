import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { archiveQuietly, fallbackSummary, FINISH_TIMEOUT_MS, finishInstruction, finishSummaryPrompt, mainCard, NO_REPLIES_SUMMARY, registerBotFinish } from "./bot-finish";
import { BotThreads, type Signals, type ThreadFacts } from "./bot-threads";
import { MIGRATIONS } from "./migrations";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const SUMMARY = "**Decisions**\n- One 45-minute mock a day.\n\n**Left open**\n- Book a paid mock before Nov 20?";

/** Dot (Main thr_main) with the conversation "prep" (Launch prep) and its worker "review". */
async function setup(options: { isBotThread?: (threadId: string) => boolean; providerReady?: (providerId: string) => Promise<boolean>; summarize?: (input: { threadId: string; title: string; prompt: string }) => Promise<string | null> } = {}) {
  const threads = new Map<string, ThreadFacts>([
    ["thr_main", { id: "thr_main", title: "Chief of Staff", createdAt: 1, status: "idle" }],
    ["prep", { id: "prep", title: "Launch prep", createdAt: 2, status: "idle" }],
    ["review", { id: "review", title: "Reviewer", createdAt: 3, parentThreadId: "prep", status: "idle" }],
  ]);
  const send = vi.fn(async (_args: unknown) => ({ ok: true }));
  const archive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: 9 }); return {}; });
  const unarchive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: null }); return {}; });
  const events = vi.fn(async (_args: unknown): Promise<unknown[]> => [{ data: { item: { type: "agentMessage", text: "One mock a day." } } }]);
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: (async (args: { threadIds?: string[] }) => [...threads.values()].filter((thread) => !args.threadIds || args.threadIds.includes(thread.id))) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw new Error("Not found"); return thread; }) as never,
      send: send as never, archive: archive as never, unarchive: unarchive as never,
      events: { list: events as never },
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  let now = 1_000_000;
  const signals: Signals = { bots: [{ id: "dot", threadId: "thr_main", chain: ["thr_main"] }], focusedBotId: null, sideThread: () => null, runnerBot: () => null, leadThreads: new Set(), internal: new Set(), managedBot: () => null };
  const store = new BotThreads({ db, sdk: bb.sdk, signals: () => signals, changed: () => {}, now: () => now });
  await store.backfill();
  const reviewed: [string, string][] = [];
  const finish = registerBotFinish(bb, {
    db, threads: store, mainOf: (botId) => (botId === "dot" ? "thr_main" : null), isBotThread: options.isBotThread,
    changed: () => {}, log: () => {}, now: () => now, providerReady: options.providerReady, summarize: options.summarize,
    reviewArchived: (botId, threadId) => { reviewed.push([botId, threadId]); },
  });
  return { bb, harness, db, store, finish, threads, send, archive, unarchive, events, reviewed, tick: (ms: number) => { now += ms; } };
}

it("sends the finishing turn into the conversation as agent-only steps, with no user bubble", async () => {
  const x = await setup();
  expect(await x.finish.rpc.bot_finish({ threadId: "prep" })).toEqual({ state: "finishing" });
  expect(x.send).toHaveBeenCalledTimes(1);
  const input = (x.send.mock.calls[0]![0] as { threadId: string; input: { text: string; visibility?: string }[] });
  expect(input.threadId).toBe("prep");
  expect(input.input).toHaveLength(1);
  expect(input.input.every((part) => part.visibility === "agent-only")).toBe(true);
  expect(input.input[0]).toMatchObject({ visibility: "agent-only", text: finishInstruction({ threadId: "prep", title: "Launch prep" }) });
  // The summary stays on the archived conversation: nothing goes to memory or a skill.
  expect(input.input[0]!.text).not.toMatch(/memory \(op|memory_add/);
  expect(input.input[0]!.text).toContain("it stays on the archived conversation");
  expect(input.input[0]!.text).toContain("bot_finish_done");
  // Pressing it again while it finishes sends nothing more.
  expect(await x.finish.rpc.bot_finish({ threadId: "prep" })).toEqual({ state: "finishing" });
  expect(x.send).toHaveBeenCalledTimes(1);
  // Not Main, not a worker, not while it works.
  await expect(x.finish.rpc.bot_finish({ threadId: "thr_main" })).rejects.toThrow(/Main/);
  await expect(x.finish.rpc.bot_finish({ threadId: "review" })).rejects.toThrow(/worker/);
  x.store.reopen("prep");
  x.db.prepare("DELETE FROM bot_finishes").run();
  x.threads.set("prep", { ...x.threads.get("prep")!, status: "active" });
  await expect(x.finish.rpc.bot_finish({ threadId: "prep" })).rejects.toThrow(/still working/);
});

it("bot_finish_done archives the conversation with its summary, posts the card to Main, and archives it in BB once its turn is over", async () => {
  const x = await setup();
  await x.finish.rpc.bot_finish({ threadId: "prep" });
  x.send.mockClear();
  // The tool runs mid-turn.
  x.threads.set("prep", { ...x.threads.get("prep")!, status: "active" });
  const reply = String(await x.harness.callAgentTool("bot_finish_done", { summary: SUMMARY }, { threadId: "prep" }));
  expect(reply).toBe("Finished: the conversation is archived with its summary, and Main has it. Reply with one short line.");
  expect(x.store.get("prep")).toMatchObject({ finishedSummary: SUMMARY });
  expect(x.store.get("prep")!.archivedAt).not.toBeNull();
  expect(x.store.listed("dot").map((each) => each.threadId)).not.toContain("prep");
  const post = x.send.mock.calls[0]![0] as { threadId: string; senderThreadId: string; input: { text: string; visibility?: string }[] };
  expect(post).toMatchObject({ threadId: "thr_main", senderThreadId: "prep" });
  expect(post.input).toHaveLength(1);
  expect(post.input.every((part) => part.visibility === "agent-only")).toBe(true);
  expect(post.input[0]!.text).toBe(mainCard({ threadId: "prep", botId: "dot", title: "Launch prep", summary: SUMMARY }).note);
  expect(post.input[0]!.text).toContain(SUMMARY);
  expect(post.input[0]!.text).toContain('::finished{thread="prep"}');
  expect(post.input[0]!.text).not.toContain("summary saved");
  expect(x.store.get("thr_main")!.latest?.text).toBe("Archived “Launch prep”");
  // Its one skill review pass is queued.
  expect(x.reviewed).toEqual([["dot", "prep"]]);
  // BB's archive waits for the turn to end.
  expect(x.archive).not.toHaveBeenCalled();
  x.threads.set("prep", { ...x.threads.get("prep")!, status: "idle" });
  await x.harness.emitThreadEvent("thread.idle", { thread: x.threads.get("prep") as never, lastAssistantText: "Done, it's in Memory." } as never);
  await vi.waitFor(() => expect(x.archive).toHaveBeenCalledWith({ threadId: "prep" }));
  expect(await x.finish.rpc.bot_finished({ threadId: "prep" })).toMatchObject({ finished: { threadId: "prep", title: "Launch prep", summary: SUMMARY, records: 0, archived: true, memoryHref: "/plugins/studio/studio/memory/dot" } });
  // Not in Main or a worker.
  expect(String(await x.harness.callAgentTool("bot_finish_done", { summary: "x" }, { threadId: "thr_main" }))).toBe("Main can't be finished.");
  expect(String(await x.harness.callAgentTool("bot_finish_done", { summary: "x" }, { threadId: "review" }))).toMatch(/Only a conversation/);
});

it("finishes with a summary from the last replies when the turn ends without bot_finish_done, kept on the conversation", async () => {
  const x = await setup();
  await x.finish.rpc.bot_finish({ threadId: "prep" });
  x.tick(30_000);
  x.events.mockResolvedValue([
    { data: { item: { type: "agentMessage", text: "Here's the summary: one mock a day.\n::next{do=\"x\"}" } } },
    { data: { item: { type: "commandExecution", command: "ls" } } },
    { data: { item: { type: "agentMessage", text: "Deep dives at minute 24." } } },
  ]);
  await x.harness.emitThreadEvent("thread.idle", { thread: x.threads.get("prep") as never, lastAssistantText: "Here's the summary" } as never);
  await vi.waitFor(() => expect(x.store.get("prep")!.archivedAt).not.toBeNull());
  const summary = x.store.get("prep")!.finishedSummary!;
  expect(summary).toBe(fallbackSummary(["Here's the summary: one mock a day.\n::next{do=\"x\"}", "Deep dives at minute 24."], null));
  expect(summary).toContain("> Here's the summary: one mock a day.");
  expect(summary).not.toContain("::next");
  await vi.waitFor(() => expect(x.archive).toHaveBeenCalledWith({ threadId: "prep" }));
  expect((x.send.mock.calls.at(-1)![0] as { threadId: string }).threadId).toBe("thr_main");
});

it("falls back after the timeout too", async () => {
  const x = await setup();
  await x.finish.rpc.bot_finish({ threadId: "prep" });
  await x.finish.finish.sweep();
  expect(x.store.get("prep")!.archivedAt).toBeNull();
  x.tick(FINISH_TIMEOUT_MS);
  await x.finish.finish.sweep();
  expect(x.store.get("prep")!.archivedAt).not.toBeNull();
  expect(x.store.get("prep")!.finishedSummary).toMatch(/^\*\*Last replies\*\*/);
});

it("holds a finish while its Bot is paused or stopped, so nothing starts a turn in Main, and finishes it after Resume", async () => {
  const x = await setup();
  await x.finish.rpc.bot_finish({ threadId: "prep" });
  // Like bb's Studio data brought over: the Bot arrives stopped with this finish still pending.
  x.db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES ('dot', 'Dot', 'D', 'stopped', 'thr_main', 0, 1, 1)").run();
  x.send.mockClear();
  x.tick(FINISH_TIMEOUT_MS * 3);
  await x.finish.finish.sweep();
  await x.harness.emitThreadEvent("thread.idle", { thread: x.threads.get("prep") as never, lastAssistantText: "" } as never);
  expect(x.send).not.toHaveBeenCalled();
  expect(x.store.get("prep")!.archivedAt).toBeNull();
  expect(x.db.prepare("SELECT state FROM bot_finishes WHERE thread_id = 'prep'").get()).toEqual({ state: "finishing" });
  x.db.prepare("UPDATE bots SET state = 'active'").run();
  await x.finish.finish.sweep();
  expect(x.store.get("prep")!.archivedAt).not.toBeNull();
});

it("archiving a conversation in BB starts the same summary step; Main, a worker and a quiet archive don't", async () => {
  const x = await setup();
  await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("prep") as never });
  await vi.waitFor(() => expect(x.send).toHaveBeenCalledTimes(1));
  const input = x.send.mock.calls[0]![0] as { threadId: string; input: { text: string; visibility?: string }[] };
  expect(input.threadId).toBe("prep");
  expect(input.input).toEqual([expect.objectContaining({ visibility: "agent-only" })]);
  expect(input.input[0]!.text).toContain("bot_finish_done");
  await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("prep") as never });
  await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("thr_main") as never });
  await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("review") as never });
  await x.harness.callAgentTool("bot_finish_done", { summary: SUMMARY }, { threadId: "prep" });
  expect((x.send.mock.calls.at(-1)![0] as { threadId: string }).threadId).toBe("thr_main");
  await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("prep") as never });
  expect(x.send).toHaveBeenCalledTimes(2);
});

it("BB refuses a turn in an archived thread, so archiving unarchives the conversation for its summary turn and archives it again once it's done", async () => {
  const x = await setup();
  x.send.mockImplementation(async (args: unknown) => {
    const { threadId } = args as { threadId: string };
    if (x.threads.get(threadId)?.archivedAt) throw new Error("HTTP 409: Thread is archived");
    return { ok: true };
  });
  x.threads.set("prep", { ...x.threads.get("prep")!, archivedAt: 9 });
  await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("prep") as never });
  await vi.waitFor(() => expect(x.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: "prep" })));
  expect(x.unarchive).toHaveBeenCalledWith({ threadId: "prep" });
  expect((x.send.mock.calls[0]![0] as { input: { text: string; visibility?: string }[] }).input).toEqual([expect.objectContaining({ visibility: "agent-only" })]);
  await x.harness.callAgentTool("bot_finish_done", { summary: SUMMARY }, { threadId: "prep" });
  expect(x.store.get("prep")!.finishedSummary).toBe(SUMMARY);
  expect(x.archive).toHaveBeenCalledWith({ threadId: "prep" });
  expect(x.threads.get("prep")!.archivedAt).toBe(9);
});

it("a quiet archive, or a Bot's own thread it handed off from, gets no summary step", async () => {
  const x = await setup();
  await archiveQuietly("prep", async () => { await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("prep") as never }); });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(x.send).not.toHaveBeenCalled();
  const y = await setup({ isBotThread: (threadId) => threadId === "prep" });
  await y.harness.emitThreadEvent("thread.archived", { thread: y.threads.get("prep") as never });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(y.send).not.toHaveBeenCalled();
});

it("an archived conversation that can't take the turn gets Studio's summary, kept on it and posted to Main", async () => {
  const x = await setup();
  x.send.mockRejectedValueOnce(new Error("archived"));
  await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("prep") as never });
  await vi.waitFor(() => expect(x.store.get("prep")!.finishedSummary).toMatch(/^\*\*Last replies\*\*/));
  expect((x.send.mock.calls.at(-1)![0] as { threadId: string }).threadId).toBe("thr_main");
});

it("asks for the summary in the second person", () => {
  expect(finishInstruction({ threadId: "prep", title: "Launch prep" })).toContain('to the user, as "you" (never "the user")');
  const prompt = finishSummaryPrompt("Launch prep", [{ role: "user", text: "Plan the launch" }, { role: "assistant", text: "Ship Friday.\n::next{reply=\"x\"}" }]);
  expect(prompt).toContain('as "you" (never "the user")');
  expect(prompt).toContain("You: Plan the launch\n\nAssistant: Ship Friday.");
  expect(prompt).not.toContain("::next");
});

it("archives a conversation with no replies quietly: no turn, nothing in Main, no skill review", async () => {
  const x = await setup();
  x.events.mockResolvedValue([{ data: { item: { type: "userMessage", content: [{ type: "text", text: "Say hello." }] } } }]);
  await x.harness.emitThreadEvent("thread.archived", { thread: x.threads.get("prep") as never });
  await vi.waitFor(() => expect(x.store.get("prep")!.finishedSummary).toBe(NO_REPLIES_SUMMARY));
  expect(x.send).not.toHaveBeenCalled();
  expect(x.reviewed).toEqual([]);
  expect(x.store.get("thr_main")!.latest?.text ?? "").not.toMatch(/Archived/);
  await vi.waitFor(() => expect(x.archive).toHaveBeenCalledWith({ threadId: "prep" }));
});

it("writes the summary on a signed-in model when the conversation's own provider is signed out", async () => {
  const summarize = vi.fn(async (_input: { threadId: string; title: string; prompt: string }) => SUMMARY);
  const x = await setup({ providerReady: async (providerId) => providerId !== "codex", summarize });
  x.threads.set("prep", { ...x.threads.get("prep")!, providerId: "codex" } as never);
  x.events.mockResolvedValue([
    { data: { item: { type: "agentMessage", text: "Kobo for the dark mode." } } },
    { data: { item: { type: "userMessage", content: [{ type: "text", text: "Kindle or Kobo for bed?" }] } } },
  ]);
  await x.finish.rpc.bot_finish({ threadId: "prep" });
  expect(summarize).toHaveBeenCalledTimes(1);
  expect(summarize.mock.calls[0]![0].prompt).toContain("You: Kindle or Kobo for bed?\n\nAssistant: Kobo for the dark mode.");
  expect(x.send.mock.calls.map((call) => (call[0] as { threadId: string }).threadId)).toEqual(["thr_main"]);
  expect(x.store.get("prep")!.finishedSummary).toBe(SUMMARY);

  const y = await setup({ providerReady: async () => false, summarize: async () => null });
  y.threads.set("prep", { ...y.threads.get("prep")!, providerId: "codex" } as never);
  await y.finish.rpc.bot_finish({ threadId: "prep" });
  expect(y.store.get("prep")!.finishedSummary).toMatch(/^\*\*Last replies\*\*/);
  expect(y.send.mock.calls.map((call) => (call[0] as { threadId: string }).threadId)).toEqual(["thr_main"]);
});

it("FM: Finish on a conversation BB can't send to (no model) sums it up elsewhere instead of failing", async () => {
  const summarize = vi.fn(async (_input: { threadId: string; title: string; prompt: string }) => SUMMARY);
  const x = await setup({ summarize });
  x.events.mockResolvedValue([{ data: { item: { type: "agentMessage", text: "Kobo for the dark mode." } } }]);
  // Before: BB's raw "no stored execution model" came back from bot_finish.
  x.send.mockRejectedValueOnce(new Error("Thread prep has no stored execution model"));
  await expect(x.finish.rpc.bot_finish({ threadId: "prep" })).resolves.toBeTruthy();
  expect(summarize).toHaveBeenCalledTimes(1);
  expect(x.store.get("prep")!.finishedSummary).toBe(SUMMARY);
});

it("reopens a finished conversation: back in the sidebar and unarchived in BB, the summary kept", async () => {
  const x = await setup();
  await x.finish.rpc.bot_finish({ threadId: "prep" });
  await x.harness.callAgentTool("bot_finish_done", { summary: SUMMARY }, { threadId: "prep" });
  expect(x.archive).toHaveBeenCalled();
  expect(await x.finish.rpc.bot_reopen({ threadId: "prep" })).toEqual({ ok: true });
  expect(x.unarchive).toHaveBeenCalledWith({ threadId: "prep" });
  expect(x.store.get("prep")).toMatchObject({ archivedAt: null, finishedSummary: SUMMARY });
  expect(x.store.listed("dot").map((each) => each.threadId)).toContain("prep");
  expect(await x.finish.rpc.bot_finished({ threadId: "prep" })).toMatchObject({ finished: { archived: false } });
  // Finished again from the chat, without pressing Finish: the Bot's tool does it all.
  await x.harness.callAgentTool("bot_finish_done", { summary: "**Decisions**\n- Done." }, { threadId: "prep" });
  expect(x.store.get("prep")).toMatchObject({ finishedSummary: "**Decisions**\n- Done." });
  expect(x.store.get("prep")!.archivedAt).not.toBeNull();
});

