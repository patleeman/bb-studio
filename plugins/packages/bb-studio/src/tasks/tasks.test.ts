import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { registerLoops } from "../loops/register";
import { LoopStore } from "../loops/store";
import { LoopScheduler } from "../loops/scheduler";
import { registerWorkCards } from "../work/register";
import { WORK_ID } from "../work/shared";
import { WorkCardStore } from "../work/store";
import { task as taskSchema, TODO_ID, type Task } from "./contract";
import { adoptAtStart, backupPath, KEEP_BACKUPS, migrateToTasks, summarizeTaskMigration, verifyTaskMigration } from "./migrate";
import { registerTasks, TASK_TOOLS } from "./register";
import { markTasksUnavailable, normalizeTask, TaskStore } from "./store";
import { applyLoop, applyWork, taskFromLoop, taskFromWork, toLoop, toWork } from "./views";
import { taskFromLoop as captureTaskFromLoop } from "../../../../scripts/capture/task-rows.mjs";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
let db: Database.Database;
let dir: string | null = null;

const migrate = (target: Database.Database) => { for (const sql of MIGRATIONS) target.exec(sql); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = new Database(":memory:");
  migrate(db);
});
afterEach(() => {
  if (db.open) db.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
  vi.useRealTimers();
});

type Tool = { name: string; execute(input: unknown, ctx: unknown): Promise<string> };
function fakeBb() {
  const tools: Record<string, Tool> = {};
  const handlers: Record<string, (input: any) => any> = {};
  const bb = {
    realtime: { publish: vi.fn() }, log: { warn: vi.fn(), info: vi.fn() }, onDispose: vi.fn(),
    agents: { registerTool: (tool: Tool) => { tools[tool.name] = tool; } },
    ui: { registerMentionProvider: vi.fn() },
    rpc: { register: (_contract: unknown, map: typeof handlers) => Object.assign(handlers, map) },
    sdk: { threads: { get: async () => null, update: vi.fn(async () => ({})), timeline: vi.fn(async () => ({ rows: [] })) } },
  };
  return { bb, tools, handlers };
}

function setup() {
  const { bb, tools, handlers } = fakeBb();
  const posts: string[] = [];
  const post = async (text: string) => { posts.push(text); };
  const loops = registerLoops(bb as never, db, post, async () => {}, { get: async () => ({ loopsEnabled: false }), onChange: () => {} }, () => "UTC", () => {});
  const work = registerWorkCards(bb as never, db, { read: async () => ({ rows: [] }), thread: async () => ({ status: "active" }) });
  const tasks = registerTasks(bb as never, db, post);
  const call = async (name: string, input: unknown, ctx: { threadId?: string | null } = { threadId: "thr_lead" }) => {
    const text = await tools[name]!.execute(input, ctx);
    return text.startsWith("Error: ") ? { error: text } : JSON.parse(text);
  };
  return { posts, loops, work, tasks, tools, handlers, call };
}

it("registers the five task tools", () => {
  const { tools } = setup();
  expect(TASK_TOOLS.every((name) => !!tools[name])).toBe(true);
});

it("creates a task with defaults, the user alias stored as patrick, and reads it back with history", async () => {
  const { call } = setup();
  const { task } = await call("task_create", { title: "Renew the passport", owner: "user", why: "It expires in March", due: NOW + 86400000 });
  expect(task).toMatchObject({ owner: "patrick", state: "todo", kind: "do", origin: "task", attention: { queue: "queued", push: false }, timing: { due: NOW + 86400000, trigger: { type: "none" }, snoozed: false }, card: null, conversation: null });
  expect(task.id).toMatch(/^task_/);
  const got = await call("task_get", { id: task.id });
  expect(got.task).toEqual(task);
  expect(got.history.map((e: { type: string }) => e.type)).toEqual(["created"]);
  expect(taskSchema.parse(got.task)).toEqual(task);
});

it("resolves me to the calling thread and refuses it without one", async () => {
  const { call } = setup();
  expect((await call("task_create", { title: "Mine", owner: "me" })).task.owner).toBe("thread:thr_lead");
  expect((await call("task_create", { title: "Mine", owner: "me" }, {})).error).toMatch(/calling thread/);
});

it("gives a task with a card a ::work line that the work card views read", async () => {
  const { call, work, handlers } = setup();
  const { task, directive } = await call("task_create", { title: "Ship 1.2", owner: "me", card: true, state: "in_progress", step: "1/3 Build" });
  expect(directive).toBe(`::work{id="${task.id}"}`);
  expect(WORK_ID.test(task.id)).toBe(true);
  expect(task.conversation).toBe("thr_lead");
  expect(await handlers["work.get"]!({ id: task.id })).toMatchObject({ id: task.id, threadId: "thr_lead", title: "Ship 1.2", kind: "task", state: "running", step: "1/3 Build" });
  expect((await work.list("thr_lead")).cards.map((c) => c.id)).toEqual([task.id]);
  expect((await call("task_create", { title: "Nowhere", owner: "cos", card: true }, {})).error).toMatch(/conversation/);
});

