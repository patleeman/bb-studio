// The schema as of the 2026-10-04 reset. Append new statements; never edit or
// reorder these, since each database records the hash of every one it ran.
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, key TEXT NOT NULL, thread_id TEXT NOT NULL UNIQUE, json TEXT NOT NULL, UNIQUE(bot_id,key))`,
  `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bot_create_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS document_revisions (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, text TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS thread_views (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS view_threads (view_id TEXT NOT NULL, thread_id TEXT NOT NULL, bot_id TEXT, PRIMARY KEY(view_id,thread_id))`,
  `CREATE TABLE IF NOT EXISTS view_entries (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS view_sends (id TEXT PRIMARY KEY, view_id TEXT NOT NULL, json TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS jobs_by_bot ON jobs(bot_id,status,created_at)`,
  `CREATE INDEX IF NOT EXISTS pending_bot_create_requests ON bot_create_requests(status,created_at)`,
  `CREATE INDEX IF NOT EXISTS unfinished_jobs_by_room ON jobs(json_extract(json,'$.roomId'))
        WHERE status IN ('queued','dispatching','running') OR json_extract(json,'$.cancellationPending')=1`,
  `CREATE INDEX IF NOT EXISTS jobs_by_bot_started ON jobs(bot_id,COALESCE(json_extract(json,'$.startedAt'),json_extract(json,'$.dispatchStartedAt')))`,
  `CREATE INDEX IF NOT EXISTS jobs_by_room_started ON jobs(json_extract(json,'$.roomId'),COALESCE(json_extract(json,'$.startedAt'),json_extract(json,'$.dispatchStartedAt')))`,
  `CREATE INDEX IF NOT EXISTS jobs_by_room ON jobs(json_extract(json,'$.roomId'),created_at)`,
  `CREATE INDEX IF NOT EXISTS jobs_by_run ON jobs(json_extract(json,'$.runId'),created_at)`,
  `CREATE INDEX IF NOT EXISTS attachments_by_room ON attachments(json_extract(json,'$.roomId'))`,
  `CREATE INDEX IF NOT EXISTS revisions_by_scope ON document_revisions(scope,id)`,
  `CREATE INDEX IF NOT EXISTS views_by_thread ON view_threads(thread_id)`,
  `CREATE INDEX IF NOT EXISTS view_entries_by_thread ON view_entries(thread_id,created_at)`,
];
