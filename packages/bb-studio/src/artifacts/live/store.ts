// Live HTML artifacts: each artifact's shared state, its event log, and the
// takes its page sent to an agent. State belongs to the artifact, not a
// version, so saving a new version keeps what the user entered.
import { newId } from "../../kit/ids";
import type Database from "better-sqlite3";

/**
 * Studio's MIGRATIONS (src/migrations.ts) runs this; BB checks each
 * statement against the hash it recorded, so never edit it.
 */
export const ARTIFACT_LIVE_TABLES = `CREATE TABLE artifact_live_state (
       artifact_id TEXT PRIMARY KEY REFERENCES artifacts (id) ON DELETE CASCADE,
       state TEXT NOT NULL, version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
     );
   CREATE TABLE artifact_live_events (
       seq INTEGER PRIMARY KEY AUTOINCREMENT,
       artifact_id TEXT NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
       type TEXT NOT NULL, name TEXT, data TEXT, by TEXT NOT NULL, at INTEGER NOT NULL
     );
   CREATE INDEX artifact_live_events_artifact ON artifact_live_events (artifact_id, seq);
   CREATE TABLE artifact_takes (
       id TEXT PRIMARY KEY,
       artifact_id TEXT NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
       label TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
     );`;

/** A state, an event's data or a take, as JSON, is at most this long. */
export const MAX_LIVE_JSON = 256 * 1024;
/** Each artifact keeps its newest this-many events. */
const KEEP_EVENTS = 500;
/** And its newest this-many takes. */
const KEEP_TAKES = 50;

export type LiveBy = "user" | "agent";
export type LiveEventType = "state" | "event" | "command" | "result";
export type LiveEvent = { seq: number; type: LiveEventType; name: string | null; data: unknown; by: LiveBy; at: number };
export type LiveState = { state: unknown; version: number; updatedBy: LiveBy | null; updatedAt: number | null };
export type Take = { id: string; artifactId: string; label: string; data: unknown; createdAt: number };

/** JSON text for `value`, refusing anything that isn't JSON or is too large. */
export function liveJson(value: unknown, what: string): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined) throw new Error(`The ${what} must be a JSON value.`);
  if (text.length > MAX_LIVE_JSON) throw new Error(`The ${what} is ${Math.ceil(text.length / 1024)} KB; the limit is ${MAX_LIVE_JSON / 1024} KB.`);
  return text;
}

const parse = (text: string | null): unknown => (text === null ? null : JSON.parse(text));

export class LiveStore {
  constructor(private readonly db: Database.Database) {}

  state(artifactId: string): LiveState {
    const row = this.db.prepare("SELECT state, version, updated_by, updated_at FROM artifact_live_state WHERE artifact_id = ?").get(artifactId) as
      | { state: string; version: number; updated_by: LiveBy; updated_at: number }
      | undefined;
    return row ? { state: parse(row.state), version: row.version, updatedBy: row.updated_by, updatedAt: row.updated_at } : { state: null, version: 0, updatedBy: null, updatedAt: null };
  }

  /** Replaces the state and logs it; returns the new version. */
  setState(artifactId: string, state: unknown, by: LiveBy, at = Date.now()): LiveState {
    const text = liveJson(state, "state");
    return this.db.transaction(() => {
      const version = this.state(artifactId).version + 1;
      this.db
        .prepare(
          `INSERT INTO artifact_live_state (artifact_id, state, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (artifact_id) DO UPDATE SET state = excluded.state, version = excluded.version, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        )
        .run(artifactId, text, version, by, at);
      this.insertEvent(artifactId, "state", null, text, by, at);
      return { state: JSON.parse(text) as unknown, version, updatedBy: by, updatedAt: at };
    })();
  }

  log(artifactId: string, type: Exclude<LiveEventType, "state">, name: string | null, data: unknown, by: LiveBy, at = Date.now()): number {
    return this.insertEvent(artifactId, type, name, data === undefined ? null : liveJson(data, "event data"), by, at);
  }

  private insertEvent(artifactId: string, type: LiveEventType, name: string | null, data: string | null, by: LiveBy, at: number): number {
    const seq = Number(
      this.db.prepare("INSERT INTO artifact_live_events (artifact_id, type, name, data, by, at) VALUES (?, ?, ?, ?, ?, ?)").run(artifactId, type, name, data, by, at).lastInsertRowid,
    );
    this.db
      .prepare("DELETE FROM artifact_live_events WHERE artifact_id = ? AND seq <= (SELECT seq FROM artifact_live_events WHERE artifact_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)")
      .run(artifactId, artifactId, KEEP_EVENTS);
    return seq;
  }

  /** Events after `since`, oldest first. */
  events(artifactId: string, since: number, limit = 100): LiveEvent[] {
    const rows = this.db
      .prepare("SELECT seq, type, name, data, by, at FROM artifact_live_events WHERE artifact_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(artifactId, since, limit) as { seq: number; type: LiveEventType; name: string | null; data: string | null; by: LiveBy; at: number }[];
    return rows.map((row) => ({ ...row, data: parse(row.data) }));
  }

  lastSeq(artifactId: string): number {
    const row = this.db.prepare("SELECT MAX(seq) AS seq FROM artifact_live_events WHERE artifact_id = ?").get(artifactId) as { seq: number | null };
    return row.seq ?? 0;
  }

  addTake(artifactId: string, label: string, data: unknown, at = Date.now()): Take {
    const text = liveJson(data, "take");
    const id = newId("take");
    this.db.prepare("INSERT INTO artifact_takes (id, artifact_id, label, data, created_at) VALUES (?, ?, ?, ?, ?)").run(id, artifactId, label, text, at);
    this.db
      .prepare("DELETE FROM artifact_takes WHERE artifact_id = ? AND id NOT IN (SELECT id FROM artifact_takes WHERE artifact_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)")
      .run(artifactId, artifactId, KEEP_TAKES);
    return { id, artifactId, label, data: JSON.parse(text) as unknown, createdAt: at };
  }

  take(id: string): Take | null {
    const row = this.db.prepare("SELECT id, artifact_id, label, data, created_at FROM artifact_takes WHERE id = ?").get(id) as
      | { id: string; artifact_id: string; label: string; data: string; created_at: number }
      | undefined;
    return row ? { id: row.id, artifactId: row.artifact_id, label: row.label, data: JSON.parse(row.data) as unknown, createdAt: row.created_at } : null;
  }
}
