import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { registerLoops } from "../loops/register";
import { rpcContract as loopsContract } from "../loops/contract";
import { registerWorkCards } from "../work/register";
import { registerTasks } from "./register";
import { addTodo, withTaskTools, withWorkTools } from "./test/tools";
import { tasksContract } from "./rpc-contract";
import { guardTasks, markTasksUnavailable } from "./store";
import { handedBy, inFlightOrder, phoneActs, registerUserTasks } from "./user";
import type { Task } from "./contract";

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

function setup({ sendFails = false } = {}) {
  const tools: Record<string, Tool> = {};
  const handlers: Record<string, (input: any) => any> = {};
  const bb = {
    realtime: { publish: vi.fn() }, log: { warn: vi.fn(), info: vi.fn() }, onDispose: vi.fn(),
    agents: { registerTool: (tool: Tool) => { tools[tool.name] = tool; } },
    ui: { registerMentionProvider: vi.fn() },
    rpc: { register: (_contract: unknown, map: typeof handlers) => Object.assign(handlers, map) },
    sdk: { threads: { get: async () => null, update: vi.fn(async () => ({})), timeline: vi.fn(async () => ({ rows: [] })) } },
  };
  const posts: string[] = [];
  const sent: { threadId: string; text: string }[] = [];
  const post = async (text: string) => { posts.push(text); };
  const loops = registerLoops(bb as never, db, post, () => "UTC");
  withWorkTools(tools, db, registerWorkCards(bb as never, db, { read: async () => ({ rows: [] }), thread: async () => ({ status: "active" }) }));
  const agent = withTaskTools(tools, db, registerTasks(bb as never, db, post));
  const titles: Record<string, string> = { thr_worker: "Fix the flaky test", thr_lead: "Larkspur lead", thr_main: "Main", thr_old: "Old worker" };
  const user = registerUserTasks(bb as never, db, {
    post,
    send: async (threadId, text) => { if (sendFails) throw new Error("thread is gone"); sent.push({ threadId, text }); },
    thread: async (id) => (titles[id] ? { title: titles[id], archivedAt: id === "thr_old" ? NOW : null } : null),
    loopAct: (x) => loops.actDirect(x),
    reopenLoop: (id) => loops.store.update(id, { status: "surfaced" }),
    snoozeLoopUntil: (id, at) => loops.store.update(id, { status: "snoozed", trigger: { type: "time", at } }),
    held: () => [],
  });
  loops.routeActs(phoneActs(user));
  const tool = async (name: string, input: unknown, threadId = "thr_worker") => JSON.parse(await tools[name]!.execute(input, { threadId }));
  return { handlers, tools, posts, sent, loops, agent, user, tool };
}

it("registers get, list, inFlight and act, and none of them is in the phone's contract", () => {
  const { handlers } = setup();
  for (const method of Object.keys(tasksContract)) expect(handlers[method]).toBeTypeOf("function");
  for (const method of Object.keys(tasksContract)) expect(Object.keys(loopsContract)).not.toContain(method);
});

it("hands the user's own task to the Bot: owner, state, history, and one message in Main with the task", async () => {
  const { handlers, posts, loops } = setup();
  const todo = addTodo(db, "Renew the passport");
  const out = await handlers["tasks.act"]!({ id: todo.id, action: "hand_off", to: "cos" });
  expect(out.task).toMatchObject({ owner: "cos", state: "in_progress", attention: { queue: null } });
  expect(out.note).toBeNull();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatch(/^The user handed you a task: "Renew the passport" \(loop_[^)]+\).*Report in your chat as you go; when you need the user, tell them there and call bot_needs_you\./);
  const view = await handlers["tasks.get"]!({ id: todo.id });
  expect(view.history.map((e: { type: string }) => e.type)).toEqual(["added_by_you", "handed_off", "state"]);
  expect(JSON.parse(view.history[1].data)).toMatchObject({ owner: "cos", from: "patrick", by: "patrick" });
  expect(loops.store.get(todo.id).status).toBe("in_progress");
});

