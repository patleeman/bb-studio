import Database from "better-sqlite3";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { migratedSqlDb, migratedSqlFileDb } from "../test/migrated-db";
import { registerLoops } from "../loops/register";
import { registerWorkCards } from "../work/register";
import { checkTasks } from "./check";
import type { Task } from "./contract";
import { applyLinks, linkAtStart, planLinks, SPAWN_GRACE_MS, ThreadDirectory, type ThreadFact } from "./links";
import { retireAgentTasks } from "./retire";
import { registerTasks } from "./register";
import { withTaskTools, withWorkTools } from "./test/tools";
import { boardRows, dayStart } from "./rows";
import { SpawnLinks } from "./spawn";
import { TaskStore } from "./store";
import { registerUserTasks } from "./user";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
let db: Database.Database;
let dir: string | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = migratedSqlDb();
});
afterEach(() => {
  if (db.open) db.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
  vi.useRealTimers();
});

const fact = (id: string, patch: Partial<ThreadFact> = {}): ThreadFact => ({ id, parentThreadId: null, title: id, status: "idle", archivedAt: null, deletedAt: null, createdAt: NOW - 3_600_000, updatedAt: NOW - 600_000, ...patch });

function seedThreads(target: Database.Database, threads: ThreadFact[]) {
  target.prepare("INSERT OR IGNORE INTO bots (id, name, avatar, state, thread_id, created_at, updated_at) VALUES ('bot_main', 'Chief', 'x', 'active', NULL, 0, 0)").run();
  target.prepare("INSERT OR REPLACE INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('proj_personal', 'thr_main', 0, 0)").run();
  const insert = target.prepare("INSERT OR REPLACE INTO bot_threads (thread_id, bot_id, kind, is_main, owner_conversation_id, title, source, created_at, updated_at) VALUES (?, 'bot_main', ?, ?, ?, ?, 'created', 0, 0)");
  const byId = new Map(threads.map((t) => [t.id, t]));
  const ownerOf = (t: ThreadFact): string | null => {
    let at = t.parentThreadId ? byId.get(t.parentThreadId) : undefined;
    while (at?.parentThreadId) at = byId.get(at.parentThreadId);
    return at?.id ?? null;
  };
  for (const t of threads) insert.run(t.id, t.parentThreadId ? "worker" : "conversation", t.id === "thr_main" ? 1 : 0, t.parentThreadId ? ownerOf(t) : null, t.title);
}

const THREADS = [
  fact("thr_main", { title: "Main" }),
  fact("thr_lead", { title: "Larkspur lead" }),
  fact("thr_w1", { parentThreadId: "thr_lead", title: "Build the phone app", status: "active" }),
  fact("thr_w2", { parentThreadId: "thr_lead", title: "Review the build" }),
  fact("thr_w3", { parentThreadId: "thr_lead", title: "Fix the keyboard", status: "active" }),
];

type Tool = { name: string; execute(input: unknown, ctx: unknown): Promise<string> };

function setup(threads: ThreadFact[] = THREADS) {
  seedThreads(db, threads);
  const facts = new Map(threads.map((t) => [t.id, t]));
  const tools: Record<string, Tool> = {};
  const handlers: Record<string, (input: any) => any> = {};
  const bb = {
    realtime: { publish: vi.fn() }, log: { warn: vi.fn(), info: vi.fn() }, onDispose: vi.fn(),
    agents: { registerTool: (tool: Tool) => { tools[tool.name] = tool; } },
    ui: { registerMentionProvider: vi.fn() },
    rpc: { register: (_contract: unknown, map: typeof handlers) => Object.assign(handlers, map) },
    sdk: { threads: { get: async ({ threadId }: { threadId: string }) => facts.get(threadId) ?? null, update: vi.fn(async () => ({})), timeline: vi.fn(async () => ({ rows: [] })) } },
  };
  const posts: string[] = [];
  const post = async (text: string) => { posts.push(text); };
  const loops = registerLoops(bb as never, db, post, () => "UTC");
  const work = withWorkTools(tools, db, registerWorkCards(bb as never, db, { read: async () => ({ rows: [] }), thread: async () => ({ status: "active" }) }));
  const later: (() => void)[] = [];
  const store = new TaskStore(db);
  const links = new SpawnLinks({ store, dir: new ThreadDirectory(db), thread: async (id) => facts.get(id) ?? null, later: (_ms, fn) => { later.push(fn); } });
  let user: ReturnType<typeof registerUserTasks> | null = null;
  const agent = withTaskTools(tools, db, registerTasks(bb as never, db, post, async () => {}, () => {}, { links, check: async () => (await user!.check()).problems }));
  user = registerUserTasks(bb as never, db, {
    post, send: async () => {}, thread: async (id) => (facts.get(id) ?? null) as never,
    loopAct: (x) => loops.actDirect(x), reopenLoop: () => null, snoozeLoopUntil: () => null, held: () => [],
    zone: () => "UTC", facts: async () => [...facts.values()],
  });
  const tool = async (name: string, input: unknown, threadId = "thr_lead") => {
    const out = await tools[name]!.execute(input, { threadId });
    if (out.startsWith("Error")) throw new Error(out);
    return JSON.parse(out);
  };
  const ctx = () => ({ since: dayStart(Date.now(), "UTC"), dir: new ThreadDirectory(db) });
  return { tools, handlers, tool, store, links, later, agent, user: user!, work, facts, ctx, posts };
}