it("a carded task made for another conversation is posted there by that conversation; one in the caller's own thread tells the caller to post it", async () => {
  const { bb, tools } = fakeBb();
  const sent: { threadId: string; text: string }[] = [];
  registerTasks(bb as never, db, async () => {}, async (threadId, text) => { sent.push({ threadId, text }); });
  const call = async (input: unknown, threadId: string) => JSON.parse(await tools.task_create!.execute(input, { threadId }));
  const made = await call({ title: "Build the changelog", owner: "me", card: true, conversation: "thr_main", step: "1/2" }, "thr_worker");
  expect(sent).toEqual([{ threadId: "thr_main", text: expect.stringContaining(`exactly once, on its own line: ::work{id="${made.task.id}"} (the task "Build the changelog", made by thread:thr_worker)`) }]);
  expect(made.note).toMatch(/sent to that conversation/);
  const own = await call({ title: "Ship it", owner: "me", card: true }, "thr_worker");
  expect(sent).toHaveLength(1);
  expect(own.note).toBe(`Post this line once, on its own line, in your reply: ::work{id="${own.task.id}"}`);
});

it("reads a task's title for a sidebar line, and null for an unknown id", async () => {
  const { call } = setup();
  const { task } = await call("task_create", { title: "Fix the flaky upload test", owner: "me" });
  const { taskTitle } = await import("./store");
  expect(taskTitle(db, task.id)).toBe("Fix the flaky upload test");
  expect(taskTitle(db, "task_nope")).toBeNull();
});

it("keeps loop_, wc_ and task_ ids, and each resolves through task_get", async () => {
  const { call, loops, work } = setup();
  const loop = loops.store.add({ title: "Call Sam" });
  const card = work.create({ title: "Build", threadId: "thr_lead" }).card;
  const { task } = await call("task_create", { title: "New", owner: "cos" });
  for (const id of [loop.id, card.id, task.id]) expect((await call("task_get", { id })).task.id).toBe(id);
  expect(loop.id).toMatch(/^loop_/);
  expect(card.id).toMatch(/^wc_/);
  expect(loops.store.get(loop.id).id).toBe(loop.id);
  expect(() => loops.store.get(card.id)).toThrow("Todo not found");
  expect(() => work.store.get(loop.id)).toThrow(/not found/);
  expect(() => work.store.get(task.id)).toThrow(/not found/);
  expect(loops.store.get(task.id).title).toBe("New");
});

it("records progress and state in history, closes with who closed it, and reopens", async () => {
  const { call } = setup();
  const { task } = await call("task_create", { title: "Migrate", owner: "me", state: "in_progress" });
  vi.setSystemTime(NOW + 1000);
  const step = await call("task_update", { id: task.id, step: "2/4 Copy", line: "Copied 120 rows" });
  expect(step).toMatchObject({ progress: { step: "2/4 Copy", line: "Copied 120 rows" }, updatedAt: NOW + 1000 });
  const done = await call("task_update", { id: task.id, state: "done", outputs: [{ kind: "pr", ref: "#42" }] });
  expect(done).toMatchObject({ state: "done", closedAt: NOW + 1000, closedBy: "thread:thr_lead", outputs: [{ kind: "pr", ref: "#42" }] });
  const back = await call("task_update", { id: task.id, state: "in_progress" });
  expect(back).toMatchObject({ closedAt: null, closedBy: null });
  expect((await call("task_get", { id: task.id })).history.map((e: { type: string }) => e.type)).toEqual(["created", "progress", "closed", "reopened"]);
});

it("models subtasks: children under a parent, and no cycles", async () => {
  const { call } = setup();
  const parent = (await call("task_create", { title: "Weekly check", owner: "cos", schedule: { text: "Mondays at 9", cron: "0 9 * * 1" } })).task;
  const child = (await call("task_create", { title: "Run 1", owner: "cos", parentId: parent.id })).task;
  expect(parent.schedule).toEqual({ text: "Mondays at 9", cron: "0 9 * * 1", timeZone: null, automationId: null, paused: false });
  expect((await call("task_get", { id: parent.id })).children).toEqual([{ id: child.id, title: "Run 1", owner: "cos", state: "in_progress" }]);
  expect((await call("task_update", { id: parent.id, parentId: child.id })).error).toMatch(/own subtasks/);
  expect((await call("task_list", { parentId: parent.id })).tasks.map((t: Task) => t.id)).toEqual([child.id]);
});

