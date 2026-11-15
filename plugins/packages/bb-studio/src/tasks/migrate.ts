import type Database from "better-sqlite3";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { loop as loopSchema } from "../loops/contract";
import { workCard as workSchema } from "../work/contract";
import { needsYou } from "./contract";
import { markTasksUnavailable, TaskStore } from "./store";
import { taskFromLoop, taskFromWork, toLoop, toWork } from "./views";

type Legacy = { id: string; record: string };
type Row = { record: string };
export type MigrationProblem = { id: string; source: "loop" | "work"; reason: string };
export type TaskMigrationReport = {
  backup: string | null;
  backupError?: string;
  pruned?: string[];
  adopted: { loops: number; cards: number; events: number };
  skipped: MigrationProblem[];
  orphanEvents: number;
};

const hasTable = (db: Database.Database, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const message = (error: unknown) => (error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : String(error));

function pending(db: Database.Database): { loops: Legacy[]; cards: Legacy[] } {
  const loops = hasTable(db, "bot_loops") ? db.prepare("SELECT id, record FROM bot_loops WHERE id NOT IN (SELECT id FROM task_legacy) ORDER BY rowid").all() as Legacy[] : [];
  const cards = hasTable(db, "work_cards") ? db.prepare("SELECT id, record FROM work_cards WHERE id NOT IN (SELECT id FROM task_legacy) ORDER BY rowid").all() as Legacy[] : [];
  return { loops, cards };
}

export function backupPath(file: string, at: number, label = "tasks"): string {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
  const ext = extname(file);
  return join(dirname(file), `${basename(file, ext)}.before-${label}-${stamp}${ext || ".db"}`);
}

export function backupDatabase(db: Database.Database, at: number, label = "tasks"): string | null {
  const file = db.name;
  if (!file || file === ":memory:") return null;
  const target = backupPath(file, at, label);
  if (existsSync(target)) throw new Error(`${target} already exists`);
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } catch (error) {
    try { rmSync(target, { force: true }); } catch { }
    throw error;
  }
  return target;
}

export const KEEP_BACKUPS = 3;

export function pruneBackups(file: string, keep = KEEP_BACKUPS): string[] {
  const ext = extname(file);
  const prefix = `${basename(file, ext)}.before-tasks-`;
  const all = readdirSync(dirname(file)).filter((name) => name.startsWith(prefix) && name.endsWith(ext || ".db")).sort();
  const old = all.length > keep ? all.slice(1, all.length - (keep - 1)) : [];
  for (const name of old) rmSync(join(dirname(file), name), { force: true });
  return old;
}

type Readable<T> = { row: Legacy; record: T };

function sortRows<T extends { id: string }>(rows: Legacy[], schema: { parse(value: unknown): T }, source: "loop" | "work", skipped: MigrationProblem[]): Readable<T>[] {
  const out: Readable<T>[] = [];
  for (const row of rows) {
    try {
      const record = schema.parse(JSON.parse(row.record));
      if (record.id !== row.id) throw new Error(`record id ${record.id} differs from row id`);
      out.push({ row, record });
    } catch (error) {
      skipped.push({ id: row.id, source, reason: message(error) });
    }
  }
  return out;
}

class Rehearsal extends Error {}

type Log = { info(message: string): void; warn(message: string): void; error(message: string): void };

export function adoptAtStart(db: Database.Database, log: Log): TaskMigrationReport | null {
  try {
    const moved = migrateToTasks(db);
    if (moved.adopted.loops || moved.adopted.cards) log.info(`Tasks: adopted ${moved.adopted.loops} todo(s) and ${moved.adopted.cards} work card(s); backup at ${moved.backup ?? "none"}.`);
    if (moved.backupError) log.warn(`Tasks: the backup before adopting failed (${moved.backupError}); adopted anyway, the old tables are untouched.`);
    for (const skipped of moved.skipped) log.warn(`Tasks: ${skipped.source} ${skipped.id} does not read as one and was not adopted: ${skipped.reason}`);
    return moved;
  } catch (error) {
    const reason = message(error);
    markTasksUnavailable(db, reason);
    log.error(`Tasks: adopting todos and work cards failed; Todos and In flight show an error until the next start retries: ${reason}`);
    return null;
  }
}

