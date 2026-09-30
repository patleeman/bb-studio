// Studio's own tables: tags (src/tags.ts) and sidebar tabs (src/tabs.ts).

/**
 * Append-only: statement index is the migration id, and BB checks each
 * statement against the hash it recorded, so never edit one (not even its
 * whitespace).
 */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS tags (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       color TEXT NOT NULL,
       created_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX IF NOT EXISTS tags_name ON tags (name COLLATE NOCASE);
   CREATE TABLE IF NOT EXISTS item_tags (
       plugin_id TEXT NOT NULL,
       item_id TEXT NOT NULL,
       tag_id TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (plugin_id, item_id, tag_id)
     );
   CREATE INDEX IF NOT EXISTS item_tags_tag ON item_tags (tag_id);`,
  `CREATE TABLE IF NOT EXISTS tabs (
       plugin_id TEXT NOT NULL,
       item_id TEXT NOT NULL,
       position INTEGER NOT NULL,
       opened_at INTEGER NOT NULL,
       PRIMARY KEY (plugin_id, item_id)
     );`,
];
