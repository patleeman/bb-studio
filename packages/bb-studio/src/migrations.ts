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
  `CREATE VIRTUAL TABLE studio_search_fts USING fts5(
       plugin_id UNINDEXED, item_id UNINDEXED, kind UNINDEXED,
       project_id UNINDEXED, href UNINDEXED, updated_at UNINDEXED,
       title, body, tokenize='unicode61 remove_diacritics 2'
     );`,
  `CREATE TABLE IF NOT EXISTS item_links (
       from_plugin TEXT NOT NULL, from_id TEXT NOT NULL,
       to_plugin TEXT NOT NULL, to_id TEXT NOT NULL,
       kind TEXT NOT NULL, source TEXT NOT NULL,
       PRIMARY KEY (from_plugin, from_id, to_plugin, to_id, kind, source)
     );
   CREATE INDEX IF NOT EXISTS item_links_to ON item_links (to_plugin, to_id);
   CREATE TABLE IF NOT EXISTS item_threads (
       thread_id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       role TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL, metadata TEXT NOT NULL
     );
   CREATE INDEX IF NOT EXISTS item_threads_item ON item_threads (plugin_id, item_id, created_at);
   CREATE TABLE IF NOT EXISTS item_activity (
       id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       actor TEXT NOT NULL, verb TEXT NOT NULL, at INTEGER NOT NULL, summary TEXT NOT NULL
     );
   CREATE INDEX IF NOT EXISTS item_activity_item ON item_activity (plugin_id, item_id, id);
   CREATE TABLE IF NOT EXISTS item_comments (
       id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       parent_id TEXT, anchor TEXT, actor TEXT NOT NULL, body TEXT NOT NULL,
       created_at INTEGER NOT NULL, resolved_at INTEGER
     );
   CREATE INDEX IF NOT EXISTS item_comments_item ON item_comments (plugin_id, item_id, created_at);
   CREATE TABLE IF NOT EXISTS item_blobs (sha256 TEXT PRIMARY KEY, bytes BLOB NOT NULL);
   CREATE TABLE IF NOT EXISTS item_versions (
       id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       sha256 TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL
     );
   CREATE INDEX IF NOT EXISTS item_versions_item ON item_versions (plugin_id, item_id, created_at);`,
  `CREATE TABLE item_threads_next (
       thread_id TEXT NOT NULL, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       role TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL, metadata TEXT NOT NULL,
       PRIMARY KEY (thread_id, plugin_id, item_id)
     );
   INSERT INTO item_threads_next SELECT * FROM item_threads;
   DROP TABLE item_threads;
   ALTER TABLE item_threads_next RENAME TO item_threads;
   CREATE INDEX item_threads_item ON item_threads (plugin_id, item_id, created_at);
   CREATE INDEX item_threads_thread ON item_threads (thread_id);`,
];