it("lists open tasks by default and filters by owner, state and conversation", async () => {
  const { call } = setup();
  const mine = (await call("task_create", { title: "A", owner: "user" })).task;
  vi.setSystemTime(NOW + 1);
  const bots = (await call("task_create", { title: "B", owner: "cos", conversation: "thr_x" })).task;
  vi.setSystemTime(NOW + 2);
  const closed = (await call("task_create", { title: "C", owner: "user" })).task;
  await call("task_update", { id: closed.id, state: "dropped" });
  expect((await call("task_list", {})).tasks.map((t: Task) => t.id)).toEqual([bots.id, mine.id]);
  expect((await call("task_list", { owner: "user" })).tasks.map((t: Task) => t.id)).toEqual([mine.id]);
  expect((await call("task_list", { state: "closed" })).tasks.map((t: Task) => t.id)).toEqual([closed.id]);
  expect((await call("task_list", { conversation: "thr_x" })).tasks.map((t: Task) => t.id)).toEqual([bots.id]);
});

it("hands a todo to the user: it comes up in Today with one card and keeps its history", async () => {
  const { call, posts, handlers } = setup();
  const { task } = await call("task_create", { title: "Pick a venue", owner: "cos", state: "in_progress" });
  const out = await call("task_handoff", { id: task.id, to: "user", needs: "Choose one", options: ["Hall", "Park"] });
  expect(out.task).toMatchObject({ owner: "patrick", state: "waiting", needs: "Choose one", kind: "decide", options: ["Hall", "Park"], attention: { queue: "surfaced" } });
  expect(posts).toEqual([`Please post this card in your chat exactly once: ::loop{id="${task.id}"}`]);
  const list = await handlers["loops.list"]!({});
  expect(list.needsYouNow.map((l: { id: string }) => l.id)).toEqual([task.id]);
  expect((await handlers["loops.get"]!({ id: task.id })).loop).toMatchObject({ status: "surfaced", owner: "patrick", kind: "decide" });
  const back = await call("task_handoff", { id: task.id, to: "thread:thr_w" });
  expect(back.task).toMatchObject({ owner: "thread:thr_w", state: "in_progress", needs: null, attention: { queue: null } });
  expect(posts[1]).toContain("was handed to thread:thr_w");
  const history = (await call("task_get", { id: task.id })).history.filter((e: { type: string }) => e.type === "handed_off").map((e: { data: string }) => JSON.parse(e.data));
  expect(history).toEqual([{ owner: "patrick", from: "cos", by: "thread:thr_lead", needs: "Choose one" }, { owner: "thread:thr_w", from: "patrick", by: "thread:thr_lead" }]);
});

it("hands a carded task to the user as needs-you on its card, without posting, and back to the agent", async () => {
  const { call, posts, work } = setup();
  const { task } = await call("task_create", { title: "Release", owner: "me", card: true, state: "in_progress" });
  await call("task_handoff", { id: task.id, to: "user", needs: "Approve the push" });
  expect(work.store.get(task.id)).toMatchObject({ state: "needs-you", needs: "Approve the push" });
  expect(posts).toEqual([]);
  await call("task_handoff", { id: task.id, to: "me" });
  expect(work.store.get(task.id)).toMatchObject({ state: "running", needs: null });
  expect(posts).toEqual([]);
  await call("task_update", { id: task.id, state: "done" });
  expect((await call("task_handoff", { id: task.id, to: "user" })).error).toMatch(/closed/);
});

it("still hands off when the Bot chat can't be told, and says so", async () => {
  const { bb, tools } = fakeBb();
  registerTasks(bb as never, db, async () => { throw new Error("An active Bot chat is required"); });
  const created = JSON.parse(await tools.task_create!.execute({ title: "X", owner: "user" }, {}));
  const out = JSON.parse(await tools.task_handoff!.execute({ id: created.task.id, to: "cos" }, {}));
  expect(out.task.owner).toBe("cos");
  expect(out.note).toMatch(/could not be told/);
});

it("a work card needs-you is owned by the user, and leaving it returns the card to its worker", () => {
  const store = new WorkCardStore(db);
  const card = store.create({ title: "Fix", kind: "worker", threadId: "thr_lead", workerThreadId: "thr_w" });
  const tasks = new TaskStore(db);
  expect(tasks.get(card.id)).toMatchObject({ owner: "thread:thr_w", state: "in_progress", workers: ["thr_w"], origin: "work" });
  store.update(card.id, { state: "needs-you", needs: "Approve" });
  expect(tasks.get(card.id)).toMatchObject({ owner: "patrick", state: "waiting", needs: "Approve" });
  store.update(card.id, { state: "done" });
  expect(tasks.get(card.id)).toMatchObject({ owner: "thread:thr_w", state: "done", closedBy: "thread:thr_w" });
  expect(tasks.history(card.id).map((e) => e.type)).toEqual(["handed_off", "state", "handed_off", "closed"]);
});

