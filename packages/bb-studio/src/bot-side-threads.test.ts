import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { SIDE_CHAT_SEED_PREFIX, SIDE_THREADS_MANY, SIDE_THREADS_TABLE, SideThreads, snippet } from "./bot-side-threads";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

// The Bot's chat: two pages of rows, newest page first.
const PAGES = [
  { rows: [{ id: "r3", kind: "conversation", role: "assistant", text: "## Plan\n\nShip **Friday**.\n\n::bot-thread{}", sourceSeqEnd: 30 }], timelinePage: { hasOlderRows: true, olderCursor: { anchorSeq: 20, anchorId: "r2" } } },
  { rows: [{ id: "r1", kind: "conversation", role: "assistant", text: "Older reply", sourceSeqEnd: 10 }], timelinePage: { hasOlderRows: false } },
];

type Thread = { id: string; status: string; archivedAt: number | null; originPluginId?: string; sourceThreadId?: string; title?: string | null };

function setup(options: { sideChat?: boolean } = {}) {
  const threads = new Map<string, Thread>();
  // Each fork's first event: side-chat's agent-only note quoting the message.
  const firstEvents = new Map<string, string>();
  const make = (fields: Partial<Thread>) => { const thread = { id: `fork${threads.size + 1}`, status: "idle", archivedAt: null, ...fields }; threads.set(thread.id, thread); return thread; };
  const callRpc = vi.fn(async ({ pluginId, method, input }: { pluginId: string; method: string; input: { sourceThreadId: string; sourceSeqEnd: number; anchorText: string } }) => {
    if (pluginId !== "side-chat" || method !== "createSideChat" || options.sideChat === false) throw new Error("No such plugin");
    const thread = make({ originPluginId: "side-chat", sourceThreadId: input.sourceThreadId });
    firstEvents.set(thread.id, `${SIDE_CHAT_SEED_PREFIX}${input.anchorText}`);
    return { threadId: thread.id };
  });
  const fork = vi.fn(async (_args: Record<string, unknown>) => make({ sourceThreadId: "bot1" }));
  const forkRows = new Map<string, { id: string; role: string; text: string; turnId: string }[]>();
  const timeline = vi.fn(async (args: { threadId: string; beforeAnchorId?: string }) => forkRows.has(args.threadId)
    ? { rows: forkRows.get(args.threadId), timelinePage: { hasOlderRows: false } }
    : args.beforeAnchorId ? PAGES[1] : PAGES[0]);
  const get = vi.fn(async ({ threadId }: { threadId: string }) => {
    const thread = threads.get(threadId);
    if (!thread) throw Object.assign(new Error("Not found"), { status: 404 });
    return thread;
  });
  const update = vi.fn(async ({ threadId, title }: { threadId: string; title: string }) => { threads.get(threadId)!.title = title; return {}; });
  const list = vi.fn(async (args: { sourceThreadId?: string; originPluginId?: string }) => [...threads.values()].filter((thread) => thread.sourceThreadId === args.sourceThreadId && thread.originPluginId === args.originPluginId && !thread.archivedAt));
  const events = vi.fn(async ({ threadId }: { threadId: string }) => firstEvents.has(threadId) ? [{ seq: 1, data: { input: [{ type: "text", text: firstEvents.get(threadId), visibility: "agent-only" }] } }] : []);
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: { fork: fork as never, timeline: timeline as never, get: get as never, update: update as never, list: list as never, events: { list: events as never } as never },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: options.sideChat === false ? [] : [{ id: "side-chat", enabled: true }] }) as never } as never,
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, [SIDE_THREADS_TABLE, SIDE_THREADS_MANY]);
  const changed = vi.fn();
  const side = new SideThreads({ db, sdk: bb.sdk, changed, waits: [], botFor: (threadId) => threadId === "bot1" ? { id: "bot", name: "Juno" } : null });
  // A side chat the user starts from BB's "Reply in side chat", quoting `text`.
  const userSideChat = (text: string) => { const thread = make({ originPluginId: "side-chat", sourceThreadId: "bot1" }); firstEvents.set(thread.id, `${SIDE_CHAT_SEED_PREFIX}${text}`); return thread; };
  return { side, fork, callRpc, threads, changed, forkRows, update, userSideChat };
}

it("starts a side chat through side-chat at the reply, names it, and reopens it", async () => {
  const { side, callRpc, threads } = setup();
  const [a, b] = await Promise.all([side.open("bot1", "r1"), side.open("bot1", "r1")]);
  expect(a).toEqual({ threadId: "fork1", created: true });
  expect(b).toEqual(a);
  expect(callRpc).toHaveBeenCalledTimes(1);
  expect(callRpc.mock.calls[0]![0]).toMatchObject({ pluginId: "side-chat", method: "createSideChat", input: { sourceThreadId: "bot1", sourceSeqEnd: 10, anchorText: "Older reply" } });
  expect(threads.get("fork1")!.title).toBe("Juno · Older reply");
  expect(await side.open("bot1", "r1")).toEqual({ threadId: "fork1", created: false });
  expect(side.forThread("fork1")).toEqual({ botId: "bot", sourceThreadId: "bot1", messageId: "r1" });
});

