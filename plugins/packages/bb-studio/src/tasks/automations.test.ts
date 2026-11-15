import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { registerLoops } from "../loops/register";
import { AutomationTasks, type AutomationTaskDeps, alwaysPrints, CLEAR_AFTER_MS, findingKey, KEEP_RUNS, parentIdOf, readSources, splitControl, URGENT_RUN_NOTE, type AutomationBotInfo } from "./automations";
import { isClosed, type Task } from "./contract";
import { registerTasks } from "./register";
import { TaskStore } from "./store";
import { registerUserTasks } from "./user";
import { inLoopView } from "./views";

const NOW = new Date("2026-11-15T13:00:00Z").getTime();
const HOUR = 3_600_000;
let db: Database.Database;
let dir: string | null = null;
const BOTS: AutomationBotInfo[] = [{ id: "bot_main", name: "Dot", threadId: "thr_main", heartbeatKey: "proj_personal" }];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
});
afterEach(() => {
  if (db.open) db.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
  vi.useRealTimers();
});

const at = (ms: number) => vi.setSystemTime(ms);

function automation(id: string, kind: "checkin" | "watcher" | "reminder", name: string, extra: { state?: string; script?: string; target?: string; schedule?: unknown } = {}) {
  db.prepare(`INSERT INTO bot_automations (id, bot_id, kind, name, instruction, script, interpreter, target, schedule_json, state, project_id, bb_ids, seen_until, created_at, updated_at)
    VALUES (?, 'bot_main', ?, ?, 'Do it', ?, 'bash', ?, ?, ?, 'proj_personal', '[]', 0, ?, ?)`).run(
    id, kind, name, extra.script ?? null, extra.target ?? "main",
    JSON.stringify(extra.schedule ?? (kind === "reminder" ? { type: "once", at: NOW + HOUR } : { type: "times", days: [0, 1, 2, 3, 4, 5, 6], times: ["13:00"], timezone: "America/New_York" })),
    extra.state ?? "active", NOW, NOW);
}

function runner(id: string, name: string, thread: string, state = "active") {
  db.prepare(`INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, cron, automation_id, created_at, updated_at)
    VALUES (?, 'bot_main', ?, 'Sweep', ?, 'proj_personal', ?, 'custom', '09:00', '15 7,12,17,22 * * *', ?, ?, ?)`).run(id, name, thread, state, `trg_runner_${id}`, NOW, NOW);
}

const SILENT = "problems=()\n[ -n \"$x\" ] && problems+=(\"x\")\n[ ${#problems[@]} -eq 0 ] && exit 0\nprintf '%s\\n' \"${problems[@]}\"";

function seed() {
  automation("aut_daily", "checkin", "Daily check-in");
  automation("aut_silent", "watcher", "Silent heartbeat", { script: SILENT, schedule: { type: "interval", every: 2, unit: "hours", days: [0, 1, 2, 3, 4, 5, 6], from: "08:00", to: "23:00" } });
  automation("aut_morning", "watcher", "Morning card", { script: "#!/bin/bash\n# Wakes the Bot.\necho \"Write today's morning card.\"" });
  automation("aut_ended", "checkin", "Overnight watch", { state: "ended" });
  automation("aut_remind", "reminder", "Call back");
  runner("run_staff", "Staff", "thr_staff");
  db.prepare("INSERT INTO project_runs (project_id, enabled, cadence, time, lead_thread_id) VALUES ('proj_personal', 1, 'weekdays', '08:00', 'thr_main')").run();
}

class Posting extends AutomationTasks {
  override started(key: { owner: string; ownerId: string }, threadId: string) { const run = super.started(key, threadId); run?.sent(); return run; }
  override watcherRun(...args: Parameters<AutomationTasks["watcherRun"]>) { const plan = super.watcherRun(...args); if (plan && plan !== "quiet") plan.done(true); return plan; }
}

function setup(deps: Partial<AutomationTaskDeps> = {}) {
  const posts: string[] = [];
  const sent: { threadId: string; text: string }[] = [];
  const store = new TaskStore(db, () => {});
  const tasks = new Posting(store, { sources: () => readSources(db, BOTS), zone: () => "America/New_York", ...deps });
  const raw = new AutomationTasks(store, { sources: () => readSources(db, BOTS), zone: () => "America/New_York", ...deps });
  const tools: Record<string, { execute(input: unknown, ctx: unknown): Promise<string> }> = {};
  const handlers: Record<string, (input: any) => any> = {};
  const bb = {
    realtime: { publish: vi.fn() }, log: { warn: vi.fn(), info: vi.fn() }, onDispose: vi.fn(),
    agents: { registerTool: (tool: { name: string; execute(input: unknown, ctx: unknown): Promise<string> }) => { tools[tool.name] = tool; } },
    ui: { registerMentionProvider: vi.fn() },
    rpc: { register: (_contract: unknown, map: typeof handlers) => Object.assign(handlers, map) },
    sdk: { threads: { get: async () => null, update: vi.fn(async () => ({})), timeline: vi.fn(async () => ({ rows: [] })) } },
  };
  const post = async (text: string) => { posts.push(text); };
  const loops = registerLoops(bb as never, db, post, async () => {}, { get: async () => ({ loopsEnabled: false }), onChange: () => {} }, () => "UTC", () => {});
  registerTasks(bb as never, db, post, async (threadId, text) => { sent.push({ threadId, text }); });
  registerUserTasks(bb as never, db, {
    post, send: async (threadId, text) => { sent.push({ threadId, text }); }, thread: async () => null,
    loopAct: (x) => loops.actDirect(x), reopenLoop: () => {}, snoozeLoopUntil: () => {}, held: () => [],
  });
  const tool = async (name: string, input: unknown, threadId: string) => JSON.parse(await tools[name]!.execute(input, { threadId }));
  const exec = (name: string, input: unknown, threadId: string) => tools[name]!.execute(input, { threadId });
  return { store, tasks, raw, posts, sent, loops, handlers, tool, exec };
}