const ids = (rows: { id: string; under: string | null }[]) => rows.map((r) => (r.under ? `  ${r.id}` : r.id));

it("says what a waiting task waits on: the user, the outside, or what the agent names", async () => {
  const { tool } = setup();
  const handed = (await tool("task_create", { title: "Approve the plan", owner: "me" })).task;
  const toUser = (await tool("task_handoff", { id: handed.id, to: "user", needs: "Approve" })).task;
  expect(toUser.waitingOn).toEqual({ kind: "user", ref: null, text: null });
  const outside = (await tool("task_create", { title: "Wait for the vendor", owner: "user", kind: "waiting-outside", state: "waiting" })).task;
  expect(outside.waitingOn).toMatchObject({ kind: "outside" });
  const vague = await tool("task_create", { title: "Wait for CI", owner: "me", state: "waiting" });
  expect(vague.task.waitingOn).toBeNull();
  expect(vague.note).toMatch(/waitingOn/);
  const ci = await tool("task_update", { id: vague.task.id, waitingOn: { kind: "ci", ref: "run 4411" } });
  expect(ci.waitingOn).toEqual({ kind: "ci", ref: "run 4411", text: null });
  expect(ci.note).toBeUndefined();
  const moving = await tool("task_update", { id: vague.task.id, state: "in_progress" });
  expect(moving.waitingOn).toBeNull();
});

it("sets the conversation once, where the task started, and a subtask takes its parent's", async () => {
  const { tool } = setup();
  const job = (await tool("task_create", { title: "Ship the phone build", owner: "me", conversation: "thr_main" })).task;
  const moved = await tool("task_update", { id: job.id, conversation: "thr_lead" });
  expect(moved.conversation).toBe("thr_main");
  expect(moved.note).toMatch(/set once/);
  const sub = (await tool("task_create", { title: "Build it", owner: "thread:thr_w1", parentId: job.id })).task;
  expect(sub.conversation).toBe("thr_main");
  const loose = (await tool("task_create", { title: "Loose", owner: "me" })).task;
  expect((await tool("task_update", { id: loose.id, conversation: "thr_main" })).conversation).toBe("thr_main");
});

it("binds a spawned worker to the task its lead makes for it, and the worker's progress lands there", async () => {
  const { tool, store } = setup();
  const job = (await tool("task_create", { title: "Ship the phone build", owner: "me", conversation: "thr_main" })).task;
  const sub = (await tool("task_create", { title: "Build the app", owner: "thread:thr_w1", workers: ["thr_w1"], parentId: job.id })).task;
  const update = await tool("task_update", { id: sub.id, step: "2/4 Building", line: "Compiling" }, "thr_w1");
  expect(update.progress).toEqual({ step: "2/4 Building", line: "Compiling" });
  expect(store.get(sub.id).workers).toEqual(["thr_w1"]);
  expect(store.get(job.id).workers).toEqual([]);
});

it("joins a worker to the task it first updates when it has none yet, and only then", async () => {
  const { tool, store } = setup();
  const job = (await tool("task_create", { title: "Review the build", owner: "me", conversation: "thr_main" })).task;
  const first = await tool("task_update", { id: job.id, step: "1/2 Reading" }, "thr_w2");
  expect(first.note).toMatch(/joined task/);
  expect(store.get(job.id).workers).toEqual(["thr_w2"]);
  const other = (await tool("task_create", { title: "Something else", owner: "me" })).task;
  await tool("task_update", { id: other.id, line: "Peeked" }, "thr_w2");
  expect(store.get(other.id).workers).toEqual([]);
  const fromConversation = (await tool("task_create", { title: "Main's", owner: "cos" })).task;
  await tool("task_update", { id: fromConversation.id, line: "hi" }, "thr_main");
  expect(store.get(fromConversation.id).workers).toEqual([]);
});

it("a worker's own task_create binds it when it has no task", async () => {
  const { tool } = setup();
  const own = (await tool("task_create", { title: "Fix the keyboard", owner: "me" }, "thr_w3")).task;
  expect(own.workers).toEqual(["thr_w3"]);
  const second = (await tool("task_create", { title: "A side note", owner: "me" }, "thr_w3")).task;
  expect(second.workers).toEqual([]);
});

