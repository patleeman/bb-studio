import type Database from "better-sqlite3";

const KEY = (threadId: string) => `flight-cleared:${threadId}`;
const hasState = (db: Database.Database) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bot_threads_state'").get();

export function flightClearedAt(db: Database.Database, threadId: string): number {
  if (!hasState(db)) return 0;
  const row = db.prepare("SELECT value FROM bot_threads_state WHERE key = ?").get(KEY(threadId)) as { value: string } | undefined;
  const at = row ? Number(row.value) : 0;
  return Number.isFinite(at) ? at : 0;
}

export function clearFlight(db: Database.Database, threadId: string, at: number): void {
  if (!hasState(db)) return;
  db.prepare("INSERT INTO bot_threads_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(KEY(threadId), String(at));
}