const all = (store: TaskStore) => store.all();
const children = (store: TaskStore, parent: string) => store.children(parentIdOf(parent));
const events = () => (db.prepare("SELECT COUNT(*) AS n FROM task_events").get() as { n: number }).n;

it("maps every check-in, watcher, runner and the Bot's own check-in to a task with a schedule, and leaves reminders and ended ones out", () => {
  seed();
  const { store, tasks } = setup();
  expect(tasks.sync()).toMatchObject({ created: 5, updated: 0, closed: 0 });
  const parents = all(store);
  expect(parents.map((t) => [t.id, t.title, t.owner, t.state, t.automation?.kind, t.automation?.mode])).toEqual([
    ["task_auto-aut-daily", "Daily check-in", "cos", "in_progress", "checkin", null],
    ["task_auto-aut-morning", "Morning card", "cos", "in_progress", "watcher", "each"],
    ["task_auto-aut-silent", "Silent heartbeat", "cos", "in_progress", "watcher", "dedupe"],
    ["task_auto-run-staff", "Staff", "thread:thr_staff", "in_progress", "runner", null],
    ["task_auto-heartbeat-bot-main", "Check-in", "cos", "in_progress", "heartbeat", null],
  ]);
  const daily = store.get("task_auto-aut-daily");
  expect(daily).toMatchObject({ origin: "task", parentId: null, conversation: null, schedule: { text: "Every day 1:00 PM", automationId: "aut_daily", paused: false, timeZone: "America/New_York" }, automation: { role: "schedule", thread: "thr_main" } });
  expect(store.get("task_auto-run-staff").schedule).toMatchObject({ automationId: "run_staff", paused: false });
  expect(parents.every((t) => !inLoopView(t))).toBe(true);
});

it("the mapping is idempotent: a second run writes nothing, and a db with nothing to map gets no backup", () => {
  seed();
  const { store, tasks } = setup();
  tasks.sync();
  const before = JSON.stringify(all(store));
  const n = events();
  expect(tasks.sync()).toMatchObject({ created: 0, updated: 0, closed: 0, backup: null });
  expect(JSON.stringify(all(store))).toBe(before);
  expect(events()).toBe(n);
  db.prepare("DELETE FROM bot_automations").run();
  db.prepare("DELETE FROM bot_runners").run();
  db.prepare("DELETE FROM project_runs").run();
  db.prepare("DELETE FROM tasks").run();
  expect(tasks.sync({ backup: true })).toMatchObject({ created: 0, backup: null });
});

it("backs up the db file once, before the first mapping, and never again", () => {
  dir = mkdtempSync(join(tmpdir(), "auto-tasks-"));
  db.close();
  db = new Database(join(dir, "data.db"));
  for (const sql of MIGRATIONS) db.exec(sql);
  seed();
  const { tasks } = setup();
  const first = tasks.sync({ backup: true });
  expect(first.created).toBe(5);
  expect(first.backup).toMatch(/data\.before-automation-tasks-.*\.db$/);
  at(NOW + 60_000);
  automation("aut_new", "checkin", "Weekly review");
  const second = tasks.sync({ backup: true });
  expect(second).toMatchObject({ created: 1, backup: null });
  expect(readdirSync(dir).filter((name) => name.includes("before-automation-tasks"))).toHaveLength(1);
});

it("pausing an automation pauses its task, resuming brings it back, and deleting it closes it", () => {
  seed();
  const { store, tasks } = setup();
  tasks.sync();
  db.prepare("UPDATE bot_automations SET state = 'paused' WHERE id = 'aut_daily'").run();
  db.prepare("UPDATE bot_runners SET state = 'paused' WHERE id = 'run_staff'").run();
  expect(tasks.sync()).toMatchObject({ updated: 2 });
  expect(store.get("task_auto-aut-daily")).toMatchObject({ state: "waiting", schedule: { paused: true } });
  expect(store.get("task_auto-run-staff")).toMatchObject({ state: "waiting", schedule: { paused: true } });
  db.prepare("UPDATE bot_automations SET state = 'active' WHERE id = 'aut_daily'").run();
  tasks.sync();
  expect(store.get("task_auto-aut-daily")).toMatchObject({ state: "in_progress", schedule: { paused: false } });
  expect(store.history("task_auto-aut-daily").map((e) => e.type)).toEqual(["created", "state", "state"]);
  db.prepare("DELETE FROM bot_automations WHERE id = 'aut_daily'").run();
  expect(tasks.sync()).toMatchObject({ closed: 1 });
  expect(store.get("task_auto-aut-daily")).toMatchObject({ state: "dropped", progress: { line: "Deleted" } });
  db.prepare("UPDATE bot_automations SET state = 'ended' WHERE id = 'aut_silent'").run();
  tasks.sync();
  expect(store.get("task_auto-aut-silent").state).toBe("done");
});

