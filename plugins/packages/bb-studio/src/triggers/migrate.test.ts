import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import type { Schedule } from "../schedule";
import { testScheduler } from "../test/scheduler-fixture";
import { moveToScheduler } from "./migrate";
import { nextRun } from "./next-run";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const START = Date.parse("2026-11-10T12:00:00Z");
type Bb = { id: string; projectId: string; enabled: boolean; nextRunAt?: number | null; lastRunAt?: number | null; trigger?: { timezone?: string }; execution?: { targetThreadId?: string } };

/** A Studio from before the move: every schedule is a BB automation. */
async function setup() {
  const automations: Bb[] = [];
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: Record<string, unknown> }) => {
    calls.push({ method, input });
    if (method === "automations_list") return automations.filter((each) => each.projectId === input.projectId);
    if (method === "automations_delete") { const at = automations.findIndex((each) => each.id === input.automationId); if (at < 0) throw Object.assign(new Error("Not found"), { status: 404 }); automations.splice(at, 1); return {}; }
    return {};
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: { plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] } } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const clock = { now: START };
  const { engine, scheduler } = testScheduler(db, bb.sdk, clock);
  const bbAutomation = (id: string, fields: Partial<Bb> = {}) => { automations.push({ id, projectId: "proj_personal", enabled: true, nextRunAt: 99, lastRunAt: null, ...fields }); };
  const heartbeat = (key: string, automationId: string | null, enabled = 1) => db.prepare("INSERT INTO project_runs (project_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES (?, ?, 'weekdays', '08:30', NULL, ?, 'proj_personal')").run(key, enabled, automationId);
  const runner = (id: string, automationId: string, fields: { state?: string; adopted?: number; cron?: string } = {}) => db.prepare(`INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, cron, automation_id, automation_project_id, adopted, created_at, updated_at)
    VALUES (?, 'bot_main', ?, 'job', ?, 'proj_personal', ?, ?, '09:00', ?, ?, 'proj_personal', ?, 1, 1)`).run(id, id, `thr_${id}`, fields.state ?? "active", fields.cron ? "custom" : "hourly", fields.cron ?? null, automationId, fields.adopted ?? 0);
  const automation = (id: string, kind: string, schedule: unknown, bbIds: string[], state = "active") => db.prepare(`INSERT INTO bot_automations (id, bot_id, kind, name, instruction, target, schedule_json, state, project_id, bb_ids, resources, seen_until, created_at, updated_at)
    VALUES (?, 'bot_main', ?, ?, 'do it', 'main', ?, ?, 'proj_personal', ?, ?, 0, 1, 1)`).run(id, kind, id, JSON.stringify(schedule), state, JSON.stringify(bbIds), JSON.stringify(bbIds.map((each) => ({ id: each, projectId: "proj_personal" }))));
  const leads: Record<string, string> = { proj_personal: "thr_bot" };
  const move = () => moveToScheduler({ db, sdk: bb.sdk, scheduler, leadOf: (key) => leads[key] ?? null, askMs: 50 });
  const row = (table: string, id: string) => db.prepare(`SELECT * FROM ${table} WHERE ${table === "project_runs" ? "project_id" : "id"} = ?`).get(id) as Record<string, unknown>;
  return { db, clock, engine, scheduler, automations, calls, callRpc, bbAutomation, heartbeat, runner, automation, leads, move, row };
}