it("keeps fields only tasks have when a todo or card is saved through its old shape", () => {
  const tasks = new TaskStore(db);
  const loops = new LoopStore(db);
  const l = loops.add({ title: "Todo" });
  tasks.save({ ...tasks.get(l.id), project: "Home", outputs: [{ kind: "page", ref: "pg_1" }], workers: ["thr_a"], state: "failed" });
  loops.update(l.id, { why: "because" });
  expect(tasks.get(l.id)).toMatchObject({ why: "because", project: "Home", outputs: [{ kind: "page", ref: "pg_1" }], workers: ["thr_a"], state: "failed" });
  expect(loops.get(l.id).status).toBe("dropped");
});

it("round-trips every todo status and kind and every card state through a task", () => {
  for (const status of ["queued", "surfaced", "snoozed", "in_progress", "done", "dropped"] as const) {
    for (const kind of ["do", "decide", "read", "waiting"] as const) {
      const closed = status === "done" || status === "dropped";
      const loop = { id: "loop_x", title: "T", why: "", source: null, kind, options: kind === "decide" ? ["A"] : [], owner: "patrick", trigger: { type: "time" as const, at: NOW }, priority: "low" as const, push: true, status, due: NOW, area: "Home", createdAt: 1, updatedAt: 2, closedAt: closed ? 3 : null, closedBy: closed ? "patrick" : null };
      const task = normalizeTask(taskFromLoop(loop), NOW);
      expect(toLoop(task)).toEqual(loop);
      expect(toLoop(applyLoop(task, loop))).toEqual(loop);
    }
  }
  for (const state of ["running", "waiting", "needs-you", "done", "failed"] as const) {
    for (const stale of [false, true]) {
      const finished = state === "done" || state === "failed";
      const card = { id: "wc_x", threadId: "thr_a", title: "C", kind: "worker" as const, state, step: "1/2", line: "l", needs: state === "needs-you" ? "n" : null, workerThreadId: "thr_w", messageId: "m", messageSeq: 4, createdAt: 1, updatedAt: 2, finishedAt: finished ? 3 : null, stale: finished && stale, dismissedAt: finished ? 5 : null };
      const task = normalizeTask(taskFromWork(card), NOW);
      expect(toWork(task)).toEqual(card);
      expect(toWork(applyWork(task, card))).toEqual(card);
    }
  }
});

it("writes capture fixtures as the same task rows the app stores", () => {
  for (const status of ["queued", "surfaced", "snoozed", "in_progress", "done", "dropped"] as const) {
    for (const kind of ["do", "decide", "read", "waiting"] as const) {
      const closed = status === "done" || status === "dropped";
      const loop = { id: "loop_capture-x", title: "T", why: "w", source: null, kind, options: [], owner: "patrick", trigger: { type: "none" as const }, priority: "normal" as const, push: false, status, due: null, area: null, createdAt: 1, updatedAt: 2, closedAt: closed ? 3 : null, closedBy: closed ? "patrick" : null };
      expect(normalizeTask(captureTaskFromLoop(loop) as Task, NOW)).toEqual(normalizeTask(taskFromLoop(loop), NOW));
      expect(captureTaskFromLoop(loop)).toEqual(taskFromLoop(loop));
    }
  }
});

it("adds a typed todo as the user's own, in Today, with no Bot turn; a spoken one still goes to the Bot", async () => {
  const { handlers, loops, posts } = setup();
  const typed = await handlers["loops.add"]!({ text: "Buy stamps" });
  expect(typed).toMatchObject({ title: "Buy stamps", owner: "patrick", status: "surfaced", kind: "do" });
  expect(posts).toEqual([]);
  expect((await handlers["loops.list"]!({})).needsYouNow.map((l: { id: string }) => l.id)).toEqual([typed.id]);
  expect(loops.store.history(typed.id).map((e) => e.type)).toEqual(["added_by_you"]);
  expect(loops.scheduler.held()).toEqual([]);
  const spoken = await loops.add("Call the vet");
  expect(spoken).toMatchObject({ owner: "cos", status: "in_progress" });
  expect(posts).toEqual([`Fill in draft todo ${spoken.id} from this typed line using todos_update, then queue it: "Call the vet"`]);
});