it("drops the made-up task when the lead names the worker's real task, so the worker is on one task", async () => {
  const { tool, links, store, user } = setup();
  const made = links.ensure(fact("thr_w3", { parentThreadId: "thr_lead", status: "active", title: "Fix the keyboard" }))!;
  expect(made.state).toBe("in_progress");
  const real = (await tool("task_create", { title: "Keyboard covers Send", owner: "thread:thr_w3", workers: ["thr_w3"], conversation: "thr_main" })).task;
  expect(store.get(made.id)).toMatchObject({ state: "dropped", workers: [] });
  expect((await user.board()).rows.map((r) => r.id)).toEqual([real.id]);
  expect((await user.check()).problems.map((p) => [p.kind, p.threadId])).toEqual([["worker-without-task", "thr_w1"]]);
});

it("closes a made-up task when its worker goes idle and reopens it when the worker runs again", () => {
  const { links, store } = setup();
  const made = links.ensure(fact("thr_w1", { parentThreadId: "thr_lead", status: "active" }))!;
  links.settled("thr_w1");
  expect(store.get(made.id)).toMatchObject({ state: "done", progress: { line: "Its thread finished without a report" } });
  links.resumed("thr_w1");
  expect(store.get(made.id)).toMatchObject({ state: "in_progress", progress: { line: null } });
  const idle = links.ensure(fact("thr_w2", { parentThreadId: "thr_lead", status: "idle" }))!;
  expect(idle).toMatchObject({ state: "done", closedAt: NOW - 600_000, closedBy: "thread:thr_w2" });
});

it("a worker card for a worker that has a task draws that task instead of making a second one", async () => {
  const { tool, tools, store } = setup();
  const sub = (await tool("task_create", { title: "Build the app", owner: "thread:thr_w1", workers: ["thr_w1"], conversation: "thr_main" })).task;
  const before = store.all().length;
  const card = JSON.parse(await tools.work_card_create!.execute({ title: "Phone build", kind: "worker", workerThreadId: "thr_w1" }, { threadId: "thr_main" }));
  expect(card.id).toBe(sub.id);
  expect(store.all()).toHaveLength(before);
  expect(store.get(sub.id).card).toMatchObject({ kind: "worker" });
  const again = JSON.parse(await tools.work_card_create!.execute({ title: "Phone build", kind: "worker", workerThreadId: "thr_w1" }, { threadId: "thr_main" }));
  expect(again.id).toBe(sub.id);
  const named = (await tool("task_create", { title: "Plain", owner: "me", conversation: "thr_main" })).task;
  const drawn = JSON.parse(await tools.work_card_create!.execute({ title: "x", taskId: named.id }, { threadId: "thr_main" }));
  expect(drawn.id).toBe(named.id);
  const lead = JSON.parse(await tools.work_card_create!.execute({ title: "Lead card", kind: "lead", workerThreadId: "thr_lead" }, { threadId: "thr_main" }));
  expect(lead.id).toMatch(/^wc_/);
  await expect(tools.work_card_create!.execute({ title: "x", taskId: "loop_abc" }, { threadId: "thr_main" })).rejects.toThrow(/Only a task_ or wc_ task/);
});

it("nests a worker's own task under the lead's task that lists the same worker (rule 2), live", async () => {
  const { tool, tools, store, user } = setup();
  const card = JSON.parse(await tools.work_card_create!.execute({ title: "iOS build", kind: "worker", workerThreadId: "thr_w1" }, { threadId: "thr_main" }));
  const workerCard = store.get(card.id);
  expect(workerCard.owner).toBe("thread:thr_w1");
  const lead = (await tool("task_create", { title: "TestFlight", owner: "me", card: true, conversation: "thr_main", workers: ["thr_w1", "thr_w2"] })).task;
  expect(store.get(card.id).parentId).toBe(lead.id);
  const flight = await user.flight("thr_main");
  expect(ids(flight.rows)).toEqual([lead.id, `  ${card.id}`]);
  expect(flight.rows[0]!.workers).toEqual(["thr_w2"]);
  expect(flight.rows[1]!.workers).toEqual(["thr_w1"]);
  expect(flight.counts).toMatchObject({ open: 1, workers: 2 });
  expect(store.history(card.id).some((e) => e.type === "linked")).toBe(true);
});

it("ends 'done today' at the user's own midnight", () => {
  const at = new Date("2026-11-14T03:30:00Z").getTime();
  expect(new Date(dayStart(at, "America/New_York")).toISOString()).toBe("2026-11-13T05:00:00.000Z");
  expect(new Date(dayStart(at, "UTC")).toISOString()).toBe("2026-11-14T00:00:00.000Z");
  expect(new Date(dayStart(at, "Not/AZone")).toISOString()).toBe("2026-11-14T00:00:00.000Z");
});