export function migrateToTasks(db: Database.Database, options: { backup?: boolean; now?: () => number } = {}): TaskMigrationReport {
  const now = options.now ?? Date.now;
  const report: TaskMigrationReport = { backup: null, adopted: { loops: 0, cards: 0, events: 0 }, skipped: [], orphanEvents: 0 };
  const todo = pending(db);
  if (hasTable(db, "loop_events") && hasTable(db, "bot_loops")) {
    report.orphanEvents = (db.prepare("SELECT count(*) AS n FROM loop_events WHERE loop_id NOT IN (SELECT id FROM bot_loops)").get() as { n: number }).n;
  }
  const loops = sortRows(todo.loops, loopSchema, "loop", report.skipped);
  const cards = sortRows(todo.cards, workSchema, "work", report.skipped);
  if (!loops.length && !cards.length) return report;
  const store = new TaskStore(db, () => {}, now);
  const exists = db.prepare("SELECT 1 FROM tasks WHERE id = ?");
  const ledger = db.prepare("INSERT OR IGNORE INTO task_legacy (id, source, adopted_at) VALUES (?, ?, ?)");
  const events = hasTable(db, "loop_events")
    ? db.prepare("INSERT INTO task_events (task_id, type, at, data) SELECT loop_id, type, at, data FROM loop_events WHERE loop_id = ? ORDER BY seq")
    : null;
  const adopt = (rehearse: boolean) => {
    const adopted = { loops: 0, cards: 0, events: 0 };
    try {
      db.transaction(() => {
        for (const { row, record } of loops) {
          if (!exists.get(row.id)) {
            store.write(taskFromLoop(record));
            adopted.events += events?.run(row.id).changes ?? 0;
          }
          ledger.run(row.id, "loop", now());
          adopted.loops++;
        }
        for (const { row, record } of cards) {
          if (!exists.get(row.id)) store.write(taskFromWork(record));
          ledger.run(row.id, "work", now());
          adopted.cards++;
        }
        if (rehearse) throw new Rehearsal();
      })();
    } catch (error) {
      if (!(error instanceof Rehearsal)) throw error;
    }
    return adopted;
  };
  adopt(true);
  if (options.backup !== false) {
    try {
      report.backup = backupDatabase(db, now());
      if (report.backup) report.pruned = pruneBackups(db.name);
    } catch (error) {
      report.backupError = message(error);
    }
  }
  report.adopted = adopt(false);
  return report;
}

export function verifyTaskMigration(db: Database.Database): MigrationProblem[] {
  const store = new TaskStore(db);
  const problems: MigrationProblem[] = [];
  const check = (source: "loop" | "work", rows: Legacy[]) => {
    for (const row of rows) {
      try {
        const task = store.find(row.id);
        if (!task) { problems.push({ id: row.id, source, reason: "not adopted" }); continue; }
        const before = source === "loop" ? loopSchema.parse(JSON.parse(row.record)) : workSchema.parse(JSON.parse(row.record));
        const after = source === "loop" ? toLoop(task) : toWork(task);
        const differs = Object.keys(before).filter((key) => JSON.stringify((before as Record<string, unknown>)[key]) !== JSON.stringify((after as Record<string, unknown>)[key]));
        if (differs.length) problems.push({ id: row.id, source, reason: `reads back differently: ${differs.map((key) => `${key} ${JSON.stringify((before as Record<string, unknown>)[key])} → ${JSON.stringify((after as Record<string, unknown>)[key])}`).join("; ")}` });
      } catch (error) {
        problems.push({ id: row.id, source, reason: message(error) });
      }
    }
  };
  if (hasTable(db, "bot_loops")) check("loop", db.prepare("SELECT id, record FROM bot_loops ORDER BY rowid").all() as Legacy[]);
  if (hasTable(db, "work_cards")) check("work", db.prepare("SELECT id, record FROM work_cards ORDER BY rowid").all() as Legacy[]);
  if (hasTable(db, "loop_events")) {
    const mismatched = db.prepare(`SELECT l.id AS id, (SELECT count(*) FROM loop_events e WHERE e.loop_id = l.id) AS n_before, (SELECT count(*) FROM task_events t WHERE t.task_id = l.id) AS n_after
      FROM bot_loops l WHERE n_before <> n_after`).all() as { id: string; n_before: number; n_after: number }[];
    for (const row of mismatched) problems.push({ id: row.id, source: "loop", reason: `history has ${row.n_after} events, the todo had ${row.n_before}` });
  }
  return problems;
}

type Counts = Record<string, number>;
const tally = (values: string[]): Counts => values.reduce<Counts>((out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }), {});
const ownerType = (owner: string) => (owner.startsWith("thread:") ? "thread" : owner);

export function summarizeTaskMigration(db: Database.Database) {
  const parse = (record: string) => { try { return JSON.parse(record) as Record<string, unknown>; } catch { return {}; } };
  const loops = hasTable(db, "bot_loops") ? (db.prepare("SELECT record FROM bot_loops").all() as Row[]).map((r) => parse(r.record)) : [];
  const cards = hasTable(db, "work_cards") ? (db.prepare("SELECT record FROM work_cards").all() as Row[]).map((r) => parse(r.record)) : [];
  const tasks = new TaskStore(db).all();
  return {
    before: {
      loops: { total: loops.length, status: tally(loops.map((l) => String(l.status))), kind: tally(loops.map((l) => String(l.kind))), owner: tally(loops.map((l) => ownerType(String(l.owner)))), trigger: tally(loops.map((l) => String((l.trigger as { type?: string } | undefined)?.type))) },
      cards: { total: cards.length, state: tally(cards.map((c) => String(c.state) + (c.stale ? " (ended)" : ""))), kind: tally(cards.map((c) => String(c.kind))), dismissed: cards.filter((c) => c.dismissedAt != null).length },
      loopEvents: hasTable(db, "loop_events") ? (db.prepare("SELECT count(*) AS n FROM loop_events").get() as { n: number }).n : 0,
    },
    after: {
      total: tasks.length,
      byOrigin: tally(tasks.map((t) => t.origin)),
      state: tally(tasks.map((t) => `${t.origin}:${t.state}`)),
      kind: tally(tasks.map((t) => t.kind)),
      owner: tally(tasks.map((t) => ownerType(t.owner))),
      queue: tally(tasks.map((t) => String(t.attention.queue))),
      timeTriggers: tasks.filter((t) => t.timing.trigger.type === "time").length,
      needsYou: tasks.filter(needsYou).length,
      taskEvents: (db.prepare("SELECT count(*) AS n FROM task_events").get() as { n: number }).n,
    },
  };
}
