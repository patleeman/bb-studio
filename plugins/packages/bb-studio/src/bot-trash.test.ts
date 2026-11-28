import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { registerBotFinish } from "./bot-finish";
import { BotThreads, type Signals, type ThreadFacts } from "./bot-threads";
import { archivedByTrash, hiddenByTrash, registerBotTrash, TRASH_KEEP_DAYS } from "./bot-trash";
import { MIGRATIONS } from "./migrations";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const DAY = 86_400_000;
const status = (code: number, text: string) => Object.assign(new Error(text), { status: code });

/**
 * Dot (Main thr_main) with the conversation "prep" (Launch prep), its
 * workers "review" (owned by prep) and "draft" (already archived), a hidden
 * thread "note" owned by review, and the conversation "trip". The fake BB
 * keeps BB's rules (db/data/threads.ts): archive-all takes everything below,
 * unarchive needs the lifecycle owner unarchived (409), a deleted thread is
 * a 404, and each change sends its event.
 */
async function setup(options: { finishing?: (threadId: string) => boolean } = {}) {
  const threads = new Map<string, ThreadFacts>([
    ["thr_main", { id: "thr_main", title: "Chief of Staff", createdAt: 1, status: "idle" }],
    ["prep", { id: "prep", title: "Launch prep", createdAt: 2, status: "idle" }],
    ["review", { id: "review", title: "Reviewer", createdAt: 3, parentThreadId: "prep", lifecycleOwnerThreadId: "prep", status: "idle" }],
    ["draft", { id: "draft", title: "Draft", createdAt: 4, parentThreadId: "prep", status: "idle", archivedAt: 5 }],
    ["note", { id: "note", title: "Note", createdAt: 5, parentThreadId: "review", lifecycleOwnerThreadId: "review", status: "idle" }],
    ["trip", { id: "trip", title: "Lisbon trip", createdAt: 6, status: "idle" }],
  ]);
  const hidden = new Set(["note"]);
  let clock = 100;
  const childrenOf = (id: string) => [...threads.values()].filter((thread) => thread.parentThreadId === id);
  const below = (id: string): ThreadFacts[] => childrenOf(id).flatMap((child) => [child, ...below(child.id)]);
  const setArchived = (id: string, at: number | null) => threads.set(id, { ...threads.get(id)!, archivedAt: at });
  let emit: (name: string, payload: unknown) => Promise<void> = async () => {};
  const archiveAll = vi.fn(async ({ threadId }: { threadId: string }) => {
    const archivedThreadIds: string[] = [];
    for (const id of [threadId, ...below(threadId).map((each) => each.id)]) {
      if (threads.get(id)!.archivedAt) continue;
      setArchived(id, ++clock);
      archivedThreadIds.push(id);
      await emit("thread.archived", { thread: threads.get(id) });
    }
    return { ok: true, archivedThreadIds };
  });
  const unarchive = vi.fn(async ({ threadId }: { threadId: string }) => {
    const thread = threads.get(threadId);
    if (!thread) throw status(404, "Thread not found");
    if (!thread.archivedAt) return {};
    const owner = thread.lifecycleOwnerThreadId ? threads.get(thread.lifecycleOwnerThreadId) : null;
    if (thread.lifecycleOwnerThreadId && (!owner || owner.archivedAt)) throw status(409, "Lifecycle owner must be unarchived first");
    setArchived(threadId, null);
    await emit("thread.unarchived", { thread: threads.get(threadId) });
    return {};
  });
  const get = vi.fn(async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw status(404, "Thread not found"); return thread; });
  const remove = vi.fn(async ({ threadId }: { threadId: string; childThreadsConfirmed: boolean }) => {
    for (const each of below(threadId)) threads.delete(each.id);
    threads.delete(threadId);
    return {};
  });
  const send = vi.fn(async (_args: unknown) => ({ ok: true }));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: (async (args: { threadIds?: string[] }) => [...threads.values()].filter((thread) => !args.threadIds || args.threadIds.includes(thread.id))) as never,
      get: get as never,
      experimental_listCascade: (async ({ threadIds, action }: { threadIds: string[]; action: "archive" | "delete" }) => ({
        threads: threadIds.filter((id) => threads.has(id)).map((id) => ({
          threadId: id, cascadeThreadIds: below(id).filter((each) => !hidden.has(each.id) && (action === "delete" || !each.archivedAt)).map((each) => each.id),
        })),
      })) as never,
      experimental_listDescendants: (async ({ threadIds, includeHidden }: { threadIds: string[]; includeHidden?: boolean }) => ({
        threads: threadIds.filter((id) => threads.has(id)).map((id) => ({
          threadId: id, descendantIds: below(id).filter((each) => !each.archivedAt && (includeHidden || !hidden.has(each.id))).map((each) => each.id),
        })),
      })) as never,
      archiveAll: archiveAll as never, unarchive: unarchive as never, delete: remove as never, send: send as never,
      archive: (async ({ threadId }: { threadId: string }) => { setArchived(threadId, ++clock); return {}; }) as never,
      events: { list: (async () => []) as never },
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  emit = async (name, payload) => { await harness.emitThreadEvent(name as never, payload as never); };
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  let now = 1_000_000;
  const signals: Signals = { bots: [{ id: "dot", threadId: "thr_main", chain: ["thr_main"] }], focusedBotId: null, sideThread: () => null, runnerBot: () => null, leadThreads: new Set(), internal: new Set(), managedBot: () => null };
  const store = new BotThreads({ db, sdk: bb.sdk, signals: () => signals, changed: () => {}, now: () => now });
  await store.backfill();
  // Finish listens for BB's archive: a soft delete must not start a finishing turn.
  registerBotFinish(bb, { db, threads: store, mainOf: () => "thr_main", changed: () => {}, log: () => {}, now: () => now });
  const changed = vi.fn();
  const logs: string[] = [];
  const trash = registerBotTrash(bb, {
    db, threads: store, changed, log: (line) => { logs.push(line); }, now: () => now, botOrCurrent: (botId) => botId ?? "dot",
    isBotThread: (threadId) => threadId === "thr_main", isFinishing: options.finishing,
  });
  const listed = async () => (await trash.rpc.bot_deleted({})).conversations.map((each) => each.threadId).sort();
  return {
    db, store, trash, threads, archiveAll, unarchive, get, remove, send, changed, logs, listed, emit, setArchived,
    tick: (ms: number) => { now += ms; }, archiveAgain: (id: string) => setArchived(id, ++clock),
  };
}

