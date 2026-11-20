// The threads Studio's data needs, read from a copy of bb's Studio database
// and key-value rows: what "Bring over BB Studio data" brings over as an
// ordinary bring-over job, before the swap.
//
// Only threads that Studio's data is built around come over:
//   - required: each Bot's own thread (the primary Bot's is the personal
//     project's lead) and its Main (bot_threads.is_main); the bring-over
//     refuses unless each one it asks for comes over. The row asks only for
//     the ones bb still has (bring-over/api.ts requiredInBb): a Main deleted
//     in bb is left out, and its Bot gets a new Main here (Bots.restoreMain);
//   - wanted: the Bots' conversations and workers (bot_threads, with the
//     conversation a worker belongs to), runners, side threads, the Chief of
//     Staff, project and space leads and the threads their heartbeats wake,
//     item chats (chats and the kv chat links), and the threads tasks, todos
//     and work cards name (their conversation column and any thread id in
//     their records).
// Tables that only remember threads they saw (live_activity, thread_titles,
// space_threads, item_threads, trigger_runs, ...) are not a reason to bring a
// thread over: their rows stay, pointing at a thread that isn't here.
import type Database from "better-sqlite3";
import { PERSONAL_PROJECT_ID } from "../project-lead";

export interface StudioThreads {
  required: string[];
  wanted: string[];
}

const THREAD_ID = /\bthr_[A-Za-z0-9]+\b/g;

/** Column sources: [table, column, extra WHERE]. */
const REQUIRED: [string, string, string][] = [
  ["bots", "thread_id", ""],
  ["project_leads", "lead_thread_id", `project_id = '${PERSONAL_PROJECT_ID}'`],
  ["bot_threads", "thread_id", "is_main = 1"],
];
const WANTED: [string, string, string][] = [
  ["bot_threads", "thread_id", ""],
  ["bot_threads", "owner_conversation_id", ""],
  ["bot_runners", "thread_id", ""],
  ["bot_side_threads", "thread_id", ""],
  ["chief_of_staff", "thread_id", ""],
  ["project_leads", "lead_thread_id", ""],
  ["project_runs", "lead_thread_id", ""],
  ["space_leads", "lead_thread_id", ""],
  ["chats", "thread_id", ""],
  ["tasks", "conversation", ""],
];
/** JSON records that name threads anywhere inside them. */
const RECORDS: [string, string][] = [
  ["tasks", "record"],
  ["bot_loops", "record"],
  ["work_cards", "record"],
];

const missing = (error: unknown) => /no such (table|column)/.test(String((error as Error)?.message ?? error));

function column(db: Database.Database, table: string, name: string, where: string): string[] {
  try {
    return (db.prepare(`SELECT DISTINCT "${name}" AS value FROM "${table}" WHERE "${name}" IS NOT NULL${where ? ` AND ${where}` : ""}`).all() as { value: unknown }[])
      .map((row) => row.value)
      .filter((value): value is string => typeof value === "string" && value.startsWith("thr_"));
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

function idsIn(text: string): string[] {
  return text.match(THREAD_ID) ?? [];
}

/** kv rows as stored: the key and its JSON text. Item chat links are `link:<item>` → { threadId }. */
export function studioThreads(db: Database.Database, kv: readonly { key: string; value: string }[] = []): StudioThreads {
  const required = new Set<string>();
  for (const [table, name, where] of REQUIRED) for (const id of column(db, table, name, where)) required.add(id);
  const wanted = new Set<string>(required);
  for (const [table, name, where] of WANTED) for (const id of column(db, table, name, where)) wanted.add(id);
  for (const [table, name] of RECORDS) {
    try {
      for (const row of db.prepare(`SELECT "${name}" AS value FROM "${table}"`).iterate() as Iterable<{ value: unknown }>) {
        if (typeof row.value === "string") for (const id of idsIn(row.value)) wanted.add(id);
      }
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  for (const row of kv) {
    if (!row.key.startsWith("link:")) continue;
    try {
      const value = JSON.parse(row.value) as { threadId?: unknown };
      if (typeof value?.threadId === "string" && value.threadId.startsWith("thr_")) wanted.add(value.threadId);
    } catch {
      // A link that isn't JSON names no thread.
    }
  }
  return { required: [...required].sort(), wanted: [...wanted].sort() };
}
