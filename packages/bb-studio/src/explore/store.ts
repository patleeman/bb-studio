// Explore's store: the Next row's click log, in Studio's database.
import type Database from "better-sqlite3";
import { NEXT_KINDS, suggestionKey, type NextKind } from "./next";

/**
 * The Next row's click log, which Studio keeps in its own database (Explore
 * kept explore.db beside Pages' database).
 * Each statement is exactly as Explore ran it, since a database records the
 * hash of every statement it ran; never edit or reorder them.
 * Studio freezes its own copy. Append schema changes only at the END of
 * MIGRATIONS in src/migrations.ts.
 */
export const NEXT_LOG_MIGRATIONS = [
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
];

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
