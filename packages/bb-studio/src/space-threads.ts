// A thread belongs to at most one space. It belongs implicitly to the space
// that owns its BB project (src/office/space-store.ts), unless it was added to
// a space explicitly: that explicit membership wins, and adding the thread to
// another space moves it. Pages and other items keep following their project.
import type Database from "better-sqlite3";

type Row = { thread_id: string; space_id: string; added_at: number };

export class SpaceThreadOwners {
  constructor(private readonly db: Database.Database) {}

  /** The space a thread was added to explicitly, if that space still exists. */
  explicit(threadId: string): string | null {
    const row = this.db.prepare("SELECT t.space_id FROM space_threads t JOIN spaces s ON s.id = t.space_id WHERE t.thread_id = ?").get(threadId) as { space_id: string } | undefined;
    return row?.space_id ?? null;
  }

  /** Explicit owners of every thread, by thread id. */
  all(): Map<string, string> {
    const rows = this.db.prepare("SELECT t.thread_id, t.space_id FROM space_threads t JOIN spaces s ON s.id = t.space_id").all() as Row[];
    return new Map(rows.map((row) => [row.thread_id, row.space_id]));
  }

  /** Threads added to a space explicitly, oldest first. */
  ofSpace(spaceId: string): string[] {
    return (this.db.prepare("SELECT thread_id FROM space_threads WHERE space_id = ? ORDER BY added_at, thread_id").all(spaceId) as Row[]).map((row) => row.thread_id);
  }

  /** Adds a thread to a space, taking it out of any other. Returns the space it left, if any. */
  set(spaceId: string, threadId: string, at = Date.now()): string | null {
    const previous = this.explicit(threadId);
    if (previous === spaceId) return null;
    this.db
      .prepare("INSERT INTO space_threads (thread_id, space_id, added_at) VALUES (?, ?, ?) ON CONFLICT (thread_id) DO UPDATE SET space_id = excluded.space_id, added_at = excluded.added_at")
      .run(threadId, spaceId, at);
    return previous;
  }

  /** Takes a thread out of a space it was added to; it falls back to its project's space. */
  remove(spaceId: string, threadId: string): boolean {
    return this.db.prepare("DELETE FROM space_threads WHERE space_id = ? AND thread_id = ?").run(spaceId, threadId).changes > 0;
  }

  forget(threadId: string): boolean {
    return this.db.prepare("DELETE FROM space_threads WHERE thread_id = ?").run(threadId).changes > 0;
  }

  removeSpace(spaceId: string): void {
    this.db.prepare("DELETE FROM space_threads WHERE space_id = ?").run(spaceId);
  }

  /** Changes whenever any explicit membership or project ownership changes. */
  fingerprint(): string {
    const threads = this.db.prepare("SELECT COALESCE(group_concat(thread_id || '=' || space_id, ','), '') AS v FROM (SELECT thread_id, space_id FROM space_threads ORDER BY thread_id)").get() as { v: string };
    const projects = this.db.prepare("SELECT COALESCE(group_concat(project_id || '=' || space_id, ','), '') AS v FROM (SELECT project_id, space_id FROM space_projects ORDER BY project_id)").get() as { v: string };
    const spaces = this.db.prepare("SELECT COALESCE(group_concat(id, ','), '') AS v FROM (SELECT id FROM spaces ORDER BY id)").get() as { v: string };
    return `${threads.v}|${projects.v}|${spaces.v}`;
  }
}

/**
 * Moves explicit thread memberships kept from the tag-based spaces (rows in
 * item_tags under a space's id) into space_threads. A thread that was in
 * several spaces keeps the one it was added to most recently. Runs once.
 */
export function migrateThreadOwners(db: Database.Database, log: (message: string) => void): void {
  const dropped: string[] = [];
  db.transaction(() => {
    db.exec("CREATE TABLE IF NOT EXISTS office_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    if (db.prepare("SELECT 1 FROM office_migrations WHERE id = 'space-thread-owner-v1'").get()) return;
    const rows = db
      .prepare(
        `SELECT it.item_id AS thread_id, it.tag_id AS space_id, it.created_at AS added_at
           FROM item_tags it JOIN spaces s ON s.id = it.tag_id
          WHERE it.plugin_id = 'bb-thread'
          ORDER BY it.item_id, it.created_at DESC, it.tag_id DESC`,
      )
      .all() as Row[];
    const upsert = db.prepare(
      "INSERT INTO space_threads (thread_id, space_id, added_at) VALUES (?, ?, ?) ON CONFLICT (thread_id) DO UPDATE SET space_id = excluded.space_id, added_at = excluded.added_at WHERE excluded.added_at > space_threads.added_at",
    );
    const kept = new Map<string, string>();
    for (const row of rows) {
      const winner = kept.get(row.thread_id);
      if (winner) {
        dropped.push(`Thread ${row.thread_id} was in several spaces; keeping ${winner}, dropping ${row.space_id}.`);
        continue;
      }
      kept.set(row.thread_id, row.space_id);
      upsert.run(row.thread_id, row.space_id, row.added_at);
    }
    db.prepare("DELETE FROM item_tags WHERE plugin_id = 'bb-thread' AND tag_id IN (SELECT id FROM spaces)").run();
    // The old space tags held only what didn't follow a project; drop the empty ones.
    db.prepare("DELETE FROM tags WHERE id IN (SELECT id FROM spaces) AND NOT EXISTS (SELECT 1 FROM item_tags WHERE item_tags.tag_id = tags.id)").run();
    db.prepare("INSERT INTO office_migrations (id, applied_at) VALUES ('space-thread-owner-v1', ?)").run(Date.now());
  })();
  for (const message of dropped) log(message);
}