it("a check-in run is a child task the Bot owns; it closes quietly when the Bot's turn ends with [PASS]", () => {
  seed();
  const { store, tasks, posts, sent } = setup();
  tasks.sync();
  const started = tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main")!;
  const [run] = children(store, "aut_daily");
  expect(run).toMatchObject({ owner: "cos", state: "in_progress", origin: "task", conversation: null, automation: { role: "run", thread: "thr_main", kind: "checkin" } });
  expect(run!.title).toMatch(/^Daily check-in · Nov 15, 8:00 AM$/);
  expect(started.prompt).toContain(`This run is task ${run!.id}.`);
  expect(started.prompt).toContain('task_handoff (to "user"');
  expect(store.get("task_auto-aut-daily").automation).toMatchObject({ count: 1, lastAt: NOW });
  at(NOW + 680);
  expect(tasks.settle("thr_main", "[PASS]", "succeeded")).toBe(1);
  expect(store.get(run!.id)).toMatchObject({ state: "done", progress: { line: "Nothing new" }, closedBy: "cos" });
  expect(store.get("task_auto-aut-daily").progress.line).toBe("Nothing new");
  expect(posts).toEqual([]);
  expect(sent).toEqual([]);
});

it("a run that ends at once keeps its own result, and the next run's turn doesn't close it with its text", () => {
  seed();
  const { store, tasks } = setup();
  tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main");
  at(NOW + 680);
  tasks.settle("thr_main", "[PASS]", "succeeded");
  at(NOW + 60_000);
  tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main");
  at(NOW + 65_000);
  tasks.settle("thr_main", "Handed off: the dentist date needs your pick.", "succeeded");
  expect(children(store, "aut_daily").map((t) => t.progress.line)).toEqual(["Nothing new", "Handed off: the dentist date needs your pick."]);
});

it("a run's reply becomes its result; a failed run is Failed; the next run closes one left open", () => {
  seed();
  const { store, tasks } = setup();
  tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main");
  at(NOW + 60_000);
  tasks.settle("thr_main", "**Two** things changed today.\nMore below.", "succeeded");
  expect(children(store, "aut_daily")[0]).toMatchObject({ state: "done", progress: { line: "Two things changed today." } });
  tasks.started({ owner: "heartbeat", ownerId: "proj_personal" }, "thr_main");
  at(NOW + 120_000);
  tasks.settle("thr_main", "The provider is down", "failed");
  expect(children(store, "heartbeat:bot_main")[0]).toMatchObject({ state: "failed", progress: { line: "Failed: The provider is down" } });
  at(NOW + 180_000);
  tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main");
  at(NOW + 240_000);
  tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main");
  const runs = children(store, "aut_daily");
  expect(runs.map((t) => [t.state, t.progress.line])).toEqual([["done", "Two things changed today."], ["done", "No report"], ["in_progress", null]]);
  at(NOW + 300_000);
  const failed = tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main")!;
  failed.failed("thread is gone");
  expect(children(store, "aut_daily").at(-1)).toMatchObject({ state: "failed", progress: { line: "Failed: thread is gone" } });
  expect(tasks.started({ owner: "automation", ownerId: "aut_remind" }, "thr_main")).toBeNull();
  expect(tasks.started({ owner: "automation", ownerId: "aut_gone" }, "thr_main")).toBeNull();
});

it("a check-in run that needs the user moves to them (Today and its card) and stays open; its schedule shows Needs you", async () => {
  seed();
  const { store, tasks, tool, posts, loops } = setup();
  tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main");
  const run = children(store, "aut_daily")[0]!;
  const out = await tool("task_handoff", { id: run.id, to: "user", needs: "Approve the Kensico budget raise" }, "thr_main");
  expect(out.task).toMatchObject({ owner: "patrick", state: "waiting", title: "Daily check-in: Approve the Kensico budget raise", attention: { queue: "surfaced" } });
  expect(posts).toEqual([`Please post this card in your chat exactly once: ::loop{id="${run.id}"}`]);
  expect(loops.store.get(run.id)).toMatchObject({ status: "surfaced", owner: "patrick" });
  at(NOW + 60_000);
  tasks.settle("thr_main", "I put it in your Today.", "succeeded");
  expect(store.get(run.id).state).toBe("waiting");
  expect(store.get("task_auto-aut-daily").progress.line).toBe("Needs you: Approve the Kensico budget raise");
});

