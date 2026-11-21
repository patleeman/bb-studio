// Strands replaced tasks (phase 5): at start, every agent task still open
// (a lead's or a worker's job, a task the Bot kept) is closed as "Moved to
// strands", after a VACUUM INTO backup of Studio's database. Nothing is
// deleted: each keeps its record and its history in task_events, with a
// moved_to_strands event. Left alone: the user's own rows, and every row an
// automation keeps (its schedule, runs and findings), which areas and the
// Scheduled list still read. It runs on every start and does nothing once no
// agent task is open, so it needs no marker.
import type Database from "better-sqlite3";
import { isClosed, USER_OWNER, type Task } from "./contract";
import { backupDatabase, KEEP_BACKUPS, pruneBackups } from "./migrate";
import { TaskStore } from "./store";

export const MOVED_LINE = "Moved to strands";
export const MOVED_EVENT = "moved_to_strands";
export const MOVED_BY = "strands";

export type RetireReport = { closed: string[]; backup: string | null; backupError: string | null; pruned: string[] };

/** The `before-strands-*` copies kept: the newest few, each a full copy of the database. */
export const KEEP_STRAND_BACKUPS = KEEP_BACKUPS;

/** An open task an agent owns, that no automation keeps. */
export function isOpenAgentTask(task: Task): boolean {
  return !isClosed(task) && task.owner !== USER_OWNER && task.automation === null && task.schedule === null && !task.id.startsWith("task_auto-");
}

/**
 * Closes every open agent task as moved to strands. Backs up first; a
 * backup that fails stops it (nothing is closed) unless `force`, so a full
 * disk never costs history.
 */
export function retireAgentTasks(db: Database.Database, options: { now?: () => number; force?: boolean; backup?: (db: Database.Database, at: number) => string | null } = {}): RetireReport {
  const store = new TaskStore(db, () => {}, options.now);
  const open = store.rows("SELECT record FROM tasks WHERE closed_at IS NULL AND owner <> ?", USER_OWNER).filter(isOpenAgentTask);
  if (!open.length) return { closed: [], backup: null, backupError: null, pruned: [] };
  let backup: string | null = null;
  let backupError: string | null = null;
  try {
    backup = (options.backup ?? ((target, at) => backupDatabase(target, at, "strands")))(db, store.now());
  } catch (error) {
    backupError = error instanceof Error ? error.message : String(error);
    if (!options.force) return { closed: [], backup: null, backupError, pruned: [] };
  }
  const closed = db.transaction(() => open.map((task) => {
    store.change(task.id, (t) => { t.state = "dropped"; t.progress.line = MOVED_LINE; t.needs = null; }, MOVED_BY);
    store.event(task.id, MOVED_EVENT, { by: MOVED_BY, owner: task.owner, state: task.state });
    return task.id;
  }))();
  let pruned: string[] = [];
  if (backup && db.name && db.name !== ":memory:") {
    try { pruned = pruneBackups(db.name, KEEP_STRAND_BACKUPS, { label: "strands", newest: true }); } catch { /* Pruning is housekeeping: a failure leaves the copies. */ }
  }
  return { closed, backup, backupError, pruned };
}
