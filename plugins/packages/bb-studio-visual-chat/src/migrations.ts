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
  // The model picker: each canvas's provider, model and reasoning level (its
  // backing thread's), a provider switch waiting for the next turn (JSON), and
  // the threads a canvas had before a provider switch (old links keep working).
  `ALTER TABLE canvases ADD COLUMN provider_id TEXT;
  ALTER TABLE canvases ADD COLUMN model TEXT;
  ALTER TABLE canvases ADD COLUMN reasoning_level TEXT;
  ALTER TABLE canvases ADD COLUMN pending_execution TEXT;
  CREATE TABLE canvas_thread_aliases (thread_id TEXT PRIMARY KEY, canvas_id TEXT NOT NULL);`,
  // BB Studio Visual Chat was the plugin "canvas" (and then "studio-canvas"): its one-time import of that
  // plugin's canvases (src/legacy-import.ts), recorded so it never runs twice.
  `CREATE TABLE canvas_legacy_import (
    id INTEGER PRIMARY KEY CHECK (id = 1), source TEXT NOT NULL, at INTEGER NOT NULL, counts TEXT NOT NULL
  );`,
  // Pages: a board is one HTML page the agent writes (src/page.ts); boards
  // of items from before stay readable. And where the title came from
  // (prompt, agent or page), so the title follows the topic.
  `ALTER TABLE canvases ADD COLUMN page TEXT;
  ALTER TABLE canvases ADD COLUMN title_source TEXT;`,
  // Pictures canvas_image and canvas_images found (src/image.ts ImageCache),
  // by query or page address, reused for a day.
  `CREATE TABLE canvas_image_cache (key TEXT PRIMARY KEY, image TEXT NOT NULL, at INTEGER NOT NULL);`,
  // Versions (store.ts): each turn's finished board (its page, or the items
  // of a board from before pages), with its style, title, prompt and caption,
  // the last 50 per canvas. n only grows; from_n is the version a branch
  // continued from. viewing: the version the user is looking at (null: the
  // latest).
  `CREATE TABLE canvas_versions (
    canvas_id TEXT NOT NULL, n INTEGER NOT NULL, page TEXT, items TEXT, look TEXT, title TEXT NOT NULL DEFAULT '',
    prompt TEXT, caption TEXT, rev INTEGER NOT NULL, from_n INTEGER, at INTEGER NOT NULL,
    PRIMARY KEY (canvas_id, n)
  );
  ALTER TABLE canvases ADD COLUMN viewing INTEGER;`,
  // Webpage parts (src/webpage.ts): the URLs a canvas may show (from the user, or the agent's own fetch or
  // search results in the turn that used them), and each page's framing and link card, cached for a day.
  `CREATE TABLE canvas_webpage_urls (canvas_id TEXT NOT NULL, url TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (canvas_id, url));
  CREATE TABLE canvas_webpage_cache (url TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);`,
];