const TIMES: Schedule = { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00", "18:30"], timezone: "America/New_York" };

it("moves heartbeats, Studio's runners, check-ins and reminders to its scheduler with the same schedule and state, and deletes their BB automations", async () => {
  const x = await setup();
  x.bbAutomation("hb", { execution: { targetThreadId: "thr_lead" } });
  x.heartbeat("proj_personal", "hb");
  x.bbAutomation("r_on");
  x.runner("run_on", "r_on");
  x.bbAutomation("r_off", { enabled: false });
  x.runner("run_off", "r_off", { state: "paused" });
  // BB turned this one off by itself: it stays off and shows paused, so Resume brings it back.
  x.bbAutomation("r_bb_off", { enabled: false });
  x.runner("run_bb_off", "r_bb_off", { cron: "*/15 * * * *" });
  // Two times were two BB automations; they become one trigger.
  x.bbAutomation("c1"); x.bbAutomation("c2");
  x.automation("aut_brief", "checkin", TIMES, ["c1", "c2"]);
  x.bbAutomation("c_off", { enabled: false });
  x.automation("aut_bb_off", "checkin", { type: "cron", cron: "0 9 * * *" }, ["c_off"]);
  const at = START + 3_600_000;
  x.bbAutomation("rem");
  x.automation("aut_later", "reminder", { type: "once", at }, ["rem"]);
  // BB already ran this reminder.
  x.bbAutomation("rem_ran", { enabled: false, nextRunAt: null, lastRunAt: START - 5000 });
  x.automation("aut_ran", "reminder", { type: "once", at: START - 5000 }, ["rem_ran"]);

  expect(await x.move()).toBe(8);

  expect(x.row("project_runs", "proj_personal")).toMatchObject({ enabled: 1, automation_id: "trg_heartbeat_proj_personal", lead_thread_id: "thr_lead" });
  expect(x.engine.get("heartbeat", "proj_personal")).toMatchObject({ state: "on", nextAt: nextRun({ type: "cron", cron: "30 8 * * 1-5" }, START, Intl.DateTimeFormat().resolvedOptions().timeZone) });
  expect(x.row("bot_runners", "run_on")).toMatchObject({ automation_id: "trg_runner_run_on", state: "active" });
  expect(x.engine.get("runner", "run_on")!.state).toBe("on");
  expect(x.engine.get("runner", "run_off")!.state).toBe("off");
  expect(x.engine.get("runner", "run_bb_off")!.state).toBe("off");
  expect(x.row("bot_runners", "run_bb_off")).toMatchObject({ automation_id: "trg_runner_run_bb_off", state: "active" });
  expect(x.row("bot_automations", "aut_brief")).toMatchObject({ bb_ids: '["trg_automation_aut_brief"]', resources: '[{"id":"trg_automation_aut_brief","projectId":"proj_personal"}]', state: "active" });
  expect(x.engine.list("automation").filter((each) => each.ownerId === "aut_brief")).toMatchObject([{ state: "on", nextAt: nextRun(TIMES, START, "UTC") }]);
  expect(x.row("bot_automations", "aut_bb_off").state).toBe("paused");
  expect(x.engine.get("automation", "aut_bb_off")!.state).toBe("off");
  expect(x.engine.get("automation", "aut_later")).toMatchObject({ state: "on", nextAt: at });
  expect(x.row("bot_automations", "aut_later").state).toBe("active");
  expect(x.engine.get("automation", "aut_ran")!.state).toBe("done");
  expect(x.row("bot_automations", "aut_ran").state).toBe("done");
  // Every old BB automation is deleted.
  expect(x.automations).toEqual([]);
});

it("leaves watchers, adopted runners and BB's own automations alone", async () => {
  const x = await setup();
  x.bbAutomation("w1"); x.bbAutomation("adopted"); x.bbAutomation("users_own");
  x.automation("aut_watch", "watcher", { type: "cron", cron: "*/5 * * * *" }, ["w1"]);
  x.runner("run_adopted", "adopted", { adopted: 1, cron: "0 8 * * *" });
  expect(await x.move()).toBe(0);
  expect(x.automations.map((each) => each.id)).toEqual(["w1", "adopted", "users_own"]);
  expect(x.row("bot_automations", "aut_watch").bb_ids).toBe('["w1"]');
  expect(x.row("bot_runners", "run_adopted").automation_id).toBe("adopted");
  expect(x.engine.list()).toEqual([]);
  expect(x.calls).toEqual([]);
});

it.each(["throws", "never answers"])("finishes the move from the rows' own state when the automations plugin %s", async (failure) => {
  const x = await setup();
  x.callRpc.mockImplementation(failure === "throws" ? async () => { throw new Error("Plugin automations is disabled"); } : () => new Promise(() => {}));
  x.heartbeat("proj_personal", "hb");
  x.heartbeat("bot:bot_2", "hb2");
  x.heartbeat("p_off", "hb_off", 0);
  x.runner("run_on", "r_on");
  x.runner("run_off", "r_off", { state: "paused" });
  x.automation("aut_brief", "checkin", TIMES, ["c1", "c2"]);
  x.automation("aut_paused", "checkin", TIMES, ["c3", "c4"], "paused");
  x.automation("aut_later", "reminder", { type: "once", at: START + 3_600_000 }, ["rem"]);
  x.leads["bot:bot_2"] = "thr_bot2";
  expect(await x.move()).toBe(8);
  expect(x.row("project_runs", "proj_personal")).toMatchObject({ enabled: 1, automation_id: "trg_heartbeat_proj_personal", lead_thread_id: "thr_bot" });
  expect(x.row("project_runs", "bot:bot_2")).toMatchObject({ automation_id: "trg_heartbeat_bot:bot_2", lead_thread_id: "thr_bot2" });
  // A heartbeat that was off has no schedule until it is turned on.
  expect(x.row("project_runs", "p_off")).toMatchObject({ enabled: 0, automation_id: null });
  expect(x.engine.list().map((each) => [each.id, each.state])).toEqual([
    ["automation:aut_brief", "on"], ["automation:aut_later", "on"], ["automation:aut_paused", "off"],
    ["heartbeat:bot:bot_2", "on"], ["heartbeat:proj_personal", "on"], ["runner:run_off", "off"], ["runner:run_on", "on"],
  ]);
  // It asked once, then stopped asking, so the move does not wait on the plugin.
  expect(x.callRpc.mock.calls.length).toBe(1);
  // The BB automations it could not delete are listed, so the startup repair deletes them if the plugin comes back (they would run beside the triggers).
  expect((x.db.prepare("SELECT automation_id FROM space_retired_automations ORDER BY automation_id").all() as { automation_id: string }[]).map((row) => row.automation_id))
    .toEqual(["c1", "c2", "c3", "c4", "hb", "hb2", "hb_off", "r_off", "r_on", "rem"]);
});

it("is safe to repeat: a second run moves nothing, keeps next times and makes no second trigger", async () => {
  const x = await setup();
  x.bbAutomation("hb"); x.bbAutomation("r_on"); x.bbAutomation("c1"); x.bbAutomation("c2");
  x.heartbeat("proj_personal", "hb");
  x.runner("run_on", "r_on");
  x.automation("aut_brief", "checkin", TIMES, ["c1", "c2"]);
  expect(await x.move()).toBe(3);
  const before = { triggers: x.engine.list(), runs: x.db.prepare("SELECT * FROM project_runs").all(), runners: x.db.prepare("SELECT * FROM bot_runners").all(), automations: x.db.prepare("SELECT * FROM bot_automations").all() };
  x.calls.length = 0;
  x.clock.now += 10 * 60_000;
  expect(await x.move()).toBe(0);
  expect(x.calls).toEqual([]);
  expect({ triggers: x.engine.list(), runs: x.db.prepare("SELECT * FROM project_runs").all(), runners: x.db.prepare("SELECT * FROM bot_runners").all(), automations: x.db.prepare("SELECT * FROM bot_automations").all() }).toEqual(before);
});

it("moves a row whose BB automation is already gone or can't be deleted, and leaves the failed delete to the startup repair", async () => {
  const x = await setup();
  // The runner's automation was deleted in BB; the check-in's delete fails.
  x.runner("run_on", "gone");
  x.bbAutomation("c1");
  x.automation("aut_brief", "checkin", TIMES, ["c1"]);
  const real = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (args) => { if (args.method === "automations_delete" && args.input.automationId === "c1") throw new Error("offline"); return real(args); });
  expect(await x.move()).toBe(2);
  // Gone already (404) needs nothing more; the one BB could not delete is listed for the repair.
  expect(x.db.prepare("SELECT automation_id FROM space_retired_automations").all()).toEqual([{ automation_id: "c1" }]);
  expect(x.engine.get("runner", "run_on")!.state).toBe("on");
  expect(x.row("bot_automations", "aut_brief").bb_ids).toBe('["trg_automation_aut_brief"]');
  x.calls.length = 0;
  expect(await x.move()).toBe(0);
  expect(x.calls).toEqual([]);
});

it("keeps a schedule Studio can't run on BB automations and says so", async () => {
  const x = await setup();
  x.bbAutomation("odd");
  x.automation("aut_odd", "checkin", { type: "cron", cron: "0 9 * * 1#2" }, ["odd"]);
  const warned: string[] = [];
  expect(await moveToScheduler({ db: x.db, sdk: (x.scheduler as unknown as { deps: { sdk: never } }).deps.sdk, scheduler: x.scheduler, leadOf: () => null, warn: (message) => warned.push(message) })).toBe(0);
  expect(x.row("bot_automations", "aut_odd").bb_ids).toBe('["odd"]');
  expect(x.automations.map((each) => each.id)).toEqual(["odd"]);
  expect(warned).toEqual(['Automation aut_odd stays on BB automations: Studio can\'t run its cron "0 9 * * 1#2".']);
});