it("task_check answers through the tool", async () => {
  const { tools } = setup();
  const out = JSON.parse(await tools.task_check!.execute({}, { threadId: "thr_main" }));
  expect(out.summary).toMatch(/2 problems found; nothing was changed/);
  expect(out.problems.map((p: { threadId: string }) => p.threadId).sort()).toEqual(["thr_w1", "thr_w3"]);
});

function seedTonight(store: TaskStore) {
  const base = (id: string, patch: Partial<Task>): Task => ({
    id, title: id, why: "", owner: "cos", state: "done", kind: "do", options: [], needs: null, priority: "normal", conversation: "thr_main", project: null, area: null,
    timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: null, push: false }, progress: { step: null, line: null }, workers: [], outputs: [],
    source: null, parentId: null, schedule: null, card: null, automation: null, waitingOn: null, stale: false, origin: "task", createdAt: NOW - 9 * 3_600_000, updatedAt: NOW - 3_600_000,
    closedAt: NOW - 3_600_000, closedBy: "cos", ...patch,
  });
  store.write(base("wc_ios", { title: "iOS build: phase 4", owner: "thread:thr_w1", workers: ["thr_w1"], card: { kind: "worker", messageId: null, messageSeq: null, dismissedAt: null }, origin: "work" }));
  store.write(base("task_tf", { title: "TestFlight: new room", owner: "thread:thr_lead", workers: ["thr_w1", "thr_w2", "thr_w3"], card: { kind: "task", messageId: null, messageSeq: null, dismissedAt: null } }));
  store.write(base("task_review", { title: "Fresh review", owner: "thread:thr_w2", workers: ["thr_w2"], parentId: "task_tf" }));
  store.write(base("task_phone", { title: "Phone: tasks as cards", owner: "thread:thr_w1", workers: ["thr_w1"], parentId: "task_tf", createdAt: NOW - 8 * 3_600_000 }));
  store.write(base("wc_lead", { title: "Lead card", owner: "thread:thr_lead", workers: ["thr_lead"], card: { kind: "lead", messageId: null, messageSeq: null, dismissedAt: null }, origin: "work" }));
  store.write(base("task_old_a", { title: "Reused worker, job A", owner: "thread:thr_w4", workers: ["thr_w4"], closedAt: NOW - 9 * 86_400_000 }));
  store.write(base("task_old_b", { title: "Reused worker, job B", owner: "thread:thr_w4", workers: ["thr_w4"], closedAt: NOW - 8 * 86_400_000 }));
  store.write(base("task_x", { title: "Shared X", owner: "cos", workers: ["thr_w5"], state: "in_progress", closedAt: null, closedBy: null }));
  store.write(base("task_y", { title: "Shared Y", owner: "thread:thr_lead", workers: ["thr_w5"], state: "in_progress", closedAt: null, closedBy: null }));
  store.write(base("task_z", { title: "Its own", owner: "thread:thr_w5", workers: ["thr_w5"], state: "in_progress", closedAt: null, closedBy: null }));
}

const MIGRATION_THREADS = [
  ...THREADS.map((t) => (t.id === "thr_w1" || t.id === "thr_w3" ? { ...t, status: "idle" } : t)),
  fact("thr_w4", { parentThreadId: "thr_lead", title: "Reused worker" }),
  fact("thr_w5", { parentThreadId: "thr_lead", title: "Shared worker", status: "active" }),
  fact("thr_w6", { parentThreadId: "thr_lead", title: "Worker with no task", status: "active" }),
  fact("thr_w7", { parentThreadId: "thr_w6", title: "Its helper, finished", updatedAt: NOW - 86_400_000 }),
  fact("thr_gone", { parentThreadId: "thr_lead", title: "Archived", archivedAt: NOW - 1000 }),
  fact("thr_new", { parentThreadId: "thr_lead", title: "Just spawned", status: "active", createdAt: NOW - 5_000 }),
];

it("migration on a fresh database does nothing and takes no backup", () => {
  dir = mkdtempSync(join(tmpdir(), "task-links-"));
  db.close();
  db = migratedSqlFileDb(join(dir, "data.db"));
  const report = linkAtStart(new TaskStore(db), [], new ThreadDirectory(db));
  expect(report).toMatchObject({ pairs: [], drops: [], create: [], created: [], backup: null });
  expect(readdirSync(dir).filter((n) => n.includes(".before-"))).toEqual([]);
});

