// Explore's database: the Next row's click log. Explainers (and their jobs and
// parent pages) were removed; their tables stay, since migrations only append.
import type Database from "better-sqlite3";
import { NEXT_KINDS, suggestionKey, type NextKind } from "./next";

// The schema as of the 2026-10-04 reset. Append new statements; never edit or
// reorder these, since each database records the hash of every one it ran.
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS explore_explainers (
     id TEXT PRIMARY KEY,
     key TEXT NOT NULL UNIQUE,
     parent_id TEXT,
     thread_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     turn_id TEXT,
     emoji TEXT NOT NULL,
     label TEXT NOT NULL,
     page_id TEXT,
     project_id TEXT,
     status TEXT NOT NULL,
     follow_ups TEXT NOT NULL DEFAULT '[]',
     generated_at INTEGER,
     regenerated_at INTEGER,
     error TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS explore_jobs (
     id TEXT PRIMARY KEY,
     explainer_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     status TEXT NOT NULL,
     label TEXT NOT NULL,
     detail TEXT NOT NULL,
     progress INTEGER NOT NULL,
     worker_thread_id TEXT,
     error TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS explore_parents (
     project_key TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS explore_findings (
     id TEXT PRIMARY KEY,
     key TEXT NOT NULL UNIQUE,
     thread_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     turn_id TEXT,
     emoji TEXT NOT NULL,
     label TEXT NOT NULL,
     project_id TEXT,
     thread_title TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     post_id TEXT,
     linked_page_id TEXT,
     digested_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS explore_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS explore_explainers_message ON explore_explainers (thread_id, message_id)`,
  `CREATE INDEX IF NOT EXISTS explore_explainers_page ON explore_explainers (page_id)`,
  `CREATE INDEX IF NOT EXISTS explore_jobs_explainer ON explore_jobs (explainer_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS explore_findings_digest ON explore_findings (digested_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS explore_findings_post ON explore_findings (post_id)`,
  // Findings were kept for Studio Feed, which is gone.
  `DROP TABLE IF EXISTS explore_findings`,
  // The Next row's suggestions: when each was first shown and clicked.
  `CREATE TABLE IF NOT EXISTS next_suggestions (
     key TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     emoji TEXT NOT NULL,
     label TEXT NOT NULL,
     shown_at INTEGER NOT NULL,
     clicked_at INTEGER,
     clicks INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS next_suggestions_shown ON next_suggestions (shown_at)`,
  // What the user was told about a finding in the Next row, for its explainer's writer.
  `ALTER TABLE explore_explainers ADD COLUMN note TEXT`,
];

/**
 * The Next row's click log, which Studio keeps in its own database (Explore
 * kept explore.db beside Pages' database; the upgrade bridge copies it in).
 * These are the statements above, unchanged; the rest are retired tables.
 */
export const NEXT_LOG_MIGRATIONS = MIGRATIONS.filter((sql) => sql.includes("next_suggestions"));

/** The click log keeps this many days, enough for `bb studio pages explore stats --days 180`. */
export const NEXT_LOG_DAYS = 180;
/** And at most this many suggestions, newest kept. */
export const NEXT_LOG_MAX_ROWS = 50_000;
const NEXT_PRUNE_EVERY_MS = 60 * 60 * 1000;

export type NextKindStats = { kind: NextKind; shown: number; clicked: number };
export type NextLabelStats = { kind: NextKind; emoji: string; label: string; shown: number; clicked: number };
export type NextStats = { since: number; kinds: NextKindStats[]; top: NextLabelStats[] };

export class ExploreStore {
  private nextPrunedAt: number | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
    private readonly nextLog: { days: number; maxRows: number } = { days: NEXT_LOG_DAYS, maxRows: NEXT_LOG_MAX_ROWS },
  ) {}

  // ----- the Next row's click log -----

  /** Records suggestions as shown; ones already recorded keep their first time. */
  nextShown(input: { threadId: string; messageId: string; items: readonly { kind: NextKind; emoji: string; label: string }[] }): void {
    const insert = this.db.prepare(
      `INSERT INTO next_suggestions (key, thread_id, message_id, kind, emoji, label, shown_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING`,
    );
    const at = this.now();
    this.db.transaction(() => {
      for (const item of input.items) insert.run(suggestionKey({ ...input, ...item }), input.threadId, input.messageId, item.kind, item.emoji, item.label, at);
    })();
    if (this.nextPrunedAt === null || at - this.nextPrunedAt >= NEXT_PRUNE_EVERY_MS) this.pruneNext(at);
  }

  /** Drops suggestions shown before the log's window, then the oldest past its row cap. */
  pruneNext(at: number = this.now()): void {
    this.nextPrunedAt = at;
    this.db.prepare("DELETE FROM next_suggestions WHERE shown_at < ?").run(at - this.nextLog.days * 24 * 60 * 60 * 1000);
    this.db
      .prepare("DELETE FROM next_suggestions WHERE key IN (SELECT key FROM next_suggestions ORDER BY shown_at DESC, rowid DESC LIMIT -1 OFFSET ?)")
      .run(this.nextLog.maxRows);
  }

  /** Records a click, and the suggestion as shown if that was missed. */
  nextClicked(input: { threadId: string; messageId: string; kind: NextKind; emoji: string; label: string }): void {
    this.nextShown({ threadId: input.threadId, messageId: input.messageId, items: [input] });
    this.db
      .prepare("UPDATE next_suggestions SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, ?) WHERE key = ?")
      .run(this.now(), suggestionKey(input));
  }

  /** Suggestions copied from the old Pages plugin's explore.db; ones Studio has keep Studio's counts. */
  importNext(rows: readonly { key: string; threadId: string; messageId: string; kind: string; emoji: string; label: string; shownAt: number; clickedAt: number | null; clicks: number }[]): { imported: number; existing: number } {
    const insert = this.db.prepare(
      `INSERT INTO next_suggestions (key, thread_id, message_id, kind, emoji, label, shown_at, clicked_at, clicks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING`,
    );
    let imported = 0;
    this.db.transaction(() => {
      for (const row of rows) imported += insert.run(row.key, row.threadId, row.messageId, row.kind, row.emoji, row.label, row.shownAt, row.clickedAt, row.clicks).changes;
    })();
    return { imported, existing: rows.length - imported };
  }

  /** Shown and clicked suggestions since a time, per kind, and the most clicked labels. */
  nextStats(since: number, limit = 10): NextStats {
    const kinds = this.db
      .prepare("SELECT kind, COUNT(*) AS shown, COUNT(clicked_at) AS clicked FROM next_suggestions WHERE shown_at >= ? GROUP BY kind")
      .all(since) as NextKindStats[];
    const top = this.db
      .prepare(
        `SELECT kind, MIN(emoji) AS emoji, MIN(label) AS label, COUNT(*) AS shown, COUNT(clicked_at) AS clicked FROM next_suggestions
         WHERE shown_at >= ? GROUP BY kind, LOWER(label) HAVING clicked > 0 ORDER BY clicked DESC, shown ASC LIMIT ?`,
      )
      .all(since, limit) as NextLabelStats[];
    return { since, kinds: NEXT_KINDS.map((kind) => kinds.find((row) => row.kind === kind) ?? { kind, shown: 0, clicked: 0 }), top };
  }
}
