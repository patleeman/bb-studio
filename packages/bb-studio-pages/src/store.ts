import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";

// SQLite persistence. A page's content is its Yjs state (`state`); `markdown`
// is a derived cache for search, mentions and previews, refreshed on save.
// The schema as of the 2026-10-04 reset. Append new statements; never edit or
// reorder these, since each database records the hash of every one it ran.
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS pages (
     id TEXT PRIMARY KEY,
     project_id TEXT,
     parent_id TEXT,
     title TEXT NOT NULL DEFAULT '',
     icon TEXT NOT NULL DEFAULT '',
     position REAL NOT NULL DEFAULT 0,
     state BLOB,
     markdown TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     updated_by TEXT NOT NULL DEFAULT '',
     archived_at INTEGER,
     refresh_bot_id TEXT,
     refresh_cron TEXT,
     refresh_instructions TEXT NOT NULL DEFAULT '',
     refresh_last_at INTEGER
   , template INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS snapshots (
     id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     state BLOB NOT NULL,
     label TEXT NOT NULL,
     actor TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS files (
     id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     name TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     data BLOB NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS requests (
     id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     bot_id TEXT NOT NULL,
     bot_name TEXT NOT NULL,
     thread_id TEXT,
     kind TEXT NOT NULL,
     block_id TEXT,
     comment_thread_id TEXT,
     summary TEXT NOT NULL,
     status TEXT NOT NULL,
     error TEXT,
     result TEXT,
     dedupe_key TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS chats (
     thread_id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS checklist_handoffs (
     thread_id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     block_id TEXT NOT NULL,
     title TEXT NOT NULL,
     state TEXT NOT NULL,
     note TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS pages_parent ON pages (project_id, parent_id, position)`,
  `CREATE INDEX IF NOT EXISTS snapshots_page ON snapshots (page_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS requests_page ON requests (page_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS requests_thread ON requests (thread_id, status)`,
  `CREATE INDEX IF NOT EXISTS chats_page ON chats (page_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS checklist_handoffs_page ON checklist_handoffs (page_id, created_at)`,
  // Bot workers were retired. Keep history, but never show old requests as live work.
  `UPDATE requests SET status = 'failed',
     error = COALESCE(NULLIF(error, ''), 'Bot profile automation was retired. Start a page chat to continue.'),
     updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
   WHERE status IN ('queued', 'working')`,
];

export { newId };

export interface PageRow {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  icon: string;
  position: number;
  state: Buffer | null;
  markdown: string;
  created_at: number;
  updated_at: number;
  updated_by: string;
  archived_at: number | null;
  template?: number;
}

export type PageMeta = Omit<PageRow, "state" | "markdown">;

export interface RequestRow {
  id: string;
  page_id: string;
  bot_id: string;
  bot_name: string;
  thread_id: string | null;
  kind: "mention" | "comment" | "refresh";
  block_id: string | null;
  comment_thread_id: string | null;
  summary: string;
  status: "queued" | "working" | "done" | "failed";
  error: string | null;
  result: string | null;
  dedupe_key: string;
  created_at: number;
  updated_at: number;
}

export interface SnapshotMeta {
  id: string;
  page_id: string;
  label: string;
  actor: string;
  created_at: number;
}

const META_COLUMNS =
  "id, project_id, parent_id, title, icon, position, created_at, updated_at, updated_by, archived_at, template";
const SNAPSHOTS_PER_PAGE = 50;

export class PageStore {
  constructor(private readonly db: Database.Database, private readonly snapshotLimit: () => number = () => SNAPSHOTS_PER_PAGE) {}

  setTemplate(id: string, template: boolean): void {
    this.db.prepare("UPDATE pages SET template = ? WHERE id = ?").run(template ? 1 : 0, id);
  }

  // Pages -------------------------------------------------------------------

  list(options: { projectId?: string | null; includeArchived?: boolean } = {}): PageMeta[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (options.projectId !== undefined) {
      // A project's pages plus global pages; `null` means global only.
      where.push(options.projectId === null ? "project_id IS NULL" : "(project_id IS NULL OR project_id = ?)");
      if (options.projectId !== null) args.push(options.projectId);
    }
    if (!options.includeArchived) where.push("archived_at IS NULL");
    const sql = `SELECT ${META_COLUMNS} FROM pages ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY position, created_at`;
    return this.db.prepare(sql).all(...args) as PageMeta[];
  }

  get(id: string): PageRow | null {
    return (this.db.prepare("SELECT * FROM pages WHERE id = ?").get(id) as PageRow | undefined) ?? null;
  }

  meta(id: string): PageMeta | null {
    return (this.db.prepare(`SELECT ${META_COLUMNS} FROM pages WHERE id = ?`).get(id) as PageMeta | undefined) ?? null;
  }

  create(input: { projectId: string | null; parentId: string | null; title: string; icon?: string; actor: string }): PageMeta {
    const id = newId("pg");
    const now = Date.now();
    const last = this.db
      .prepare("SELECT MAX(position) AS max FROM pages WHERE parent_id IS ? AND project_id IS ?")
      .get(input.parentId, input.projectId) as { max: number | null };
    this.db
      .prepare(
        "INSERT INTO pages (id, project_id, parent_id, title, icon, position, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.projectId, input.parentId, input.title, input.icon ?? "", (last.max ?? 0) + 1, now, now, input.actor);
    return this.meta(id)!;
  }

  update(
    id: string,
    patch: Partial<Pick<PageRow, "title" | "icon" | "parent_id" | "project_id" | "position" | "archived_at">>,
    actor: string,
    expectedTitle?: string,
  ): PageMeta | null {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length) {
      const sets = entries.map(([key]) => `${key} = ?`).join(", ");
      const result = this.db
        .prepare(`UPDATE pages SET ${sets}, updated_at = ?, updated_by = ? WHERE id = ?${expectedTitle === undefined ? "" : " AND title = ?"}`)
        .run(...entries.map(([, value]) => value), Date.now(), actor, id, ...(expectedTitle === undefined ? [] : [expectedTitle]));
      if (expectedTitle !== undefined && !result.changes && this.meta(id)) {
        throw new Error("Page title changed. Review the current title before retrying.");
      }
    }
    return this.meta(id);
  }

  saveContent(id: string, state: Uint8Array, markdown: string, actor: string | null): void {
    if (actor === null) {
      this.db.prepare("UPDATE pages SET state = ?, markdown = ? WHERE id = ?").run(Buffer.from(state), markdown, id);
    } else {
      this.db
        .prepare("UPDATE pages SET state = ?, markdown = ?, updated_at = ?, updated_by = ? WHERE id = ?")
        .run(Buffer.from(state), markdown, Date.now(), actor, id);
    }
  }

  descendants(id: string): string[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE tree(id) AS (SELECT id FROM pages WHERE parent_id = ? UNION ALL SELECT p.id FROM pages p JOIN tree t ON p.parent_id = t.id) SELECT id FROM tree`,
      )
      .all(id) as { id: string }[];
    return rows.map((row) => row.id);
  }

  /** The start of every page's saved Markdown, for previews. */
  markdownHeads(chars = 2000): Map<string, string> {
    const rows = this.db.prepare("SELECT id, substr(markdown, 1, ?) AS head FROM pages").all(chars) as { id: string; head: string | null }[];
    return new Map(rows.map((row) => [row.id, row.head ?? ""]));
  }

  delete(ids: string[]): void {
    const tx = this.db.transaction((all: string[]) => {
      for (const id of all) {
        this.db.prepare("DELETE FROM pages WHERE id = ?").run(id);
        this.db.prepare("DELETE FROM snapshots WHERE page_id = ?").run(id);
        this.db.prepare("DELETE FROM files WHERE page_id = ?").run(id);
        this.db.prepare("DELETE FROM requests WHERE page_id = ?").run(id);
        this.db.prepare("DELETE FROM chats WHERE page_id = ?").run(id);
      }
    });
    tx(ids);
  }

  search(query: string, projectId: string | null | undefined, limit = 20): PageMeta[] {
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const scope = projectId === undefined ? "" : projectId === null ? "AND project_id IS NULL" : "AND (project_id IS NULL OR project_id = ?)";
    const args: unknown[] = [like, like];
    if (projectId) args.push(projectId);
    args.push(limit);
    return this.db
      .prepare(
        `SELECT ${META_COLUMNS} FROM pages WHERE archived_at IS NULL AND (title LIKE ? ESCAPE '\\' OR markdown LIKE ? ESCAPE '\\') ${scope} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...args) as PageMeta[];
  }

  // Snapshots ---------------------------------------------------------------

  addSnapshot(pageId: string, state: Uint8Array, label: string, actor: string): SnapshotMeta {
    const id = newId("snap");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO snapshots (id, page_id, state, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, pageId, Buffer.from(state), label, actor, now);
    const limit = this.snapshotLimit();
    if (limit > 0) this.db
      .prepare(
        "DELETE FROM snapshots WHERE page_id = ? AND id NOT IN (SELECT id FROM snapshots WHERE page_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
      )
      .run(pageId, pageId, limit);
    return { id, page_id: pageId, label, actor, created_at: now };
  }

  snapshots(pageId: string): SnapshotMeta[] {
    return this.db
      .prepare("SELECT id, page_id, label, actor, created_at FROM snapshots WHERE page_id = ? ORDER BY created_at DESC, rowid DESC")
      .all(pageId) as SnapshotMeta[];
  }

  latestSnapshot(pageId: string): SnapshotMeta | null {
    return this.snapshots(pageId)[0] ?? null;
  }

  snapshotState(id: string): { page_id: string; state: Buffer } | null {
    return (
      (this.db.prepare("SELECT page_id, state FROM snapshots WHERE id = ?").get(id) as
        | { page_id: string; state: Buffer }
        | undefined) ?? null
    );
  }

  // Files -------------------------------------------------------------------

  addFile(pageId: string, name: string, mime: string, data: Uint8Array): string {
    const id = newId("file");
    this.db
      .prepare("INSERT INTO files (id, page_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, pageId, name, mime, data.byteLength, Buffer.from(data), Date.now());
    return id;
  }

  file(id: string): { name: string; mime: string; data: Buffer } | null {
    return (
      (this.db.prepare("SELECT name, mime, data FROM files WHERE id = ?").get(id) as
        | { name: string; mime: string; data: Buffer }
        | undefined) ?? null
    );
  }

  files(pageId: string): { id: string; name: string; mime: string; data: Buffer }[] {
    return this.db.prepare("SELECT id, name, mime, data FROM files WHERE page_id = ? ORDER BY created_at, id").all(pageId) as { id: string; name: string; mime: string; data: Buffer }[];
  }

  // Historical bot requests are read-only.

  requests(pageId: string, limit = 20): RequestRow[] {
    return this.db
      .prepare("SELECT * FROM requests WHERE page_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(pageId, limit) as RequestRow[];
  }

  addChat(pageId: string, threadId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO chats VALUES (?,?,?)").run(threadId, pageId, Date.now());
  }

  chats(pageId: string, limit = 10): { thread_id: string; created_at: number }[] {
    return this.db
      .prepare("SELECT thread_id, created_at FROM chats WHERE page_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(pageId, limit) as { thread_id: string; created_at: number }[];
  }

  chatPageId(threadId: string): string | null {
    const row = this.db.prepare("SELECT page_id FROM chats WHERE thread_id = ?").get(threadId) as { page_id: string } | undefined;
    return row?.page_id ?? null;
  }
}