it("migration on a populated database: one backup, tonight's pair nested, no task made for a running worker, ambiguity left alone; a second run changes nothing", () => {
  dir = mkdtempSync(join(tmpdir(), "task-links-"));
  db.close();
  db = migratedSqlFileDb(join(dir, "data.db"));
  seedThreads(db, MIGRATION_THREADS);
  const store = new TaskStore(db);
  seedTonight(store);
  const threads = new ThreadDirectory(db);
  const ctx = { since: dayStart(NOW, "UTC"), dir: threads };
  const before = checkTasks(store.all(), MIGRATION_THREADS, ctx);
  expect(before.map((p) => [p.kind, p.threadId]).sort()).toEqual([["shown-twice", "thr_w5"], ["worker-without-task", "thr_w6"]]);

  const report = linkAtStart(store, MIGRATION_THREADS, threads);
  expect(report.backup).toBeTruthy();
  expect(existsSync(report.backup!)).toBe(true);
  expect(report.pairs.map((p) => [p.parent, p.child, p.thread])).toEqual([["task_phone", "wc_ios", "thr_w1"]]);
  expect(store.get("wc_ios").parentId).toBe("task_phone");
  expect(store.get("task_review").parentId).toBe("task_tf");
  expect(store.get("wc_lead").parentId).toBeNull();
  expect(report.ambiguous.map((a) => [a.thread, a.tasks.sort()])).toEqual([["thr_w4", ["task_old_a", "task_old_b"]], ["thr_w5", ["task_x", "task_y", "task_z"].sort()]]);
  for (const id of ["task_old_a", "task_old_b", "task_x", "task_y", "task_z"]) expect(store.get(id).parentId).toBeNull();
  // Strands replaced tasks: a running worker gets no task (one would be an open agent task the next start closes again).
  expect(report.create).toEqual([]);
  expect(report.created).toEqual([]);
  expect(store.all().some((t) => t.workers.includes("thr_w6") || t.workers.includes("thr_w7"))).toBe(false);
  expect(store.history("wc_ios").map((e) => e.type)).toEqual(["linked"]);

  const rows = boardRows(store.all(), { ...ctx, since: 0 }).rows;
  const tonight = rows.filter((r) => ["task_tf", "task_review", "task_phone", "wc_ios"].includes(r.id));
  expect(tonight.map((r) => [r.id, r.under, r.depth])).toEqual([["task_tf", null, 0], ["task_phone", "task_tf", 1], ["wc_ios", "task_phone", 2], ["task_review", "task_tf", 1]]);
  expect(tonight.map((r) => r.workers)).toEqual([["thr_w3"], [], ["thr_w1"], ["thr_w2"]]);
  expect(rows.filter((r) => r.under === null).map((r) => r.id)).not.toContain("wc_ios");
  expect(rows.filter((r) => r.id === "wc_ios")).toHaveLength(1);

  const after = checkTasks(store.all(), MIGRATION_THREADS, ctx);
  expect(after.map((p) => [p.kind, p.threadId]).sort()).toEqual([["shown-twice", "thr_w5"], ["worker-without-task", "thr_w6"]]);

  const snapshot = JSON.stringify(store.all());
  const events = db.prepare("SELECT COUNT(*) AS n FROM task_events").get();
  const second = linkAtStart(store, MIGRATION_THREADS, threads);
  expect(second).toMatchObject({ pairs: [], drops: [], created: [], backup: null });
  expect(JSON.stringify(store.all())).toBe(snapshot);
  expect(db.prepare("SELECT COUNT(*) AS n FROM task_events").get()).toEqual(events);
  expect(readdirSync(dir).filter((n) => n.includes(".before-task-links-"))).toHaveLength(1);

  vi.setSystemTime(NOW + SPAWN_GRACE_MS);
  const third = linkAtStart(store, MIGRATION_THREADS, threads);
  expect(third).toMatchObject({ create: [], created: [], backup: null });
  expect(JSON.stringify(store.all())).toBe(snapshot);
});

it("after the move to strands, a start with workers still running makes no agent task, so the next start closes nothing and takes no backup", () => {
  dir = mkdtempSync(join(tmpdir(), "task-links-"));
  db.close();
  db = migratedSqlFileDb(join(dir, "data.db"));
  seedThreads(db, MIGRATION_THREADS);
  const store = new TaskStore(db);
  seedTonight(store);
  expect(retireAgentTasks(db).backup).toBeTruthy();
  vi.setSystemTime(NOW + SPAWN_GRACE_MS);
  for (let start = 0; start < 3; start++) {
    linkAtStart(store, MIGRATION_THREADS, new ThreadDirectory(db));
    expect(retireAgentTasks(db)).toEqual({ closed: [], backup: null, backupError: null, pruned: [] });
  }
  expect(readdirSync(dir).filter((n) => n.includes(".before-strands-"))).toHaveLength(1);
});

