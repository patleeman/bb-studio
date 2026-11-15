import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { isClosed, needsYou, unavailableMessage, task as taskSchema, USER_OWNER, type Task, type TaskEvent, type TaskListInput } from "./contract";

type Row = { record: string };

const unavailable = new WeakMap<Database.Database, string>();
export const markTasksUnavailable = (db: Database.Database, reason: string) => { unavailable.set(db, reason); };
export const tasksUnavailable = (db: Database.Database) => unavailable.get(db) ?? null;

export function assertTasksReady(db: Database.Database, detail = true): void {
  const reason = tasksUnavailable(db);
  if (reason) throw new Error(unavailableMessage(detail ? reason : undefined));
}

export const TASKS_FAILED = "Tasks couldn't be read or saved just now. Try again; if it keeps happening, restart BB Studio.";
const isDatabaseError = (error: unknown) => error instanceof Error && (error.name === "SqliteError" || /^SQLITE_/.test(String((error as { code?: unknown }).code ?? "")));

export function guardTasks<T extends Record<string, (...args: never[]) => unknown>>(db: Database.Database, handlers: T, detail = false, log?: (message: string) => void): T {
  const clean = (name: string, error: unknown): never => {
    if (detail || !isDatabaseError(error)) throw error;
    log?.(`Tasks: ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error(TASKS_FAILED);
  };
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (...args: never[]) => {
    assertTasksReady(db, detail);
    let out: unknown;
    try { out = handler(...args); } catch (error) { return clean(name, error); }
    return out instanceof Promise ? out.catch((error: unknown) => clean(name, error)) : out;
  }])) as T;
}

export function taskTitle(db: Database.Database, id: string): string | null {
  try {
    const row = db.prepare("SELECT json_extract(record, '$.title') AS title FROM tasks WHERE id = ?").get(id) as { title: unknown } | undefined;
    return typeof row?.title === "string" ? row.title : null;
  } catch { return null; }
}

export function sinceHandedToUser<E extends TaskEvent>(history: readonly E[]): E[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]!;
    let d: { owner?: string; by?: string | null } = {};
    try { d = JSON.parse(e.data || "{}") as typeof d; } catch { continue; }
    if (d.by === USER_OWNER) continue;
    if (e.type === "handed_off" && d.owner === USER_OWNER) return history.slice(i + 1);
  }
  return [...history];
}

export const notifiedSinceHandoff = (history: readonly TaskEvent[]) => sinceHandedToUser(history).some((e) => e.type === "notified");

export function cardNeedsUser(task: Task | null, kind: "work" | "loop", history: readonly TaskEvent[] = []): boolean {
  if (!task) return true;
  if (notifiedSinceHandoff(history)) return false;
  if (needsYou(task)) return true;
  return kind === "loop" && task.owner === USER_OWNER && !isClosed(task);
}

export function surfaceForUser(t: Task): void {
  if (needsYou(t) && t.attention.queue === null) t.attention.queue = "surfaced";
}

export const toStoredOwner = (owner: string, caller?: string | null) => {
  if (owner === "user") return USER_OWNER;
  if (owner === "me") {
    if (!caller) throw new Error('"me" needs a calling thread; pass "thread:<id>" or "cos".');
    return `thread:${caller}`;
  }
  return owner;
};

export function normalizeTask(input: Task, now: number): Task {
  const t = taskSchema.parse(input);
  if (isClosed(t)) {
    t.attention.queue = null;
    t.timing.snoozed = false;
    if (t.closedAt === null) t.closedAt = now;
  } else {
    t.closedAt = null;
    t.closedBy = null;
    if (t.state === "todo" && t.attention.queue === null) t.attention.queue = "queued";
    if (t.state === "in_progress") { t.attention.queue = null; t.timing.snoozed = false; }
    if (t.timing.snoozed && t.attention.queue === null) t.attention.queue = "queued";
  }
  t.workers = [...new Set(t.workers)];
  return t;
}

export class TaskStore {
  constructor(readonly db: Database.Database, readonly changed: () => void = () => {}, readonly now: () => number = Date.now) {}

  find(id: string): Task | null {
    const row = this.db.prepare("SELECT record FROM tasks WHERE id = ?").get(id) as Row | undefined;
    return row ? taskSchema.parse(JSON.parse(row.record)) : null;
  }

  get(id: string): Task {
    const found = this.find(id);
    if (!found) throw new Error(`Task ${id} not found`);
    return found;
  }

  all(): Task[] {
    return this.rows("SELECT record FROM tasks ORDER BY rowid");
  }

  rows(sql: string, ...params: unknown[]): Task[] {
    return (this.db.prepare(sql).all(...params) as Row[]).map((row) => taskSchema.parse(JSON.parse(row.record)));
  }

  children(id: string): Task[] {
    return this.rows("SELECT record FROM tasks WHERE parent_id = ? ORDER BY created_at, id", id);
  }

  list(filter: TaskListInput & { owner?: string } = {}): Task[] {
    const want = filter.state ?? "open";
    const out = this.all().filter((t) => {
      if (filter.owner && t.owner !== filter.owner) return false;
      if (filter.conversation && t.conversation !== filter.conversation) return false;
      if (filter.area && t.area?.trim() !== filter.area.trim()) return false;
      if (filter.project && t.project !== filter.project) return false;
      if (filter.parentId && t.parentId !== filter.parentId) return false;
      if (want === "open") return !isClosed(t);
      if (want === "closed") return isClosed(t);
      return t.state === want;
    });
    out.sort((a, b) => (b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id));
    return out.slice(0, filter.limit ?? 50);
  }

  write(task: Task): Task {
    const t = normalizeTask(task, this.now());
    this.db.prepare("INSERT OR REPLACE INTO tasks (id, record, owner, state, origin, conversation, parent_id, created_at, updated_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(t.id, JSON.stringify(t), t.owner, t.state, t.origin, t.conversation, t.parentId, t.createdAt, t.updatedAt, t.closedAt);
    return t;
  }

  save(task: Task): Task {
    const t = this.write(task);
    this.changed();
    return t;
  }

  saveAll(tasks: readonly Task[]): void {
    if (!tasks.length) return;
    this.db.transaction(() => { for (const t of tasks) this.write(t); })();
    this.changed();
  }

  event(id: string, type: string, data: unknown = {}): void {
    this.db.prepare("INSERT INTO task_events (task_id, type, at, data) VALUES (?, ?, ?, ?)").run(id, type, this.now(), JSON.stringify(data));
  }

  history(id: string): TaskEvent[] {
    return this.db.prepare("SELECT type, at, data FROM task_events WHERE task_id = ? ORDER BY seq").all(id) as TaskEvent[];
  }

  newId(prefix: "task" | "loop" | "wc"): string {
    return `${prefix}_${randomUUID()}`;
  }

  change(id: string, patch: (t: Task) => void, by: string | null): Task {
    const saved = this.db.transaction(() => {
      const before = this.get(id);
      const next: Task = structuredClone(before);
      patch(next);
      next.updatedAt = this.now();
      surfaceForUser(next);
      if (next.card && ((isClosed(before) && !isClosed(next)) || (next.owner === USER_OWNER && before.owner !== USER_OWNER))) next.card.dismissedAt = null;
      if (isClosed(next) && !isClosed(before)) { next.closedAt = this.now(); next.closedBy = by; }
      if (!isClosed(next) && isClosed(before) && before.stale) next.stale = false;
      const saved = this.write(next);
      this.record(before, saved, by);
      return saved;
    })();
    this.changed();
    return saved;
  }

  record(before: Task, after: Task, by: string | null): void {
    if (before.owner !== after.owner) this.event(after.id, "handed_off", { owner: after.owner, from: before.owner, by, ...(after.needs ? { needs: after.needs } : {}) });
    if (before.state !== after.state) {
      if (isClosed(after)) this.event(after.id, "closed", { action: after.state === "dropped" ? "drop" : after.state, by });
      else if (isClosed(before)) this.event(after.id, "reopened", { status: after.state, by });
      else this.event(after.id, "state", { state: after.state, from: before.state, by });
    }
    if (before.progress.step !== after.progress.step || before.progress.line !== after.progress.line) {
      this.event(after.id, "progress", { step: after.progress.step, line: after.progress.line, by });
    }
  }
}
