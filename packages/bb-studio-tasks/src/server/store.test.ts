import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./store";
import { memoryStore } from "../test/db";

function clock() {
  let at = 1_000;
  return () => (at += 1);
}

const column = (store: ReturnType<typeof memoryStore>["store"], status: string) =>
  store
    .list()
    .filter((task) => task.status === status)
    .map((task) => task.title);

describe("the task store", () => {
  it("upgrades existing task rows without changing their status", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATIONS[0]!);
    db.prepare("INSERT INTO tasks (id, title, status, rank, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tsk_existing", "Old task", "review", 0, 1, 1);
    db.exec(MIGRATIONS[1]!);
    expect(db.prepare("SELECT status, priority, labels FROM tasks WHERE id = ?").get("tsk_existing"))
      .toEqual({ status: "review", priority: "none", labels: "[]" });
    db.close();
  });
  it("adds tasks to the top of their column", () => {
    const { store } = memoryStore(clock());
    store.create({ title: "First", by: "user" });
    store.create({ title: " Second ", by: "user" });
    store.create({ title: "Reviewing", status: "review", by: "agent" });
    expect(column(store, "todo")).toEqual(["Second", "First"]);
    expect(column(store, "review")).toEqual(["Reviewing"]);
    expect(store.list()[0]).toMatchObject({ id: expect.stringMatching(/^tsk_[0-9a-z]{16}$/), assignee: null, done_at: null });
  });

  it("moves a task to the top of another column, or to a position", () => {
    const { store } = memoryStore(clock());
    const [a, b, c] = ["A", "B", "C"].map((title) => store.create({ title, by: "user" }));
    expect(column(store, "todo")).toEqual(["C", "B", "A"]);
    store.move(a!.id, "in_progress", "user");
    store.move(b!.id, "in_progress", "user");
    expect(column(store, "in_progress")).toEqual(["B", "A"]);
    store.move(c!.id, "in_progress", "user", 1);
    expect(column(store, "in_progress")).toEqual(["B", "C", "A"]);
    store.move(b!.id, "in_progress", "user", 2);
    expect(column(store, "in_progress")).toEqual(["C", "A", "B"]);
    store.move(b!.id, "in_progress", "user", 0);
    expect(column(store, "in_progress")).toEqual(["B", "C", "A"]);
    // Past the end is the bottom.
    store.move(b!.id, "in_progress", "user", 99);
    expect(column(store, "in_progress")).toEqual(["C", "A", "B"]);
  });

  it("spreads a column out when ranks get too close to split", () => {
    const { store } = memoryStore(clock());
    const tasks = ["A", "B", "C"].map((title) => store.create({ title, by: "user" }));
    // Keep dropping C between the top two until the gap runs out.
    for (let round = 0; round < 60; round += 1) {
      const order = column(store, "todo");
      const moving = tasks.find((task) => task.title === order[2])!;
      store.move(moving.id, "todo", "user", 1);
    }
    expect(new Set(column(store, "todo")).size).toBe(3);
    const ranks = store.list().map((task) => task.rank);
    expect(new Set(ranks).size).toBe(3);
  });

  it("stamps done_at when a task is done, keeps it on reorder, and clears it when reopened", () => {
    const { store } = memoryStore(clock());
    const task = store.create({ title: "Ship", by: "user" });
    const done = store.move(task.id, "done", "user");
    expect(done.done_at).not.toBeNull();
    expect(store.move(task.id, "done", "user", 0).done_at).toBe(done.done_at);
    expect(store.move(task.id, "todo", "user").done_at).toBeNull();
  });

  it("updates only the fields given", () => {
    const { store } = memoryStore(clock());
    const task = store.create({ title: "Draft", description: "Notes", due: "2026-10-01", by: "user" });
    const next = store.update(task.id, { title: "Final", due: null }, "agent");
    expect(next).toMatchObject({ title: "Final", description: "Notes", due: null, updated_by: "agent" });
    expect(() => store.update("tsk_missing", { title: "x" }, "user")).toThrow(/not found/);
  });

  it("hides archived tasks unless asked", () => {
    const { store } = memoryStore(clock());
    const task = store.create({ title: "Old", by: "user" });
    store.setArchived(task.id, true);
    expect(store.list()).toHaveLength(0);
    expect(store.list({ includeArchived: true })).toHaveLength(1);
  });

  it("keeps links unique, relabels them, and follows thread titles", () => {
    const { store } = memoryStore(clock());
    const task = store.create({ title: "Launch", by: "user" });
    store.link(task.id, { target: "item", plugin_id: "pages", item_id: "pg_1", label: "Plan", href: "/plugins/pages/pages/pg_1" });
    store.link(task.id, { target: "item", plugin_id: "pages", item_id: "pg_1", label: "Launch plan", href: "/plugins/pages/pages/pg_1" });
    store.link(task.id, { target: "thread", plugin_id: null, item_id: "thr_1", label: "Launch", href: "/threads/thr_1" });
    expect(store.links(task.id).map((link) => link.label)).toEqual(["Launch plan", "Launch"]);
    expect(store.relabelThread("thr_1", "Write the launch post")).toEqual([task.id]);
    expect(store.relabelThread("thr_1", "Write the launch post")).toEqual([]);
    expect(store.unlink(task.id, "item", "pg_1")).toBe(true);
    expect(store.links(task.id).map((link) => link.label)).toEqual(["Write the launch post"]);
  });

  it("lists handoffs newest first and drops links and handoffs with the task", () => {
    const { db, store } = memoryStore(clock());
    const task = store.create({ title: "Launch", by: "user" });
    store.addHandoff(task.id, "thr_1", "Claude");
    store.addHandoff(task.id, "thr_2", "Codex");
    store.setHandoff("thr_1", "archived", "Old");
    expect(store.handoffs(task.id).map((handoff) => handoff.thread_id)).toEqual(["thr_2", "thr_1"]);
    expect(store.latestHandoff(task.id)).toMatchObject({ thread_id: "thr_2", state: "starting" });
    expect(store.openHandoffs().map((handoff) => handoff.thread_id)).toEqual(["thr_2"]);
    store.link(task.id, { target: "thread", plugin_id: null, item_id: "thr_2", label: "Launch", href: null });
    store.delete(task.id);
    expect(db.prepare("SELECT count(*) AS n FROM task_handoffs").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM task_links").get()).toEqual({ n: 0 });
  });

  it("migrates old rows and stores flat task fields", () => {
    const { db, store } = memoryStore(clock());
    const parent = store.create({ title: "Parent", by: "user", priority: "high", labels: ["launch"], recurrence: "weekly", due: "2026-10-01" });
    const child = store.create({ title: "Child", by: "user", parentId: parent.id, assignee: "bot:bot_1", reminderAt: 1234 });
    expect(store.get(parent.id)).toMatchObject({ priority: "high", labels: '["launch"]', recurrence: "weekly" });
    expect(store.get(child.id)).toMatchObject({ parent_id: parent.id, assignee: "bot:bot_1", reminder_at: 1234 });
    expect(store.subtasks(parent.id)).toEqual({ total: 1, done: 0 });
    store.move(child.id, "done", "user");
    expect(store.subtasks(parent.id)).toEqual({ total: 1, done: 1 });
    expect(() => store.update(parent.id, { parentId: child.id }, "user")).toThrow(/own subtask/);
    expect(db.prepare("PRAGMA table_info(tasks)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "priority" })]));
  });

  it("creates the next recurring task once when completed", () => {
    const { store } = memoryStore(clock());
    const task = store.create({ title: "Report", due: "2026-01-31", recurrence: "monthly", by: "user" });
    store.move(task.id, "done", "user");
    const next = store.completeRecurring(task, "user");
    expect(next).toMatchObject({ title: "Report", due: "2026-02-28", status: "todo", recurrence: "monthly" });
  });

  it("keeps project columns ordered and maps removed statuses", () => {
    const { store } = memoryStore(clock());
    const task = store.create({ title: "Review", projectId: "project-1", status: "review", by: "user" });
    expect(store.statuses("project-1").map((column) => column.id)).toEqual(["todo", "in_progress", "review", "done"]);
    store.setStatuses("project-1", [{ id: "backlog", label: "Backlog" }, { id: "done", label: "Done" }]);
    expect(store.statuses("project-1")).toEqual([{ id: "backlog", label: "Backlog" }, { id: "done", label: "Done" }]);
    expect(store.get(task.id)?.status).toBe("backlog");
  });
});
