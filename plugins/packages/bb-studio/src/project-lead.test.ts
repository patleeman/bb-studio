import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { testScheduler } from "./test/scheduler-fixture";
import type { HeartbeatRun } from "./contract";
import { CHIEF_HEARTBEAT, HEARTBEAT, PERSONAL_PROJECT_ID, ProjectLeads } from "./project-lead";
import { localZone } from "./schedule";
import { nextRun } from "./triggers/next-run";

/** The migration that moves Spaces' leads to projects. */
const MOVE = MIGRATIONS.findIndex((statement) => statement.includes("CREATE TABLE space_lead_moves"));

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const request = {
  projectId: "elsewhere", providerId: "codex", model: "model", reasoningLevel: "high" as const, permissionMode: "accept-edits" as const,
  executionInputSources: {}, environment: { type: "project-default" }, input: [{ type: "text", text: "Grow tomatoes", mentions: [] }],
} as never;

async function setup(migrations = MIGRATIONS) {
  const threads = new Map<string, ReturnType<typeof makeThreadResponse>>();
  let count = 0;
  let failGets = false;
  const spawn = vi.fn(async (args: { projectId: string; title?: string; id?: string }) => {
    const thread = makeThreadResponse({ id: args.id ?? `t${++count}`, projectId: args.projectId, title: args.title ?? null, updatedAt: 1000 + count, providerId: "codex" });
    threads.set(thread.id, thread);
    return thread;
  });
  const get = vi.fn(async ({ threadId }: { threadId: string }) => {
    if (failGets) throw Object.assign(new Error("Server unavailable"), { status: 503 });
    const thread = threads.get(threadId);
    if (!thread) throw Object.assign(new Error("Not found"), { status: 404 });
    return thread;
  });
  const archive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: 5 }); return { ok: true }; });
  const automations: { id: string; name: string }[] = [];
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: { name?: string; automationId?: string } }) => {
    if (method === "automations_list") return automations;
    if (method === "automations_create") { const made = { id: `a${automations.length + 1}`, name: input.name! }; automations.push(made); return made; }
    if (method === "automations_delete") { const at = automations.findIndex((a) => a.id === input.automationId); if (at >= 0) automations.splice(at, 1); return {}; }
    return {};
  });
  const send = vi.fn(async (_args: { threadId: string; mode: string; input: { text: string }[]; permissionMode?: string }) => ({}));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      send: send as never, spawn: spawn as never, get: get as never, archive: archive as never, list: async () => [] as never,
      unpin: async () => ({}) as never, output: async () => ({ output: "Planted the seeds." }),
      defaultExecutionOptions: async () => ({ model: "model", reasoningLevel: "high", permissionMode: "accept-edits" }) as never,
    },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const changed = vi.fn();
  const clock = { now: Date.now() };
  const { engine, scheduler } = testScheduler(db, bb.sdk, clock);
  const leads = new ProjectLeads({ db, sdk: bb.sdk, scheduler, changed });
  /** Runs the heartbeats that are due after their next time. */
  const fire = async (projectId: string) => { clock.now = engine.get("heartbeat", projectId)!.nextAt! + 1; await engine.tick(); };
  return { send, fire, clock, engine, scheduler, bb, db, leads, threads, spawn, get, archive, callRpc, automations, changed, failGets: (fail: boolean) => { failGets = fail; } };
}

it.each<[HeartbeatRun["cadence"], string]>([
  ["every5minutes", "*/5 * * * *"], ["every2hours", "30 */2 * * *"], ["weekly", "30 8 * * 1"],
  ["daily", "30 8 * * *"], ["weekdays", "30 8 * * 1-5"], ["custom", "5,35 8-18/2 * JAN,MAR MON-FRI"],
])("schedules %s on the project's lead on Studio's scheduler and reuses its trigger", async (cadence, cron) => {
  const x = await setup();
  const thread = await x.spawn({ projectId: "p" });
  await x.leads.setLead("p", thread.id);
  await x.leads.setRun("p", { enabled: true, cadence: "daily", time: "08:30" });
  expect(await x.leads.setRun("p", { enabled: true, cadence, ...(cadence === "custom" ? { cron } : {}) })).toMatchObject({ projectId: "p", leadThreadId: thread.id, run: { enabled: true, cadence } });
  // No BB automation: the automations plugin is never asked.
  expect(x.callRpc).not.toHaveBeenCalled();
  expect(x.engine.list("heartbeat")).toHaveLength(1);
  const trigger = x.engine.get("heartbeat", "p")!;
  expect(trigger.state).toBe("on");
  // The same times the BB cron for this cadence gave.
  expect(trigger.nextAt).toBe(nextRun({ type: "cron", cron }, x.clock.now, localZone()));
  expect(x.leads.runs.automation("p")).toEqual({ id: "trg_heartbeat_p", projectId: "p" });
  expect(x.leads.runs.status("p")).toMatchObject({ on: true, nextRunAt: trigger.nextAt, lastRunAt: null });
});