it("migration plans without writing, and a failed backup still links", () => {
  seedThreads(db, MIGRATION_THREADS);
  const store = new TaskStore(db);
  seedTonight(store);
  const snapshot = JSON.stringify(store.all());
  const plan = planLinks(store.all(), MIGRATION_THREADS, new ThreadDirectory(db), NOW);
  expect(plan.pairs).toHaveLength(1);
  expect(JSON.stringify(store.all())).toBe(snapshot);
  const report = applyLinks(store, plan);
  expect(report.backup).toBeNull();
  expect(store.get("wc_ios").parentId).toBe("task_phone");
});

it("never pairs a worker into a cycle and skips runner threads", () => {
  seedThreads(db, MIGRATION_THREADS);
  db.prepare("INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, created_at, updated_at) VALUES ('run_1', 'bot_main', 'Runner', 'job', 'thr_w6', 'proj', 'active', 'daily', '09:00', 0, 0)").run();
  const store = new TaskStore(db);
  seedTonight(store);
  const raw = store.get("task_tf");
  store.write({ ...raw, parentId: "wc_ios" });
  const plan = planLinks(store.all(), MIGRATION_THREADS, new ThreadDirectory(db), NOW);
  expect(plan.pairs.find((p) => p.child === "wc_ios")).toBeUndefined();
  expect(store.get("task_tf").parentId).toBe("wc_ios");
  expect(plan.create).toEqual([]);
});

it("the check also catches one worker on two rows of the same task", async () => {
  const { tool, user } = setup();
  const job = (await tool("task_create", { title: "Ship", owner: "me", conversation: "thr_main" })).task;
  const a = (await tool("task_create", { title: "Part A", owner: "thread:thr_w1", workers: ["thr_w1"], parentId: job.id })).task;
  const b = (await tool("task_create", { title: "Part B", owner: "cos", workers: ["thr_w1"], parentId: job.id })).task;
  await tool("task_create", { title: "Keys", owner: "thread:thr_w3", workers: ["thr_w3"] });
  const problems = (await user.check()).problems;
  expect(problems.map((p) => [p.kind, p.threadId, [...p.taskIds].sort()])).toEqual([["shown-twice", "thr_w1", [a.id, b.id].sort()]]);
  expect(problems[0]!.text).toMatch(/rows of one task/);
});

it("a reused idle worker with a real task never gets its made-up task back (review P1-1)", async () => {
  const { tool, links, store, user } = setup();
  const made = links.ensure(fact("thr_w1", { parentThreadId: "thr_lead", status: "active" }))!;
  links.settled("thr_w1");
  expect(store.get(made.id).state).toBe("done");
  const real = (await tool("task_create", { title: "Second job", owner: "me", conversation: "thr_main", workers: ["thr_w1"] })).task;
  links.resumed("thr_w1");
  expect(store.get(made.id).state).toBe("dropped");
  expect(store.all().filter((t) => t.state !== "dropped" && t.state !== "done" && t.workers.includes("thr_w1")).map((t) => t.id)).toEqual([real.id]);
  const rows = (await user.board()).rows;
  expect(rows.filter((r) => r.workers.includes("thr_w1")).map((r) => r.id)).toEqual([real.id]);
  expect((await user.check()).problems.filter((p) => p.threadId === "thr_w1")).toEqual([]);
});

it("resumed() drops a closed made-up task when a real task appeared some other way, and reopens it when there is none", () => {
  const { links, store } = setup();
  const made = links.ensure(fact("thr_w1", { parentThreadId: "thr_lead", status: "active" }))!;
  links.settled("thr_w1");
  links.resumed("thr_w1");
  expect(store.get(made.id).state).toBe("in_progress");
  links.settled("thr_w1");
  const raw = store.get(made.id);
  store.write({ ...raw, id: "task_real", title: "Real", source: null, state: "in_progress", closedAt: null, closedBy: null });
  links.resumed("thr_w1");
  expect(store.get(made.id).state).toBe("dropped");
});

it("adding a worker to a task nests its own task only when it has exactly one (review P2-2)", async () => {
  const { tool, store } = setup();
  const one = (await tool("task_create", { title: "Own job one", owner: "me" }, "thr_w1")).task;
  const two = (await tool("task_create", { title: "Own job two", owner: "thread:thr_w1" })).task;
  const lead = (await tool("task_create", { title: "Unrelated", owner: "cos", conversation: "thr_main", workers: ["thr_w1"] }, "thr_main")).task;
  expect([store.get(one.id).parentId, store.get(two.id).parentId]).toEqual([null, null]);
  expect(store.get(lead.id).parentId).toBeNull();
});