it("previews what goes with the conversation and how long it is kept; Main, a worker, a working one and a finishing one can't be deleted", async () => {
  const x = await setup();
  // BB's delete takes the visible threads below it, archived ones too.
  expect(await x.trash.rpc.bot_delete_preview({ threadId: "prep" })).toEqual({ workers: 2, keepDays: TRASH_KEEP_DAYS });
  expect(await x.trash.rpc.bot_delete_preview({ threadId: "trip" })).toEqual({ workers: 0, keepDays: 30 });
  await expect(x.trash.rpc.bot_delete_preview({ threadId: "thr_main" })).rejects.toThrow(/Main/);
  await expect(x.trash.rpc.bot_delete({ threadId: "thr_main" })).rejects.toThrow(/Main/);
  await expect(x.trash.rpc.bot_delete({ threadId: "review" })).rejects.toThrow(/worker/);
  x.threads.set("trip", { ...x.threads.get("trip")!, status: "active" });
  await expect(x.trash.rpc.bot_delete({ threadId: "trip" })).rejects.toThrow(/still working/);
  const finishing = await setup({ finishing: (threadId) => threadId === "trip" });
  await expect(finishing.trash.rpc.bot_delete({ threadId: "trip" })).rejects.toThrow(/being archived/);
  expect(x.archiveAll).not.toHaveBeenCalled();
  expect(x.remove).not.toHaveBeenCalled();
});

it("deletes softly: archived with every thread below it, out of the lists, kept 30 days, and no finishing turn", async () => {
  const x = await setup();
  const { deleted } = await x.trash.rpc.bot_delete({ threadId: "prep" });
  expect(deleted).toEqual({ threadId: "prep", botId: "dot", title: "Launch prep", deletedAt: 1_000_000, purgeAt: 1_000_000 + 30 * DAY, workers: 2 });
  expect(x.archiveAll).toHaveBeenCalledWith({ threadId: "prep" });
  for (const id of ["prep", "review", "note"]) {
    expect(x.threads.get(id)!.archivedAt, id).toBeTruthy();
    expect(archivedByTrash(x.db, id), id).toBe(true);
  }
  expect(archivedByTrash(x.db, "trip")).toBe(false);
  expect(x.store.get("prep")!.archivedAt).not.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(x.send).not.toHaveBeenCalled();
  expect(x.remove).not.toHaveBeenCalled();
  expect([...hiddenByTrash(x.db)]).toEqual(expect.arrayContaining(["prep", "review", "note"]));
  expect(hiddenByTrash(x.db).has("trip")).toBe(false);
  expect(await x.listed()).toEqual(["prep"]);
  expect(x.changed).toHaveBeenCalledWith([{ botId: "dot", kinds: ["conversations", "workers"] }]);
});

