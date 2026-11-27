import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { directiveFor, isFinished, rpcContract, WORK_ID, type CreateInput, type WorkCard, type WorkChanges } from "./contract";
import { WorkCardStore } from "./store";
import { guardTasks } from "../tasks/store";
import { closedByUser, isClosed, type Task } from "../tasks/contract";
import { boundTask, isPlaceholder, SPAWN_SOURCE, ThreadDirectory } from "../tasks/links";

type TimelineRow = { id: string; kind?: string; role?: string; text?: string; messageSeq?: number };
type TimelinePage = { rows?: TimelineRow[]; timelinePage?: { olderCursor?: { anchorSeq: number; anchorId: string } | null } };
export type TimelineReader = (threadId: string, cursor: { anchorSeq: number; anchorId: string } | null) => Promise<TimelinePage>;

export type WorkerThread = { status?: string | null; archivedAt?: number | null; deletedAt?: number | null } | null;
export type ThreadReader = (threadId: string) => Promise<WorkerThread>;

const PAGES = 8;
const RETRY_MS = 15_000;

export async function findCardMessage(read: TimelineReader, card: Pick<WorkCard, "id" | "threadId" | "messageId">): Promise<{ messageId: string; messageSeq: number } | null> {
  const directive = `id="${card.id}"`;
  let cursor: { anchorSeq: number; anchorId: string } | null = null;
  for (let page = 0; page < PAGES; page++) {
    const result = await read(card.threadId, cursor);
    const rows = [...(result.rows ?? [])].reverse();
    const found = rows.find((row) => row.kind === "conversation" && typeof row.messageSeq === "number" && (row.id === card.messageId || (!!row.text && row.text.includes("::work{") && row.text.includes(directive))));
    if (found && typeof found.messageSeq === "number") return { messageId: found.id, messageSeq: found.messageSeq };
    cursor = result.timelinePage?.olderCursor ?? null;
    if (!cursor) return null;
  }
  return null;
}



export function endsCard(card: WorkCard, thread: WorkerThread): boolean {
  if (isFinished(card) || !card.workerThreadId) return false;
  if (!thread || thread.archivedAt || thread.deletedAt) return true;
  return card.state === "running" && card.kind !== "lead" && card.workerThreadId !== card.threadId && (thread.status === "idle" || thread.status === "error");
}