it("hands a task to a worker thread directly, and through the Bot when that thread can't be reached", async () => {
  const ok = setup();
  const a = addTodo(db, "Look into the CI cache");
  await ok.handlers["tasks.act"]!({ id: a.id, action: "hand_off", to: "thread:thr_worker" });
  expect(ok.sent).toEqual([{ threadId: "thr_worker", text: expect.stringContaining("Look into the CI cache") }]);
  expect(ok.posts).toEqual([]);
  db.close(); db = new Database(":memory:"); for (const sql of MIGRATIONS.filter(Boolean)) db.exec(sql);
  const down = setup({ sendFails: true });
  const b = addTodo(db, "Look into the CI cache");
  const out = await down.handlers["tasks.act"]!({ id: b.id, action: "hand_off", to: "thread:thr_worker" });
  expect(out.task.owner).toBe("thread:thr_worker");
  expect(down.posts).toEqual([expect.stringMatching(/Look into the CI cache[\s\S]*could not be reached, so pass this on to it\.$/)]);
});

it("refuses a hand-off of a closed task and a hand-off to the user through act", async () => {
  const { handlers } = setup();
  const todo = addTodo(db, "Call the bank");
  await handlers["tasks.act"]!({ id: todo.id, action: "done" });
  await expect(handlers["tasks.act"]!({ id: todo.id, action: "hand_off", to: "cos" })).rejects.toThrow(/closed/);
  expect(() => tasksContract["tasks.act"].input.parse({ id: todo.id, action: "hand_off", to: "patrick" })).toThrow();
});

it("takes a task back from an agent: it lands in Today as the user's and the agent is told to stop", async () => {
  const { handlers, tool, sent } = setup();
  const { task } = await tool("task_create", { title: "Draft the release notes", owner: "me", card: true, step: "2/4 Draft", line: "Writing the intro" });
  const out = await handlers["tasks.act"]!({ id: task.id, action: "take_back" });
  expect(out.task).toMatchObject({ owner: "patrick", state: "todo", attention: { queue: "surfaced" }, progress: { step: null, line: null } });
  expect(sent).toEqual([{ threadId: "thr_worker", text: expect.stringMatching(/took task "Draft the release notes".*back to do it themselves\. Stop working on it/) }]);
});

it("an agent hands a decision to the user; choosing hands it back to that agent with the choice", async () => {
  const { handlers, tool, sent } = setup();
  const { task } = await tool("task_create", { title: "Pick a backup provider", owner: "me", card: true });
  await tool("task_handoff", { id: task.id, to: "user", needs: "Which provider?", options: ["Backblaze", "Wasabi"] });
  const handed = await handlers["tasks.get"]!({ id: task.id });
  expect(handed.task).toMatchObject({ owner: "patrick", state: "waiting", kind: "decide", needs: "Which provider?" });
  expect(handedBy(handed.history)).toBe("thread:thr_worker");
  const out = await handlers["tasks.act"]!({ id: task.id, action: "choose", option: "Wasabi" });
  expect(out.task).toMatchObject({ owner: "thread:thr_worker", state: "in_progress", needs: null, kind: "do", options: [], progress: { line: "Chose: Wasabi" } });
  expect(sent.at(-1)).toEqual({ threadId: "thr_worker", text: expect.stringMatching(/chose "Wasabi" for task "Pick a backup provider"/) });
  await expect(handlers["tasks.act"]!({ id: task.id, action: "choose", option: "Nope" })).rejects.toThrow(/existing option/);
});

it("Done on a task an agent handed over closes it and tells that agent", async () => {
  const { handlers, tool, sent } = setup();
  const { task } = await tool("task_create", { title: "Sign the DMG", owner: "me", card: true });
  await tool("task_handoff", { id: task.id, to: "user", needs: "Touch the YubiKey" });
  const out = await handlers["tasks.act"]!({ id: task.id, action: "done" });
  expect(out.task).toMatchObject({ state: "done", closedBy: "patrick" });
  expect(sent.at(-1)!.text).toMatch(/^The user finished task "Sign the DMG"/);
});

it("closes and reopens a work card's task, and won't snooze one", async () => {
  const { handlers, tools } = setup();
  const made = JSON.parse(await tools.work_card_create!.execute({ title: "Release 1.0.6", kind: "release", state: "needs-you", needs: "Approve" }, { threadId: "thr_main" }));
  const id = made.id as string;
  await expect(handlers["tasks.act"]!({ id, action: "snooze", snooze: "tonight" })).rejects.toThrow(/own to-dos/);
  expect((await handlers["tasks.act"]!({ id, action: "done" })).task.state).toBe("done");
  expect((await handlers["tasks.act"]!({ id, action: "reopen" })).task).toMatchObject({ state: "todo", owner: "patrick" });
  expect((await handlers["tasks.get"]!({ id })).todo).toBe(false);
});

