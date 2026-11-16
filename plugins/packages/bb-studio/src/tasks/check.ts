import type Database from "better-sqlite3";
import { isClosed, type Task } from "./contract";
import { linksThread, RUNNING, SPAWN_GRACE_MS, type ThreadFact } from "./links";
import { boardRows, buildRows, flightRows, type RowContext } from "./rows";

export const PROBLEM_KINDS = ["worker-without-task", "shown-twice", "card-without-task", "open-under-closed"] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];
export type TaskProblem = { kind: ProblemKind; text: string; taskIds: string[]; threadId: string | null };

const hasTable = (db: Database.Database, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const name = (t: Task) => JSON.stringify(t.title.length > 60 ? `${t.title.slice(0, 59)}…` : t.title);
const threadName = (f: ThreadFact) => JSON.stringify((f.title || f.titleFallback || f.id).slice(0, 60));

export function legacyCardsWithoutTask(db: Database.Database): string[] {
  if (!hasTable(db, "work_cards")) return [];
  return (db.prepare("SELECT id FROM work_cards WHERE id NOT IN (SELECT id FROM tasks) ORDER BY rowid").all() as { id: string }[]).map((r) => r.id);
}

export function checkTasks(all: readonly Task[], facts: readonly ThreadFact[], ctx: RowContext, legacyCards: readonly string[] = [], now = Date.now()): TaskProblem[] {
  const problems: TaskProblem[] = [];
  const byId = new Map(all.map((t) => [t.id, t]));

  for (const fact of facts) {
    if (fact.archivedAt || fact.deletedAt || !RUNNING.has(fact.status ?? "") || now - fact.createdAt < SPAWN_GRACE_MS || !ctx.dir.isWorker(fact.id, fact)) continue;
    if (all.some((t) => linksThread(t, fact.id))) continue;
    problems.push({ kind: "worker-without-task", text: `The worker ${threadName(fact)} is running with no task.`, taskIds: [], threadId: fact.id });
  }

  const views = [boardRows(all, ctx), ...[...new Set(buildRows(all, ctx).roots.map((r) => r.home))].filter((h): h is string => !!h).map((h) => flightRows(all, h, ctx))];
  const twice = new Set<string>();
  for (const view of views) {
    const seen = new Set<string>();
    for (const row of view.rows) { if (seen.has(row.id)) twice.add(row.id); seen.add(row.id); }
  }
  for (const id of twice) problems.push({ kind: "shown-twice", text: `The task ${name(byId.get(id)!)} is shown twice in one list.`, taskIds: [id], threadId: null });

  const board = boardRows(all, ctx);
  const rootOfRow = new Map<string, string>();
  for (const row of board.rows) rootOfRow.set(row.id, row.under === null ? row.id : rootOfRow.get(row.under) ?? row.id);
  const holders = new Map<string, string[]>();
  for (const row of board.rows) if (row.open) for (const w of row.workers) holders.set(w, [...(holders.get(w) ?? []), row.id]);
  for (const [threadId, rows] of holders) {
    if (rows.length < 2) continue;
    const roots = new Set(rows.map((id) => rootOfRow.get(id)!));
    const ids = roots.size > 1 ? [...roots] : rows;
    const where = roots.size > 1 ? "separate rows" : "rows of one task";
    problems.push({ kind: "shown-twice", text: `The worker ${threadId} is on ${ids.length} ${where}: ${ids.map((id) => name(byId.get(id)!)).join(" and ")}. A worker belongs to one task: make one a subtask of the other.`, taskIds: ids, threadId });
  }

  for (const id of legacyCards) problems.push({ kind: "card-without-task", text: `The work card ${id} has no task.`, taskIds: [id], threadId: null });
  for (const t of all) {
    if (t.card && !t.conversation) problems.push({ kind: "card-without-task", text: `The task ${name(t)} has a card but no conversation to draw it in.`, taskIds: [t.id], threadId: null });
  }

  for (const t of all) {
    if (isClosed(t) || !t.parentId) continue;
    const parent = byId.get(t.parentId);
    if (!parent) problems.push({ kind: "open-under-closed", text: `The open task ${name(t)} has a parent that no longer exists.`, taskIds: [t.id], threadId: null });
    else if (isClosed(parent)) problems.push({ kind: "open-under-closed", text: `The open task ${name(t)} is under ${name(parent)}, which is ${parent.state}.`, taskIds: [t.id, parent.id], threadId: null });
  }
  return problems;
}