it("two deletes at once archive once", async () => {
  const x = await setup();
  const [first, second] = await Promise.all([x.trash.rpc.bot_delete({ threadId: "prep" }), x.trash.rpc.bot_delete({ threadId: "prep" })]);
  expect(second.deleted).toEqual(first.deleted);
  expect(x.archiveAll).toHaveBeenCalledTimes(1);
});

it("a delete BB refuses leaves the conversation as it was", async () => {
  const x = await setup();
  x.archiveAll.mockRejectedValueOnce(new Error("BB is busy"));
  await expect(x.trash.rpc.bot_delete({ threadId: "prep" })).rejects.toThrow(/busy/);
  expect(await x.listed()).toEqual([]);
  expect(x.store.get("prep")!.archivedAt).toBeNull();
  expect(archivedByTrash(x.db, "prep")).toBe(false);
});

it("restores as it was: only what the delete archived, hidden threads too", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  expect(await x.trash.rpc.bot_restore({ threadId: "prep" })).toEqual({ ok: true });
  for (const id of ["prep", "review", "note"]) expect(x.threads.get(id)!.archivedAt, id).toBeNull();
  expect(x.threads.get("draft")!.archivedAt).toBe(5);
  expect(x.store.get("prep")!.archivedAt).toBeNull();
  expect(hiddenByTrash(x.db).size).toBe(0);
  expect(await x.listed()).toEqual([]);
  await expect(x.trash.rpc.bot_restore({ threadId: "prep" })).rejects.toThrow(/Recently deleted/);
});

it("restore unarchives an owner before what it owns, whatever order the delete recorded", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  x.db.prepare("UPDATE bot_deleted SET archived_ids = ? WHERE thread_id = 'prep'").run(JSON.stringify(["note", "review", "prep"]));
  expect(await x.trash.rpc.bot_restore({ threadId: "prep" })).toEqual({ ok: true });
  for (const id of ["prep", "review", "note"]) expect(x.threads.get(id)!.archivedAt, id).toBeNull();
});

it("a finished conversation goes back to the archive with what it owns: no 409 keeps it in Recently deleted", async () => {
  const x = await setup();
  x.store.finish("prep", "**Decisions**\n- Ship Friday.");
  x.setArchived("prep", 50);
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  expect(await x.trash.rpc.bot_restore({ threadId: "prep" })).toEqual({ ok: true });
  // BB's rule: a thread whose lifecycle owner is archived can't be unarchived, so it isn't tried.
  expect(x.unarchive).not.toHaveBeenCalled();
  for (const id of ["prep", "review", "note"]) expect(x.threads.get(id)!.archivedAt, id).toBeTruthy();
  expect(x.store.get("prep")!.archivedAt).not.toBeNull();
  expect(await x.listed()).toEqual([]);
});

it("a thread BB deleted meanwhile counts as restored, not a failure", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  x.threads.delete("note");
  expect(await x.trash.rpc.bot_restore({ threadId: "prep" })).toEqual({ ok: true });
  expect(x.threads.get("review")!.archivedAt).toBeNull();
  expect(await x.listed()).toEqual([]);
});

it("a restore BB can't finish keeps the conversation to try again; once it's back, a child BB kept is only logged", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  const real = x.unarchive.getMockImplementation()!;
  x.unarchive.mockImplementation(async (args) => { if (args.threadId === "prep") throw new Error("BB is busy"); return real(args); });
  await expect(x.trash.rpc.bot_restore({ threadId: "prep" })).rejects.toThrow(/Try Restore again/);
  expect(await x.listed()).toEqual(["prep"]);
  x.unarchive.mockImplementation(async (args) => { if (args.threadId === "note") throw new Error("BB is busy"); return real(args); });
  expect(await x.trash.rpc.bot_restore({ threadId: "prep" })).toEqual({ ok: true });
  expect(x.threads.get("prep")!.archivedAt).toBeNull();
  expect(await x.listed()).toEqual([]);
  expect(x.logs.some((line) => line.includes("kept note archived"))).toBe(true);
});

