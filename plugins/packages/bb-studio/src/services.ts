import { readAvailable } from "./kit/server/read-available";
import { newId } from "./kit/ids";
import type { Actor } from "./kit/server/index";
import type Database from "better-sqlite3";

export type { Ref, ItemLink, ItemActivity, ItemThread, ItemComment } from "./kit/item-services-contract";
import type { Ref, ItemLink, ItemActivity, ItemThread, ItemComment } from "./kit/item-services-contract";

const readActor = (raw: string): Actor => JSON.parse(raw) as Actor;
const readRef = (pluginId: string, id: string): Ref => ({ pluginId, id });

export class StudioServices {
  constructor(private readonly db: Database.Database) {}

  replaceLinks(ref: Ref, source: string, links: readonly ItemLink[]): void {
    if (links.some((link) => link.from.pluginId !== ref.pluginId || link.from.id !== ref.id || link.source !== source)) {
      throw new Error("Link source does not match the item.");
    }
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM item_links WHERE from_plugin = ? AND from_id = ? AND source = ?").run(ref.pluginId, ref.id, source);
      const insert = this.db.prepare("INSERT OR IGNORE INTO item_links (from_plugin, from_id, to_plugin, to_id, kind, source) VALUES (?, ?, ?, ?, ?, ?)");
      for (const link of links) insert.run(ref.pluginId, ref.id, link.to.pluginId, link.to.id, link.kind, source);
    })();
  }

  links(ref: Ref): { outgoing: ItemLink[]; backlinks: ItemLink[] } {
    type Row = { from_plugin: string; from_id: string; to_plugin: string; to_id: string; kind: ItemLink["kind"]; source: string };
    const map = (row: Row): ItemLink => ({ from: readRef(row.from_plugin, row.from_id), to: readRef(row.to_plugin, row.to_id), kind: row.kind, source: row.source });
    return {
      outgoing: (this.db.prepare("SELECT * FROM item_links WHERE from_plugin = ? AND from_id = ?").all(ref.pluginId, ref.id) as Row[]).map(map),
      backlinks: (this.db.prepare("SELECT * FROM item_links WHERE to_plugin = ? AND to_id = ?").all(ref.pluginId, ref.id) as Row[]).map(map),
    };
  }

  /** Links an item an agent made to the thread that made it. */
  created(ref: Ref, threadId: string): void {
    const at = Date.now();
    this.linkThread({ threadId, ref, role: "created", state: "working", createdAt: at, updatedAt: at, metadata: {} });
  }

  linkThread(thread: ItemThread): void {
    this.db.prepare(`INSERT INTO item_threads (thread_id, plugin_id, item_id, role, state, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, plugin_id, item_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`)
      .run(thread.threadId, thread.ref.pluginId, thread.ref.id, thread.role, thread.state, thread.createdAt, thread.updatedAt, JSON.stringify(thread.metadata));
  }

  threads(ref: Ref): ItemThread[] {
    type Row = { thread_id: string; plugin_id: string; item_id: string; role: string; state: string; created_at: number; updated_at: number; metadata: string };
    return (this.db.prepare("SELECT * FROM item_threads WHERE plugin_id = ? AND item_id = ? ORDER BY created_at DESC").all(ref.pluginId, ref.id) as Row[])
      .map((row) => ({ threadId: row.thread_id, ref, role: row.role, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, metadata: JSON.parse(row.metadata) as Record<string, string> }));
  }

  threadsForThread(threadId: string): ItemThread[] {
    const rows = this.db.prepare("SELECT plugin_id, item_id FROM item_threads WHERE thread_id = ?").all(threadId) as { plugin_id: string; item_id: string }[];
    return rows.flatMap((row) => this.threads(readRef(row.plugin_id, row.item_id)).filter((thread) => thread.threadId === threadId));
  }

  /** Returns false only when a lookup needs retrying. Never replaces a newer thread event. */
  async reconcileThread(threadId: string, read: () => Promise<{ archivedAt?: number | null; deletedAt?: number | null }>, log: (error: unknown) => void): Promise<boolean> {
    const before = this.threadsForThread(threadId);
    const result = await readAvailable(read);
    if (result.status === "unavailable") { log(result.error); return false; }
    const state = result.status === "absent" || result.value.deletedAt ? "deleted" : result.value.archivedAt ? "archived" : "idle";
    for (const thread of this.threadsForThread(threadId)) {
      if (before.some((old) => old.ref.pluginId === thread.ref.pluginId && old.ref.id === thread.ref.id && old.updatedAt === thread.updatedAt && old.state === thread.state)) {
        this.linkThread({ ...thread, state, updatedAt: Date.now() });
      }
    }
    return true;
  }

  /**
   * The thread that made each item, by `<plugin>:<id>`: its earliest link
   * with the "created" role. Items no thread made are absent.
   */
  originThreads(): Map<string, string> {
    const rows = this.db.prepare(`SELECT plugin_id, item_id, thread_id FROM item_threads t WHERE role = 'created'
      AND NOT EXISTS (SELECT 1 FROM item_threads e WHERE e.plugin_id = t.plugin_id AND e.item_id = t.item_id AND e.role = 'created'
        AND (e.created_at < t.created_at OR (e.created_at = t.created_at AND e.thread_id < t.thread_id)))`).all() as { plugin_id: string; item_id: string; thread_id: string }[];
    return new Map(rows.map((row) => [`${row.plugin_id}:${row.item_id}`, row.thread_id]));
  }

  activeThreads(): ItemThread[] {
    const refs = this.db.prepare("SELECT DISTINCT plugin_id, item_id FROM item_threads WHERE state NOT IN ('archived', 'deleted')").all() as { plugin_id: string; item_id: string }[];
    return refs.flatMap((row) => this.threads(readRef(row.plugin_id, row.item_id)).filter((thread) => thread.state !== "archived" && thread.state !== "deleted"));
  }

  /**
   * Who made each item: the actor of its first recorded activity, by
   * `pluginId:itemId`. An item with no activity is absent.
   */
  creators(): Map<string, "user" | "agent"> {
    const rows = this.db.prepare("SELECT plugin_id, item_id, actor FROM item_activity WHERE id IN (SELECT MIN(id) FROM item_activity GROUP BY plugin_id, item_id)").all() as { plugin_id: string; item_id: string; actor: string }[];
    const creators = new Map<string, "user" | "agent">();
    for (const row of rows) {
      try {
        const kind = (JSON.parse(row.actor) as { kind?: unknown }).kind;
        if (kind === "user" || kind === "agent") creators.set(`${row.plugin_id}:${row.item_id}`, kind);
      } catch { /* an unreadable actor names no one */ }
    }
    return creators;
  }

  /**
   * The thread of the agent each item's first recorded activity names, by
   * `pluginId:itemId`: who made it, when that was an agent's thread. The
   * Library uses it to credit a worker for what it made through Main.
   */
  creatorThreads(): Map<string, string> {
    const rows = this.db.prepare("SELECT plugin_id, item_id, actor FROM item_activity WHERE id IN (SELECT MIN(id) FROM item_activity GROUP BY plugin_id, item_id)").all() as { plugin_id: string; item_id: string; actor: string }[];
    const threads = new Map<string, string>();
    for (const row of rows) {
      try {
        const actor = JSON.parse(row.actor) as { kind?: unknown; id?: unknown };
        if (actor.kind === "agent" && typeof actor.id === "string" && actor.id) threads.set(`${row.plugin_id}:${row.item_id}`, actor.id);
      } catch { /* an unreadable actor names no one */ }
    }
    return threads;
  }

  recordActivity(event: ItemActivity): number {
    const result = this.db.prepare("INSERT INTO item_activity (plugin_id, item_id, actor, verb, at, summary) VALUES (?, ?, ?, ?, ?, ?)")
      .run(event.ref.pluginId, event.ref.id, JSON.stringify(event.actor), event.verb, event.at, event.summary);
    return Number(result.lastInsertRowid);
  }

  activity(ref: Ref | null, since: number, limit: number): (ItemActivity & { id: number })[] {
    type Row = { id: number; plugin_id: string; item_id: string; actor: string; verb: string; at: number; summary: string };
    const rows = ref
      ? this.db.prepare("SELECT * FROM item_activity WHERE plugin_id = ? AND item_id = ? AND id > ? ORDER BY id DESC LIMIT ?").all(ref.pluginId, ref.id, since, limit)
      : this.db.prepare("SELECT * FROM item_activity WHERE id > ? ORDER BY id DESC LIMIT ?").all(since, limit);
    return (rows as Row[]).map((row) => ({ id: row.id, ref: readRef(row.plugin_id, row.item_id), actor: readActor(row.actor), verb: row.verb, at: row.at, summary: row.summary }));
  }

  addComment(input: Omit<ItemComment, "id" | "createdAt" | "resolvedAt">): ItemComment {
    const comment: ItemComment = { ...input, id: newId("comment"), createdAt: Date.now(), resolvedAt: null };
    if (comment.parentId) {
      const parent = this.db.prepare("SELECT plugin_id, item_id FROM item_comments WHERE id = ?").get(comment.parentId) as { plugin_id: string; item_id: string } | undefined;
      if (!parent || parent.plugin_id !== input.ref.pluginId || parent.item_id !== input.ref.id) throw new Error("Comment thread not found.");
    }
    this.db.prepare("INSERT INTO item_comments (id, plugin_id, item_id, parent_id, anchor, actor, body, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(comment.id, input.ref.pluginId, input.ref.id, input.parentId, input.anchor, JSON.stringify(input.actor), input.body, comment.createdAt, null);
    return comment;
  }

  comments(ref: Ref): ItemComment[] {
    type Row = { id: string; parent_id: string | null; anchor: string | null; actor: string; body: string; created_at: number; resolved_at: number | null };
    return (this.db.prepare("SELECT * FROM item_comments WHERE plugin_id = ? AND item_id = ? ORDER BY created_at").all(ref.pluginId, ref.id) as Row[])
      .map((row) => ({ id: row.id, ref, parentId: row.parent_id, anchor: row.anchor, actor: readActor(row.actor), body: row.body, createdAt: row.created_at, resolvedAt: row.resolved_at }));
  }

  openComments(): ItemComment[] {
    const refs = this.db.prepare("SELECT DISTINCT plugin_id, item_id FROM item_comments WHERE resolved_at IS NULL").all() as { plugin_id: string; item_id: string }[];
    return refs.flatMap((row) => this.comments(readRef(row.plugin_id, row.item_id)));
  }

  resolveComment(ref: Ref, id: string, resolved: boolean): boolean {
    return this.db.prepare("UPDATE item_comments SET resolved_at = ? WHERE id = ? AND plugin_id = ? AND item_id = ?")
      .run(resolved ? Date.now() : null, id, ref.pluginId, ref.id).changes > 0;
  }
}