function legacy(target: Database.Database) {
  const loop = (id: string, over: Record<string, unknown>) => ({ id, title: id, why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "queued", due: null, area: null, createdAt: NOW - 9000, updatedAt: NOW - 8000, closedAt: null, closedBy: null, ...over });
  const loops = [
    loop("loop_reminder_aut_1", { title: "Take the bins out", source: { kind: "automation", ref: "aut_1" }, owner: "cos", trigger: { type: "time", at: NOW + 3600000 } }),
    loop("loop_a", { status: "surfaced", push: true, priority: "urgent", due: NOW - 1 }),
    loop("loop_b", { status: "snoozed", trigger: { type: "time", at: NOW + 7200000 } }),
    loop("loop_c", { kind: "decide", options: ["Yes", "No"], status: "done", closedAt: NOW - 100, closedBy: "patrick" }),
    loop("loop_d", { kind: "waiting", trigger: { type: "event", event: "reply:sam", label: "when Sam replies" } }),
    loop("loop_e", { owner: "thread:thr_a", status: "in_progress", area: "Work" }),
    loop("loop_f", { kind: "read", status: "dropped", closedAt: NOW - 50, closedBy: "cos" }),
    loop("loop_g", { trigger: { type: "place", place: "home", direction: "arrive" } }),
  ];
  for (const l of loops) target.prepare("INSERT INTO bot_loops VALUES (?, ?)").run(l.id, JSON.stringify(l));
  target.prepare("INSERT INTO bot_loops VALUES (?, ?)").run("loop_broken", JSON.stringify({ id: "loop_broken", title: "" }));
  const event = target.prepare("INSERT INTO loop_events (loop_id, type, at, data) VALUES (?, ?, ?, ?)");
  event.run("loop_a", "surfaced", NOW - 500, "{}");
  event.run("loop_c", "closed", NOW - 100, JSON.stringify({ action: "choose", option: "Yes" }));
  event.run("loop_a", "notified", NOW - 400, "{}");
  event.run("loop_gone", "closed", NOW - 1, "{}");
  const card = (id: string, over: Record<string, unknown>) => ({ id, threadId: "thr_lead", title: id, kind: "worker", state: "running", step: null, line: null, needs: null, workerThreadId: "thr_w", messageId: "m_1", messageSeq: 3, createdAt: NOW - 9000, updatedAt: NOW - 8000, finishedAt: null, stale: false, dismissedAt: null, ...over });
  const cards = [
    card("wc_run", {}),
    card("wc_need", { state: "needs-you", needs: "Approve", kind: "release", workerThreadId: null }),
    card("wc_wait", { state: "waiting", kind: "lead", workerThreadId: null }),
    card("wc_done", { state: "done", finishedAt: NOW - 10, dismissedAt: NOW - 5 }),
    card("wc_ended", { state: "done", stale: true, finishedAt: NOW - 20 }),
    card("wc_fail", { state: "failed", finishedAt: NOW - 30, kind: "task" }),
  ];
  const { stale: _s, dismissedAt: _d, ...old } = card("wc_old", { kind: "todo", workerThreadId: null });
  for (const c of [...cards, old]) target.prepare("INSERT INTO work_cards (id, thread_id, record, finished_at) VALUES (?, ?, ?, ?)").run(c.id, c.threadId, JSON.stringify(c), c.finishedAt);
  return { loops, cards };
}

it("on a fresh database adopts nothing and takes no backup", () => {
  dir = mkdtempSync(join(tmpdir(), "tasks-fresh-"));
  const file = new Database(join(dir, "data.db"));
  migrate(file);
  expect(migrateToTasks(file)).toEqual({ backup: null, adopted: { loops: 0, cards: 0, events: 0 }, skipped: [], orphanEvents: 0 });
  expect(readdirSync(dir).filter((name) => name.includes("before-tasks"))).toEqual([]);
  file.close();
});