it("an unarchive in BB that isn't bot_restore calls the delete off: nothing is purged later", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  // The desktop or the CLI unarchives it.
  await x.unarchive({ threadId: "prep" });
  expect(await x.listed()).toEqual([]);
  expect(hiddenByTrash(x.db).size).toBe(0);
  expect(archivedByTrash(x.db, "prep")).toBe(false);
  // Archived again later, and a month on: the purge has nothing to do.
  await x.archiveAll({ threadId: "prep" });
  x.tick(31 * DAY);
  expect(await x.trash.trash.purge()).toBe(0);
  expect(x.remove).not.toHaveBeenCalled();
  // A worker unarchived alone doesn't call its conversation's delete off.
  const y = await setup();
  await y.trash.rpc.bot_delete({ threadId: "prep" });
  await y.emit("thread.unarchived", { thread: y.threads.get("review") });
  expect(await y.listed()).toEqual(["prep"]);
});

it("the purge deletes in BB with its child threads after 30 days, not before, and logs it", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  x.tick(29 * DAY);
  expect(await x.trash.trash.purge()).toBe(0);
  expect(x.remove).not.toHaveBeenCalled();
  x.tick(DAY);
  expect(await x.trash.trash.purge()).toBe(1);
  expect(x.remove).toHaveBeenCalledWith({ threadId: "prep", childThreadsConfirmed: true });
  expect(await x.listed()).toEqual([]);
  expect(x.logs.some((line) => line.startsWith("Recently deleted: deleting prep (Launch prep) in BB for good"))).toBe(true);
});

it("the purge never deletes another archive than the delete's: unarchived and archived again while Studio was down", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  // No events reach Studio: it wasn't running.
  x.setArchived("prep", null);
  x.archiveAgain("prep");
  x.tick(30 * DAY);
  expect(await x.trash.trash.purge()).toBe(0);
  expect(x.remove).not.toHaveBeenCalled();
  expect(await x.listed()).toEqual([]);
  expect(x.logs.some((line) => line.includes("archived again since the delete"))).toBe(true);
});

it("on any doubt the purge skips: BB not answering, no archive time; BB failing tries again; one BB deleted leaves the list", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  await x.trash.rpc.bot_delete({ threadId: "trip" });
  x.tick(30 * DAY);
  x.get.mockRejectedValueOnce(new Error("BB is restarting"));
  x.get.mockRejectedValueOnce(new Error("BB is restarting"));
  expect(await x.trash.trash.purge()).toBe(0);
  expect(await x.listed()).toEqual(["prep", "trip"]);
  x.db.prepare("UPDATE bot_deleted SET bb_archived_at = NULL WHERE thread_id = 'trip'").run();
  x.remove.mockRejectedValueOnce(new Error("BB is busy"));
  expect(await x.trash.trash.purge()).toBe(0);
  expect(x.remove).toHaveBeenCalledTimes(1);
  expect(await x.listed()).toEqual(["prep", "trip"]);
  expect(await x.trash.trash.purge()).toBe(1);
  expect(await x.listed()).toEqual(["trip"]);
  expect(x.remove).toHaveBeenCalledTimes(2);

  const fresh = await setup();
  await fresh.trash.rpc.bot_delete({ threadId: "trip" });
  fresh.threads.delete("trip");
  fresh.tick(30 * DAY);
  expect(await fresh.trash.trash.purge()).toBe(0);
  expect(await fresh.listed()).toEqual([]);
  expect(fresh.remove).not.toHaveBeenCalled();
});

it("the purge skips a conversation while it's being restored", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  x.tick(30 * DAY);
  // The restore waits on BB's first unarchive while the purge runs.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const real = x.unarchive.getMockImplementation()!;
  x.unarchive.mockImplementation(async (args) => { await gate; return real(args); });
  const restoring = x.trash.rpc.bot_restore({ threadId: "prep" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await x.trash.trash.purge()).toBe(0);
  expect(x.remove).not.toHaveBeenCalled();
  expect(x.logs.some((line) => line.includes("skipping prep: it's being restored"))).toBe(true);
  release();
  expect(await restoring).toEqual({ ok: true });
  expect(x.threads.get("prep")!.archivedAt).toBeNull();
});

it("BB's delete of a conversation in Recently deleted takes it off the list and tells the clients", async () => {
  const x = await setup();
  await x.trash.rpc.bot_delete({ threadId: "prep" });
  x.changed.mockClear();
  await x.emit("thread.deleted", { thread: x.threads.get("prep") });
  expect(await x.listed()).toEqual([]);
  expect(x.changed).toHaveBeenCalledWith([{ botId: "dot", kinds: ["conversations", "workers"] }]);
});
