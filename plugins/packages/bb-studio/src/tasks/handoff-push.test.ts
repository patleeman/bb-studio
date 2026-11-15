import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { registerLoops } from "../loops/register";
import type { Loop } from "../loops/contract";
import { registerWorkCards } from "../work/register";
import { handoffPush, loopPushInput } from "./handoff-push";
import { registerTasks } from "./register";
import { cardNeedsUser, TaskStore } from "./store";
import { registerUserTasks } from "./user";

const NOW = new Date("2026-11-15T15:00:00Z").getTime();
let db: Database.Database;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
});
afterEach(() => { db.close(); vi.useRealTimers(); });

type Tool = { name: string; execute(input: unknown, ctx: unknown): Promise<string> };
function setup({ quiet = false } = {}) {
  const tools: Record<string, Tool> = {};
  const handlers: Record<string, (input: any) => any> = {};
  const bb = {
    realtime: { publish: vi.fn() }, log: { warn: vi.fn(), info: vi.fn() }, onDispose: vi.fn(),
    agents: { registerTool: (tool: Tool) => { tools[tool.name] = tool; } },
    ui: { registerMentionProvider: vi.fn() },
    rpc: { register: (_contract: unknown, map: typeof handlers) => Object.assign(handlers, map) },
    sdk: { threads: { get: async () => null, update: vi.fn(async () => ({})), timeline: vi.fn(async () => ({ rows: [] })), send: vi.fn(async () => ({})) } },
  };
  const pushes: ReturnType<typeof loopPushInput>[] = [];
  const store = new TaskStore(db);
  const push = async (loop: Loop) => { pushes.push(loopPushInput(loop, { id: "bot_main", threadId: "thr_main" }, store.find(loop.id)?.conversation ?? null, "proj_personal")); };
  const loops = registerLoops(bb as never, db, async () => {}, push, { get: async () => ({ loopsEnabled: true }), onChange: () => {} }, () => "UTC", () => {});
  const moved = handoffPush({ db, enabled: () => true, quiet: () => quiet, push });
  registerWorkCards(bb as never, db, { read: async () => ({ rows: [] }), thread: async () => ({ status: "active" }), moved });
  registerTasks(bb as never, db, async () => {}, async () => {}, moved);
  registerUserTasks(bb as never, db, {
    post: async () => {}, send: async () => {}, thread: async (id) => ({ title: id, archivedAt: null }) as never,
    loopAct: (x) => loops.actDirect(x), reopenLoop: () => {}, snoozeLoopUntil: () => {}, held: () => [],
  });
  const tool = async (name: string, input: unknown, threadId = "thr_worker") => JSON.parse(await tools[name]!.execute(input, { threadId }));
  const card = (id: string, kind: "work" | "loop") => cardNeedsUser(store.find(id), kind, store.history(id));
  return { tool, handlers, pushes, loops, store, card };
}

it("a hand-off to the user pushes once, with the task's conversation, and the Bot's card reply that follows doesn't push again", async () => {
  const { tool, pushes, card, loops } = setup();
  const { task } = await tool("task_create", { title: "Pick a launch date", owner: "me", card: true, conversation: "thr_release" });
  expect(pushes).toEqual([]);
  await tool("task_handoff", { id: task.id, to: "user", needs: "Pick a date", options: ["Tue", "Thu"] });
  await Promise.resolve();
  expect(pushes).toEqual([expect.objectContaining({ loopId: task.id, category: "BB_LOOP", conversationId: "thr_release", threadId: "thr_main", loopKind: "decide", options: ["Tue", "Thu"] })]);
  expect(card(task.id, "work")).toBe(false);
  await tool("task_update", { id: task.id, line: "Waiting on the date", priority: "urgent", push: true });
  await loops.scheduler.tick();
  expect(pushes).toHaveLength(1);
  await tool("task_update", { id: task.id, state: "in_progress" });
  await tool("task_handoff", { id: task.id, to: "user", needs: "Pick again" });
  await Promise.resolve();
  expect(pushes).toHaveLength(2);
});

it("a task made waiting for the user and a work card going needs-you push once each; the scheduler adds none", async () => {
  const { tool, pushes, loops } = setup();
  const { task } = await tool("task_create", { title: "Approve the copy", owner: "user", state: "waiting", needs: "Approve it", priority: "urgent", push: true });
  const made = await tool("work_card_create", { title: "Release 2.1", kind: "release" }, "thr_main");
  await tool("work_card_update", { id: made.id, state: "needs-you", needs: "Touch the YubiKey" }, "thr_main");
  await tool("work_card_update", { id: made.id, step: "4/5" }, "thr_main");
  await Promise.resolve();
  expect(pushes.map((p) => [p.loopId, p.conversationId])).toEqual([[task.id, "thr_main"], [made.id, "thr_main"]]);
  await loops.scheduler.tick();
  expect(pushes).toHaveLength(2);
});

it("no push for an agent's own task, a hand-on between agents, or the user's take-back; a quiet-hours hand-off waits for the scheduler", async () => {
  const { tool, handlers, pushes, store } = setup();
  const { task } = await tool("task_create", { title: "Fix the flaky test", owner: "me" });
  await tool("task_handoff", { id: task.id, to: "cos" });
  await handlers["tasks.act"]!({ id: task.id, action: "take_back" });
  await Promise.resolve();
  expect(pushes).toEqual([]);
  const quiet = setup({ quiet: true });
  const { task: late } = await quiet.tool("task_create", { title: "Sign the form", owner: "me" });
  await quiet.tool("task_handoff", { id: late.id, to: "user", needs: "Sign it" });
  expect(quiet.pushes).toEqual([]);
  expect(store.get(late.id).attention.push).toBe(true);
});
