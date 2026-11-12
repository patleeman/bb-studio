import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { countReplies, SIDE_CHAT_SEED_PREFIX, SideThreads, snippet, type TimelineRow } from "./bot-side-threads";
import { MIGRATIONS } from "./migrations";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const PAGES = [
  { rows: [{ id: "r3", kind: "conversation", role: "assistant", text: "## Plan\n\nShip **Friday**.\n\n::bot-thread{}", sourceSeqEnd: 30 }], timelinePage: { olderCursor: { anchorSeq: 20, anchorId: "r2" } } },
  { rows: [{ id: "r1", kind: "conversation", role: "assistant", text: "Older reply", sourceSeqEnd: 10 }], timelinePage: { olderCursor: null } },
];

type Thread = { id: string; status: string; archivedAt: number | null; originPluginId?: string; sourceThreadId?: string; title?: string | null; updatedAt?: number; createdAt?: number };

function setup() {
  const threads = new Map<string, Thread>();
  const firstEvents = new Map<string, string>();
  const make = (fields: Partial<Thread> & { id?: string }) => { const thread = { id: `fork${threads.size + 1}`, status: "idle", archivedAt: null, ...fields }; threads.set(thread.id, thread); return thread; };
  const forkRows = new Map<string, TimelineRow[]>();
  const timeline = vi.fn(async (args: { threadId: string; beforeAnchorId?: string }) => forkRows.has(args.threadId)
    ? { rows: forkRows.get(args.threadId), timelinePage: { olderCursor: null } }
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
    threads: { timeline: timeline as never, get: get as never, update: update as never, list: list as never, events: { list: events as never } as never },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const changed = vi.fn();
  const side = new SideThreads({ db, sdk: bb.sdk, changed, waits: [], botFor: (threadId) => threadId === "bot1" ? { id: "bot", name: "Juno" } : null });
  const userSideChat = (text: string) => { const thread = make({ originPluginId: "side-chat", sourceThreadId: "bot1" }); firstEvents.set(thread.id, `${SIDE_CHAT_SEED_PREFIX}${text}`); return thread; };
  const fork = (id: string, messageId: string, createdAt?: number) => { make({ id, sourceThreadId: "bot1", ...(createdAt === undefined ? {} : { createdAt }) }); side.record(id, "bot", "bot1", messageId); };
  return { side, threads, changed, forkRows, userSideChat, fork, db };
}

it("keeps its table through the migrations, with the last replier", () => {
  const { db } = setup();
  const columns = (db.prepare("PRAGMA table_info(bot_side_threads)").all() as { name: string }[]).map((each) => each.name);
  expect(columns).toContain("last_reply_role");
});

it("adopts side chats from bb's side-chat plugin, by the message they quote", async () => {
  const { side, userSideChat, threads } = setup();
  const whole = userSideChat("Older reply");
  await side.created(whole);
  const part = userSideChat("Ship **Friday**.");
  const listed = await side.list("bot1");
  expect(side.forThread(whole.id)).toEqual({ botId: "bot", sourceThreadId: "bot1", messageId: "r1" });
  expect(side.forThread(part.id)).toEqual({ botId: "bot", sourceThreadId: "bot1", messageId: "r3" });
  expect(listed.map((each) => [each.messageId, each.threadId]).sort()).toEqual([["r1", whole.id], ["r3", part.id]]);
  expect(threads.get(whole.id)!.title).toBe("Juno · Older reply");
  const elsewhere = { id: "x1", status: "idle", archivedAt: null, originPluginId: "side-chat", sourceThreadId: "other" };
  threads.set(elsewhere.id, elsewhere);
  await side.created(elsewhere);
  expect(side.forThread("x1")).toBeNull();
});

it("counts user messages and Bot turns, newest replier last", () => {
  const rows: TimelineRow[] = [
    { id: "u1", kind: "conversation", role: "user", initiator: "user", text: "Why Friday?", turnId: "t1", createdAt: 100 },
    { id: "a1", kind: "conversation", role: "assistant", text: "Checking.", turnId: "t1", createdAt: 110 },
    { id: "a2", kind: "conversation", role: "assistant", text: "Because QA.", turnId: "t1", createdAt: 120 },
    { id: "s1", kind: "conversation", role: "user", initiator: "system", text: "Context compacted", turnId: null, createdAt: 125 },
    { id: "w1", kind: "work", role: "assistant", text: "ran tests", turnId: "t1", createdAt: 126 },
    { id: "u2", kind: "conversation", role: "user", initiator: "user", text: "OK", turnId: "t2", createdAt: 130 },
  ];
  expect(countReplies([rows])).toEqual({ replies: 3, lastReplyAt: 130, lastReplyRole: "user" });
  expect(countReplies([[{ id: "a3", kind: "conversation", role: "assistant", text: "Done.", turnId: "t3", createdAt: 140 }], rows])).toEqual({ replies: 4, lastReplyAt: 140, lastReplyRole: "assistant" });
  expect(countReplies([[]])).toEqual({ replies: 0, lastReplyAt: null, lastReplyRole: null });
});

it("recounts a thread's replies from its timeline and shows the last replier under the message", async () => {
  const { side, forkRows, changed, threads, fork } = setup();
  fork("t1", "r3");
  changed.mockClear();
  forkRows.set("t1", [{ id: "u1", kind: "conversation", role: "user", initiator: "user", text: "Why Friday?", turnId: "a", createdAt: 1_000 }]);
  await side.recount("t1");
  expect((await side.list("bot1"))[0]).toEqual({ messageId: "r3", threadId: "t1", botId: "bot", replies: 1, lastReplyAt: 1_000, lastReplyRole: "user", working: false });
  forkRows.set("t1", [...forkRows.get("t1")!, { id: "a1", kind: "conversation", role: "assistant", text: "QA.", turnId: "a", createdAt: 2_000 }]);
  await Promise.all([side.recount("t1"), side.recount("t1")]);
  await side.recount("t1");
  await side.recount("unrelated");
  expect(changed).toHaveBeenCalledTimes(2);
  threads.get("t1")!.status = "active";
  expect((await side.list("bot1"))[0]).toMatchObject({ replies: 2, lastReplyAt: 2_000, lastReplyRole: "assistant", working: true });
  threads.delete("t1");
  expect(await side.list("bot1")).toEqual([]);
  expect(side.forThread("t1")).toBeNull();
});

it("sums a message's threads, and its newest one is what the row and Reply in thread open", async () => {
  const { side, forkRows, fork, threads } = setup();
  fork("t1", "r1");
  fork("t2", "r1");
  forkRows.set("t1", [{ id: "a", kind: "conversation", role: "assistant", text: "One.", turnId: "x", createdAt: 5 }]);
  forkRows.set("t2", [{ id: "b", kind: "conversation", role: "user", initiator: "user", text: "Two.", turnId: "y", createdAt: 9 }]);
  await side.recount("t1");
  await side.recount("t2");
  expect(await side.list("bot1")).toEqual([{ messageId: "r1", threadId: "t2", botId: "bot", replies: 2, lastReplyAt: 9, lastReplyRole: "user", working: false }]);
  expect(await side.newest("bot1", "r1")).toBe("t2");
  threads.get("t2")!.archivedAt = 1;
  expect(await side.newest("bot1", "r1")).toBe("t1");
  expect(await side.newest("bot1", "r9")).toBeNull();
});

it("finds a message's place in the conversation, on older pages too", async () => {
  const { side } = setup();
  expect(await side.message("bot1", "r1")).toMatchObject({ id: "r1", sourceSeqEnd: 10 });
  expect(await side.message("bot1", "missing")).toBeNull();
});

it("links forks made from a message to that message, once", () => {
  const { side, db } = setup();
  db.prepare(`INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, forked_from_thread_id, forked_from_message_id, source, created_at, updated_at)
    VALUES ('f1', 'bot', 'conversation', 0, 'bot1', 'r1', 'user', 7, 7), ('f2', 'bot', 'conversation', 0, 'bot1', NULL, 'reconciled', 8, 8), ('w1', 'bot', 'worker', 0, 'bot1', 'r1', 'reconciled', 9, 9)`).run();
  expect(side.linkForks()).toEqual(["f1"]);
  expect(side.forThread("f1")).toEqual({ botId: "bot", sourceThreadId: "bot1", messageId: "r1" });
  expect(side.linkForks()).toEqual([]);
  expect(side.record("f1", "bot", "bot1", "r1")).toBe(false);
});

it("lists a Bot's threads for its sidebar, latest first", async () => {
  const { side, fork, threads } = setup();
  fork("t1", "r1");
  fork("t2", "r3");
  threads.get("t1")!.title = "Older";
  threads.get("t2")!.title = "Newer";
  const listed = await side.forBot("bot");
  expect(listed.map((each) => each.threadId).sort()).toEqual(["t1", "t2"]);
  expect(listed.map((each) => each.title).sort()).toEqual(["Newer", "Older"]);
  expect(await side.forBot("other")).toEqual([]);
});

it("titles a side thread with the reply's plain start", () => {
  expect(snippet("## Plan\n\nShip **Friday**.\n\n::bot-thread{}")).toBe("Plan Ship Friday.");
  expect(snippet("::next{reply=\"x\"}")).toBe("Thread");
  expect(snippet("a".repeat(80))).toHaveLength(60);
});

const FORKED_AT = 1_000_000;

function seeded(count: number): TimelineRow[] {
  return Array.from({ length: count }, (_, index) => index % 2
    ? { id: `s${index}`, kind: "conversation", role: "assistant", text: `Answer ${index}`, turnId: `old${index - 1}`, createdAt: 10_000 + index }
    : { id: `s${index}`, kind: "conversation", role: "user", initiator: "user", text: `Question ${index}`, turnId: `old${index}`, createdAt: 10_000 + index });
}

it("counts only what's added after the fork, not the 30 messages it copied", async () => {
  const { side, forkRows, fork } = setup();
  fork("t1", "r3", FORKED_AT);
  const history = seeded(30);
  forkRows.set("t1", history);
  await side.recount("t1");
  expect((await side.list("bot1"))[0]).toMatchObject({ replies: 0, lastReplyAt: null, lastReplyRole: null });
  const asked: TimelineRow = { id: "u1", kind: "conversation", role: "user", initiator: "user", text: "Why Friday?", turnId: "n1", createdAt: FORKED_AT + 50 };
  forkRows.set("t1", [...history, asked]);
  await side.recount("t1");
  expect((await side.list("bot1"))[0]).toMatchObject({ replies: 1, lastReplyAt: FORKED_AT + 50, lastReplyRole: "user" });
  forkRows.set("t1", [...history, asked,
    { id: "a1", kind: "conversation", role: "assistant", text: "Checking.", turnId: "n1", createdAt: FORKED_AT + 60 },
    { id: "a2", kind: "conversation", role: "assistant", text: "Because QA.", turnId: "n1", createdAt: FORKED_AT + 70 }]);
  await side.recount("t1");
  expect((await side.list("bot1"))[0]).toMatchObject({ replies: 2, lastReplyAt: FORKED_AT + 70, lastReplyRole: "assistant" });
  expect(countReplies([seeded(30)], FORKED_AT)).toEqual({ replies: 0, lastReplyAt: null, lastReplyRole: null });
});

it("recounts threads made before the fix, which counted the copied history", async () => {
  const { side, forkRows, fork, db } = setup();
  fork("t1", "r3", FORKED_AT);
  fork("t2", "r1", FORKED_AT);
  forkRows.set("t1", seeded(30));
  forkRows.set("t2", [...seeded(30), { id: "u1", kind: "conversation", role: "user", initiator: "user", text: "And now?", turnId: "n1", createdAt: FORKED_AT + 5 }]);
  db.prepare("UPDATE bot_side_threads SET replies = 3522, last_reply_at = 10029, last_reply_role = 'assistant'").run();
  expect((await side.list("bot1")).map((each) => each.replies)).toEqual([3522, 3522]);
  await side.recountAll();
  const rows = db.prepare("SELECT thread_id, replies, last_reply_at, last_reply_role FROM bot_side_threads ORDER BY thread_id").all();
  expect(rows).toEqual([
    { thread_id: "t1", replies: 0, last_reply_at: null, last_reply_role: null },
    { thread_id: "t2", replies: 1, last_reply_at: FORKED_AT + 5, last_reply_role: "user" },
  ]);
});