it("never puts an open worker task under a closed lead task at start (review P3-5)", () => {
  seedThreads(db, THREADS);
  const store = new TaskStore(db);
  const mk = (id: string, patch: Partial<Task>): Task => ({
    id, title: id, why: "", owner: "cos", state: "in_progress", kind: "do", options: [], needs: null, priority: "normal", conversation: "thr_main", project: null, area: null,
    timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: null, push: false }, progress: { step: null, line: null }, workers: [], outputs: [],
    source: null, parentId: null, schedule: null, card: null, automation: null, waitingOn: null, stale: false, origin: "task", createdAt: NOW, updatedAt: NOW, closedAt: null, closedBy: null, ...patch,
  });
  store.write(mk("task_lead_done", { owner: "thread:thr_lead", workers: ["thr_w1"], state: "done", closedAt: NOW - 1000, closedBy: "thread:thr_lead" }));
  store.write(mk("task_own_open", { owner: "thread:thr_w1", workers: ["thr_w1"] }));
  const plan = planLinks(store.all(), THREADS, new ThreadDirectory(db), NOW);
  expect(plan.pairs).toEqual([]);
  expect(plan.ambiguous.map((a) => a.reason)).toEqual(["its open task would go under a closed one"]);
});

it("a thread that owns two jobs is a lead: not drawn as a worker on each, not flagged (review P2-3)", async () => {
  const { tool, user, store } = setup();
  await tool("task_create", { title: "Build", owner: "thread:thr_w1", workers: ["thr_w1"] });
  await tool("task_create", { title: "Keys", owner: "thread:thr_w3", workers: ["thr_w3"] });
  const one = (await tool("task_create", { title: "Lead job one", owner: "thread:thr_w2" }, "thr_main")).task;
  const two = (await tool("task_create", { title: "Lead job two", owner: "thread:thr_w2" }, "thr_main")).task;
  const board = await user.board();
  expect(board.rows.filter((r) => r.id === one.id || r.id === two.id).map((r) => r.workers)).toEqual([[], []]);
  expect((await user.workers()).rows.map((r) => r.id)).not.toContain(one.id);
  expect((await user.check()).problems).toEqual([]);
  const reused = (await tool("task_create", { title: "Earlier", owner: "thread:thr_w1", workers: ["thr_w1"] })).task;
  await tool("task_update", { id: reused.id, state: "done" });
  expect(store.get(reused.id).state).toBe("done");
  expect((await user.check()).problems).toEqual([]);
});

it("a nested spawner with two tasks gives its worker's made-up task no parent (review P3-1)", async () => {
  const threads = [...THREADS, fact("thr_sub", { parentThreadId: "thr_w1", title: "Sub-worker", status: "active" })];
  const { tool, links } = setup(threads);
  await tool("task_create", { title: "A", owner: "cos", workers: ["thr_w1"] }, "thr_main");
  await tool("task_create", { title: "B", owner: "me", workers: ["thr_w1"] });
  const made = links.ensure(threads.at(-1)!)!;
  expect(made.parentId).toBeNull();
});

it("takes the backup even when a live write landed first, and links nothing when the backup fails (review P3-2)", () => {
  dir = mkdtempSync(join(tmpdir(), "task-links-"));
  db.close();
  db = migratedSqlFileDb(join(dir, "data.db"));
  seedThreads(db, MIGRATION_THREADS);
  const store = new TaskStore(db);
  seedTonight(store);
  const links = new SpawnLinks({ store, dir: new ThreadDirectory(db), thread: async () => null });
  links.ensure(fact("thr_w6", { parentThreadId: "thr_lead", status: "active" }));
  const report = linkAtStart(store, MIGRATION_THREADS, new ThreadDirectory(db));
  expect(report.pairs).toHaveLength(1);
  expect(report.backup).toBeTruthy();

  const other = mkdtempSync(join(tmpdir(), "task-links-ro-"));
  const file = join(other, "data.db");
  const second = new Database(file);
  for (const sql of MIGRATIONS.filter(Boolean)) second.exec(sql);
  seedThreads(second, MIGRATION_THREADS);
  const s2 = new TaskStore(second);
  seedTonight(s2);
  const before = JSON.stringify(s2.all());
  chmodSync(other, 0o555);
  try {
    const failed = linkAtStart(s2, MIGRATION_THREADS, new ThreadDirectory(second));
    expect(failed.backupError).toBeTruthy();
    expect(failed.pairs).toEqual([]);
    expect(JSON.stringify(s2.all())).toBe(before);
  } finally {
    chmodSync(other, 0o755);
    second.close();
    rmSync(other, { recursive: true, force: true });
  }
});

