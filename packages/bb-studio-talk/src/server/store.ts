// Recordings and their audio segments in the plugin's own SQLite database.
// Audio bytes live on disk (see audio-files.ts); rows hold the metadata and
// each segment's transcript.
import type Database from "better-sqlite3";
import type {
  Recording,
  RecordingKind,
  RecordingStatus,
  Segment,
  SegmentStatus,
} from "../shared/contract";
import { countWords, defaultTitle, joinTranscript, tail } from "../shared/format";

/** Append-only: statement index is the migration id. */
export const MIGRATIONS = [
  `CREATE TABLE recordings (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     title_source TEXT NOT NULL,
     title_chars INTEGER NOT NULL DEFAULT 0,
     kind TEXT NOT NULL,
     status TEXT NOT NULL,
     project_id TEXT,
     thread_id TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     ended_at INTEGER,
     heartbeat_at INTEGER NOT NULL
   );
   CREATE TABLE segments (
     recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
     id TEXT NOT NULL,
     session_id TEXT NOT NULL,
     idx INTEGER NOT NULL,
     started_at INTEGER NOT NULL,
     duration_ms INTEGER NOT NULL,
     mime_type TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     file TEXT NOT NULL,
     status TEXT NOT NULL,
     text TEXT,
     error TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     next_attempt_at INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (recording_id, id)
   );
   CREATE INDEX segments_order ON segments(recording_id, started_at, idx);
   CREATE INDEX segments_pending ON segments(status, next_attempt_at);
   CREATE INDEX recordings_updated ON recordings(updated_at);`,
  // BB Studio: archiving, as for every Studio item.
  `ALTER TABLE recordings ADD COLUMN archived_at INTEGER;`,
];

interface RecordingRow {
  id: string;
  title: string;
  title_source: Recording["titleSource"];
  title_chars: number;
  kind: RecordingKind;
  status: RecordingStatus;
  project_id: string | null;
  thread_id: string | null;
  created_at: number;
  updated_at: number;
  ended_at: number | null;
  heartbeat_at: number;
  archived_at: number | null;
}

interface SegmentRow {
  recording_id: string;
  id: string;
  session_id: string;
  idx: number;
  started_at: number;
  duration_ms: number;
  mime_type: string;
  bytes: number;
  file: string;
  status: SegmentStatus;
  text: string | null;
  error: string | null;
  attempts: number;
  next_attempt_at: number;
}

export interface PendingSegment {
  recordingId: string;
  id: string;
  file: string;
  mimeType: string;
  attempts: number;
  /** The tail of the previous transcribed segment, as a continuity hint. */
  hint: string;
}

export interface NewSegment {
  recordingId: string;
  sessionId: string;
  index: number;
  startedAt: number;
  durationMs: number;
  mimeType: string;
  bytes: number;
  file: string;
}

const ORDER = "ORDER BY started_at, session_id, idx";