it("backs up first, adopts every todo and card with its id and history, and reads each back unchanged", () => {
  dir = mkdtempSync(join(tmpdir(), "tasks-full-"));
  const path = join(dir, "data.db");
  const file = new Database(path);
  migrate(file);
  const { loops } = legacy(file);
  const report = migrateToTasks(file);
  expect(report.backup).toBe(backupPath(path, NOW));
  expect(existsSync(report.backup!)).toBe(true);
  const copy = new Database(report.backup!, { readonly: true });
  expect(copy.prepare("SELECT count(*) AS n FROM bot_loops").get()).toEqual({ n: 9 });
  expect(copy.prepare("SELECT count(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  copy.close();
  expect(report.adopted).toEqual({ loops: 8, cards: 7, events: 3 });
  expect(report.skipped).toEqual([{ id: "loop_broken", source: "loop", reason: expect.stringContaining("") }]);
  expect(report.orphanEvents).toBe(1);
  expect(verifyTaskMigration(file).filter((p) => p.id !== "loop_broken")).toEqual([]);
  const store = new LoopStore(file);
  expect(store.get("loop_reminder_aut_1").trigger).toEqual(loops[0]!.trigger);
  expect(store.get("loop_b")).toMatchObject({ status: "snoozed", trigger: { type: "time", at: NOW + 7200000 } });
  expect(store.history("loop_a").map((e) => e.type)).toEqual(["surfaced", "notified"]);
  expect(new TaskStore(file).get("loop_a")).toMatchObject({ owner: "patrick", state: "todo", attention: { queue: "surfaced", push: true } });
  expect(new TaskStore(file).get("loop_d")).toMatchObject({ state: "waiting", kind: "waiting-outside" });
  expect(new TaskStore(file).get("wc_need")).toMatchObject({ owner: "patrick", state: "waiting", needs: "Approve" });
  expect(new WorkCardStore(file).get("wc_old")).toMatchObject({ stale: false, dismissedAt: null, kind: "todo" });
  file.close();
});

it("is idempotent: a second run adopts nothing, takes no backup and keeps tasks changed since; later rows are adopted", () => {
  dir = mkdtempSync(join(tmpdir(), "tasks-twice-"));
  const file = new Database(join(dir, "data.db"));
  migrate(file);
  legacy(file);
  migrateToTasks(file);
  new LoopStore(file).update("loop_a", { title: "Changed since" });
  const before = file.prepare("SELECT id, record FROM tasks ORDER BY id").all();
  const events = file.prepare("SELECT count(*) AS n FROM task_events").get();
  vi.setSystemTime(NOW + 60000);
  const again = migrateToTasks(file);
  expect(again).toMatchObject({ backup: null, adopted: { loops: 0, cards: 0, events: 0 } });
  expect(again.skipped.map((s) => s.id)).toEqual(["loop_broken"]);
  expect(file.prepare("SELECT id, record FROM tasks ORDER BY id").all()).toEqual(before);
  expect(file.prepare("SELECT count(*) AS n FROM task_events").get()).toEqual(events);
  expect(readdirSync(dir).filter((name) => name.includes("before-tasks"))).toHaveLength(1);
  const late = { id: "loop_late", title: "Seeded later", why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "queued", due: null, area: null, createdAt: NOW, updatedAt: NOW, closedAt: null, closedBy: null };
  file.prepare("INSERT INTO bot_loops VALUES (?, ?)").run(late.id, JSON.stringify(late));
  const third = migrateToTasks(file);
  expect(third.adopted.loops).toBe(1);
  expect(third.backup).toBe(backupPath(join(dir, "data.db"), NOW + 60000));
  expect(new LoopStore(file).get("loop_late")).toEqual(late);
  file.close();
});

it("reports counts before and after for the dry run", () => {
  legacy(db);
  migrateToTasks(db, { backup: false });
  expect(summarizeTaskMigration(db)).toEqual({
    before: {
      loops: { total: 9, status: { queued: 3, surfaced: 1, snoozed: 1, done: 1, in_progress: 1, dropped: 1, undefined: 1 }, kind: { do: 5, decide: 1, waiting: 1, read: 1, undefined: 1 }, owner: { cos: 1, patrick: 6, thread: 1, undefined: 1 }, trigger: { time: 2, none: 4, event: 1, place: 1, undefined: 1 } },
      cards: { total: 7, state: { running: 2, "needs-you": 1, waiting: 1, done: 1, "done (ended)": 1, failed: 1 }, kind: { worker: 3, release: 1, lead: 1, task: 1, todo: 1 }, dismissed: 1 },
      loopEvents: 4,
    },
    after: {
      total: 15,
      byOrigin: { loop: 8, work: 7 },
      state: { "loop:todo": 4, "loop:done": 1, "loop:waiting": 1, "loop:in_progress": 1, "loop:dropped": 1, "work:in_progress": 2, "work:waiting": 2, "work:done": 2, "work:failed": 1 },
      kind: { do: 12, decide: 1, "waiting-outside": 1, read: 1 },
      owner: { cos: 1, patrick: 7, thread: 7 },
      queue: { queued: 4, surfaced: 1, null: 10 },
      timeTriggers: 2,
      needsYou: 1,
      taskEvents: 3,
    },
  });
});

it("starts an agent's task in progress, under Agents on it, never in the user's Later", async () => {
  const { call, handlers, work } = setup();
  const mine = (await call("task_create", { title: "Fix the build", owner: "me" })).task;
  const bots = (await call("task_create", { title: "Renew the domain", owner: "cos" })).task;
  const carded = (await call("task_create", { title: "Release", owner: "me", card: true })).task;
  for (const t of [mine, bots, carded]) expect(t).toMatchObject({ state: "in_progress", attention: { queue: null } });
  const list = await handlers["loops.list"]!({});
  expect(list.agentsOnIt.map((l: { id: string }) => l.id).sort()).toEqual([mine.id, bots.id, carded.id].sort());
  expect(list.comingUp).toEqual([]);
  expect(work.store.get(carded.id).state).toBe("running");
  expect((await call("task_create", { title: "Later", owner: "cos", state: "todo", trigger: { type: "time", at: NOW + 1000 } })).task).toMatchObject({ state: "todo", attention: { queue: "queued" } });
});

it("puts a task for the user that waits on them in Today, with or without a card, and shows one needs-you", async () => {
  const { call, handlers, posts, work } = setup();
  const asked = await call("task_create", { title: "Approve the budget", owner: "user", state: "waiting", needs: "Say yes or no" });
  expect(asked.task.attention.queue).toBe("surfaced");
  expect(posts).toEqual([`Please post this card in your chat exactly once: ::loop{id="${asked.task.id}"}`]);
  const carded = (await call("task_create", { title: "Ship", owner: "me", card: true })).task;
  await call("task_handoff", { id: carded.id, to: "user", needs: "Approve the push" });
  expect(posts).toHaveLength(1);
  const today = (await handlers["loops.list"]!({})).needsYouNow.map((l: { id: string }) => l.id);
  expect(today.sort()).toEqual([asked.task.id, carded.id].sort());
  expect(work.store.get(carded.id).state).toBe("needs-you");
  const todo = (await call("task_create", { title: "Read it", owner: "user", card: true })).task;
  expect(todo.attention.queue).toBe("surfaced");
  expect(work.store.get(todo.id).state).toBe("waiting");
});

it("doesn't count hand-offs against the daily budget", async () => {
  const { call, loops } = setup();
  for (let i = 0; i < 6; i++) await call("task_handoff", { id: (await call("task_create", { title: `H${i}`, owner: "cos" })).task.id, to: "user" });
  loops.store.add({ title: "Due now" });
  const scheduler = new LoopScheduler(loops.store, () => ({ enabled: true, timeZone: "UTC", dailyBudget: 5, quietStart: 22, quietEnd: 7 }), async () => {}, async () => {});
  expect(scheduler.held()).toEqual([]);
  expect(db.prepare("SELECT count(*) AS n FROM task_events WHERE type = 'surfaced'").get()).toEqual({ n: 0 });
});

it("re-shows a cleared card when a task tool reopens it or hands it to the user, and revives an ended one", async () => {
  const { call, work } = setup();
  const card = work.create({ title: "Build", threadId: "thr_lead" }).card;
  work.update(card.id, { state: "done" });
  expect(work.store.clearFinished("thr_lead")).toBe(1);
  expect((await work.list("thr_lead")).cards).toEqual([]);
  await call("task_update", { id: card.id, state: "in_progress" });
  expect((await work.list("thr_lead")).cards.map((c) => c.id)).toEqual([card.id]);
  work.store.dismiss(card.id);
  await call("task_handoff", { id: card.id, to: "user", needs: "Look" });
  expect((await work.list("thr_lead")).cards.map((c) => [c.id, c.state])).toEqual([[card.id, "needs-you"]]);
  const ended = work.create({ title: "Worker", kind: "worker", threadId: "thr_lead", workerThreadId: "thr_w" }).card;
  work.store.markStale(ended.id);
  expect(await call("task_update", { id: ended.id, line: "Back at it" })).toMatchObject({ state: "in_progress", stale: false });
  expect(work.store.get(ended.id)).toMatchObject({ state: "running", stale: false, line: "Back at it" });
});

it("checks triggers like todos do: incomplete ones refused, place names lower-cased", async () => {
  const { call } = setup();
  expect((await call("task_create", { title: "X", owner: "user", trigger: { type: "time" } })).error).toMatch(/incomplete/);
  const t = (await call("task_create", { title: "Plumber", owner: "user", trigger: { type: "place", place: "Home", direction: "arrive" } })).task;
  expect(t.timing.trigger.place).toBe("home");
  expect((await call("task_update", { id: t.id, trigger: { type: "event" } })).error).toMatch(/incomplete/);
});

it("shows a clear error in Todos, In flight and the tools when adoption failed, instead of empty lists", async () => {
  const { call, handlers, tools } = setup();
  markTasksUnavailable(db, "disk I/O error");
  await expect(Promise.resolve().then(() => handlers["loops.list"]!({}))).rejects.toThrow(/^Tasks could not be loaded\. Nothing was lost\. Restart BB Studio to try again\.$/);
  await expect(Promise.resolve().then(() => handlers["work.list"]!({ threadId: "thr_lead" }))).rejects.toThrow(/Tasks could not be loaded/);
  await expect(Promise.resolve().then(() => handlers["loops.add"]!({ text: "x" }))).rejects.toThrow(/Tasks could not be loaded/);
  await expect(Promise.resolve().then(() => tools.todos_list!.execute({}, {}))).rejects.toThrow(/Tasks could not be loaded: disk I\/O error\. Nothing was lost/);
  await expect(Promise.resolve().then(() => tools.work_card_get!.execute({ id: "wc_x" }, {}))).rejects.toThrow(/Tasks could not be loaded/);
  expect((await call("task_list", {})).error).toMatch(/Tasks could not be loaded/);
});

it("adopts even when the backup fails, says why, and leaves the file in the way alone", () => {
  dir = mkdtempSync(join(tmpdir(), "tasks-nobackup-"));
  const path = join(dir, "data.db");
  const file = new Database(path);
  migrate(file);
  legacy(file);
  writeFileSync(backupPath(path, NOW), "someone else's file");
  const report = migrateToTasks(file);
  expect(report.backup).toBeNull();
  expect(report.backupError).toMatch(/already exists/);
  expect(report.adopted).toMatchObject({ loops: 8, cards: 7 });
  expect(readFileSync(backupPath(path, NOW), "utf8")).toBe("someone else's file");
  file.close();
});

it("keeps the first backup and the two newest", () => {
  dir = mkdtempSync(join(tmpdir(), "tasks-prune-"));
  const path = join(dir, "data.db");
  const older = [1, 2, 3, 4].map((day) => backupPath(path, NOW - day * 86400000));
  for (const old of older) writeFileSync(old, "old");
  writeFileSync(join(dir, "data.other.db"), "keep");
  const file = new Database(path);
  migrate(file);
  legacy(file);
  const report = migrateToTasks(file);
  const left = readdirSync(dir).filter((name) => name.includes("before-tasks")).sort();
  expect(left).toHaveLength(KEEP_BACKUPS);
  expect(left).toEqual([older[3], older[0], report.backup].map((p) => p!.slice(dir!.length + 1)).sort());
  expect(existsSync(join(dir, "data.other.db"))).toBe(true);
  file.close();
});

it.each([
  ["every row", "BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END"],
  ["some rows", "BEFORE INSERT ON tasks WHEN NEW.id IN ('loop_c', 'wc_done') BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END"],
])("when %s can't be written: adopts nothing, takes no backup, and shows the error until a start succeeds", async (_case, trigger) => {
  dir = mkdtempSync(join(tmpdir(), "tasks-fail-"));
  const path = join(dir, "data.db");
  const file = new Database(path);
  migrate(file);
  legacy(file);
  file.exec(`CREATE TRIGGER tasks_full ${trigger}`);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  expect(adoptAtStart(file, log)).toBeNull();
  expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/adopting todos and work cards failed.*disk is full/));
  expect(file.prepare("SELECT (SELECT count(*) FROM tasks) + (SELECT count(*) FROM task_legacy) + (SELECT count(*) FROM task_events) AS n").get()).toEqual({ n: 0 });
  expect(readdirSync(dir).filter((name) => name.includes("before-tasks"))).toEqual([]);
  const { bb, handlers } = fakeBb();
  registerLoops(bb as never, file, async () => {}, async () => {}, { get: async () => ({}), onChange: () => {} }, () => "UTC", () => {});
  registerWorkCards(bb as never, file, { read: async () => ({ rows: [] }) });
  await expect(Promise.resolve().then(() => handlers["loops.list"]!({}))).rejects.toThrow(/^Tasks could not be loaded\. Nothing was lost/);
  await expect(Promise.resolve().then(() => handlers["work.list"]!({ threadId: "thr_lead" }))).rejects.toThrow(/Tasks could not be loaded/);
  expect(adoptAtStart(file, log)).toBeNull();
  expect(readdirSync(dir).filter((name) => name.includes("before-tasks"))).toEqual([]);
  file.exec("DROP TRIGGER tasks_full");
  const fixed = new Database(path);
  const moved = adoptAtStart(fixed, log);
  expect(moved).toMatchObject({ adopted: { loops: 8, cards: 7, events: 3 } });
  expect(moved!.backup).not.toBeNull();
  expect(verifyTaskMigration(fixed).filter((p) => p.id !== "loop_broken")).toEqual([]);
  fixed.close();
  file.close();
});