it("a runner's report lands on its run: log and tell close it quietly, urgent hands it to the user", () => {
  seed();
  const { store, tasks, loops } = setup();
  tasks.started({ owner: "runner", ownerId: "run_staff" }, "thr_staff");
  expect(tasks.report("run_staff", "thr_staff", "log", "Nothing urgent in the inbox.")).toBeNull();
  expect(children(store, "run_staff")[0]).toMatchObject({ owner: "thread:thr_staff", state: "done", progress: { line: "Nothing urgent in the inbox." } });
  at(NOW + HOUR);
  expect(tasks.report("run_staff", "thr_staff", "tell", "A new PR needs review.")).toBeNull();
  expect(children(store, "run_staff")[1]).toMatchObject({ state: "done", progress: { line: "A new PR needs review." } });
  at(NOW + 2 * HOUR);
  const note = tasks.report("run_staff", "thr_staff", "urgent", "The card was charged twice; call the bank today.");
  const urgent = children(store, "run_staff")[2]!;
  expect(note).toBe(URGENT_RUN_NOTE(urgent.id));
  expect(urgent).toMatchObject({ owner: "patrick", state: "waiting", title: "Staff: The card was charged twice; call the bank today.", needs: "The card was charged twice; call the bank today.", progress: { line: null }, attention: { queue: "surfaced" } });
  expect(loops.store.get(urgent.id).status).toBe("surfaced");
  expect(store.history(urgent.id).map((e) => e.type)).toContain("handed_to_you");
  expect(store.get("task_auto-run-staff").progress.line).toBe("Needs you: The card was charged twice; call the bank today.");
  expect(tasks.report("run_nope", "thr_x", "log", "x")).toBeNull();
});

it("quiet runs fold away: the Tasks list and the phone's todo list leave them out, and old ones are pruned", async () => {
  seed();
  const { store, tasks, handlers, loops } = setup();
  tasks.sync();
  for (let i = 0; i < KEEP_RUNS + 5; i++) {
    at(NOW + i * HOUR);
    tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main");
    at(NOW + i * HOUR + 60_000);
    tasks.settle("thr_main", "[PASS]", "succeeded");
  }
  tasks.started({ owner: "runner", ownerId: "run_staff" }, "thr_staff");
  tasks.report("run_staff", "thr_staff", "urgent", "Act now");
  const listed = (await handlers["tasks.list"]!({})).tasks as Task[];
  expect(listed.filter((t) => t.automation?.role === "run").map((t) => t.owner)).toEqual(["patrick"]);
  expect(listed.filter((t) => t.automation?.role === "schedule")).toHaveLength(5);
  expect(loops.store.all().filter((l) => l.id.startsWith("task_")).map((l) => l.title)).toEqual(["Staff: Act now"]);
  at(NOW + 40 * 86_400_000);
  expect(tasks.prune()).toBe(5);
  expect(children(store, "aut_daily")).toHaveLength(KEEP_RUNS);
  const view = await handlers["tasks.get"]!({ id: "task_auto-aut-daily" });
  expect(view.runs).toHaveLength(10);
  expect(view.runs[0].createdAt).toBeGreaterThan(view.runs[9].createdAt);
});

it("a watcher's finding is one task; the next finding for the same thing updates it and posts nothing", () => {
  seed();
  const { store, tasks } = setup();
  tasks.sync();
  const first = tasks.watcherRun("aut_silent", "Kensico health rc=1: writer: Claude spend $5.42 today for write-ups and summaries (over $5/day)", null, NOW);
  expect(first).toMatchObject({ post: "Kensico health rc=1: writer: Claude spend $5.42 today for write-ups and summaries (over $5/day)", note: expect.stringMatching(/^This finding is task task_.*Leave it open while the problem lasts/) });
  const [finding] = children(store, "aut_silent");
  expect(finding).toMatchObject({ owner: "cos", state: "in_progress", conversation: "thr_main", automation: { role: "finding", count: 1 }, title: "Silent heartbeat: Kensico health rc=1: writer: Claude spend $5.42 today for write-ups and summaries (over $5/day)" });
  at(NOW + 24 * HOUR);
  expect(tasks.watcherRun("aut_silent", "Kensico health rc=1: writer: Claude spend $5.61 today for write-ups and summaries (over $5/day)", null, NOW + 24 * HOUR)).toBe("quiet");
  const kids = children(store, "aut_silent");
  expect(kids).toHaveLength(1);
  expect(kids[0]).toMatchObject({ id: finding!.id, state: "in_progress", automation: { count: 2, lastAt: NOW + 24 * HOUR }, progress: { line: expect.stringContaining("$5.61") } });
  expect(store.history(finding!.id).at(-1)).toMatchObject({ type: "found_again", data: expect.stringContaining("\"count\":2") });
  const both = tasks.watcherRun("aut_silent", "Kensico health rc=1: writer: Claude spend $5.80 today for write-ups and summaries (over $5/day)\nOpenCode Go 5-hour window: only 12% left", null, NOW + 26 * HOUR);
  expect(both).toMatchObject({ post: "Kensico health rc=1: writer: Claude spend $5.80 today for write-ups and summaries (over $5/day)\nOpenCode Go 5-hour window: only 12% left" });
  expect(children(store, "aut_silent").map((t) => [t.automation!.count, t.title])).toEqual([[3, finding!.title], [1, "Silent heartbeat: OpenCode Go 5-hour window: only 12% left"]]);
  expect(store.get("task_auto-aut-silent").progress.line).toMatch(/^Found: Kensico health/);
});