export class TalkStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: {
    id: string;
    kind: RecordingKind;
    projectId: string | null;
    threadId: string | null;
  }): Recording {
    const at = this.now();
    this.db
      .prepare(
        `INSERT INTO recordings
           (id, title, title_source, kind, status, project_id, thread_id,
            created_at, updated_at, heartbeat_at)
         VALUES (?, ?, 'pending', ?, 'recording', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        defaultTitle(at, input.kind),
        input.kind,
        input.projectId,
        input.threadId,
        at,
        at,
        at,
      );
    return this.recording(input.id)!;
  }

  recording(id: string): Recording | null {
    const row = this.row(id);
    return row ? this.toRecording(row) : null;
  }

  /** Newest first. Archived recordings are left out unless asked for. */
  list(options: { query?: string; limit?: number; includeArchived?: boolean } = {}): Recording[] {
    const limit = options.limit ?? 50;
    const query = options.query?.trim();
    const live = options.includeArchived ? "" : "AND r.archived_at IS NULL";
    const rows = query
      ? (this.db
          .prepare(
            `SELECT r.* FROM recordings r
             WHERE (r.title LIKE @like ESCAPE '\\'
                OR EXISTS (SELECT 1 FROM segments s
                           WHERE s.recording_id = r.id AND s.text LIKE @like ESCAPE '\\')) ${live}
             ORDER BY r.updated_at DESC LIMIT @limit`,
          )
          .all({ like: `%${query.replace(/[\\%_]/g, "\\$&")}%`, limit }) as RecordingRow[])
      : (this.db
          .prepare(`SELECT * FROM recordings r WHERE 1 ${live} ORDER BY updated_at DESC LIMIT ?`)
          .all(limit) as RecordingRow[]);
    return rows.map((row) => this.toRecording(row));
  }

  segments(recordingId: string): Segment[] {
    const rows = this.db
      .prepare(`SELECT * FROM segments WHERE recording_id = ? ${ORDER}`)
      .all(recordingId) as SegmentRow[];
    let offset = 0;
    return rows.map((row) => {
      const segment: Segment = {
        id: row.id,
        sessionId: row.session_id,
        startedAt: row.started_at,
        offsetMs: offset,
        durationMs: row.duration_ms,
        mimeType: row.mime_type,
        bytes: row.bytes,
        status: row.status,
        text: row.text,
        error: row.error,
        attempts: row.attempts,
      };
      offset += row.duration_ms;
      return segment;
    });
  }

  segmentFile(recordingId: string, segmentId: string): { file: string; mimeType: string } | null {
    const row = this.db
      .prepare(`SELECT file, mime_type FROM segments WHERE recording_id = ? AND id = ?`)
      .get(recordingId, segmentId) as { file: string; mime_type: string } | undefined;
    return row ? { file: row.file, mimeType: row.mime_type } : null;
  }

  transcript(recordingId: string): string {
    return joinTranscript(
      this.db
        .prepare(
          `SELECT session_id AS sessionId, text FROM segments
           WHERE recording_id = ? AND status = 'done' ${ORDER}`,
        )
        .all(recordingId) as { sessionId: string; text: string | null }[],
    );
  }

  /** Idempotent: re-sending a stored segment (a retried upload) is a no-op. */
  addSegment(segment: NewSegment): boolean {
    const id = `${segment.sessionId}-${segment.index}`;
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO segments
           (recording_id, id, session_id, idx, started_at, duration_ms,
            mime_type, bytes, file, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        segment.recordingId,
        id,
        segment.sessionId,
        segment.index,
        segment.startedAt,
        segment.durationMs,
        segment.mimeType,
        segment.bytes,
        segment.file,
        this.now(),
      );
    if (result.changes === 0) return false;
    this.touch(segment.recordingId, { heartbeat: true });
    return true;
  }

  /**
   * The oldest due segment per recording, in recorded order, so each
   * transcription can use the previous segment's text as its hint.
   */
  due(limit: number): PendingSegment[] {
    const at = this.now();
    const rows = this.db
      .prepare(
        `SELECT s.* FROM segments s
         WHERE s.status = 'pending' AND s.next_attempt_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM segments e
             WHERE e.recording_id = s.recording_id AND e.status = 'pending'
               AND (e.started_at, e.session_id, e.idx) < (s.started_at, s.session_id, s.idx))
         ORDER BY s.started_at LIMIT ?`,
      )
      .all(at, limit) as SegmentRow[];
    return rows.map((row) => ({
      recordingId: row.recording_id,
      id: row.id,
      file: row.file,
      mimeType: row.mime_type,
      attempts: row.attempts,
      hint: this.previousText(row),
    }));
  }

  /** When the next pending segment becomes due, or null when none waits. */
  nextDueAt(): number | null {
    const row = this.db
      .prepare(`SELECT MIN(next_attempt_at) AS at FROM segments WHERE status = 'pending'`)
      .get() as { at: number | null };
    return row.at;
  }

  markTranscribed(recordingId: string, segmentId: string, text: string): void {
    const trimmed = text.trim();
    this.db
      .prepare(
        `UPDATE segments SET status = ?, text = ?, error = NULL,
           attempts = attempts + 1 WHERE recording_id = ? AND id = ?`,
      )
      .run(trimmed === "" ? "empty" : "done", trimmed === "" ? null : trimmed, recordingId, segmentId);
    this.touch(recordingId);
    this.settle(recordingId);
  }

  /**
   * Records a failed attempt. `retryInMs` null gives up on the segment; it
   * stays failed until the user retries the recording.
   */
  markFailed(recordingId: string, segmentId: string, error: string, retryInMs: number | null): void {
    this.db
      .prepare(
        `UPDATE segments SET status = ?, error = ?, attempts = attempts + 1,
           next_attempt_at = ? WHERE recording_id = ? AND id = ?`,
      )
      .run(
        retryInMs === null ? "failed" : "pending",
        error.slice(0, 500),
        this.now() + (retryInMs ?? 0),
        recordingId,
        segmentId,
      );
    this.touch(recordingId);
    this.settle(recordingId);
  }

  retryFailed(recordingId: string): number {
    const result = this.db
      .prepare(
        `UPDATE segments SET status = 'pending', attempts = 0, next_attempt_at = 0
         WHERE recording_id = ? AND status = 'failed'`,
      )
      .run(recordingId);
    if (result.changes > 0 && this.row(recordingId)?.status === "done") {
      this.db.prepare(`UPDATE recordings SET status = 'finishing' WHERE id = ?`).run(recordingId);
    }
    this.touch(recordingId);
    return result.changes;
  }

  setStatus(id: string, status: "recording" | "paused" | "finishing"): Recording | null {
    const row = this.row(id);
    if (!row) return null;
    const at = this.now();
    this.db
      .prepare(
        `UPDATE recordings SET status = ?, ended_at = ?, heartbeat_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, status === "finishing" ? at : null, at, at, id);
    if (status === "finishing") this.settle(id);
    return this.recording(id);
  }

  heartbeat(id: string): RecordingStatus | null {
    const row = this.row(id);
    if (!row) return null;
    let status = row.status;
    // A client that heartbeats again after being declared gone is still
    // capturing (a laptop woke from sleep): take the recording back.
    if (status === "interrupted") status = "recording";
    this.db
      .prepare(`UPDATE recordings SET heartbeat_at = ?, status = ? WHERE id = ?`)
      .run(this.now(), status, id);
    return status;
  }

  /** Marks recordings whose capturing client went silent. Returns their ids. */
  interruptStale(staleAfterMs: number): string[] {
    const cutoff = this.now() - staleAfterMs;
    const rows = this.db
      .prepare(`SELECT id FROM recordings WHERE status = 'recording' AND heartbeat_at < ?`)
      .all(cutoff) as { id: string }[];
    const update = this.db.prepare(
      `UPDATE recordings SET status = 'interrupted', updated_at = ? WHERE id = ?`,
    );
    for (const { id } of rows) update.run(this.now(), id);
    return rows.map((row) => row.id);
  }

  rename(id: string, title: string, source: "auto" | "user", titledChars = 0): Recording | null {
    const result = this.db
      .prepare(
        `UPDATE recordings SET title = ?, title_source = ?, title_chars = ?, updated_at = ?
         WHERE id = ? AND (? = 'user' OR title_source != 'user')`,
      )
      .run(title, source, titledChars, this.now(), id, source);
    return result.changes > 0 ? this.recording(id) : null;
  }

  /**
   * Whether the recording's title should be (re)generated: never over a
   * user's title, first once there is enough text, then again when the
   * transcript has grown well past what the last title saw.
   */
  titleDue(id: string, minChars: number): { chars: number } | null {
    const row = this.row(id);
    if (!row || row.title_source === "user") return null;
    const chars = this.transcript(id).length;
    if (chars < minChars) return null;
    if (row.title_source === "pending") return { chars };
    const finished = row.status === "done" && row.title_chars < chars;
    return chars >= row.title_chars * 3 || (finished && chars > row.title_chars * 1.2)
      ? { chars }
      : null;
  }

  /**
   * Finished recordings with no transcribed words and no segments left to
   * transcribe or retry (see `isEmptyRecording`); all of them, or just `id`.
   */
  emptyRecordings(id?: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM recordings r
         WHERE status = 'done' AND (? IS NULL OR id = ?)
           AND NOT EXISTS (SELECT 1 FROM segments s
                           WHERE s.recording_id = r.id AND s.status IN ('done', 'pending', 'failed'))`,
      )
      .all(id ?? null, id ?? null) as { id: string }[];
    return rows.map((row) => row.id);
  }

  setProject(id: string, projectId: string | null): boolean {
    return this.db.prepare(`UPDATE recordings SET project_id = ?, updated_at = ? WHERE id = ?`).run(projectId, this.now(), id).changes > 0;
  }

  setArchived(id: string, archived: boolean): boolean {
    return (
      this.db.prepare(`UPDATE recordings SET archived_at = ? WHERE id = ?`).run(archived ? this.now() : null, id).changes > 0
    );
  }

  delete(id: string): boolean {
    this.db.prepare(`DELETE FROM segments WHERE recording_id = ?`).run(id);
    return this.db.prepare(`DELETE FROM recordings WHERE id = ?`).run(id).changes > 0;
  }

  /** A finishing recording is done once nothing is left to transcribe. */
  private settle(id: string): void {
    this.db
      .prepare(
        `UPDATE recordings SET status = 'done', updated_at = ?
         WHERE id = ? AND status = 'finishing'
           AND NOT EXISTS (SELECT 1 FROM segments WHERE recording_id = ? AND status = 'pending')`,
      )
      .run(this.now(), id, id);
  }

  private touch(id: string, options: { heartbeat?: boolean } = {}): void {
    const at = this.now();
    this.db
      .prepare(
        options.heartbeat
          ? `UPDATE recordings SET updated_at = ?, heartbeat_at = ? WHERE id = ?`
          : `UPDATE recordings SET updated_at = ? WHERE id = ?`,
      )
      .run(...(options.heartbeat ? [at, at, id] : [at, id]));
  }

  private previousText(row: SegmentRow): string {
    const previous = this.db
      .prepare(
        `SELECT text FROM segments
         WHERE recording_id = ? AND status = 'done'
           AND (started_at, session_id, idx) < (?, ?, ?)
         ORDER BY started_at DESC, session_id DESC, idx DESC LIMIT 1`,
      )
      .get(row.recording_id, row.started_at, row.session_id, row.idx) as
      | { text: string | null }
      | undefined;
    return previous?.text ? tail(previous.text, 400).replace(/^…/, "") : "";
  }

  private row(id: string): RecordingRow | undefined {
    return this.db.prepare(`SELECT * FROM recordings WHERE id = ?`).get(id) as
      | RecordingRow
      | undefined;
  }

  private toRecording(row: RecordingRow): Recording {
    const stats = this.db
      .prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(duration_ms), 0) AS duration,
                COALESCE(SUM(status = 'pending'), 0) AS pending,
                COALESCE(SUM(status = 'failed'), 0) AS failed
         FROM segments WHERE recording_id = ?`,
      )
      .get(row.id) as { count: number; duration: number; pending: number; failed: number };
    const transcript = this.transcript(row.id);
    return {
      id: row.id,
      title: row.title,
      titleSource: row.title_source,
      kind: row.kind,
      status: row.status,
      projectId: row.project_id,
      threadId: row.thread_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      endedAt: row.ended_at,
      durationMs: stats.duration,
      segmentCount: stats.count,
      pendingCount: stats.pending,
      failedCount: stats.failed,
      wordCount: countWords(transcript),
      preview: tail(transcript, 240),
      archived: row.archived_at !== null,
    };
  }
}
