import type Database from "better-sqlite3";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { loop as loopSchema } from "../loops/contract";
import { workCard as workSchema } from "../work/contract";
import { needsYou } from "./contract";
import { TaskStore } from "./store";
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

export function backupPath(file: string, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
  const ext = extname(file);
  return join(dirname(file), `${basename(file, ext)}.before-tasks-${stamp}${ext || ".db"}`);
}

export function backupDatabase(db: Database.Database, at: number): string | null {
  const file = db.name;
  if (!file || file === ":memory:") return null;
  const target = backupPath(file, at);
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
  const old = readdirSync(dirname(file)).filter((name) => name.startsWith(prefix) && name.endsWith(ext || ".db")).sort().reverse().slice(keep);
  for (const name of old) rmSync(join(dirname(file), name), { force: true });
  return old;
}

export function migrateToTasks(db: Database.Database, options: { backup?: boolean; now?: () => number } = {}): TaskMigrationReport {
  const now = options.now ?? Date.now;
  const report: TaskMigrationReport = { backup: null, adopted: { loops: 0, cards: 0, events: 0 }, skipped: [], orphanEvents: 0 };
  const todo = pending(db);
  if (hasTable(db, "loop_events") && hasTable(db, "bot_loops")) {
    report.orphanEvents = (db.prepare("SELECT count(*) AS n FROM loop_events WHERE loop_id NOT IN (SELECT id FROM bot_loops)").get() as { n: number }).n;
  }
  const readable = (rows: Legacy[], schema: { parse(value: unknown): { id: string } }) => rows.some((row) => { try { return schema.parse(JSON.parse(row.record)).id === row.id; } catch { return false; } });
  if (!readable(todo.loops, loopSchema) && !readable(todo.cards, workSchema)) {
    for (const row of todo.loops) report.skipped.push({ id: row.id, source: "loop", reason: "the record does not read as a todo" });
    for (const row of todo.cards) report.skipped.push({ id: row.id, source: "work", reason: "the record does not read as a work card" });
    return report;
  }
  if (options.backup !== false) {
    try {
      report.backup = backupDatabase(db, now());
      if (report.backup) report.pruned = pruneBackups(db.name);
    } catch (error) {
      report.backupError = message(error);
    }
  }
  const store = new TaskStore(db, () => {}, now);
  const exists = db.prepare("SELECT 1 FROM tasks WHERE id = ?");
  const ledger = db.prepare("INSERT OR IGNORE INTO task_legacy (id, source, adopted_at) VALUES (?, ?, ?)");
  const events = hasTable(db, "loop_events")
    ? db.prepare("INSERT INTO task_events (task_id, type, at, data) SELECT loop_id, type, at, data FROM loop_events WHERE loop_id = ? ORDER BY seq")
    : null;
  db.transaction(() => {
    for (const row of todo.loops) {
      try {
        const parsed = loopSchema.parse(JSON.parse(row.record));
        if (parsed.id !== row.id) throw new Error(`record id ${parsed.id} differs from row id`);
        if (!exists.get(row.id)) {
          store.write(taskFromLoop(parsed));
          report.adopted.events += events?.run(row.id).changes ?? 0;
        }
        ledger.run(row.id, "loop", now());
        report.adopted.loops++;
      } catch (error) {
        report.skipped.push({ id: row.id, source: "loop", reason: message(error) });
      }
    }
    for (const row of todo.cards) {
      try {
        const parsed = workSchema.parse(JSON.parse(row.record));
        if (parsed.id !== row.id) throw new Error(`record id ${parsed.id} differs from row id`);
        if (!exists.get(row.id)) store.write(taskFromWork(parsed));
        ledger.run(row.id, "work", now());
        report.adopted.cards++;
      } catch (error) {
        report.skipped.push({ id: row.id, source: "work", reason: message(error) });
      }
    }
  })();
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