it("wakes the lead with the heartbeat prompt behind the automation marker, and closes the run when the thread settles", async () => {
  const x = await setup();
  const thread = await x.spawn({ projectId: "p" });
  await x.leads.setLead("p", thread.id);
  await x.leads.setRun("p", { enabled: true, cadence: "hourly" });
  await x.fire("p");
  expect(x.send).toHaveBeenCalledWith({
    threadId: thread.id, mode: "steer-if-active", permissionMode: "accept-edits",
    input: [{ type: "text", text: `[bb automation due:trg_heartbeat_p]\n\n${HEARTBEAT}\nProject: p.`, mentions: [] }],
  });
  expect(x.leads.runs.status("p")).toMatchObject({ on: true, lastRunStatus: "running" });
  x.scheduler.threadSettled(thread.id, "succeeded", "[PASS]");
  expect(x.leads.runs.status("p")).toMatchObject({ lastRunStatus: "succeeded", lastRunAt: x.clock.now });
  // Turning it off removes the schedule; nothing fires after.
  await x.leads.setRun("p", { enabled: false, cadence: "hourly" });
  expect(x.engine.get("heartbeat", "p")).toBeNull();
  expect(x.leads.runs.automation("p")).toBeNull();
});

it("needs a lead for a heartbeat, and the personal project's lead is the Chief of Staff", async () => {
  const x = await setup();
  await expect(x.leads.setRun("p", { enabled: true, cadence: "daily" })).rejects.toThrow(/lead/);
  await expect(x.leads.setChiefRun({ enabled: true, cadence: "daily" })).rejects.toThrow(/Make your Bot/);
  const chief = await x.spawn({ projectId: "p" });
  expect(await x.leads.setChief(chief.id)).toEqual({ threadId: chief.id, run: null });
  expect(await x.leads.get(PERSONAL_PROJECT_ID)).toMatchObject({ leadThreadId: chief.id });
  await x.leads.setChiefRun({ enabled: true, cadence: "hourly" });
  await x.fire(PERSONAL_PROJECT_ID);
  expect(x.send.mock.calls[0]![0]).toMatchObject({ threadId: chief.id, input: [{ text: `[bb automation due:trg_heartbeat_${PERSONAL_PROJECT_ID}]\n\n${CHIEF_HEARTBEAT}` }] });
});

it("moves a thread's lead role, carrying its heartbeat over, and forgets a deleted lead", async () => {
  const x = await setup();
  const thread = await x.spawn({ projectId: "p" });
  await x.leads.setLead("p", thread.id);
  await x.leads.setRun("p", { enabled: true, cadence: "daily" });
  expect(await x.leads.setLead("q", thread.id)).toMatchObject({ leadThreadId: thread.id, run: { enabled: true, cadence: "daily" } });
  expect(await x.leads.get("p")).toMatchObject({ leadThreadId: null, run: { enabled: false } });
  expect(x.leads.list().map((lead) => lead.projectId)).toEqual(["p", "q"]);
  expect(x.engine.list("heartbeat").map((trigger) => trigger.ownerId)).toEqual(["q"]);
  x.threads.delete(thread.id);
  expect(await x.leads.get("q")).toMatchObject({ leadThreadId: null, run: { enabled: false } });
  expect(x.engine.list("heartbeat")).toEqual([]);
});

it("keeps a lead's successor the lead after a handoff", async () => {
  const x = await setup();
  const thread = await x.spawn({ projectId: "p" });
  await x.leads.setLead("p", thread.id);
  await x.leads.setRun("p", { enabled: true, cadence: "daily" });
  const { threadId } = await x.leads.handoff(thread.id, request);
  expect(threadId).not.toBe(thread.id);
  expect(x.leads.storedLead("p")).toBe(threadId);
  expect(x.archive).toHaveBeenCalledWith({ threadId: thread.id });
  // The heartbeat follows: its next run wakes the successor.
  await x.fire("p");
  expect(x.send.mock.calls.map(([arg]) => arg.threadId)).toEqual([threadId]);
  // A retry makes no second thread.
  expect(await x.leads.handoff(thread.id, request)).toEqual({ threadId });
  expect(x.spawn).toHaveBeenCalledTimes(2);
});

