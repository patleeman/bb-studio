import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { fallbackSummary, FINISH_TIMEOUT_MS, finishInstruction, mainCard, registerBotFinish } from "./bot-finish";
import { BotThreads, type Signals, type ThreadFacts } from "./bot-threads";
import { MIGRATIONS } from "./migrations";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const SUMMARY = "**Decisions**\n- One 45-minute mock a day.\n\n**Left open**\n- Book a paid mock before Nov 20?";

/** Dot (Main thr_main) with the conversation "prep" (Launch prep) and its worker "review". */
async function setup() {
  const threads = new Map<string, ThreadFacts>([
    ["thr_main", { id: "thr_main", title: "Chief of Staff", createdAt: 1, status: "idle" }],
    ["prep", { id: "prep", title: "Launch prep", createdAt: 2, status: "idle" }],
    ["review", { id: "review", title: "Reviewer", createdAt: 3, parentThreadId: "prep", status: "idle" }],
  ]);
  const send = vi.fn(async (_args: unknown) => ({ ok: true }));
  const archive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: 9 }); return {}; });
  const unarchive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: null }); return {}; });
  const events = vi.fn(async (_args: unknown): Promise<unknown[]> => []);
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
  const records: { botId: string; topic: string; text: string; threadId: string; title: string; at: number }[] = [];
  const finish = registerBotFinish(bb, {
    db, threads: store, mainOf: (botId) => (botId === "dot" ? "thr_main" : null),
    memory: {
      add: (input) => { records.push({ ...input, at: now }); },
      count: (botId, threadId, since) => records.filter((each) => each.botId === botId && each.threadId === threadId && each.at >= (since ?? 0)).length,
    },
    changed: () => {}, log: () => {}, now: () => now,
  });
  return { bb, harness, db, store, finish, threads, send, archive, unarchive, events, records, tick: (ms: number) => { now += ms; } };
}

it("sends the finishing turn into the conversation: a visible line and the agent-only steps", async () => {
  const x = await setup();
  expect(await x.finish.rpc.bot_finish({ threadId: "prep" })).toEqual({ state: "finishing" });
  expect(x.send).toHaveBeenCalledTimes(1);
  const input = (x.send.mock.calls[0]![0] as { threadId: string; input: { text: string; visibility?: string }[] });
  expect(input.threadId).toBe("prep");
  expect(input.input[0]).toMatchObject({ text: "Finish this conversation." });
  expect(input.input[1]).toMatchObject({ visibility: "agent-only", text: finishInstruction({ threadId: "prep", title: "Launch prep" }) });
  expect(input.input[1]!.text).toContain('memory_add: topic "Launch prep", the summary as text, source {"kind":"conversation","id":"prep","title":"Launch prep"}');
  expect(input.input[1]!.text).toContain("bot_finish_done");
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
  x.records.push({ botId: "dot", topic: "Launch prep", text: SUMMARY, threadId: "prep", title: "Launch prep", at: 1_000_000 });
  const reply = String(await x.harness.callAgentTool("bot_finish_done", { summary: SUMMARY }, { threadId: "prep" }));
  expect(reply).toMatch(/^Finished: the conversation is archived, Main has the summary, and 1 memory record cite/);
  expect(x.store.get("prep")).toMatchObject({ finishedSummary: SUMMARY });
  expect(x.store.get("prep")!.archivedAt).not.toBeNull();
  expect(x.store.listed("dot").map((each) => each.threadId)).not.toContain("prep");
  // Main: the summary from the conversation, and the note that has the Bot post the card.
  const post = x.send.mock.calls[0]![0] as { threadId: string; senderThreadId: string; input: { text: string; visibility?: string }[] };
  expect(post).toMatchObject({ threadId: "thr_main", senderThreadId: "prep" });
  expect(post.input[0]!.text).toBe(mainCard({ threadId: "prep", botId: "dot", title: "Launch prep", summary: SUMMARY }).text);
  expect(post.input[0]!.text.split("\n")[0]).toBe("Finished “Launch prep” · summary saved");
  expect(post.input[0]!.text).toContain("[Open the conversation](/threads/prep) · [See in Memory](/plugins/studio/studio/memory/dot)");
  expect(post.input[1]).toMatchObject({ visibility: "agent-only" });
  expect(post.input[1]!.text).toContain('::finished{thread="prep"}');
  expect(x.store.get("thr_main")!.latest?.text).toBe("Finished “Launch prep” · summary saved");
  // BB's archive waits for the turn to end.
  expect(x.archive).not.toHaveBeenCalled();
  x.threads.set("prep", { ...x.threads.get("prep")!, status: "idle" });
  await x.harness.emitThreadEvent("thread.idle", { thread: x.threads.get("prep") as never, lastAssistantText: "Done, it's in Memory." } as never);
  await vi.waitFor(() => expect(x.archive).toHaveBeenCalledWith({ threadId: "prep" }));
  expect(await x.finish.rpc.bot_finished({ threadId: "prep" })).toMatchObject({ finished: { threadId: "prep", title: "Launch prep", summary: SUMMARY, records: 1, archived: true, memoryHref: "/plugins/studio/studio/memory/dot" } });
  // Not in Main or a worker.
  expect(String(await x.harness.callAgentTool("bot_finish_done", { summary: "x" }, { threadId: "thr_main" }))).toBe("Main can't be finished.");
  expect(String(await x.harness.callAgentTool("bot_finish_done", { summary: "x" }, { threadId: "review" }))).toMatch(/Only a conversation/);
});

it("finishes with a summary from the last replies when the turn ends without bot_finish_done, and saves it to memory", async () => {
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
  expect(x.records).toMatchObject([{ botId: "dot", topic: "Launch prep", threadId: "prep", title: "Launch prep", text: summary }]);
  await vi.waitFor(() => expect(x.archive).toHaveBeenCalledWith({ threadId: "prep" }));
  expect((x.send.mock.calls.at(-1)![0] as { threadId: string }).threadId).toBe("thr_main");
});

it("falls back after the timeout too, without a second memory record when the Bot already saved one", async () => {
  const x = await setup();
  await x.finish.rpc.bot_finish({ threadId: "prep" });
  x.records.push({ botId: "dot", topic: "Launch prep", text: SUMMARY, threadId: "prep", title: "Launch prep", at: 1_000_000 });
  await x.finish.finish.sweep();
  expect(x.store.get("prep")!.archivedAt).toBeNull();
  x.tick(FINISH_TIMEOUT_MS);
  await x.finish.finish.sweep();
  expect(x.store.get("prep")!.archivedAt).not.toBeNull();
  expect(x.records).toHaveLength(1);
  expect(x.store.get("prep")!.finishedSummary).toMatch(/^\*\*Last replies\*\*/);
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
