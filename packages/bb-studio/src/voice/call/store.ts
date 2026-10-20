// Voice calls' tables (src/voice/call/calls.ts), for Studio's migrations.
// Both are append-only: a call's state is the events it has.

/** Each call as it started, and the log of what happened on it. */
export const VOICE_CALL_TABLES = `CREATE TABLE voice_calls (
       id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, bot_name TEXT NOT NULL, thread_id TEXT, model TEXT NOT NULL,
       voice TEXT NOT NULL, transcribe_model TEXT, started_at INTEGER NOT NULL
     );
   CREATE INDEX voice_calls_started ON voice_calls (started_at);
   CREATE TABLE voice_call_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL,
       role TEXT, text TEXT, data TEXT
     );
   CREATE INDEX voice_call_events_call ON voice_call_events (call_id, id);`;
