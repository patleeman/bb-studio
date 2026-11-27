import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { migratedSqlFileDb } from "../test/migrated-db";
import { USER_OWNER, type Task } from "./contract";
import { isOpenAgentTask, KEEP_STRAND_BACKUPS, MOVED_EVENT, MOVED_LINE, retireAgentTasks } from "./retire";
import { TaskStore } from "./store";

const NOW = Date.parse("2026-11-21T12:00:00Z");
let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "studio-retire-"));
  db = migratedSqlFileDb(join(dir, "studio.db"));
});
afterEach(() => { if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); });

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, why: "", owner: "thread:thr_lead", state: "in_progress", kind: "do", options: [], needs: null, priority: "normal",
  conversation: "thr_lead", project: null, area: null, timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: null, push: false },
  progress: { step: "2/3", line: "Building" }, workers: [], outputs: [], source: null, parentId: null, schedule: null, card: null, automation: null,
  waitingOn: null, stale: false, origin: "task", createdAt: NOW - 3_600_000, updatedAt: NOW - 60_000, closedAt: null, closedBy: null, ...over,
});

function seed() {
  const store = new TaskStore(db, () => {}, () => NOW);
  const rows = [
    task("task_lead_job"),
    task("task_cos_job", { owner: "cos", conversation: "thr_main", state: "waiting", needs: "Pick one" }),
    task("task_worker", { owner: "thread:thr_w", parentId: "task_lead_job" }),
    task("task_user_todo", { owner: USER_OWNER, state: "todo" }),
    task("task_auto-aut-daily", { owner: "cos", automation: { id: "aut_daily", kind: "checkin", role: "schedule" } as never, schedule: { text: "Daily 08:00", cron: null, timeZone: null, automationId: "aut_daily", paused: false } }),
    task("task_run", { owner: "cos", parentId: "task_auto-aut-daily", automation: { id: "aut_daily", kind: "checkin", role: "run" } as never }),
    task("task_done", { state: "done", closedAt: NOW - 1_000, closedBy: "thread:thr_lead" }),
  ];
  for (const row of rows) { store.save(row); store.event(row.id, "created", { by: row.owner }); }
  return store;
}

it("closes every open agent task as moved to strands, after a backup, and keeps the rest and every history", () => {
  const store = seed();
  const report = retireAgentTasks(db, { now: () => NOW });
  expect(report.closed.sort()).toEqual(["task_cos_job", "task_lead_job", "task_worker"]);
  expect(report.backupError).toBeNull();
  expect(report.backup).toMatch(/studio\.before-strands-2026-11-21T12-00-00-000Z\.db$/);
  expect(existsSync(report.backup!)).toBe(true);
  // The backup holds the tasks as they were.
  const copy = new Database(report.backup!, { readonly: true });
  expect((copy.prepare("SELECT count(*) AS n FROM tasks WHERE closed_at IS NULL").get() as { n: number }).n).toBe(6);
  copy.close();
  for (const id of report.closed) {
    expect(store.get(id)).toMatchObject({ state: "dropped", closedBy: "strands", closedAt: NOW, needs: null, progress: { line: MOVED_LINE } });
    expect(store.history(id).map((event) => event.type)).toEqual(["created", "closed", "progress", MOVED_EVENT]);
  }
  expect(store.get("task_user_todo").state).toBe("todo");
  expect(store.get("task_auto-aut-daily").closedAt).toBeNull();
  expect(store.get("task_run").state).toBe("in_progress");
  expect(store.get("task_done")).toMatchObject({ state: "done", closedBy: "thread:thr_lead" });
  // Nothing is deleted.
  expect((db.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }).n).toBe(7);
});

it("does nothing, and takes no backup, once no agent task is open", () => {
  seed();
  retireAgentTasks(db, { now: () => NOW });
  expect(retireAgentTasks(db, { now: () => NOW + 1_000 })).toEqual({ closed: [], backup: null, backupError: null, pruned: [] });
});

it("closes nothing when the backup fails, so a full disk never costs history", () => {
  const store = seed();
  const report = retireAgentTasks(db, { now: () => NOW, backup: () => { throw new Error("disk full"); } });
  expect(report).toEqual({ closed: [], backup: null, backupError: "disk full", pruned: [] });
  expect(store.get("task_lead_job").state).toBe("in_progress");
});

it("counts as an agent task only an open one an agent owns that no automation keeps", () => {
  expect(isOpenAgentTask(task("task_a"))).toBe(true);
  expect(isOpenAgentTask(task("task_a", { owner: USER_OWNER }))).toBe(false);
  expect(isOpenAgentTask(task("task_a", { state: "done", closedAt: NOW }))).toBe(false);
  expect(isOpenAgentTask(task("task_a", { automation: { id: "aut", role: "finding" } as never }))).toBe(false);
});

it("keeps only the newest before-strands backups, and leaves the before-tasks ones alone", () => {
  const old = ["2026-11-01T00-00-00-000Z", "2026-11-02T00-00-00-000Z", "2026-11-03T00-00-00-000Z", "2026-11-04T00-00-00-000Z"];
  for (const stamp of old) writeFileSync(join(dir, `studio.before-strands-${stamp}.db`), "old");
  writeFileSync(join(dir, "studio.before-tasks-2026-10-01T00-00-00-000Z.db"), "tasks");
  seed();
  const report = retireAgentTasks(db, { now: () => NOW });
  expect(KEEP_STRAND_BACKUPS).toBe(3);
  expect(report.pruned).toEqual(["studio.before-strands-2026-11-01T00-00-00-000Z.db", "studio.before-strands-2026-11-02T00-00-00-000Z.db"]);
  expect(readdirSync(dir).filter((name) => name.includes(".before-")).sort()).toEqual([
    "studio.before-strands-2026-11-03T00-00-00-000Z.db",
    "studio.before-strands-2026-11-04T00-00-00-000Z.db",
    "studio.before-strands-2026-11-21T12-00-00-000Z.db",
    "studio.before-tasks-2026-10-01T00-00-00-000Z.db",
  ]);
});
