import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { registerLoops } from "../loops/register";
import { rpcContract as loopsContract } from "../loops/contract";
import { registerWorkCards } from "../work/register";
import { registerTasks } from "./register";
import { addTodo, withTaskTools, withWorkTools } from "./test/tools";
import { tasksContract } from "./rpc-contract";
import { guardTasks, markTasksUnavailable, TaskStore } from "./store";
import { registerUserTasks } from "./user";
import { USER_OWNER, type Task } from "./contract";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
let db: Database.Database;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = new Database(":memory:");
  for (const sql of MIGRATIONS.filter(Boolean)) db.exec(sql);
});
afterEach(() => { db.close(); vi.useRealTimers(); });

type Tool = { name: string; execute(input: unknown, ctx: unknown): Promise<string> };

/** What the user's Done or hand-off did to a task (the act RPC is gone; old rows still carry these changes). */
const byUser = (id: string, patch: (t: Task) => void) => new TaskStore(db).change(id, patch, USER_OWNER);

function setup() {
  const tools: Record<string, Tool> = {};
  const handlers: Record<string, (input: any) => any> = {};
  const bb = {
    realtime: { publish: vi.fn() }, log: { warn: vi.fn(), info: vi.fn() }, onDispose: vi.fn(),
    agents: { registerTool: (tool: Tool) => { tools[tool.name] = tool; } },
    ui: { registerMentionProvider: vi.fn() },
    rpc: { register: (_contract: unknown, map: typeof handlers) => Object.assign(handlers, map) },
    sdk: { threads: { get: async () => null, update: vi.fn(async () => ({})), timeline: vi.fn(async () => ({ rows: [] })) } },
  };
  const post = async () => {};
  registerLoops(bb as never, db);
  withWorkTools(tools, db, registerWorkCards(bb as never, db, { read: async () => ({ rows: [] }), thread: async () => ({ status: "active" }) }));
  withTaskTools(tools, db, registerTasks(bb as never, db, post));
  const titles: Record<string, string> = { thr_worker: "Fix the flaky test", thr_lead: "Larkspur lead", thr_main: "Main", thr_old: "Old worker" };
  registerUserTasks(bb as never, db, {
    thread: async (id) => (titles[id] ? { title: titles[id], archivedAt: id === "thr_old" ? NOW : null } : null),
    held: () => [],
  });
  const tool = async (name: string, input: unknown, threadId = "thr_worker") => JSON.parse(await tools[name]!.execute(input, { threadId }));
  return { handlers, tools, tool };
}

it("registers get, getMany and list, and none of them is in the loops contract", () => {
  const { handlers } = setup();
  expect(Object.keys(tasksContract).sort()).toEqual(["tasks.get", "tasks.getMany", "tasks.list"]);
  for (const method of Object.keys(tasksContract)) expect(handlers[method]).toBeTypeOf("function");
  for (const method of Object.keys(tasksContract)) expect(Object.keys(loopsContract)).not.toContain(method);
});

it("lists open tasks of every origin and the last week's done ones, with thread names and holds", async () => {
  const { handlers, tool, tools } = setup();
  addTodo(db, "Mine");
  await tool("task_create", { title: "Agent's", owner: "me" });
  JSON.parse(await tools.work_card_create!.execute({ title: "A card", kind: "worker" }, { threadId: "thr_main" }));
  const old = addTodo(db, "Old done");
  byUser(old.id, (t) => { t.state = "done"; });
  vi.setSystemTime(NOW + 8 * 86_400_000);
  const fresh = addTodo(db, "Fresh done");
  byUser(fresh.id, (t) => { t.state = "done"; });
  const out = await handlers["tasks.list"]!({});
  expect(out.tasks.map((t: Task) => t.title).sort()).toEqual(["A card", "Agent's", "Fresh done", "Mine"]);
  expect(out.held).toEqual([]);
  expect(tasksContract["tasks.list"].output.parse(out)).toBeTruthy();
});

it("says tasks can't be shown without the database's own error, and the tools keep the reason", async () => {
  const { handlers, tools } = setup();
  markTasksUnavailable(db, "SQLITE_FULL: database or disk is full");
  await expect(Promise.resolve().then(() => handlers["tasks.list"]!({}))).rejects.toThrow(/^Tasks could not be loaded\. Nothing was lost\. Restart BB Studio to try again\.$/);
  expect(await tools.task_list!.execute({}, {})).toMatch(/SQLITE_FULL/);
});

it("an agent's task with a trigger and no state waits for it, so it files under Scheduled, not Agents on it", async () => {
  const { tool } = setup();
  const { task } = await tool("task_create", { title: "Check the deploy tonight", owner: "cos", trigger: { type: "time", at: NOW + 3_600_000 } });
  expect(task).toMatchObject({ state: "todo", attention: { queue: "queued" } });
  expect((await tool("task_create", { title: "Run now", owner: "cos" })).task.state).toBe("in_progress");
});

it("names every thread in the task's history, not only today's owner", async () => {
  const { handlers, tool } = setup();
  const { task } = await tool("task_create", { title: "Sort the receipts", owner: "me" }, "thr_lead");
  byUser(task.id, (t) => { t.owner = "thread:thr_worker"; t.state = "in_progress"; });
  byUser(task.id, (t) => { t.owner = USER_OWNER; t.state = "todo"; });
  const view = await handlers["tasks.get"]!({ id: task.id });
  expect(view.threads.map((t: { owner: string }) => t.owner).sort()).toEqual(["thread:thr_lead", "thread:thr_worker"]);
});

it("records a Done line when an agent closes its own task", async () => {
  const { handlers, tool } = setup();
  const { task } = await tool("task_create", { title: "Ship the docs", owner: "me", card: true });
  await tool("task_update", { id: task.id, state: "done" });
  const view = await handlers["tasks.get"]!({ id: task.id });
  expect(view.history.map((e: { type: string }) => e.type)).toEqual(["created", "closed"]);
  expect(JSON.parse(view.history[1].data)).toMatchObject({ action: "done", by: "thread:thr_worker" });
});

it("a work card the user closed stays closed when the worker updates it", async () => {
  const { handlers, tools } = setup();
  const made = JSON.parse(await tools.work_card_create!.execute({ title: "Release 1.0.7", kind: "release" }, { threadId: "thr_main" }));
  byUser(made.id, (t) => { t.state = "done"; });
  const card = JSON.parse(await tools.work_card_update!.execute({ id: made.id, state: "running", step: "5/5", line: "Back on it" }, { threadId: "thr_main" }));
  expect(card).toMatchObject({ state: "done", step: null, line: null, note: expect.stringMatching(/stays closed/) });
  const kept = (await handlers["tasks.get"]!({ id: made.id })).history.at(-1);
  expect(kept).toMatchObject({ type: "progress", data: expect.stringContaining("Back on it") });
  expect(JSON.parse(kept.data)).toMatchObject({ by: "thread:thr_main", kept: true });
});

it("turns a runtime database error into a plain message for the UI and logs the database's own", async () => {
  const log = vi.fn();
  const failing = guardTasks(db, { boom: () => { const e = new Error("SQLITE_BUSY: database is locked"); e.name = "SqliteError"; throw e; }, other: async () => { throw new Error("Task x not found"); } }, false, log);
  expect(() => failing.boom()).toThrow(/^Tasks couldn't be read or saved just now/);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("database is locked"));
  await expect(failing.other()).rejects.toThrow("Task x not found");
});