it("a finding closes when its condition clears: no repeat for 30 hours and a run since without it, or the script says clear", () => {
  seed();
  const { store, tasks } = setup();
  tasks.watcherRun("aut_silent", "Red4 does not answer", null, NOW);
  at(NOW + 1000);
  tasks.watcherRun("aut_silent", "Disk 91% full", null, NOW + 1000);
  const [red, disk] = children(store, "aut_silent");
  expect(tasks.watcherRun("aut_silent", null, "", NOW + 2 * HOUR)).toBe("quiet");
  expect(isClosed(store.get(red!.id))).toBe(false);
  tasks.watcherRun("aut_silent", "Disk 93% full", null, NOW + 20 * HOUR);
  tasks.watcherRun("aut_silent", null, "", NOW + CLEAR_AFTER_MS + HOUR);
  expect(store.get(red!.id)).toMatchObject({ state: "done", closedBy: "cos", progress: { line: "Cleared: the watcher stopped finding it" } });
  expect(store.get(disk!.id).state).toBe("in_progress");
  expect(store.history(red!.id).map((e) => e.type)).toEqual(["created", "closed", "progress"]);
  expect(tasks.watcherRun("aut_silent", null, '{"wakeAgent": false, "clear": true}', NOW + CLEAR_AFTER_MS + 2 * HOUR)).toBe("quiet");
  expect(store.get(disk!.id).state).toBe("done");
  expect(store.get("task_auto-aut-silent").progress.line).toBe("Nothing found");
  const again = tasks.watcherRun("aut_silent", "Red4 does not answer", null, NOW + 40 * HOUR);
  expect(again).toMatchObject({ post: "Red4 does not answer" });
  expect(children(store, "aut_silent")).toHaveLength(3);
});

it("a finding the user dismissed stays quiet while it repeats, and comes back as new once it has cleared", async () => {
  seed();
  const { store, tasks, handlers } = setup();
  tasks.watcherRun("aut_silent", "Spend $5.10 over budget", null, NOW);
  const [spend] = children(store, "aut_silent");
  await handlers["tasks.act"]!({ id: spend!.id, action: "drop" });
  expect(tasks.watcherRun("aut_silent", "Spend $5.90 over budget", null, NOW + 10 * HOUR)).toBe("quiet");
  expect(store.get(spend!.id)).toMatchObject({ state: "dropped", automation: { count: 2 } });
  tasks.watcherRun("aut_silent", null, "", NOW + 50 * HOUR);
  expect(store.get(spend!.id).automation!.clearedAt).toBe(NOW + 50 * HOUR);
  expect(tasks.watcherRun("aut_silent", "Spend $6.20 over budget", null, NOW + 60 * HOUR)).toMatchObject({ post: "Spend $6.20 over budget" });
});

it("a watcher can name its finding's key, owner and clear it; a print-only watcher's every run is a run, not a finding", () => {
  seed();
  runner("run_kensico", "Kensico lead", "thr_kensico");
  automation("aut_inv", "watcher", "Kensico inventory", { script: "out=$(x) || echo failed", target: "run_kensico" });
  const { store, tasks } = setup();
  const first = tasks.watcherRun("aut_inv", 'Push failed at 10:15\n{"key": "push", "owner": "cos"}', null, NOW);
  expect(first).toMatchObject({ post: "Push failed at 10:15" });
  expect(children(store, "aut_inv")[0]).toMatchObject({ owner: "cos", automation: { keys: ["push"] } });
  expect(tasks.watcherRun("aut_inv", 'Push failed again with exit 3\n{"key": "push"}', null, NOW + HOUR)).toBe("quiet");
  expect(tasks.watcherRun("aut_inv", null, '{"clear": ["push"]}', NOW + 2 * HOUR)).toBe("quiet");
  expect(children(store, "aut_inv")[0]!.state).toBe("done");
  at(NOW + 3 * HOUR);
  tasks.watcherRun("aut_inv", "Disk full", null, NOW + 3 * HOUR);
  expect(children(store, "aut_inv")[1]).toMatchObject({ owner: "thread:thr_kensico", conversation: "thr_kensico" });
  const morning1 = tasks.watcherRun("aut_morning", "Write today's morning card.", null, NOW);
  at(NOW + 24 * HOUR);
  const morning2 = tasks.watcherRun("aut_morning", "Write today's morning card.", null, NOW + 24 * HOUR);
  expect(morning1).toMatchObject({ post: "Write today's morning card.", note: expect.stringMatching(/^This run is task /) });
  expect(morning2).toMatchObject({ post: "Write today's morning card." });
  expect(children(store, "aut_morning").map((t) => [t.automation!.role, t.state])).toEqual([["run", "done"], ["run", "in_progress"]]);
  expect(tasks.watcherRun("aut_unknown", "x", null, NOW)).toBeNull();
});

it("stores recurring tasks, runs and findings as ordinary tasks, so code without phase 3 still reads them", async () => {
  seed();
  const { store, tasks } = setup();
  tasks.sync();
  tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main");
  tasks.watcherRun("aut_silent", "Disk 91% full", null, NOW);
  const { task: phase2 } = await import("./contract");
  const older = phase2.omit({ automation: true }).strict();
  for (const row of db.prepare("SELECT record FROM tasks").all() as { record: string }[]) {
    const { automation: _a, ...rest } = JSON.parse(row.record) as Record<string, unknown>;
    expect(() => older.parse(rest)).not.toThrow();
    expect(rest.origin).toBe("task");
  }
  expect(store.all()).toHaveLength(7);
});

