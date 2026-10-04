// Studio's own tables: tags (src/tags.ts), spaces (src/spaces.ts), saved
// views (src/views.ts) and sidebar tabs (src/tabs.ts).

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
  `CREATE TABLE studio_playbooks (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL)`,
  // Playbooks were removed.
  `DROP TABLE IF EXISTS studio_playbooks`,
  // Spaces are protected tags (src/spaces.ts): members stay in item_tags.
  `ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'tag';
   CREATE TABLE spaces (
       tag_id TEXT PRIMARY KEY,
       icon TEXT,
       description TEXT NOT NULL DEFAULT '',
       default_project_id TEXT
     );`,
  // Saved collection queries (src/views.ts).
  `CREATE TABLE views (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       query TEXT NOT NULL,
       position INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX views_name ON views (name COLLATE NOCASE);`,
  // A space's home page in Pages (src/space-page.ts).
  `ALTER TABLE spaces ADD COLUMN page_id TEXT`,
  // The space template version its page has caught up with (src/space-page.ts).
  `ALTER TABLE spaces ADD COLUMN page_template INTEGER`,
  // Parent-space inheritance runs once even when Studio restarts while an
  // item is still new. Markers expire after the inheritance window.
  `CREATE TABLE item_space_inheritance (
     plugin_id TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY (plugin_id, item_id)
   );`,
  // Office sidebar tabs and their Pinned groupings (independent of projects).
  `CREATE TABLE office_tab_folders (
     id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL,
     open INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL
   );
   CREATE INDEX office_tab_folders_space ON office_tab_folders(space_id,position);
   CREATE TABLE office_tabs (
     space_id TEXT NOT NULL, ref TEXT NOT NULL,
     zone TEXT NOT NULL CHECK(zone IN ('essential','pinned','today','archived')),
     folder_id TEXT REFERENCES office_tab_folders(id), position INTEGER NOT NULL,
     opened_at INTEGER NOT NULL, archived_at INTEGER,
     PRIMARY KEY(space_id,ref),
     CHECK(folder_id IS NULL OR zone='pinned'),
     CHECK((zone='archived') = (archived_at IS NOT NULL))
   );
   CREATE INDEX office_tabs_space_zone ON office_tabs(space_id,zone,position);`,
  `CREATE TABLE office_tab_splits (
     id TEXT PRIMARY KEY, space_id TEXT NOT NULL, refs TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX office_tab_splits_space ON office_tab_splits(space_id);`,
  `CREATE TABLE office_projects (
     project_id TEXT PRIMARY KEY, lead_thread_id TEXT, page_id TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );`,
  `CREATE TABLE office_project_runs (
     project_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, cadence TEXT NOT NULL,
     time TEXT NOT NULL, automation_id TEXT, automation_project_id TEXT
   );
   CREATE TABLE office_bot_projects (
     bot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, imported_page_id TEXT
   );
   CREATE TABLE office_thread_handoffs (
     old_thread_id TEXT PRIMARY KEY, new_thread_id TEXT NOT NULL, project_id TEXT, archived INTEGER NOT NULL DEFAULT 0
   );`,
  `CREATE TABLE studio_projects (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, position INTEGER NOT NULL,
     archived_at INTEGER, bb_project_id TEXT UNIQUE, role TEXT NOT NULL,
     legacy_bb_project_id TEXT UNIQUE
   );
   CREATE UNIQUE INDEX studio_projects_chief ON studio_projects(role) WHERE role='chief-of-staff';
   CREATE TABLE studio_project_migrations (id TEXT PRIMARY KEY);
   CREATE TABLE office_project_unlinked (ref TEXT PRIMARY KEY);
   CREATE TABLE office_project_links (
     project_id TEXT NOT NULL, ref TEXT NOT NULL PRIMARY KEY, added_at INTEGER NOT NULL
   );
   CREATE INDEX office_project_links_project ON office_project_links(project_id,added_at);
   CREATE TABLE office_project_link_targets (
     ref TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, href TEXT NOT NULL, icon TEXT
   );`,
];
