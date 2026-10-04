/** Append-only schema history. Each statement is safe on databases created before migrations. */
export const MIGRATIONS = [
  // store.ts
  `CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, key TEXT NOT NULL, thread_id TEXT NOT NULL UNIQUE, json TEXT NOT NULL, UNIQUE(bot_id,key));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_by_bot ON jobs(bot_id,status,created_at);
      CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS draft_uploads (id TEXT PRIMARY KEY, bytes BLOB NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS routing_sessions (thread_id TEXT PRIMARY KEY, request_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_create_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pending_bot_create_requests ON bot_create_requests(status,created_at);
      CREATE TABLE IF NOT EXISTS channel_notifications (id TEXT PRIMARY KEY,room_id TEXT NOT NULL,kind TEXT NOT NULL,subject_id TEXT NOT NULL,created_at INTEGER NOT NULL,dispatched_at INTEGER);
      CREATE INDEX IF NOT EXISTS pending_channel_notifications ON channel_notifications(dispatched_at,created_at);
      CREATE TABLE IF NOT EXISTS room_runs (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_by_room ON room_messages(room_id);
      CREATE INDEX IF NOT EXISTS runs_by_room ON room_runs(room_id);
      CREATE INDEX IF NOT EXISTS active_runs_by_room ON room_runs(room_id,json_extract(json,'$.status'));
      CREATE INDEX IF NOT EXISTS unfinished_jobs_by_room ON jobs(json_extract(json,'$.roomId'))
        WHERE status IN ('queued','dispatching','running') OR json_extract(json,'$.cancellationPending')=1;
      CREATE INDEX IF NOT EXISTS unfinished_runs_by_room ON room_runs(room_id)
        WHERE json_extract(json,'$.status') IN ('queued','running');
      CREATE INDEX IF NOT EXISTS jobs_by_bot_started ON jobs(bot_id,COALESCE(json_extract(json,'$.startedAt'),json_extract(json,'$.dispatchStartedAt')));
      CREATE INDEX IF NOT EXISTS jobs_by_room_started ON jobs(json_extract(json,'$.roomId'),COALESCE(json_extract(json,'$.startedAt'),json_extract(json,'$.dispatchStartedAt')));
      CREATE INDEX IF NOT EXISTS jobs_by_room ON jobs(json_extract(json,'$.roomId'),created_at);
      CREATE INDEX IF NOT EXISTS jobs_by_run ON jobs(json_extract(json,'$.runId'),created_at);
      CREATE INDEX IF NOT EXISTS messages_by_source_job ON room_messages(room_id,json_extract(json,'$.sourceJobId'));
      CREATE INDEX IF NOT EXISTS messages_by_source ON room_messages(json_extract(json,'$.sourceThreadId'));
      CREATE INDEX IF NOT EXISTS attachments_by_room ON attachments(json_extract(json,'$.roomId'));`,

  // attention.ts
  `CREATE TABLE IF NOT EXISTS channel_attention (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, status TEXT NOT NULL,
      snoozed_until INTEGER, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS attention_by_status ON channel_attention(status,snoozed_until);
      CREATE INDEX IF NOT EXISTS attention_by_room ON channel_attention(room_id);
      CREATE TABLE IF NOT EXISTS attention_question_replies (
        id TEXT PRIMARY KEY, attention_id TEXT NOT NULL, room_id TEXT NOT NULL, text TEXT NOT NULL,
        revision INTEGER NOT NULL, error TEXT, retry_at INTEGER NOT NULL DEFAULT 0);`,

  // channel-data.ts
  `
      -- Retired channel context. Kept so existing data is not dropped.
      CREATE TABLE IF NOT EXISTS channel_context (room_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS document_revisions (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, text TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS revisions_by_scope ON document_revisions(scope,id);
      CREATE TABLE IF NOT EXISTS routing_usage (id INTEGER PRIMARY KEY, room_id TEXT NOT NULL, created_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS routing_usage_by_room ON routing_usage(room_id,created_at);
    `,

  // channel-thread-link.ts
  `CREATE TABLE IF NOT EXISTS channel_threads (room_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, delivered_rowid INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS channel_thread_origins (message_id TEXT PRIMARY KEY);`,

  // delegations.ts
  `CREATE TABLE IF NOT EXISTS delegations(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,run_id TEXT NOT NULL,status TEXT NOT NULL,json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS delegations_by_room ON delegations(room_id,status);
      CREATE INDEX IF NOT EXISTS delegations_by_run ON delegations(run_id,status);`,

  // thread-profiles.ts: direct messages became ordinary threads with a profile.
  // Each keeps its own key, leaves bot history, and is unhidden once at startup.
  `CREATE TABLE IF NOT EXISTS profile_threads_to_show (thread_id TEXT PRIMARY KEY);
      INSERT OR IGNORE INTO profile_threads_to_show
        SELECT thread_id FROM conversations WHERE json_extract(json,'$.kind')='admin';
      UPDATE conversations SET key='thread:'||thread_id,
        json=json_remove(json_set(json,'$.key','thread:'||thread_id),'$.archivedAt','$.originalKey')
        WHERE json_extract(json,'$.kind')='admin';`,
  // Saved views reference normal threads. Old channel transcripts remain stored,
  // but are never replayed into the new conversations.
  `CREATE TABLE IF NOT EXISTS thread_views (id TEXT PRIMARY KEY, json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS view_threads (view_id TEXT NOT NULL, thread_id TEXT NOT NULL, bot_id TEXT, PRIMARY KEY(view_id,thread_id));
   CREATE INDEX IF NOT EXISTS views_by_thread ON view_threads(thread_id);
   CREATE TABLE IF NOT EXISTS view_entries (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS view_entries_by_thread ON view_entries(thread_id,created_at);
   CREATE TABLE IF NOT EXISTS view_sends (id TEXT PRIMARY KEY, view_id TEXT NOT NULL, json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS view_migrations (room_id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL);`,
];