it("reads watcher keys, control lines and print-only scripts", () => {
  expect(findingKey("Claude spend $5.42 today (over $5/day)")).toBe(findingKey("Claude  spend $11.07 today (over $5/day)"));
  expect(findingKey("red4 down")).not.toBe(findingKey("mac down"));
  expect(splitControl('found it\n{"key":"k","clear":["a"],"owner":"thread:thr_1","each":true}')).toEqual({ body: "found it", control: { key: "k", clear: ["a"], owner: "thread:thr_1", each: true } });
  expect(splitControl('{"wakeAgent": false}')).toEqual({ body: '{"wakeAgent": false}', control: null });
  expect(splitControl('{"status":"down","host":"red4"}')).toEqual({ body: '{"status":"down","host":"red4"}', control: null });
  expect(splitControl('Red4 is down\n{"wakeAgent": true, "reason": "x"}')).toEqual({ body: 'Red4 is down\n{"wakeAgent": true, "reason": "x"}', control: null });
  expect(splitControl('Red4 is down\n{"key": "red4", "status": 3}').control).toBeNull();
  expect(splitControl('Red4 is down\n{"wakeAgent": true, "severity": "critical"}')).toEqual({ body: "Red4 is down", control: { severity: "critical" } });
  expect(splitControl("no control {here}")).toEqual({ body: "no control {here}", control: null });
  expect(alwaysPrints("#!/bin/bash\n# note\necho \"Write today's morning card.\"", "bash")).toBe(true);
  expect(alwaysPrints("echo \"$(date)\"", "bash")).toBe(false);
  expect(alwaysPrints(SILENT, "bash")).toBe(false);
  expect(alwaysPrints("print('hi')", "python3")).toBe(true);
  expect(alwaysPrints("", "bash")).toBe(false);
});

it("P0: a finding whose post failed is posted on the next run, and counts as posted only once it went out", () => {
  seed();
  const { store, raw } = setup();
  const first = raw.watcherRun("aut_silent", "Red4 does not answer", null, NOW);
  expect(first).toMatchObject({ post: "Red4 does not answer" });
  (first as { done(posted: boolean): void }).done(false);
  expect(children(store, "aut_silent")[0]!.automation!.posted).toBe(false);
  const retry = raw.watcherRun("aut_silent", "Red4 does not answer", null, NOW + HOUR);
  expect(retry).toMatchObject({ post: "Red4 does not answer", taskId: children(store, "aut_silent")[0]!.id });
  (retry as { done(posted: boolean): void }).done(true);
  expect(children(store, "aut_silent")).toHaveLength(1);
  expect(children(store, "aut_silent")[0]!.automation!.posted).toBe(true);
  expect(raw.watcherRun("aut_silent", "Red4 does not answer", null, NOW + 2 * HOUR)).toBe("quiet");
});

it("P1: a one-line JSON output, or one with unknown keys, is posted as output", () => {
  seed();
  const { tasks } = setup();
  expect(tasks.watcherRun("aut_silent", '{"status":"down","host":"red4"}', null, NOW)).toMatchObject({ post: '{"status":"down","host":"red4"}' });
});

it("P1: a watcher's mode is kept once mapped: an edit never turns a reminder-style watcher into a quiet one, and {\"each\": true} sticks", () => {
  seed();
  const { store, tasks } = setup();
  tasks.sync();
  db.prepare("UPDATE bot_automations SET script = ? WHERE id = 'aut_morning'").run('[ "$(date +%u)" -lt 6 ] && echo "Write today\'s morning card."');
  tasks.sync();
  expect(store.get("task_auto-aut-morning").automation!.mode).toBe("each");
  tasks.watcherRun("aut_morning", "Write today's morning card.", null, NOW);
  at(NOW + 24 * HOUR);
  expect(tasks.watcherRun("aut_morning", "Write today's morning card.", null, NOW + 24 * HOUR)).toMatchObject({ steer: true, post: "Write today's morning card." });
  db.prepare("UPDATE bot_automations SET script = 'echo \"Stretch.\"' WHERE id = 'aut_silent'").run();
  tasks.sync();
  expect(store.get("task_auto-aut-silent").automation!.mode).toBe("each");
  automation("aut_rem", "watcher", "Reminder", { script: "[ -f x ] && echo hi" });
  tasks.sync();
  tasks.watcherRun("aut_rem", 'Time to stretch\n{"each": true}', null, NOW);
  expect(store.get("task_auto-aut-rem").automation!.mode).toBe("each");
  expect(tasks.watcherRun("aut_rem", "Time to stretch", null, NOW + HOUR)).toMatchObject({ post: "Time to stretch", steer: true });
});

it("P1: the check-in prompt lists the open findings", () => {
  seed();
  const { tasks } = setup();
  tasks.watcherRun("aut_silent", "[warn] Disk 91% full", null, NOW - 30 * HOUR);
  const run = tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main")!;
  expect(run.prompt).toMatch(/Open watcher findings .*\n- "Silent heartbeat: Disk 91% full" \(task_[^;]+; owner you; found 1 time; first Nov 14, 2:00 AM, last Nov 14, 2:00 AM; warn\)/);
  expect(tasks.started({ owner: "runner", ownerId: "run_staff" }, "thr_staff")!.prompt).not.toContain("Open watcher findings");
});

