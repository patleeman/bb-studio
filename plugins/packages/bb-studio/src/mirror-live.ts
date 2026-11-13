// What bb is doing with the threads BB Studio mirrors (UX review 3, item 1).
//
// The fork's one-way import copies bb's threads into BB Studio. It copies a
// running thread as "idle" (BB Studio isn't running it), and it doesn't copy
// pending approvals or questions, so BB Studio's own record of a mirrored
// thread always looked done. The live state is in bb: its `threads.status`
// and `pending_interactions`. This reads them, read-only, for the mirrored
// threads that are not taken over, the same way the fork's own route does
// (`GET /api/v1/fork/import/threads/:id`, which reads bb's database for one
// thread): BB Studio's data folder has `fork-import.json` (where bb's data
// is) and `fork-import.db` (which threads are mirrored).
//
// Nothing is ever written. On a BB Studio with no import, or if bb's
// database can't be read, the answer is empty and BB Studio's own record is
// used, as before.
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThreadFacts } from "./bot-threads";
import type { Interaction } from "./worker-approvals";

/** bb's live view of one mirrored thread. */
export interface MirrorLive {
  status: string;
  updatedAt: number;
  /** Its pending approvals and questions in bb, with the fields `waitingOn` reads. */
  pending: Interaction[];
}

const BATCH = 400;

function sourceDir(dataDir: string): string | null {
  try {
    const state = JSON.parse(readFileSync(join(dataDir, "fork-import.json"), "utf8")) as { version?: number; sourceDataDir?: unknown };
    return state.version === 1 && typeof state.sourceDataDir === "string" ? state.sourceDataDir : null;
  } catch {
    return null;
  }
}

function open(path: string): Database.Database | null {
  if (!existsSync(path)) return null;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 1000");
    return db;
  } catch {
    return null;
  }
}

function inBatches<T>(ids: readonly string[], read: (batch: readonly string[]) => T[]): T[] {
  const out: T[] = [];
  for (let at = 0; at < ids.length; at += BATCH) out.push(...read(ids.slice(at, at + BATCH)));
  return out;
}

const marks = (count: number) => Array.from({ length: count }, () => "?").join(",");

/**
 * bb's live status and pending interactions for those of `threadIds` that
 * are mirrored and not taken over. Read-only; empty when there is no import
 * or bb's data can't be read.
 */
export function readMirrorLive(dataDir: string, threadIds: readonly string[]): Map<string, MirrorLive> {
  const result = new Map<string, MirrorLive>();
  const ids = [...new Set(threadIds)];
  if (!ids.length) return result;
  const source = sourceDir(dataDir);
  if (!source) return result;
  const fork = open(join(dataDir, "fork-import.db"));
  if (!fork) return result;
  let mirrored: string[];
  try {
    mirrored = inBatches(ids, (batch) => fork.prepare(`SELECT thread_id AS id FROM mirrored_threads WHERE taken_over_at IS NULL AND thread_id IN (${marks(batch.length)})`).all(...batch) as { id: string }[]).map((row) => row.id);
  } catch {
    return result;
  } finally {
    fork.close();
  }
  if (!mirrored.length) return result;
  const bb = open(join(source, "bb.db"));
  if (!bb) return result;
  try {
    const threads = inBatches(mirrored, (batch) => bb.prepare(`SELECT id, status, updated_at AS updatedAt FROM threads WHERE id IN (${marks(batch.length)})`).all(...batch) as { id: string; status: string; updatedAt: number }[]);
    for (const row of threads) result.set(row.id, { status: row.status, updatedAt: Number(row.updatedAt), pending: [] });
    const pending = inBatches(mirrored, (batch) => bb.prepare(`SELECT id, thread_id AS threadId, payload FROM pending_interactions WHERE status = 'pending' AND thread_id IN (${marks(batch.length)})`).all(...batch) as { id: string; threadId: string; payload: string }[]);
    for (const row of pending) {
      let payload: Interaction["payload"] = null;
      try { payload = JSON.parse(row.payload) as Interaction["payload"]; } catch { /* a question with an unreadable payload is still pending */ }
      result.get(row.threadId)?.pending.push({ id: row.id, status: "pending", payload });
    }
  } catch {
    return new Map();
  } finally {
    bb.close();
  }
  return result;
}

/**
 * BB's facts with bb's live state over the mirrored threads: their status,
 * whether they wait on the user, and their latest change when bb's is newer.
 */
export function overlayMirrorLive(threads: ReadonlyMap<string, ThreadFacts>, live: ReadonlyMap<string, MirrorLive>): Map<string, ThreadFacts> {
  const out = new Map(threads);
  for (const [id, state] of live) {
    const thread = out.get(id);
    if (!thread) continue;
    out.set(id, { ...thread, status: state.status, hasPendingInteraction: state.pending.length > 0, mirroredPending: state.pending, updatedAt: Math.max(thread.updatedAt ?? 0, state.updatedAt) });
  }
  return out;
}

export interface MirroredBatch { ids: string[]; newest: number }

export function readMirroredSince(dataDir: string, since: number): MirroredBatch | null {
  const fork = open(join(dataDir, "fork-import.db"));
  if (!fork) return null;
  try {
    const rows = fork.prepare("SELECT thread_id AS id, source_updated_at AS at FROM mirrored_threads WHERE source_updated_at > ? ORDER BY source_updated_at").all(since) as { id: string; at: number }[];
    return { ids: rows.map((row) => row.id), newest: rows.reduce((max, row) => Math.max(max, Number(row.at)), since) };
  } catch {
    return null;
  } finally {
    fork.close();
  }
}