it("snoozes a todo to a picked time, and Undo reopens a closed one into Today", async () => {
  const { handlers } = setup();
  const todo = addTodo(db, "Water the plants");
  const at = NOW + 3_600_000;
  const snoozed = await handlers["tasks.act"]!({ id: todo.id, action: "snooze", at });
  expect(snoozed.task.timing).toMatchObject({ snoozed: true, trigger: { type: "time", at } });
  await handlers["tasks.act"]!({ id: todo.id, action: "done" });
  expect((await handlers["tasks.act"]!({ id: todo.id, action: "reopen" })).task).toMatchObject({ state: "todo", attention: { queue: "surfaced" }, needs: null });
});

it("orders In flight: needs you, the user's, agents', then finished newest first", () => {
  const t = (id: string, patch: Partial<Task>) => ({ id, owner: "cos", state: "in_progress", kind: "do", createdAt: 1, closedAt: null, ...patch }) as Task;
  const order = inFlightOrder([t("a", { state: "done", closedAt: 5 }), t("b", {}), t("c", { owner: "patrick", state: "todo" }), t("d", { owner: "patrick", state: "waiting" }), t("e", { state: "done", closedAt: 9 })]);
  expect(order.map((x) => x.id)).toEqual(["d", "c", "b", "e", "a"]);
});

it("lists open tasks of every origin and the last week's done ones, with thread names and holds", async () => {
  const { handlers, tool, tools } = setup();
  addTodo(db, "Mine");
  await tool("task_create", { title: "Agent's", owner: "me" });
  JSON.parse(await tools.work_card_create!.execute({ title: "A card", kind: "worker" }, { threadId: "thr_main" }));
  const old = addTodo(db, "Old done");
  await handlers["tasks.act"]!({ id: old.id, action: "done" });
  vi.setSystemTime(NOW + 8 * 86_400_000);
  const fresh = addTodo(db, "Fresh done");
  await handlers["tasks.act"]!({ id: fresh.id, action: "done" });
  const out = await handlers["tasks.list"]!({});
  expect(out.tasks.map((t: Task) => t.title).sort()).toEqual(["A card", "Agent's", "Fresh done", "Mine"]);
  expect(out.held).toEqual([]);
  expect(tasksContract["tasks.list"].output.parse(out)).toBeTruthy();
});