it("P1: an untouched finding gets one agent-only nudge a day at most, only when what it says changes, and none once its owner answered", async () => {
  seed();
  const nudges: { threadId: string; text: string }[] = [];
  const { store, tasks, tool } = setup({ nudge: async (threadId, text) => { nudges.push({ threadId, text }); } });
  for (let h = 0; h <= 48; h++) {
    at(NOW + h * HOUR);
    tasks.watcherRun("aut_silent", `timeline-sync last succeeded ${h + 5}h ago`, null, NOW + h * HOUR);
    await Promise.resolve();
  }
  expect(nudges).toHaveLength(1);
  expect(nudges[0]).toEqual({ threadId: "thr_main", text: expect.stringMatching(/^Watcher finding task task_.*still happening: found 25 times.*Latest output: timeline-sync last succeeded 29h ago.*reply exactly \[PASS\]/s) });
  at(NOW + 49 * HOUR);
  tasks.watcherRun("aut_silent", 'timeline-sync is failing: auth refused\n{"key": "timeline-sync last succeeded h ago"}', null, NOW + 49 * HOUR);
  await Promise.resolve();
  expect(nudges).toHaveLength(2);
  expect(nudges[1]!.text).toContain("Latest output: timeline-sync is failing: auth refused");
  at(NOW + 49 * HOUR + 60_000);
  tasks.settle("thr_main", "[PASS]", "succeeded");
  const [finding] = children(store, "aut_silent");
  expect(store.history(finding!.id).at(-1)).toMatchObject({ type: "answered" });
  at(NOW + 80 * HOUR);
  tasks.watcherRun("aut_silent", 'timeline-sync is down for good\n{"key": "timeline-sync last succeeded h ago"}', null, NOW + 80 * HOUR);
  await Promise.resolve();
  expect(nudges).toHaveLength(2);
  void tool;
});

it("P1: a repeat with different text records it on the task; history adds a line when the text changes beyond numbers, or once an hour", () => {
  seed();
  const { store, tasks } = setup();
  tasks.watcherRun("aut_silent", "birdclaw answered 000", null, NOW);
  tasks.watcherRun("aut_silent", "birdclaw answered 401", null, NOW + 60_000);
  tasks.watcherRun("aut_silent", "birdclaw answered 401", null, NOW + 120_000);
  tasks.watcherRun("aut_silent", "birdclaw answered 401", null, NOW + 2 * HOUR);
  const [finding] = children(store, "aut_silent");
  expect(finding).toMatchObject({ why: "birdclaw answered 401", progress: { line: "birdclaw answered 401" }, automation: { count: 4 } });
  const found = () => store.history(finding!.id).filter((e) => e.type === "found_again").map((e) => JSON.parse(e.data) as { count: number; changed: boolean });
  expect(found().map((e) => [e.count, e.changed])).toEqual([[2, false], [4, false]]);
});

it("severity: higher wakes again and raises it, the same or lower stays quiet, critical to the user pushes once, and clearing resets it", async () => {
  seed();
  const pushes: string[] = [];
  const { store, tasks, tool, loops } = setup({ push: async (task) => { pushes.push(task.id); } });
  expect(tasks.watcherRun("aut_silent", "[info] Disk 80% full", null, NOW)).toMatchObject({ post: "Disk 80% full" });
  const [disk] = children(store, "aut_silent");
  expect(disk!.automation!.severity).toBe("info");
  const worse = tasks.watcherRun("aut_silent", "[warn] Disk 91% full", null, NOW + HOUR);
  expect(worse).toMatchObject({ post: "Disk 91% full", taskId: disk!.id, note: expect.stringMatching(/is now warn: it got worse/) });
  expect(store.get(disk!.id).automation!.severity).toBe("warn");
  expect(store.get("task_auto-aut-silent").automation!.severity).toBe("warn");
  expect(tasks.watcherRun("aut_silent", "[warn] Disk 92% full", null, NOW + 2 * HOUR)).toBe("quiet");
  expect(tasks.watcherRun("aut_silent", "[info] Disk 85% full", null, NOW + 3 * HOUR)).toBe("quiet");
  expect(store.get(disk!.id)).toMatchObject({ why: "Disk 85% full", automation: { severity: "warn" } });
  await tool("task_handoff", { id: disk!.id, to: "user", needs: "Free some space on red4" }, "thr_main");
  expect(tasks.watcherRun("aut_silent", 'Disk 99% full\n{"severity": "critical"}', null, NOW + 4 * HOUR)).toMatchObject({ post: "Disk 99% full" });
  expect(pushes).toEqual([disk!.id]);
  expect(loops.store.get(disk!.id).owner).toBe("patrick");
  tasks.watcherRun("aut_silent", "[critical] Disk 99% full", null, NOW + 5 * HOUR);
  expect(pushes).toHaveLength(1);
  expect(store.history(disk!.id).filter((e) => e.type === "worse").map((e) => JSON.parse(e.data).severity)).toEqual(["warn", "critical"]);
  tasks.watcherRun("aut_silent", null, '{"clear": true}', NOW + 6 * HOUR);
  expect(store.get(disk!.id).automation!.severity).toBeNull();
  expect(store.get("task_auto-aut-silent").automation!.severity).toBeNull();
});

it("P2: a run settles only on an idle after its prompt was sent", () => {
  seed();
  const { store, raw } = setup();
  const run = raw.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main")!;
  expect(raw.settle("thr_main", "An earlier reply", "succeeded")).toBe(0);
  run.sent();
  at(NOW + 500);
  expect(raw.settle("thr_main", "[PASS]", "succeeded")).toBe(1);
  expect(children(store, "aut_daily")[0]!.progress.line).toBe("Nothing new");
});

