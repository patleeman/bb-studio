import { createHash } from "node:crypto";
import { newId } from "@bb-studio/kit/ids";
import type { Actor } from "@bb-studio/kit/server";
import type Database from "better-sqlite3";

export interface Ref { pluginId: string; id: string }
export interface ItemLink { from: Ref; to: Ref; kind: "mention" | "embed" | "task-link" | "related"; source: string }
export interface ItemActivity { actor: Actor; verb: string; ref: Ref; at: number; summary: string }
export interface ItemThread { threadId: string; ref: Ref; role: string; state: string; createdAt: number; updatedAt: number; metadata: Record<string, string> }
export interface ItemComment { id: string; ref: Ref; parentId: string | null; anchor: string | null; actor: Actor; body: string; createdAt: number; resolvedAt: number | null }
export interface ItemVersion { id: string; ref: Ref; sha256: string; label: string; actor: Actor; createdAt: number }

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
      const insert = this.db.prepare("INSERT OR IGNORE INTO item_links VALUES (?, ?, ?, ?, ?, ?)");
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

  linkThread(thread: ItemThread): void {
    this.db.prepare(`INSERT INTO item_threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

  activeThreads(): ItemThread[] {
    const refs = this.db.prepare("SELECT DISTINCT plugin_id, item_id FROM item_threads WHERE state NOT IN ('archived', 'deleted')").all() as { plugin_id: string; item_id: string }[];
    return refs.flatMap((row) => this.threads(readRef(row.plugin_id, row.item_id)).filter((thread) => thread.state !== "archived" && thread.state !== "deleted"));
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
    this.db.prepare("INSERT INTO item_comments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
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

  addVersion(ref: Ref, bytes: Uint8Array, label: string, actor: Actor): ItemVersion {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const latest = this.db.prepare("SELECT id, sha256, label, actor, created_at FROM item_versions WHERE plugin_id = ? AND item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(ref.pluginId, ref.id) as { id: string; sha256: string; label: string; actor: string; created_at: number } | undefined;
    if (latest?.sha256 === sha256) return { id: latest.id, ref, sha256, label: latest.label, actor: readActor(latest.actor), createdAt: latest.created_at };
    const version: ItemVersion = { id: newId("version"), ref, sha256, label, actor, createdAt: Date.now() };
    this.db.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO item_blobs VALUES (?, ?)").run(sha256, Buffer.from(bytes));
      this.db.prepare("INSERT INTO item_versions VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(version.id, ref.pluginId, ref.id, sha256, label, JSON.stringify(actor), version.createdAt);
    })();
    return version;
  }

  versions(ref: Ref): ItemVersion[] {
    type Row = { id: string; sha256: string; label: string; actor: string; created_at: number };
    return (this.db.prepare("SELECT * FROM item_versions WHERE plugin_id = ? AND item_id = ? ORDER BY created_at DESC, rowid DESC").all(ref.pluginId, ref.id) as Row[])
      .map((row) => ({ id: row.id, ref, sha256: row.sha256, label: row.label, actor: readActor(row.actor), createdAt: row.created_at }));
  }

  /** Drops deleted items' versions, and any blob no version uses any more. */
  forgetVersions(pluginId: string, ids: readonly string[]): void {
    if (!ids.length) return;
    this.db.transaction(() => {
      const remove = this.db.prepare("DELETE FROM item_versions WHERE plugin_id = ? AND item_id = ?");
      let removed = 0;
      for (const id of ids) removed += remove.run(pluginId, id).changes;
      if (removed) this.db.prepare("DELETE FROM item_blobs WHERE sha256 NOT IN (SELECT sha256 FROM item_versions)").run();
    })();
  }

  versionBytes(ref: Ref, id: string): Uint8Array | null {
    const row = this.db.prepare(`SELECT bytes FROM item_versions JOIN item_blobs USING (sha256)
      WHERE id = ? AND plugin_id = ? AND item_id = ?`).get(id, ref.pluginId, ref.id) as { bytes: Buffer } | undefined;
    return row?.bytes ?? null;
  }
}
