// A thread belongs to at most one space. It belongs implicitly to the space
// that owns its BB project (src/spaces.ts), unless it was added to
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