/** A Studio from before the move, with Spaces, their leads and heartbeats. */
async function legacy() {
  const x = await setup(MIGRATIONS.slice(0, MOVE));
  const space = (id: string, isDefault: number, defaultProject: string | null) =>
    x.db.prepare("INSERT INTO spaces (id, name, color, default_project_id, is_default, created_at, updated_at) VALUES (?, ?, 'blue', ?, ?, 1, 1)").run(id, id, defaultProject, isDefault);
  const project = (spaceId: string, projectId: string, at: number) => x.db.prepare("INSERT INTO space_projects (project_id, space_id, created_at) VALUES (?, ?, ?)").run(projectId, spaceId, at);
  const catchAll = (spaceId: string, projectId: string) => x.db.prepare("INSERT INTO space_folders (space_id, name, path, project_id) VALUES (?, ?, ?, ?)").run(spaceId, spaceId, `/Spaces/${spaceId}`, projectId);
  const lead = (spaceId: string, threadId: string, at = 1) => x.db.prepare("INSERT INTO space_leads (space_id, lead_thread_id, created_at, updated_at) VALUES (?, ?, 1, ?)").run(spaceId, threadId, at);
  const run = (spaceId: string, enabled: number, automationId: string | null) =>
    x.db.prepare("INSERT INTO space_runs (space_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES (?, ?, 'weekdays', '08:30', NULL, ?, 'p')").run(spaceId, enabled, automationId);
  return { ...x, space, project, catchAll, lead, run, finish: async () => {
    x.bb.storage.migrate(x.db, MIGRATIONS);
    await x.leads.finishMoves();
    await x.leads.runs.repair((projectId) => x.leads.storedLead(projectId));
  } };
}

it("moves the default Space's lead (the Chief of Staff) to the personal project, wherever its thread is", async () => {
  const x = await legacy();
  const chief = await x.spawn({ projectId: "p", id: "thr_chief" });
  x.automations.push({ id: "old", name: "Studio space heartbeat spc_personal" });
  x.space("spc_personal", 1, PERSONAL_PROJECT_ID);
  x.project("spc_personal", PERSONAL_PROJECT_ID, 1);
  x.lead("spc_personal", chief.id);
  x.run("spc_personal", 1, "old");
  await x.finish();
  expect(await x.leads.chief()).toEqual({ threadId: chief.id, run: { enabled: true, cadence: "weekdays", time: "08:30" } });
  // The Space heartbeat's BB automation is retired and a project heartbeat scheduled, aimed at the same thread.
  expect(x.automations).toEqual([]);
  expect(x.callRpc.mock.calls.some(([arg]) => arg.method === "automations_delete" && (arg.input as { automationId: string }).automationId === "old")).toBe(true);
  await x.fire(PERSONAL_PROJECT_ID);
  expect(x.send.mock.calls[0]![0]).toMatchObject({ threadId: chief.id, input: [{ text: `[bb automation due:trg_heartbeat_${PERSONAL_PROJECT_ID}]\n\n${CHIEF_HEARTBEAT}` }] });
  expect(x.db.prepare("SELECT COUNT(*) AS n FROM space_lead_moves").get()).toEqual({ n: 0 });
  expect(x.db.prepare("SELECT COUNT(*) AS n FROM spaces").get()).toEqual({ n: 1 });
});