export function registerWorkCards(bb: BbPluginApi, db: Database.Database, options: { read?: TimelineReader; thread?: ThreadReader; moved?(task: Task): void } = {}) {
  const store = new WorkCardStore(db, () => { void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); });
  const read: TimelineReader = options.read ?? (async (threadId, cursor) => await bb.sdk.threads.timeline({ threadId, segmentLimit: 40, ...(cursor ? { beforeAnchorSeq: String(cursor.anchorSeq), beforeAnchorId: cursor.anchorId } : {}) } as never) as unknown as TimelinePage);
  const tried = new Map<string, number>();
  const place = async (card: WorkCard): Promise<WorkCard> => {
    if (card.messageSeq !== null) return card;
    const last = tried.get(card.id) ?? 0;
    if (Date.now() - last < RETRY_MS) return card;
    tried.set(card.id, Date.now());
    const found = await findCardMessage(read, card).catch((error: unknown) => { bb.log.warn(`Work card ${card.id}: ${error instanceof Error ? error.message : String(error)}`); return null; });
    if (!found) return card;
    tried.delete(card.id);
    return store.placed(card.id, found.messageId, found.messageSeq);
  };
  const name = (card: WorkCard, before: WorkCard | null) => {
    if (card.kind !== "worker" || !card.workerThreadId) return;
    if (before && before.kind === card.kind && before.workerThreadId === card.workerThreadId && before.title === card.title) return;
    void Promise.resolve().then(() => bb.sdk.threads.update({ threadId: card.workerThreadId!, title: card.title } as never))
      .catch((error: unknown) => { bb.log.warn(`Work card ${card.id}: ${error instanceof Error ? error.message : String(error)}`); });
  };
  const moved = (card: WorkCard, before: WorkCard | null) => {
    if (card.state !== "needs-you" || before?.state === "needs-you") return;
    const task = store.tasks.find(card.id);
    if (task) options.moved?.(task);
  };
  const threads = new ThreadDirectory(db);
  const target = (input: CreateInput & { taskId?: string }): Task | null => {
    if (input.taskId) {
      if (!WORK_ID.test(input.taskId)) throw new Error("Only a task_ or wc_ task can be drawn as a work card; post ::loop{id} for a to-do.");
      return store.tasks.get(input.taskId);
    }
    const worker = input.workerThreadId;
    if (!worker || input.kind === "lead" || !threads.isWorker(worker)) return null;
    const all = store.tasks.all();
    const bound = boundTask(all, worker);
    if (bound) return WORK_ID.test(bound.id) ? bound : null;
    const madeUp = all.filter((t) => t.source?.kind === SPAWN_SOURCE && t.source.ref === worker && isPlaceholder(t) && t.state !== "dropped" && !closedByUser(t) && WORK_ID.test(t.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return madeUp ?? null;
  };
  const attach = (task: Task, input: CreateInput & { threadId: string }): WorkCard => {
    if (task.automation || task.schedule) throw new Error("That task is an automation's; it has no work card.");
    if (task.card && task.conversation) return store.get(task.id);
    const worker = input.workerThreadId ?? null;
    const madeUp = isPlaceholder(task);
    store.tasks.change(task.id, (t) => {
      if (madeUp) { t.title = input.title; t.conversation = input.threadId; }
      if (madeUp && isClosed(t)) { t.state = input.state === "waiting" ? "waiting" : "in_progress"; t.progress.line = input.line || null; t.stale = false; }
      t.card = { kind: input.kind ?? "task", messageId: null, messageSeq: null, dismissedAt: null };
      if (t.conversation === null) t.conversation = input.threadId;
      if (worker) t.workers = [worker, ...t.workers.filter((w) => w !== worker)];
      if (input.step && t.progress.step === null) t.progress.step = input.step;
      if (input.line && t.progress.line === null) t.progress.line = input.line;
    }, null);
    store.tasks.event(task.id, "carded", { thread: input.threadId, kind: input.kind ?? "task" });
    return store.get(task.id);
  };
  const create = (input: CreateInput & { threadId: string; taskId?: string }) => {
    const existing = target(input);
    if (existing) {
      const posted = !!existing.card && !!existing.conversation;
      const card = attach(existing, input);
      if (!posted) name(card, null);
      return { card, directive: directiveFor(card.id), ...(posted ? { posted: card.threadId } : {}) };
    }
    const card = store.create(input);
    name(card, null);
    moved(card, null);
    return { card, directive: directiveFor(card.id) };
  };
  const update = (id: string, changes: WorkChanges, by: string | null = null) => {
    const before = store.find(id);
    const card = store.update(id, changes, by);
    name(card, before);
    moved(card, before);
    return card;
  };
  const list = async (threadId: string) => ({ cards: await Promise.all(store.inFlight(threadId).map(place)) });
  const placeAll = async (threadId: string) => {
    for (const card of store.inFlight(threadId)) if (card.messageSeq === null) { tried.delete(card.id); await place(card); }
  };
  const readThread: ThreadReader = options.thread ?? (async (threadId) => await bb.sdk.threads.get({ threadId }) as unknown as WorkerThread);
  const workerEnded = (threadId: string, thread: WorkerThread) => {
    for (const card of store.forWorker(threadId)) if (endsCard(card, thread)) store.markStale(card.id);
  };
  const workerBack = (threadId: string) => {
    for (const card of store.forWorker(threadId)) if (card.stale) store.revive(card.id);
  };
  const sweep = async () => {
    for (const card of store.openWithWorker()) {
      const thread = await readThread(card.workerThreadId!).then((value) => value ?? null, (error: unknown) => {
        bb.log.warn(`Work card ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      });
      if (thread !== undefined && endsCard(store.get(card.id), thread)) store.markStale(card.id);
    }
  };
  bb.events?.on("thread.idle", ({ thread }) => { workerEnded(thread.id, { status: "idle" }); void placeAll(thread.id).catch(() => {}); });
  bb.events?.on("thread.failed", ({ thread }) => { workerEnded(thread.id, { status: "error" }); });
  bb.events?.on("thread.archived", ({ thread }) => { workerEnded(thread.id, { archivedAt: Date.now() }); });
  bb.events?.on("thread.deleted", ({ thread }) => { workerEnded(thread.id, null); });
  bb.events?.on("thread.active", ({ thread }) => { workerBack(thread.id); });
  const swept = sweep().catch((error: unknown) => { bb.log.warn(`Work cards: ${error instanceof Error ? error.message : String(error)}`); });

  bb.rpc.register(rpcContract, guardTasks(db, {
    "work.get": ({ id }) => store.get(id),
    "work.list": ({ threadId }) => list(threadId),
    "work.create": (input) => create(input),
    "work.update": ({ id, ...rest }) => update(id, rest),
    "work.anchor": async ({ id, threadId, messageId }) => await place(store.anchor(id, threadId, messageId)),
    "work.dismiss": ({ id }) => store.dismiss(id),
    "work.clear": ({ threadId }) => { const cleared = store.clearFinished(threadId); store.changed(); return { cleared }; },
  }, false, (message) => bb.log.warn(message)));


  return { store, create, update, list, place, placeAll, sweep, swept };
}