it("says tasks can't be shown without the database's own error, and the tools keep the reason", async () => {
  const { handlers, tools } = setup();
  markTasksUnavailable(db, "SQLITE_FULL: database or disk is full");
  await expect(Promise.resolve().then(() => handlers["tasks.list"]!({}))).rejects.toThrow(/^Tasks could not be loaded\. Nothing was lost\. Restart BB Studio to try again\.$/);
  await expect(Promise.resolve().then(() => handlers["tasks.inFlight"]!({ threadId: "thr_main" }))).rejects.toThrow(/^Tasks could not be loaded\./);
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
  await handlers["tasks.act"]!({ id: task.id, action: "hand_off", to: "thread:thr_worker" });
  await handlers["tasks.act"]!({ id: task.id, action: "take_back" });
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

it("handing on an agent's task tells the agent that had it to stop", async () => {
  const { handlers, tool, sent, posts } = setup();
  const { task } = await tool("task_create", { title: "Run the build", owner: "me" });
  await handlers["tasks.act"]!({ id: task.id, action: "hand_off", to: "cos" });
  expect(posts).toEqual([expect.stringMatching(/^The user handed you a task: "Run the build"/)]);
  expect(sent).toEqual([{ threadId: "thr_worker", text: expect.stringMatching(/handed task "Run the build".* to the Bot\. Stop working on it/) }]);
});

it("handing on a question an agent asked tells that agent who has it now", async () => {
  const { handlers, tool, sent } = setup();
  const { task } = await tool("task_create", { title: "Pick a db", owner: "me" });
  await tool("task_handoff", { id: task.id, to: "user", needs: "Which one?", options: ["A", "B"] });
  await handlers["tasks.act"]!({ id: task.id, action: "hand_off", to: "thread:thr_lead" });
  expect(sent.find((m) => m.threadId === "thr_worker")!.text).toMatch(/handed your question on task "Pick a db".* to the thread "Larkspur lead" \(thread:thr_lead\).*Don't wait/);
  expect(sent.find((m) => m.threadId === "thr_lead")!.text).toMatch(/^The user handed you a task/);
});

it("take back, then choose: the choice goes to the agent that asked, the Bot gets nothing", async () => {
  const { handlers, tool, sent, posts } = setup();
  const { task } = await tool("task_create", { title: "Pick the tone", owner: "me" });
  await tool("task_handoff", { id: task.id, to: "user", needs: "Which tone?", options: ["Formal", "Friendly"] });
  await handlers["tasks.act"]!({ id: task.id, action: "hand_off", to: "cos" });
  await handlers["tasks.act"]!({ id: task.id, action: "take_back" });
  expect(handedBy((await handlers["tasks.get"]!({ id: task.id })).history)).toBe("thread:thr_worker");
  posts.length = 0; sent.length = 0;
  const out = await handlers["tasks.act"]!({ id: task.id, action: "choose", option: "Friendly" });
  expect(out.task).toMatchObject({ owner: "thread:thr_worker", state: "in_progress", progress: { line: "Chose: Friendly" } });
  expect(sent).toEqual([{ threadId: "thr_worker", text: expect.stringMatching(/chose "Friendly" for task "Pick the tone"/) }]);
  expect(posts).toEqual([]);
});

it("Done on an agent's task tells it; its later update keeps the task closed unless it reopens on purpose; Undo tells it again", async () => {
  const { handlers, tool, sent } = setup();
  const { task } = await tool("task_create", { title: "Draft the notes", owner: "me", card: true });
  const done = await handlers["tasks.act"]!({ id: task.id, action: "done" });
  expect(done.task).toMatchObject({ state: "done", closedBy: "patrick" });
  expect(sent.at(-1)).toEqual({ threadId: "thr_worker", text: expect.stringMatching(/finished task "Draft the notes".*Stop working on it, and don't reopen it unless they ask\./) });
  const kept = await tool("task_update", { id: task.id, state: "in_progress", line: "Still polishing" });
  expect(kept).toMatchObject({ state: "done", progress: { line: null }, note: expect.stringMatching(/stays closed and your update went only into its history/) });
  expect((await handlers["tasks.get"]!({ id: task.id })).history.at(-1)).toMatchObject({ type: "progress", data: expect.stringContaining("Still polishing") });
  expect((await tool("task_update", { id: task.id, state: "in_progress", reopen: true })).state).toBe("in_progress");
  await handlers["tasks.act"]!({ id: task.id, action: "drop" });
  expect(sent.at(-1)!.text).toMatch(/^The user dismissed task/);
  const undone = await handlers["tasks.act"]!({ id: task.id, action: "reopen" });
  expect(undone.task.state).toBe("in_progress");
  expect(sent.at(-1)!.text).toMatch(/^The user reopened task "Draft the notes"/);
});

it("a work card the user closed stays closed when the worker updates it", async () => {
  const { handlers, tools } = setup();
  const made = JSON.parse(await tools.work_card_create!.execute({ title: "Release 1.0.7", kind: "release" }, { threadId: "thr_main" }));
  await handlers["tasks.act"]!({ id: made.id, action: "done" });
  const card = JSON.parse(await tools.work_card_update!.execute({ id: made.id, state: "running", step: "5/5", line: "Back on it" }, { threadId: "thr_main" }));
  expect(card).toMatchObject({ state: "done", step: null, line: null, note: expect.stringMatching(/stays closed/) });
  const kept = (await handlers["tasks.get"]!({ id: made.id })).history.at(-1);
  expect(kept).toMatchObject({ type: "progress", data: expect.stringContaining("Back on it") });
  expect(JSON.parse(kept.data)).toMatchObject({ by: "thread:thr_main", kept: true });
});

it("a choice made on the phone or from a push goes back to the agent that asked, like the desktop's", async () => {
  const { handlers, tool, sent } = setup();
  const { task } = await tool("task_create", { title: "Pick a provider", owner: "me" });
  await tool("task_handoff", { id: task.id, to: "user", options: ["Backblaze", "Wasabi"] });
  const loop = await handlers["loops.act"]!({ id: task.id, action: "choose", option: "Wasabi" });
  expect(loop).toMatchObject({ owner: "thread:thr_worker", status: "in_progress" });
  expect(sent.at(-1)).toEqual({ threadId: "thr_worker", text: expect.stringMatching(/chose "Wasabi"/) });
  const own = addTodo(db, "Mine");
  expect(await handlers["loops.act"]!({ id: own.id, action: "done" })).toMatchObject({ status: "done" });
});

it("refuses a hand-off to a thread that is gone or archived, and leaves the owner as it was", async () => {
  const { handlers } = setup();
  const todo = addTodo(db, "Look into it");
  await expect(handlers["tasks.act"]!({ id: todo.id, action: "hand_off", to: "thread:thr_old" })).rejects.toThrow(/gone or archived/);
  await expect(handlers["tasks.act"]!({ id: todo.id, action: "hand_off", to: "thread:thr_missing" })).rejects.toThrow(/gone or archived/);
  expect((await handlers["tasks.get"]!({ id: todo.id })).task.owner).toBe("patrick");
});

it("a bad history row doesn't break acting on the task", async () => {
  const { handlers } = setup();
  const todo = addTodo(db, "Odd history");
  db.prepare("INSERT INTO task_events (task_id, type, at, data) VALUES (?, 'handed_off', ?, '{not json')").run(todo.id, NOW);
  expect((await handlers["tasks.act"]!({ id: todo.id, action: "done" })).task.state).toBe("done");
});

it("Undo on a work card the user owned brings it back as To do, without an empty Needs you", async () => {
  const { handlers, tools } = setup();
  const made = JSON.parse(await tools.work_card_create!.execute({ title: "Approve", kind: "release", state: "needs-you", needs: "Approve" }, { threadId: "thr_main" }));
  await handlers["tasks.act"]!({ id: made.id, action: "done" });
  const back = await handlers["tasks.act"]!({ id: made.id, action: "reopen" });
  expect(back.task).toMatchObject({ owner: "patrick", state: "todo", needs: null });
});

it("turns a runtime database error into a plain message for the UI and logs the database's own", async () => {
  const log = vi.fn();
  const failing = guardTasks(db, { boom: () => { const e = new Error("SQLITE_BUSY: database is locked"); e.name = "SqliteError"; throw e; }, other: async () => { throw new Error("Task x not found"); } }, false, log);
  expect(() => failing.boom()).toThrow(/^Tasks couldn't be read or saved just now/);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("database is locked"));
  await expect(failing.other()).rejects.toThrow("Task x not found");
});

it("Done then Undo on a question an agent asked brings the question back to Today, and tells the agent", async () => {
  const { handlers, tools, sent } = setup();
  const made = JSON.parse(await tools.work_card_create!.execute({ title: "Settings polish", kind: "lead", workerThreadId: "thr_lead" }, { threadId: "thr_main" }));
  await tools.work_card_update!.execute({ id: made.id, state: "needs-you", needs: "Reset or Restore defaults?" }, { threadId: "thr_main" });
  await handlers["tasks.act"]!({ id: made.id, action: "done" });
  const back = await handlers["tasks.act"]!({ id: made.id, action: "reopen" });
  expect(back.task).toMatchObject({ owner: "patrick", state: "waiting", needs: "Reset or Restore defaults?", attention: { queue: "surfaced" } });
  expect(sent.at(-1)).toEqual({ threadId: "thr_lead", text: expect.stringMatching(/reopened task "Settings polish".*Your question is back with them/) });
});

it("Done then Undo on a decision an agent asked keeps its options and its place in Today", async () => {
  const { handlers, tool } = setup();
  const { task } = await tool("task_create", { title: "Pick a venue", owner: "me" });
  await tool("task_handoff", { id: task.id, to: "user", needs: "Which venue?", options: ["Taco Lab", "Noodle Bar"] });
  await handlers["tasks.act"]!({ id: task.id, action: "done" });
  const back = await handlers["tasks.act"]!({ id: task.id, action: "reopen" });
  expect(back.task).toMatchObject({ owner: "patrick", state: "waiting", kind: "decide", options: ["Taco Lab", "Noodle Bar"], needs: "Which venue?", attention: { queue: "surfaced" } });
});

it("an older phone's push buttons work on a work card's task: loops.get reads it, and loops.act choose, done and snooze go through", async () => {
  const { handlers, tools, sent } = setup();
  const made = JSON.parse(await tools.work_card_create!.execute({ title: "Release 2.1", kind: "release" }, { threadId: "thr_main" }));
  await tools.task_handoff!.execute({ id: made.id, to: "user", needs: "Ship today or Monday?", options: ["Today", "Monday"] }, { threadId: "thr_worker" });
  expect((await handlers["loops.get"]!({ id: made.id })).loop).toMatchObject({ id: made.id, title: "Release 2.1", owner: "patrick", kind: "decide", options: ["Today", "Monday"] });
  const snoozed = await handlers["loops.act"]!({ id: made.id, action: "snooze", snooze: "tonight" });
  expect(snoozed).toMatchObject({ id: made.id, owner: "patrick" });
  const chose = await handlers["loops.act"]!({ id: made.id, action: "choose", option: "Monday" });
  expect(chose).toMatchObject({ id: made.id, owner: "thread:thr_main", status: "in_progress" });
  expect(sent.at(-1)).toEqual({ threadId: "thr_main", text: expect.stringMatching(/chose "Monday"/) });
  const other = JSON.parse(await tools.work_card_create!.execute({ title: "Release 2.2", kind: "release", state: "needs-you", needs: "Touch the key" }, { threadId: "thr_main" }));
  const done = await handlers["loops.act"]!({ id: other.id, action: "done" });
  expect(done).toMatchObject({ id: other.id, status: "done" });
  await expect(handlers["loops.get"]!({ id: "wc_missing" })).rejects.toThrow(/not found/i);
});

it("an older phone's push buttons work on task_ ids, in the todo list or not", async () => {
  const { handlers, tool, sent } = setup();
  const { task } = await tool("task_create", { title: "Pick a provider", owner: "me", card: true, conversation: "thr_lead" });
  await tool("task_handoff", { id: task.id, to: "user", options: ["Backblaze", "Wasabi"] });
  expect(await handlers["loops.act"]!({ id: task.id, action: "choose", option: "Wasabi" })).toMatchObject({ owner: "thread:thr_worker", status: "in_progress" });
  expect(sent.at(-1)).toEqual({ threadId: "thr_worker", text: expect.stringMatching(/chose "Wasabi"/) });
  const { task: plain } = await tool("task_create", { title: "Renew the domain", owner: "user" });
  expect(await handlers["loops.act"]!({ id: plain.id, action: "snooze", snooze: "tonight" })).toMatchObject({ status: "snoozed" });
  expect(await handlers["loops.act"]!({ id: plain.id, action: "done" })).toMatchObject({ status: "done" });
});

it("Start work: handing a queued task to the owner it already has starts it and tells that owner; a running one stays as it is", async () => {
  const { handlers, tool, sent } = setup();
  const { task } = await tool("task_create", { title: "Desktop leftovers", owner: "thread:thr_lead", state: "todo" });
  expect(task).toMatchObject({ owner: "thread:thr_lead", state: "todo" });
  const out = await handlers["tasks.act"]!({ id: task.id, action: "hand_off", to: "thread:thr_lead" });
  expect(out.task).toMatchObject({ owner: "thread:thr_lead", state: "in_progress" });
  expect(out.note).toBeNull();
  expect(sent).toEqual([{ threadId: "thr_lead", text: expect.stringMatching(/^The user asked you to start task "Desktop leftovers".* now\. Report in your chat as you go/) }]);
  const view = await handlers["tasks.get"]!({ id: task.id });
  expect(view.history.some((e: { type: string; data: string }) => e.type === "acted" && JSON.parse(e.data).action === "start")).toBe(true);
  sent.length = 0;
  const again = await handlers["tasks.act"]!({ id: task.id, action: "hand_off", to: "thread:thr_lead" });
  expect(again.task.state).toBe("in_progress");
  expect(sent).toEqual([]);
});
