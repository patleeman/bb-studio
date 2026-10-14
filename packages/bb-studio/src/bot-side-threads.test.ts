import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { SIDE_THREADS_TABLE, SideThreads, snippet } from "./bot-side-threads";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

// The Bot's chat: two pages of rows, newest page first.
const PAGES = [
  { rows: [{ id: "r3", role: "assistant", text: "## Plan\n\nShip **Friday**.\n\n::bot-thread{}", sourceSeqEnd: 30 }], timelinePage: { hasOlderRows: true, olderCursor: { anchorSeq: 20, anchorId: "r2" } } },
  { rows: [{ id: "r1", role: "assistant", text: "Older reply", sourceSeqEnd: 10 }], timelinePage: { hasOlderRows: false } },
];

function setup() {
  const threads = new Map<string, { id: string; status: string; archivedAt: number | null }>();
  const fork = vi.fn(async (_args: { sourceThreadId: string; sourceSeqEnd: number }) => {
    const thread = { id: `fork${threads.size + 1}`, status: "idle", archivedAt: null };
    threads.set(thread.id, thread);
    return thread;
  });
  // A fork's timeline holds only its own messages.
  const forkRows = new Map<string, { id: string; role: string; text: string; turnId: string }[]>();
  const timeline = vi.fn(async (args: { threadId: string; beforeAnchorId?: string }) => forkRows.has(args.threadId)
    ? { rows: forkRows.get(args.threadId), timelinePage: { hasOlderRows: false } }
    : args.beforeAnchorId ? PAGES[1] : PAGES[0]);
  const get = vi.fn(async ({ threadId }: { threadId: string }) => {
    const thread = threads.get(threadId);
    if (!thread) throw Object.assign(new Error("Not found"), { status: 404 });
    return thread;
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: { threads: { fork: fork as never, timeline: timeline as never, get: get as never } } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, [SIDE_THREADS_TABLE]);
  const changed = vi.fn();
  const side = new SideThreads({ db, sdk: bb.sdk, changed, botFor: (threadId) => threadId === "bot1" ? { id: "bot", name: "Juno" } : null });
  return { side, fork, timeline, threads, changed, forkRows };
}

it("forks the Bot's chat at the reply, hidden, and reopens the same fork", async () => {
  const { side, fork } = setup();
  const [a, b] = await Promise.all([side.open("bot1", "r1"), side.open("bot1", "r1")]);
  expect(a).toEqual({ threadId: "fork1", created: true });
  expect(b).toEqual(a);
  expect(fork).toHaveBeenCalledTimes(1);
  expect(fork.mock.calls[0]![0]).toMatchObject({ sourceThreadId: "bot1", sourceSeqEnd: 10, visibility: "hidden", title: "Juno · Older reply", pluginMetadata: { botSideThread: "bot" } });
  expect(await side.open("bot1", "r1")).toEqual({ threadId: "fork1", created: false });
  expect(side.forThread("fork1")).toEqual({ botId: "bot", sourceThreadId: "bot1", messageId: "r1" });
});

it("refuses threads that aren't a Bot's chat, and replies it can't find", async () => {
  const { side } = setup();
  await expect(side.open("other", "r1")).rejects.toThrow("Side threads are for a Bot's chat.");
  await expect(side.open("bot1", "missing")).rejects.toThrow("Couldn't find that reply");
});

it("counts replies from the fork's timeline and lists side threads by reply, forgetting deleted ones", async () => {
  const { side, threads, changed, forkRows } = setup();
  await side.open("bot1", "r3");
  // The idle BB reports while the fork is set up counts nothing.
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
  expect(changed).toHaveBeenCalledTimes(2);
  expect(side.isChat("bot1")).toBe(true);
  expect(side.isChat("fork1")).toBe(false);
  threads.get("fork1")!.status = "active";
  expect(await side.list("bot1")).toEqual([{ messageId: "r3", threadId: "fork1", replies: 2, lastReplyAt: expect.any(Number), working: true }]);
  threads.delete("fork1");
  expect(await side.list("bot1")).toEqual([]);
  expect(side.forThread("fork1")).toBeNull();
});

it("makes a fresh fork when the old one was archived", async () => {
  const { side, threads } = setup();
  await side.open("bot1", "r3");
  threads.get("fork1")!.archivedAt = 5;
  expect(await side.list("bot1")).toEqual([]);
  expect(await side.open("bot1", "r3")).toEqual({ threadId: "fork2", created: true });
});

it("titles a side thread with the reply's plain start", () => {
  expect(snippet("## Plan\n\nShip **Friday**.\n\n::bot-thread{}")).toBe("Plan Ship Friday.");
  expect(snippet("::next{reply=\"x\"}")).toBe("Thread");
  expect(snippet("a".repeat(80))).toHaveLength(60);
});