it("forks the chat itself when side-chat is off, telling the fork what it is", async () => {
  const { side, fork } = setup({ sideChat: false });
  expect(await side.open("bot1", "r3")).toEqual({ threadId: "fork1", created: true });
  expect(fork.mock.calls[0]![0]).toMatchObject({ sourceThreadId: "bot1", sourceSeqEnd: 30, visibility: "hidden", lifecycleOwnerThreadId: "bot1",
    agentContextSeed: [{ visibility: "agent-only", text: expect.stringContaining("This is a side thread") }] });
});

it("refuses threads that aren't a Bot's chat, and replies it can't find", async () => {
  const { side } = setup();
  await expect(side.open("other", "r1")).rejects.toThrow("Side threads are for a Bot's chat.");
  await expect(side.open("bot1", "missing")).rejects.toThrow("Couldn't find that reply");
});

it("adopts side chats made from BB's own action, by the message they quote", async () => {
  const { side, userSideChat, threads } = setup();
  // A whole reply, as "Reply in side chat" quotes it, and a selection inside another.
  const whole = userSideChat("Older reply");
  await side.created(whole);
  const part = userSideChat("Ship **Friday**.");
  // Made while Studio wasn't listening: found when the chat's list is read.
  const listed = await side.list("bot1");
  expect(side.forThread(whole.id)).toEqual({ botId: "bot", sourceThreadId: "bot1", messageId: "r1" });
  expect(side.forThread(part.id)).toEqual({ botId: "bot", sourceThreadId: "bot1", messageId: "r3" });
  expect(listed.map((each) => [each.messageId, each.threadId]).sort()).toEqual([["r1", whole.id], ["r3", part.id]]);
  // Not a Bot's chat, or not side-chat's: left alone.
  const elsewhere = { id: "x1", status: "idle", archivedAt: null, originPluginId: "side-chat", sourceThreadId: "other" };
  threads.set(elsewhere.id, elsewhere);
  await side.created(elsewhere);
  expect(side.forThread("x1")).toBeNull();
  expect(await side.isSideThread(whole.id)).toBe(true);
  expect(await side.isSideThread("x1")).toBe(false);
});

it("counts a reply's side chats together and opens its newest", async () => {
  const { side, userSideChat, forkRows, threads } = setup();
  const first = userSideChat("Older reply");
  await side.created(first);
  const second = userSideChat("Older reply");
  await side.created(second);
  forkRows.set(first.id, [{ id: "a1", role: "assistant", text: "One.", turnId: "t1" }]);
  forkRows.set(second.id, [{ id: "a2", role: "assistant", text: "Two.", turnId: "t1" }, { id: "a3", role: "assistant", text: "Three.", turnId: "t2" }]);
  await side.idle(first.id);
  await side.idle(second.id);
  threads.get(second.id)!.status = "active";
  expect(await side.list("bot1")).toEqual([{ messageId: "r1", threadId: second.id, replies: 3, lastReplyAt: expect.any(Number), working: true }]);
  expect(await side.open("bot1", "r1")).toEqual({ threadId: second.id, created: false });
});

it("counts replies from the fork's timeline and forgets deleted side chats", async () => {
  const { side, threads, changed, forkRows } = setup();
  await side.open("bot1", "r3");
  changed.mockClear();
  forkRows.set("fork1", []);
  await side.idle("fork1");
  forkRows.set("fork1", [
    { id: "u1", role: "user", text: "Why Friday?", turnId: "t1" },
    { id: "a1", role: "assistant", text: "Checking.", turnId: "t1" },
    { id: "a2", role: "assistant", text: "Because QA.", turnId: "t1" },
    { id: "a3", role: "assistant", text: "Done.", turnId: "t2" },
  ]);
  await side.idle("fork1");
  await side.idle("fork1");
  await side.idle("unrelated");
  expect(changed).toHaveBeenCalledTimes(1);
  expect((await side.list("bot1"))[0]).toMatchObject({ replies: 2 });
  threads.delete("fork1");
  expect(await side.list("bot1")).toEqual([]);
  expect(side.forThread("fork1")).toBeNull();
});

it("lists a Bot's side threads for its sidebar, latest first, with their titles", async () => {
  const { side } = setup();
  await side.open("bot1", "r1");
  await side.open("bot1", "r3");
  const listed = await side.forBot("bot");
  expect(listed.map((each) => [each.threadId, each.title])).toEqual([["fork2", "Juno · Plan Ship Friday."], ["fork1", "Juno · Older reply"]]);
  expect(await side.forBot("other")).toEqual([]);
});

it("titles a side thread with the reply's plain start", () => {
  expect(snippet("## Plan\n\nShip **Friday**.\n\n::bot-thread{}")).toBe("Plan Ship Friday.");
  expect(snippet("::next{reply=\"x\"}")).toBe("Thread");
  expect(snippet("a".repeat(80))).toHaveLength(60);
});


it("surfaces operational side-chat failures and discovers a created fork before retrying", async () => {
  const { side, callRpc, fork, userSideChat } = setup();
  callRpc.mockImplementationOnce(async () => {
    userSideChat("Older reply");
    throw new Error("response timed out");
  });
  await expect(side.open("bot1", "r1")).rejects.toThrow("response timed out");
  expect(fork).not.toHaveBeenCalled();
  expect(await side.open("bot1", "r1")).toEqual({ threadId: "fork1", created: false });
  expect(callRpc).toHaveBeenCalledTimes(1);
});