it("work_card_create on a made-up task takes the caller's title, and a second call says the card is already posted (review P3-3)", async () => {
  const { tools, links, store } = setup();
  const made = links.ensure(fact("thr_w1", { parentThreadId: "thr_lead", status: "active", title: "thread title" }))!;
  const first = JSON.parse(await tools.work_card_create!.execute({ title: "Phone build", kind: "worker", workerThreadId: "thr_w1" }, { threadId: "thr_main" }));
  expect(first.id).toBe(made.id);
  expect(first.post).toMatch(/Post this line once/);
  expect(store.get(made.id)).toMatchObject({ title: "Phone build", conversation: "thr_main" });
  const again = JSON.parse(await tools.work_card_create!.execute({ title: "Phone build 2", kind: "worker", workerThreadId: "thr_w1" }, { threadId: "thr_main" }));
  expect(again.post).toBeUndefined();
  expect(again.note).toMatch(/already has its card in thread thr_main; don't post it again/);
  expect(store.get(made.id).title).toBe("Phone build");
});

it("starts the user's day at local midnight on daylight-saving days (review P3-6)", () => {
  expect(new Date(dayStart(new Date("2026-11-01T12:00:00Z").getTime(), "America/New_York")).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  expect(new Date(dayStart(new Date("2026-03-08T16:00:00Z").getTime(), "America/New_York")).toISOString()).toBe("2026-03-08T05:00:00.000Z");
  expect(new Date(dayStart(new Date("2026-03-08T04:30:00Z").getTime(), "America/New_York")).toISOString()).toBe("2026-03-07T05:00:00.000Z");
  expect(new Date(dayStart(new Date("2026-10-25T09:00:00Z").getTime(), "Europe/London")).toISOString()).toBe("2026-10-24T23:00:00.000Z");
});

it("finds Main where the Bot keeps it: the personal project's lead, not the bots row, fresh or stale (QA)", async () => {
  const { tool, user } = setup();
  const finding = (await tool("task_create", { title: "Spend went up", owner: "cos" }, "thr_main")).task;
  expect(finding.conversation).toBeNull();
  expect((await user.flight("thr_main")).rows.map((r) => r.id)).toEqual([finding.id]);
  expect((await user.board()).rows.find((r) => r.id === finding.id)!.home).toBe("thr_main");
  db.prepare("UPDATE bots SET thread_id = 'thr_old_main'").run();
  expect((await user.flight("thr_main")).rows.map((r) => r.id)).toEqual([finding.id]);
  expect((await user.flight("thr_old_main")).rows).toEqual([]);
  expect(new ThreadDirectory(db).main()).toBe("thr_main");
  db.prepare("DELETE FROM project_leads").run();
  expect(new ThreadDirectory(db).main()).toBeNull();
});

it("work_card_create for an idle worker whose made-up task closed reopens and draws that task, not a new card (QA note 3)", async () => {
  const { tools, links, store, user } = setup();
  const made = links.ensure(fact("thr_w1", { parentThreadId: "thr_lead", status: "active" }))!;
  links.settled("thr_w1");
  expect(store.get(made.id).state).toBe("done");
  const before = store.all().length;
  const out = JSON.parse(await tools.work_card_create!.execute({ title: "Second round", kind: "worker", workerThreadId: "thr_w1", line: "Starting" }, { threadId: "thr_main" }));
  expect(out.id).toBe(made.id);
  expect(out.post).toMatch(/Post this line once/);
  expect(store.all()).toHaveLength(before);
  expect(store.get(made.id)).toMatchObject({ state: "in_progress", title: "Second round", conversation: "thr_main", closedAt: null, progress: { line: "Starting" }, card: { kind: "worker" } });
  expect(store.history(made.id).map((e) => e.type)).toContain("reopened");
  const rows = (await user.board()).rows.filter((r) => r.workers.includes("thr_w1"));
  expect(rows.map((r) => r.id)).toEqual([made.id]);
  links.settled("thr_w1");
  expect(store.get(made.id).state).toBe("in_progress");
  const real = (await tool2(tools, "task_create", { title: "Real job", owner: "thread:thr_w2", workers: ["thr_w2"] }));
  links.settled("thr_w2");
  const again = JSON.parse(await tools.work_card_create!.execute({ title: "W2 card", kind: "worker", workerThreadId: "thr_w2" }, { threadId: "thr_main" }));
  expect(again.id).toBe(real.task.id);
});

async function tool2(tools: Record<string, Tool>, name: string, input: unknown) {
  return JSON.parse(await tools[name]!.execute(input, { threadId: "thr_lead" }));
}

it("work_card_create never reopens a made-up task the user closed", async () => {
  const { tools, links, store, handlers } = setup();
  const made = links.ensure(fact("thr_w1", { parentThreadId: "thr_lead", status: "active" }))!;
  await handlers["tasks.act"]!({ id: made.id, action: "done" });
  expect(store.get(made.id)).toMatchObject({ state: "done", closedBy: "patrick" });
  const out = JSON.parse(await tools.work_card_create!.execute({ title: "Second round", kind: "worker", workerThreadId: "thr_w1" }, { threadId: "thr_main" }));
  expect(out.id).not.toBe(made.id);
  expect(store.get(made.id)).toMatchObject({ state: "done", closedBy: "patrick", card: null });
});