it("P2: a failed or timed-out watcher run neither clears a finding nor reads Nothing found", () => {
  seed();
  const { store, tasks } = setup();
  tasks.watcherRun("aut_silent", "Red4 does not answer", null, NOW);
  expect(tasks.watcherRun("aut_silent", null, null, NOW + 40 * HOUR, "ssh: timed out\nmore")).toBe("quiet");
  expect(children(store, "aut_silent")[0]!.state).toBe("in_progress");
  expect(store.get("task_auto-aut-silent").progress.line).toBe("Failed: ssh: timed out");
});

it("P2: closed findings older than 30 days are pruned past the newest 20", () => {
  seed();
  const { store, tasks } = setup();
  for (let i = 0; i < 25; i++) {
    tasks.watcherRun("aut_silent", `Problem ${String.fromCharCode(97 + i)}`, null, NOW + i * 1000);
    tasks.watcherRun("aut_silent", null, '{"clear": true}', NOW + i * 1000 + 500);
  }
  expect(children(store, "aut_silent")).toHaveLength(25);
  expect(tasks.prune(NOW + 40 * 86_400_000)).toBe(5);
  expect(children(store, "aut_silent")).toHaveLength(20);
});

it("P3: the Bot's own check-in matches its scheduled item; tools refuse to change a recurring task; a hand-off reopens a run that ended", async () => {
  seed();
  const { store, tasks, tool, exec } = setup();
  tasks.sync();
  expect(store.get("task_auto-heartbeat-bot-main").schedule!.automationId).toBe("heartbeat");
  expect(await exec("task_update", { id: "task_auto-aut-daily", state: "done" }, "thr_main")).toMatch(/automation's schedule; change it with automation_update/);
  expect(await exec("task_handoff", { id: "task_auto-aut-daily", to: "user" }, "thr_main")).toMatch(/automation's schedule/);
  tasks.started({ owner: "automation", ownerId: "aut_daily" }, "thr_main");
  at(NOW + 1000);
  tasks.settle("thr_main", "Done for today", "succeeded");
  const run = children(store, "aut_daily")[0]!;
  const out = await tool("task_handoff", { id: run.id, to: "user", needs: "Pick a date" }, "thr_main");
  expect(out.task).toMatchObject({ owner: "patrick", state: "waiting", title: "Daily check-in: Pick a date" });
});

it("re-review: a dismissed finding that turns critical reopens and posts; [info] on a finding with no severity is not worse; a worse post goes to the finding's owner", async () => {
  seed();
  runner("run_lead", "Kensico lead", "thr_kensico");
  const { store, tasks, handlers } = setup();
  tasks.watcherRun("aut_silent", "[warn] Spend $5.10 over budget", null, NOW);
  const [spend] = children(store, "aut_silent");
  await handlers["tasks.act"]!({ id: spend!.id, action: "drop" });
  expect(tasks.watcherRun("aut_silent", "[warn] Spend $5.40 over budget", null, NOW + HOUR)).toBe("quiet");
  const critical = tasks.watcherRun("aut_silent", "[critical] Spend $9.90 over budget", null, NOW + 2 * HOUR);
  expect(critical).toMatchObject({ post: "Spend $9.90 over budget", taskId: spend!.id });
  expect(store.get(spend!.id)).toMatchObject({ state: "in_progress", automation: { severity: "critical" } });
  tasks.watcherRun("aut_silent", "Disk 80% full", null, NOW + 3 * HOUR);
  expect(tasks.watcherRun("aut_silent", "[info] Disk 81% full", null, NOW + 4 * HOUR)).toBe("quiet");
  tasks.watcherRun("aut_silent", 'Inventory push failed\n{"key": "push", "owner": "thread:thr_kensico"}', null, NOW + 5 * HOUR);
  const worse = tasks.watcherRun("aut_silent", 'Inventory push failed again\n{"key": "push", "severity": "critical"}', null, NOW + 6 * HOUR);
  expect(worse).toMatchObject({ thread: "thr_kensico", note: expect.stringMatching(/is now critical/) });
});

it("re-review: past 20 open findings, new ones roll into one \"N more findings\" task", () => {
  seed();
  const { store, tasks } = setup();
  for (let i = 0; i < 23; i++) tasks.watcherRun("aut_silent", `Problem ${String.fromCharCode(97 + i)}`, null, NOW + i * 1000);
  const open = children(store, "aut_silent").filter((t) => !isClosed(t));
  expect(open).toHaveLength(21);
  const more = open.find((t) => t.source?.kind === "watcher-overflow")!;
  expect(more).toMatchObject({ title: "Silent heartbeat: 3 more findings", automation: { keys: [findingKey("Problem u"), findingKey("Problem v"), findingKey("Problem w")] } });
  expect(tasks.watcherRun("aut_silent", "Problem v", null, NOW + HOUR)).toBe("quiet");
  expect(tasks.watcherRun("aut_silent", "Problem x", null, NOW + 2 * HOUR)).toMatchObject({ post: "Problem x", taskId: more.id });
  expect(store.get(more.id).title).toBe("Silent heartbeat: 4 more findings");
});
