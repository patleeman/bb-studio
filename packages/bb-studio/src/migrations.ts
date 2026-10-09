// Studio's own tables: tags (src/tags.ts), saved views (src/views.ts),
// sidebar tabs (src/tabs.ts), item services (src/services.ts), search
// (src/search-index.ts) and spaces (src/spaces.ts, src/space-threads.ts,
// src/space-lead.ts, src/space-folders.ts).

/**
 * Append-only: statement index is the migration id, and BB checks each
 * statement against the hash it recorded, so never edit one (not even its
 * whitespace). Add a new statement for every schema change.
 */
export const MIGRATIONS = [
  `CREATE TABLE tags (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       color TEXT NOT NULL,
       created_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX tags_name ON tags (name COLLATE NOCASE);
   CREATE TABLE item_tags (
       plugin_id TEXT NOT NULL,
       item_id TEXT NOT NULL,
       tag_id TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (plugin_id, item_id, tag_id)
     );
   CREATE INDEX item_tags_tag ON item_tags (tag_id);
   CREATE TABLE tabs (
       plugin_id TEXT NOT NULL,
       item_id TEXT NOT NULL,
       position INTEGER NOT NULL,
       opened_at INTEGER NOT NULL,
       PRIMARY KEY (plugin_id, item_id)
     );
   CREATE TABLE views (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       query TEXT NOT NULL,
       position INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX views_name ON views (name COLLATE NOCASE);
   CREATE VIRTUAL TABLE studio_search_fts USING fts5(
       plugin_id UNINDEXED, item_id UNINDEXED, kind UNINDEXED,
       project_id UNINDEXED, href UNINDEXED, updated_at UNINDEXED,
       title, body, tokenize='unicode61 remove_diacritics 2'
     );
   CREATE TABLE item_links (
       from_plugin TEXT NOT NULL, from_id TEXT NOT NULL,
       to_plugin TEXT NOT NULL, to_id TEXT NOT NULL,
       kind TEXT NOT NULL, source TEXT NOT NULL,
       PRIMARY KEY (from_plugin, from_id, to_plugin, to_id, kind, source)
     );
   CREATE INDEX item_links_to ON item_links (to_plugin, to_id);
   CREATE TABLE item_threads (
       thread_id TEXT NOT NULL, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       role TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL, metadata TEXT NOT NULL,
       PRIMARY KEY (thread_id, plugin_id, item_id)
     );
   CREATE INDEX item_threads_item ON item_threads (plugin_id, item_id, created_at);
   CREATE INDEX item_threads_thread ON item_threads (thread_id);
   CREATE TABLE item_activity (
       id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       actor TEXT NOT NULL, verb TEXT NOT NULL, at INTEGER NOT NULL, summary TEXT NOT NULL
     );
   CREATE INDEX item_activity_item ON item_activity (plugin_id, item_id, id);
   CREATE TABLE item_comments (
       id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       parent_id TEXT, anchor TEXT, actor TEXT NOT NULL, body TEXT NOT NULL,
       created_at INTEGER NOT NULL, resolved_at INTEGER
     );
   CREATE INDEX item_comments_item ON item_comments (plugin_id, item_id, created_at);
   CREATE TABLE item_blobs (sha256 TEXT PRIMARY KEY, bytes BLOB NOT NULL);
   CREATE TABLE item_versions (
       id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       sha256 TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL
     );
   CREATE INDEX item_versions_item ON item_versions (plugin_id, item_id, created_at);
   CREATE TABLE spaces (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL COLLATE NOCASE UNIQUE,
       color TEXT NOT NULL,
       icon TEXT,
       description TEXT NOT NULL DEFAULT '',
       default_project_id TEXT,
       page_id TEXT,
       page_template INTEGER,
       is_default INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX spaces_one_default ON spaces (is_default) WHERE is_default = 1;
   CREATE TABLE space_projects (
       project_id TEXT PRIMARY KEY,
       space_id TEXT NOT NULL REFERENCES spaces (id),
       created_at INTEGER NOT NULL
     );
   CREATE INDEX space_projects_space ON space_projects (space_id);
   CREATE TABLE space_folders (
       space_id TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, path TEXT NOT NULL UNIQUE,
       project_id TEXT, PRIMARY KEY (space_id, name)
     );
   CREATE TABLE space_threads (
       thread_id TEXT PRIMARY KEY, space_id TEXT NOT NULL, added_at INTEGER NOT NULL
     );
   CREATE INDEX space_threads_space ON space_threads (space_id, added_at);
   CREATE TABLE space_leads (
       space_id TEXT PRIMARY KEY, lead_thread_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
     );
   CREATE TABLE space_runs (
       space_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, cadence TEXT NOT NULL, time TEXT NOT NULL,
       automation_id TEXT, automation_project_id TEXT
     );
   CREATE TABLE space_thread_handoffs (
       old_thread_id TEXT PRIMARY KEY, new_thread_id TEXT NOT NULL, space_id TEXT,
       lead INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0
     );`,
  `ALTER TABLE space_runs ADD COLUMN cron TEXT;`,
  `ALTER TABLE tabs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE thread_titles (
       thread_id TEXT PRIMARY KEY, title TEXT, prompts INTEGER NOT NULL, locked INTEGER NOT NULL, updated_at INTEGER NOT NULL
     );`,
  `CREATE TABLE chief_of_staff (
       id INTEGER PRIMARY KEY CHECK (id = 1), thread_id TEXT NOT NULL, origin_space_id TEXT, updated_at INTEGER NOT NULL
     );`,
  // The Chief of Staff becomes the default space's lead (docs/spaces.md): it wins over
  // that space's old lead, which stays an ordinary thread. Its heartbeat settings move to
  // the default space; the old automations are retired and an enabled heartbeat is
  // provisioned again at startup (SpaceRuns.repair).
  `CREATE TABLE space_retired_automations (automation_id TEXT PRIMARY KEY, automation_project_id TEXT);
   INSERT OR IGNORE INTO space_retired_automations (automation_id, automation_project_id)
     SELECT automation_id, automation_project_id FROM space_runs WHERE automation_id IS NOT NULL
       AND (space_id = 'chief-of-staff' OR (space_id IN (SELECT id FROM spaces WHERE is_default = 1) AND EXISTS (SELECT 1 FROM chief_of_staff)));
   DELETE FROM space_runs WHERE space_id IN (SELECT id FROM spaces WHERE is_default = 1) AND EXISTS (SELECT 1 FROM chief_of_staff);
   INSERT INTO space_runs (space_id, enabled, cadence, time, cron, automation_id, automation_project_id)
     SELECT s.id, r.enabled, r.cadence, r.time, r.cron, NULL, NULL FROM space_runs r, spaces s
     WHERE r.space_id = 'chief-of-staff' AND s.is_default = 1 AND EXISTS (SELECT 1 FROM chief_of_staff);
   DELETE FROM space_runs WHERE space_id = 'chief-of-staff';
   DELETE FROM space_leads WHERE lead_thread_id IN (SELECT thread_id FROM chief_of_staff);
   INSERT INTO space_leads (space_id, lead_thread_id, created_at, updated_at)
     SELECT s.id, c.thread_id, c.updated_at, c.updated_at FROM chief_of_staff c, spaces s WHERE s.is_default = 1
     ON CONFLICT (space_id) DO UPDATE SET lead_thread_id = excluded.lead_thread_id, updated_at = excluded.updated_at;
   INSERT INTO space_threads (thread_id, space_id, added_at)
     SELECT c.thread_id, s.id, c.updated_at FROM chief_of_staff c, spaces s WHERE s.is_default = 1
     ON CONFLICT (thread_id) DO UPDATE SET space_id = excluded.space_id;
   DROP TABLE chief_of_staff;`,
];
