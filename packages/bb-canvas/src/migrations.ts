// The canvas plugin's tables, in its own database (bb.storage.database()).
// Append-only: never edit or reorder a statement once it has shipped.
export const CANVAS_MIGRATIONS: string[] = [
  // One board per canvas thread, its items, a short change log per turn,
  // and the history lines the page peeks at.
  `CREATE TABLE canvases (
    id TEXT PRIMARY KEY, thread_id TEXT UNIQUE, title TEXT NOT NULL DEFAULT '', caption TEXT,
    status TEXT NOT NULL DEFAULT 'idle', rev INTEGER NOT NULL DEFAULT 0, turn INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER
  );
  CREATE TABLE canvas_items (
    canvas_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT, data TEXT, options TEXT NOT NULL, html TEXT,
    size TEXT NOT NULL, importance INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (canvas_id, id)
  );
  CREATE TABLE canvas_changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, canvas_id TEXT NOT NULL, rev INTEGER NOT NULL, turn INTEGER NOT NULL,
    op TEXT NOT NULL, item_id TEXT, summary TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE INDEX canvas_changes_canvas ON canvas_changes (canvas_id, seq);
  CREATE TABLE canvas_turns (seq INTEGER PRIMARY KEY AUTOINCREMENT, canvas_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX canvas_turns_canvas ON canvas_turns (canvas_id, seq);`,
  // Looks (looks.ts): a canvas's design direction (null: classic), and each
  // item's relations as JSON {relatedTo, anchor, point}.
  `ALTER TABLE canvases ADD COLUMN look TEXT;
  ALTER TABLE canvas_items ADD COLUMN rel TEXT;`,
];
