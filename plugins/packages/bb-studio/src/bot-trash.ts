// Recently deleted: a conversation deleted through Studio (the phone's
// Delete) is kept for TRASH_KEEP_DAYS before BB deletes it for good.
//
// 1. bot_delete records the conversation in bot_deleted with the threads it
//    is about to archive (it and every descendant not archived yet, hidden
//    ones too), archives it in Studio, then archives them in BB. Finish
//    (src/bot-finish.ts) asks `archivedByTrash` and starts no summary turn
//    for them. Every list that reads a Bot's rows (the sidebar, Archive,
//    History, search) leaves it and its workers out.
// 2. bot_restore brings it back as it was: it unarchives in BB what the
//    delete archived, owners first, except a conversation that was finished
//    before and the threads it owns (they go back to Archive with it). A
//    thread BB no longer has is done. If BB fails, it stays in Recently
//    deleted with what's left, and the restore can be tried again.
// 3. Unarchived in BB by anything but bot_restore (the desktop, the CLI,
//    Reopen), the delete is off: it leaves the list and is never purged.
// 4. The purge (Studio's "bot-trash" trigger, hourly) deletes in BB, with
//    its child threads, a conversation past its date only while BB still
//    has the delete's own archive (same archivedAt). On any doubt it skips;
//    each decision is logged.
//
// bot_delete_preview answers what the confirm says (the threads that go
// with it, and the days it is kept); the phone feature-detects soft delete
// with it and falls back to BB's own delete on an older Studio.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { BotChange } from "./bot-signal";
import type { BotThreads, ThreadFacts } from "./bot-threads";
import { rpcErrorStatus } from "./kit/server/core";

type Sdk = BbPluginApi["sdk"];

export const TRASH_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;
/** How often the purge looks for conversations past their date. */
export const TRASH_PURGE_EVERY_MS = 60 * 60_000;
const BUSY = new Set(["starting", "active", "stopping", "pending", "provisioning"]);

interface Row {
  thread_id: string; bot_id: string; title: string; deleted_at: number; purge_at: number;
  was_archived: number; archived_ids: string; workers: number;
  /** BB's archivedAt from the delete's archive; the purge deletes only that archive. */
  bb_archived_at: number | null;
}

export interface DeletedConversation {
  threadId: string;
  botId: string;
  title: string;
  deletedAt: number;
  purgeAt: number;
  workers: number;
}

/** The conversations in Recently deleted, and the threads they started: no list shows them. */
export function hiddenByTrash(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT thread_id FROM bot_deleted").all() as { thread_id: string }[];
  const ids = new Set(rows.map((row) => row.thread_id));
  if (!ids.size) return ids;
  const owned = db.prepare(`SELECT thread_id FROM bot_threads WHERE owner_conversation_id IN (SELECT thread_id FROM bot_deleted)
    UNION SELECT each.value FROM bot_deleted, json_each(bot_deleted.archived_ids) AS each`).all() as { thread_id: string }[];
  for (const row of owned) ids.add(row.thread_id);
  return ids;
}

/** A delete archived (or is archiving) this thread: BB's archive of it is no Archive by the user. */
export function archivedByTrash(db: Database.Database, threadId: string): boolean {
  return !!db.prepare("SELECT 1 FROM bot_deleted WHERE thread_id = ? OR EXISTS (SELECT 1 FROM json_each(archived_ids) WHERE value = ?)").get(threadId, threadId);
}

export interface TrashDeps {
  db: Database.Database;
  sdk: Sdk;
  threads: BotThreads;
  /** A Bot's own threads (its Main chain): never deleted. */
  isBotThread?(threadId: string): boolean;
  /** Finish is writing its summary (src/bot-finish.ts): delete it when that's done. */
  isFinishing?(threadId: string): boolean;
  changed(changes: readonly BotChange[]): void;
  log(message: string): void;
  now?(): number;
}