it("lists a task for the user in the morning card with an id its card draws", async () => {
  const { call, loops } = setup();
  const { task } = await call("task_create", { title: "Sign the lease", owner: "user", due: NOW });
  const morning = new LoopScheduler(loops.store, () => ({ enabled: true, timeZone: "UTC", dailyBudget: 5, quietStart: 22, quietEnd: 7 }), async () => {}, async () => {}).morning();
  expect(morning.items.map((l) => l.id)).toEqual([task.id]);
  expect(TODO_ID.test(task.id)).toBe(true);
  expect(TODO_ID.test("loop_reminder_aut_1")).toBe(true);
  expect(TODO_ID.test("wc_1")).toBe(false);
});

it("names a deeper cycle as one", async () => {
  const { call } = setup();
  const top = (await call("task_create", { title: "Top", owner: "cos" })).task;
  const sub = (await call("task_create", { title: "Sub", owner: "cos", parentId: top.id })).task;
  expect((await call("task_update", { id: top.id, parentId: top.id })).error).toMatch(/its own parent/);
  expect((await call("task_update", { id: top.id, parentId: sub.id })).error).toMatch(/own subtasks/);
});

it("a card needs the user only when its task does: a running worker card doesn't, a question handed over or the user's own list item does", async () => {
  const { call } = setup();
  const { cardNeedsUser } = await import("./store");
  const store = new TaskStore(db);
  const running = (await call("task_create", { title: "Build", owner: "me", card: true })).task;
  expect(cardNeedsUser(store.find(running.id), "work")).toBe(false);
  const asked = (await call("task_handoff", { id: running.id, to: "user", needs: "Approve" })).task;
  expect(cardNeedsUser(store.find(asked.id), "work")).toBe(true);
  const mine = (await call("task_create", { title: "Call mom", owner: "user" })).task;
  expect(cardNeedsUser(store.find(mine.id), "loop")).toBe(true);
  expect(cardNeedsUser(null, "work")).toBe(true);
});