it("moves a Space's lead to its thread's project, or else to the Space's first project that isn't its ~/Spaces catch-all", async () => {
  const x = await legacy();
  const gardener = await x.spawn({ projectId: "q", id: "thr_garden" });
  x.space("spc_garden", 0, "catch_garden");
  x.catchAll("spc_garden", "catch_garden");
  x.project("spc_garden", "catch_garden", 1);
  x.project("spc_garden", "p", 2);
  x.lead("spc_garden", gardener.id);
  x.run("spc_garden", 0, null);
  // No lead: the heartbeat settings go to the first non-catch-all project.
  x.space("spc_kitchen", 0, "catch_kitchen");
  x.catchAll("spc_kitchen", "catch_kitchen");
  x.project("spc_kitchen", "catch_kitchen", 1);
  x.project("spc_kitchen", "r2", 3);
  x.project("spc_kitchen", "r1", 2);
  x.run("spc_kitchen", 0, null);
  // A default project the user picked (not a catch-all) is the main one.
  x.space("spc_shed", 0, "shed");
  x.project("spc_shed", "other", 1);
  x.project("spc_shed", "shed", 2);
  x.run("spc_shed", 0, null);
  // Only a catch-all: it gets them.
  x.space("spc_attic", 0, "catch_attic");
  x.catchAll("spc_attic", "catch_attic");
  x.run("spc_attic", 0, null);
  await x.finish();
  expect(x.leads.list()).toEqual([
    { projectId: "catch_attic", leadThreadId: null, run: { enabled: false, cadence: "weekdays", time: "08:30" } },
    { projectId: "q", leadThreadId: gardener.id, run: { enabled: false, cadence: "weekdays", time: "08:30" } },
    { projectId: "r1", leadThreadId: null, run: { enabled: false, cadence: "weekdays", time: "08:30" } },
    { projectId: "shed", leadThreadId: null, run: { enabled: false, cadence: "weekdays", time: "08:30" } },
  ]);
});

it("drops a deleted lead, turns its heartbeat off, and lets the newer lead win a shared project", async () => {
  const x = await legacy();
  const older = await x.spawn({ projectId: "p", id: "thr_older" });
  const newer = await x.spawn({ projectId: "p", id: "thr_newer" });
  x.space("spc_a", 0, "pa");
  x.lead("spc_a", older.id, 1);
  x.space("spc_b", 0, "pb");
  x.lead("spc_b", newer.id, 2);
  x.space("spc_gone", 0, "pg");
  x.lead("spc_gone", "thr_deleted");
  x.run("spc_gone", 1, "old");
  await x.finish();
  expect(x.leads.list()).toEqual([
    { projectId: "p", leadThreadId: newer.id, run: null },
    { projectId: "pg", leadThreadId: null, run: { enabled: false, cadence: "weekdays", time: "08:30" } },
  ]);
  expect(x.automations).toEqual([]);
});

it("retries the move at the next startup when BB can't say where a lead is", async () => {
  const x = await legacy();
  const gardener = await x.spawn({ projectId: "q", id: "thr_garden" });
  x.space("spc_garden", 0, "p");
  x.lead("spc_garden", gardener.id);
  x.bb.storage.migrate(x.db, MIGRATIONS);
  x.failGets(true);
  await expect(x.leads.finishMoves()).rejects.toThrow(/unavailable/);
  expect(x.leads.list()).toEqual([]);
  x.failGets(false);
  await x.leads.finishMoves();
  expect(x.leads.list()).toEqual([{ projectId: "q", leadThreadId: gardener.id, run: null }]);
});

it("completes simultaneous lead transfers and later reads", async () => {
  const x = await setup();
  const a = await x.spawn({ projectId: "a" }), b = await x.spawn({ projectId: "b" });
  await x.leads.setLead("a", a.id);
  await x.leads.setLead("b", b.id);
  await Promise.all([x.leads.setLead("a", b.id), x.leads.setLead("b", a.id)]);
  expect(await x.leads.get("a")).toMatchObject({ leadThreadId: b.id });
  expect(await x.leads.get("b")).toMatchObject({ leadThreadId: a.id });
}, 1000);

it("still turns migrated heartbeats on when the automations plugin can't delete the retired one", async () => {
  const x = await legacy();
  const chief = await x.spawn({ projectId: "p", id: "thr_chief" });
  x.space("spc_personal", 1, PERSONAL_PROJECT_ID);
  x.project("spc_personal", PERSONAL_PROJECT_ID, 1);
  x.lead("spc_personal", chief.id);
  x.run("spc_personal", 1, "old");
  x.callRpc.mockRejectedValue(new Error("Plugin automations is disabled"));
  await x.finish();
  expect(x.engine.get("heartbeat", PERSONAL_PROJECT_ID)).toMatchObject({ state: "on" });
  // The retired automation stays listed for the next startup, which deletes it once the plugin answers.
  expect(x.db.prepare("SELECT COUNT(*) AS n FROM space_retired_automations").get()).toEqual({ n: 1 });
  x.callRpc.mockReset();
  x.callRpc.mockResolvedValue({});
  await x.leads.runs.repair((projectId) => x.leads.storedLead(projectId));
  expect(x.callRpc.mock.calls.map(([arg]) => [arg.method, arg.input.automationId])).toEqual([["automations_delete", "old"]]);
  expect(x.db.prepare("SELECT COUNT(*) AS n FROM space_retired_automations").get()).toEqual({ n: 0 });
});