const view = (row: Row): DeletedConversation => ({
  threadId: row.thread_id, botId: row.bot_id, title: row.title, deletedAt: row.deleted_at, purgeAt: row.purge_at, workers: row.workers,
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class BotTrash {
  /** Conversations bot_restore is bringing back: their own unarchive doesn't call the delete off. */
  private readonly restoring = new Set<string>();

  constructor(private readonly deps: TrashDeps) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  private row(threadId: string): Row | null {
    return (this.deps.db.prepare("SELECT * FROM bot_deleted WHERE thread_id = ?").get(threadId) as Row | undefined) ?? null;
  }

  /** A conversation that can be deleted, or why not: Main and a Bot's own threads can't. */
  private deletable(threadId: string) {
    const rec = this.deps.threads.get(threadId);
    if (!rec) throw new Error("That thread isn't a conversation of any Bot.");
    if (rec.kind !== "conversation") throw new Error("A worker goes with its conversation.");
    if (rec.isMain || this.deps.isBotThread?.(threadId)) throw new Error("Main can't be deleted.");
    if (this.deps.isFinishing?.(threadId)) throw new Error("It's being archived. Delete it when that's done.");
    return rec;
  }

  /** The visible threads BB's delete takes with it (workers, side threads). */
  private async workers(threadId: string): Promise<number> {
    const found = await this.deps.sdk.threads.experimental_listCascade({ threadIds: [threadId], action: "delete" });
    return found.threads.find((each) => each.threadId === threadId)?.cascadeThreadIds.length ?? 0;
  }

  /** Every thread below it that isn't archived, hidden ones too: what BB's archive-all archives. */
  private async unarchivedBelow(threadId: string): Promise<string[]> {
    const found = await this.deps.sdk.threads.experimental_listDescendants({ threadIds: [threadId], includeHidden: true });
    return found.threads.find((each) => each.threadId === threadId)?.descendantIds ?? [];
  }

  /** BB's thread now: "gone" when BB says it doesn't exist (404), null when BB couldn't say. */
  private async bbThread(threadId: string): Promise<ThreadFacts | "gone" | null> {
    return await Promise.resolve()
      .then(() => this.deps.sdk.threads.get({ threadId }) as Promise<ThreadFacts>)
      .catch((error: unknown) => (rpcErrorStatus(error) === 404 ? "gone" as const : null));
  }

  private async idleThread(threadId: string): Promise<ThreadFacts> {
    const thread = await this.deps.sdk.threads.get({ threadId }) as ThreadFacts;
    if (BUSY.has(thread.status ?? "")) throw new Error("It's still working. Delete it when it's done.");
    return thread;
  }

  async preview(threadId: string): Promise<{ workers: number; keepDays: number }> {
    this.deletable(threadId);
    await this.idleThread(threadId);
    return { workers: await this.workers(threadId), keepDays: TRASH_KEEP_DAYS };
  }

  async delete(threadId: string): Promise<DeletedConversation> {
    const existing = this.row(threadId);
    if (existing) return view(existing);
    const rec = this.deletable(threadId);
    const [workers, below, thread] = await Promise.all([this.workers(threadId), this.unarchivedBelow(threadId), this.idleThread(threadId)]);
    const archivedIds = [...(thread.archivedAt ? [] : [threadId]), ...below];
    const now = this.now();
    const deleted: DeletedConversation = {
      threadId, botId: rec.botId, title: rec.title?.trim() || thread.title?.trim() || thread.titleFallback?.trim() || "Untitled conversation",
      deletedAt: now, purgeAt: now + TRASH_KEEP_DAYS * DAY_MS, workers,
    };
    // Recorded before BB archives, so Finish knows each archive is the delete's. A second delete at once finds it.
    const added = this.deps.db.prepare(`INSERT INTO bot_deleted (thread_id, bot_id, title, deleted_at, purge_at, was_archived, archived_ids, workers, bb_archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (thread_id) DO NOTHING`)
      .run(threadId, rec.botId, deleted.title, now, deleted.purgeAt, rec.archivedAt !== null ? 1 : 0, JSON.stringify(archivedIds), workers, thread.archivedAt ?? null);
    if (!added.changes) return this.row(threadId) ? view(this.row(threadId)!) : deleted;
    if (rec.archivedAt === null) this.deps.threads.update(threadId, { archived: true });
    if (archivedIds.length) {
      try {
        const result = await this.deps.sdk.threads.archiveAll({ threadId }) as { archivedThreadIds?: string[] };
        // What BB archived, a thread started meanwhile too, and when: the purge deletes only that archive.
        const ids = [...new Set([...archivedIds, ...(result.archivedThreadIds ?? [])])];
        const after = await this.bbThread(threadId);
        const archivedAt = after && after !== "gone" ? after.archivedAt ?? null : null;
        this.deps.db.prepare("UPDATE bot_deleted SET archived_ids = ?, bb_archived_at = ? WHERE thread_id = ?").run(JSON.stringify(ids), archivedAt, threadId);
      } catch (error) {
        // Back as it was; what BB did archive comes back too (owners first, as the list is).
        for (const id of archivedIds) await this.deps.sdk.threads.unarchive({ threadId: id }).catch(() => undefined);
        this.forget(threadId);
        if (rec.archivedAt === null) this.deps.threads.update(threadId, { archived: false });
        throw error;
      }
    }
    this.deps.log(`Recently deleted: ${threadId} (${deleted.title}), kept until ${new Date(deleted.purgeAt).toISOString()}.`);
    this.deps.changed([{ botId: rec.botId, kinds: ["conversations", "workers"] }]);
    return deleted;
  }

  /**
   * Back as it was before the delete. BB unarchives a thread only once its
   * lifecycle owner is unarchived (db/data/threads.ts, unarchiveThread), so
   * owners go first, and a thread whose owner stays archived (a finished
   * conversation's) stays archived with it. A thread BB no longer has is
   * done. The conversation back, the row goes; else it stays to try again.
   */
  async restore(threadId: string): Promise<{ ok: boolean }> {
    const row = this.row(threadId);
    if (!row) throw new Error("That conversation isn't in Recently deleted.");
    this.restoring.add(threadId);
    try {
      const kept = new Set(row.was_archived ? [threadId] : []);
      let pending = (JSON.parse(row.archived_ids) as string[]).filter((id) => !kept.has(id));
      const failed: string[] = [];
      while (pending.length) {
        const waiting: string[] = [];
        for (const id of pending) {
          const thread = await this.bbThread(id);
          if (thread === "gone" || (thread && !thread.archivedAt)) continue;
          const owner = thread?.lifecycleOwnerThreadId ?? null;
          if (owner && kept.has(owner)) { kept.add(id); continue; }
          try {
            await this.deps.sdk.threads.unarchive({ threadId: id });
          } catch (error) {
            const status = rpcErrorStatus(error);
            if (status === 404) continue;
            if (status === 409) { waiting.push(id); continue; }
            this.deps.log(`Restore: unarchiving ${id} in BB failed: ${message(error)}`);
            failed.push(id);
          }
        }
        // A pass that unarchived nothing: what still waits on its owner won't come back now.
        if (waiting.length === pending.length) { failed.push(...waiting); break; }
        pending = waiting;
      }
      // The conversation not back (or a finished one, which stays hidden till all is back): keep it, to try again.
      if (failed.length && (row.was_archived || failed.includes(threadId))) {
        this.deps.db.prepare("UPDATE bot_deleted SET archived_ids = ? WHERE thread_id = ?").run(JSON.stringify(row.was_archived ? [threadId, ...failed] : failed), threadId);
        throw new Error("BB didn't bring all of it back. Try Restore again.");
      }
      if (failed.length) this.deps.log(`Restore: ${threadId} is back; BB kept ${failed.join(", ")} archived.`);
      this.forget(threadId);
      if (this.deps.threads.get(threadId)) {
        if (row.was_archived) this.deps.threads.update(threadId, { archived: true });
        else this.deps.threads.reopen(threadId);
      }
      this.deps.log(`Recently deleted: restored ${threadId} (${row.title}).`);
      this.deps.changed([{ botId: row.bot_id, kinds: ["conversations", "workers"] }]);
      return { ok: true };
    } finally {
      this.restoring.delete(threadId);
    }
  }

  list(botId: string | null): DeletedConversation[] {
    const rows = (botId
      ? this.deps.db.prepare("SELECT * FROM bot_deleted WHERE bot_id = ? ORDER BY deleted_at DESC").all(botId)
      : this.deps.db.prepare("SELECT * FROM bot_deleted ORDER BY deleted_at DESC").all()) as Row[];
    return rows.map(view);
  }

  /** It left Recently deleted: restored, purged, or no longer the delete's (BB deleted or unarchived it). */
  forget(threadId: string): boolean {
    return this.deps.db.prepare("DELETE FROM bot_deleted WHERE thread_id = ?").run(threadId).changes > 0;
  }

  private drop(row: Row, why: string): void {
    if (!this.forget(row.thread_id)) return;
    this.deps.log(`Recently deleted: ${row.thread_id} (${row.title}) left the list: ${why}.`);
    this.deps.changed([{ botId: row.bot_id, kinds: ["conversations", "workers"] }]);
  }

  /** BB deleted it (here or anywhere): it leaves the list. */
  deletedInBb(threadId: string): void {
    const row = this.row(threadId);
    if (row) this.drop(row, "BB deleted it");
  }

  /** BB unarchived it, not bot_restore (the desktop, the CLI, Reopen): the user wants it, so the delete is off. */
  unarchived(threadId: string): void {
    if (this.restoring.has(threadId)) return;
    const row = this.row(threadId);
    if (row) this.drop(row, "unarchived in BB");
  }

  /**
   * Deletes in BB, for good and with its child threads, each conversation
   * past its date, only when BB still has the very archive the delete made
   * (same archivedAt). Anything else either takes it off the list (BB
   * deleted it, or the user unarchived or archived it again) or, when BB
   * can't say, skips it to the next pass. Never deletes on a doubt.
   */
  async purge(): Promise<number> {
    const due = this.deps.db.prepare("SELECT thread_id FROM bot_deleted WHERE purge_at <= ?").all(this.now()) as { thread_id: string }[];
    let purged = 0;
    for (const { thread_id: threadId } of due) {
      const row = this.row(threadId);
      if (!row || row.purge_at > this.now()) continue;
      if (this.restoring.has(threadId)) { this.deps.log(`Recently deleted: skipping ${threadId}: it's being restored.`); continue; }
      if (row.bb_archived_at === null) { this.deps.log(`Recently deleted: skipping ${threadId}: when BB archived it isn't known.`); continue; }
      const thread = await this.bbThread(threadId);
      if (thread === null) { this.deps.log(`Recently deleted: skipping ${threadId}: BB didn't answer.`); continue; }
      if (thread === "gone") { this.drop(row, "BB deleted it"); continue; }
      if (!thread.archivedAt) { this.drop(row, "unarchived in BB"); continue; }
      if (thread.archivedAt !== row.bb_archived_at) { this.drop(row, "archived again since the delete"); continue; }
      if (!this.row(threadId)) continue;
      if (this.restoring.has(threadId)) { this.deps.log(`Recently deleted: skipping ${threadId}: it's being restored.`); continue; }
      this.deps.log(`Recently deleted: deleting ${threadId} (${row.title}) in BB for good, with its child threads; deleted ${new Date(row.deleted_at).toISOString()}.`);
      try {
        await this.deps.sdk.threads.delete({ threadId, childThreadsConfirmed: true });
        this.drop(row, "deleted for good");
        purged++;
      } catch (error) {
        if (rpcErrorStatus(error) === 404) { this.drop(row, "BB deleted it"); continue; }
        this.deps.log(`Recently deleted: deleting ${threadId} in BB failed (${message(error)}); it tries again later.`);
      }
    }
    return purged;
  }
}

type Bb = Pick<BbPluginApi, "events" | "sdk">;

/** Recently deleted: the service, its RPC, and BB's deletes. */
export function registerBotTrash(bb: Bb, deps: Omit<TrashDeps, "sdk"> & { botOrCurrent(botId?: string): string | null }) {
  const trash = new BotTrash({ ...deps, sdk: bb.sdk });
  bb.events.on("thread.deleted", ({ thread }) => trash.deletedInBb(thread.id));
  bb.events.on("thread.unarchived", ({ thread }) => trash.unarchived(thread.id));
  const rpc = {
    bot_delete_preview: ({ threadId }: { threadId: string }) => trash.preview(threadId),
    bot_delete: async ({ threadId }: { threadId: string }) => ({ deleted: await trash.delete(threadId) }),
    bot_restore: ({ threadId }: { threadId: string }) => trash.restore(threadId),
    bot_deleted: ({ botId }: { botId?: string }) => {
      const id = deps.botOrCurrent(botId);
      return { botId: id, keepDays: TRASH_KEEP_DAYS, conversations: id ? trash.list(id) : [] };
    },
  };
  return { trash, rpc };
}
