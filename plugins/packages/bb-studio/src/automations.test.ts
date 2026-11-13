import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { fromHeartbeat, localZone, type Weekday } from "./schedule";
import { nextRun } from "./triggers/next-run";
import { testScheduler } from "./test/scheduler-fixture";
import { Automations, checkinPrompt, watcherFinding, watcherMessage, type AutomationRunner } from "./automations";
import type { HeartbeatRun } from "./contract";
import type { BbEntry } from "./automation-table";
import type { RunWatcherScript } from "./watcher-script";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

type Off = { importedAt?: number | null; runScript?: RunWatcherScript; bbFile?: () => BbEntry[] };
/** `off`: bb's automations plugin is off (a BB Studio copy): every call to it fails as BB answers then. */
const copiedReminders = new Set<string>();

async function setup(off: Off | null = null) {
  const threads = new Map([["bot1", makeThreadResponse({ id: "bot1", projectId: "proj_personal", providerId: "codex" })], ["bot9", makeThreadResponse({ id: "bot9", projectId: "proj_personal", providerId: "codex" })]]);
  const send = vi.fn(async () => ({ ok: true }));
  const automations: Record<string, unknown>[] = [];
  const runs = new Map<string, Record<string, unknown>[]>();
  /** Each thread's message requests, newest first. */
  const requests = new Map<string, { seq: number; createdAt: number }[]>();
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: Record<string, unknown> }) => {
    calls.push({ method, input });
    if (off) throw Object.assign(new Error('HTTP 503: plugin "automations" is not running (status: disabled)'), { status: 503 });
    const row = automations.find((a) => a.id === input.automationId);
    if (method === "automations_list") return automations.filter((a) => a.projectId === input.projectId);
    if (method === "automations_create") { const made = { id: `a${automations.length + 1}`, projectId: input.projectId, name: input.name, enabled: false, trigger: input.trigger, execution: input.execution, nextRunAt: 1000 + automations.length, lastRunAt: null }; automations.push(made); return made; }
    if (method === "automations_update") { if (!row) throw Object.assign(new Error("Not found"), { status: 404 }); Object.assign(row, input); return row; }
    if (method === "automations_resume" || method === "automations_pause") { if (row) row.enabled = method === "automations_resume"; return row; }
    if (method === "automations_delete") { if (row) automations.splice(automations.indexOf(row), 1); return { ok: true }; }
    if (method === "automations_runs") {
      const all = runs.get(String(input.automationId)) ?? [];
      const start = Number(input.cursor ?? 0), limit = Number(input.limit);
      return { runs: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null };
    }
    return { ok: true };
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      get: (async ({ threadId }: { threadId: string }) => threads.get(threadId)!) as never, send: send as never,
      events: { list: (async ({ threadId, beforeSeq }: { threadId: string; beforeSeq?: string }) => (requests.get(threadId) ?? []).filter((each) => beforeSeq === undefined || each.seq < Number(beforeSeq))) as never } as never,
      defaultExecutionOptions: async () => ({ model: "gpt-big", reasoningLevel: "high", permissionMode: "accept-edits" }) as never,
    },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [{ id: "automations", enabled: !off }] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const bot = { id: "bot_main", name: "Dot", threadId: "bot1" as string | null, state: "active", primary: true, kind: "studio" };
  let heartbeat: HeartbeatRun | null = { enabled: true, cadence: "weekdays", time: "08:00" };
  const setHeartbeat = vi.fn(async (_botId: string, run: HeartbeatRun) => { heartbeat = run; });
  const runnerList: AutomationRunner[] = [];
  const listRunners = vi.fn(async () => runnerList);
  const clock = { now: Date.now() };
  const { engine, scheduler } = testScheduler(db, bb.sdk, clock);
  // The original check-in is a heartbeat on Studio's scheduler (src/project-lead.ts keeps it).
  scheduler.resolve("heartbeat", () => ({ threadId: "bot1", prompt: "Heartbeat" }));
  scheduler.ensure({ owner: "heartbeat", ownerId: "proj_personal" }, { schedule: fromHeartbeat({ cadence: "weekdays", time: "08:00" }), timeZone: localZone() }, true);
  const auto = new Automations({
    db, sdk: bb.sdk, scheduler, changed: () => {}, bot: () => bot, copiedReminder: (id) => copiedReminders.has(id),
    heartbeat: { get: () => heartbeat, set: setHeartbeat, automation: () => ({ id: HB, projectId: "proj_personal" }) },
    runners: {
      list: listRunners, get: vi.fn() as never, create: vi.fn() as never, update: vi.fn() as never, setState: vi.fn() as never, runNow: vi.fn() as never, delete: vi.fn() as never, automation: () => null,
    },
    ...(off ? { importedAt: () => off.importedAt ?? null, ...(off.runScript ? { runScript: off.runScript } : {}), ...(off.bbFile ? { bbFile: off.bbFile } : {}) } : {}),
  });
  return { clock, engine, scheduler, auto, automations, runs, requests, calls, callRpc, send, bot, threads, listRunners, setHeartbeat, db, heartbeat: () => heartbeat };
}

const HB = "trg_heartbeat_proj_personal";
type X = Awaited<ReturnType<typeof setup>>;
/** What was sent; the main Bot's heartbeat is left out unless asked for, since a jump of the clock can make it due too. */
const sent = (x: X, heartbeat = false) => (x.send.mock.calls as unknown as [{ threadId: string; mode: string; permissionMode?: string; input: { type: string; text: string; mentions: unknown[] }[] }][]).map(([arg]) => arg).filter((arg) => heartbeat || !arg.input[0]?.text.includes("due:trg_heartbeat_"));
const trigger = (x: X, id: string) => x.engine.get("automation", id);
/** Runs what is due after this automation's next time. */
const fire = async (x: X, id: string) => { x.clock.now = trigger(x, id)!.nextAt! + 1; await x.engine.tick(); };
const watcher = { kind: "watcher" as const, name: "Releases", script: { body: "echo", interpreter: "bash" as const } };

it("lists the original check-in first, unchanged, then new ones", async () => {
  const x = await setup();
  const list = await x.auto.list();
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: "heartbeat", kind: "checkin", name: "Check-in", original: true, bbIds: [HB], state: "active", scheduleText: "Weekdays 8:00 AM", nextRunAt: x.engine.get("heartbeat", "proj_personal")!.nextAt });
  expect(x.setHeartbeat).not.toHaveBeenCalled();
  // Its schedule is Studio's own: the automations plugin is not asked.
  expect(x.calls).toEqual([]);
  // Run now goes through the scheduler too, and leaves the schedule where it was.
  await x.auto.runNow("heartbeat");
  expect(sent(x, true)).toMatchObject([{ threadId: "bot1", input: [{ text: `[bb automation due:${HB}]\n\nHeartbeat` }] }]);
  expect((await x.auto.runs("heartbeat"))[0]).toMatchObject({ manual: true, status: "running", threadId: "bot1" });
  expect(x.calls).toEqual([]);
});

it("makes a check-in with two times as one trigger on Studio's scheduler, not BB automations", async () => {
  const x = await setup();
  const schedule = { type: "times" as const, days: [1, 2, 3, 4, 5] as Weekday[], times: ["08:00", "18:30"], timezone: "America/New_York" };
  const made = await x.auto.create({ kind: "checkin", name: "Brief", instruction: "Summarize my day.", schedule, model: { model: "gpt-mini", reasoning: "low" } });
  // Two times were two BB automations; here they are one trigger, and the automations plugin is never asked.
  expect(x.automations).toHaveLength(0);
  expect(x.calls).toEqual([]);
  expect(made.bbIds).toEqual([`trg_automation_${made.id}`]);
  expect(x.engine.list("automation")).toHaveLength(1);
  const next = nextRun(schedule, x.clock.now, "UTC");
  expect(trigger(x, made.id)).toMatchObject({ state: "on", nextAt: next });
  expect(made).toMatchObject({ kind: "checkin", state: "active", nextRunAt: next, scheduleText: "Weekdays 8:00 AM, 6:30 PM", model: { model: "gpt-mini", reasoning: "low" } });
  // A due run is the message an automation's run would send: the marker, then the prompt.
  await fire(x, made.id);
  // Moving the clock to this run may also bring the Bot's own heartbeat due; only this check-in's message is compared.
  const mine = () => sent(x).filter((message) => message.input[0]!.text.includes(made.id));
  expect(mine()).toEqual([{ threadId: "bot1", mode: "steer-if-active", permissionMode: "accept-edits", input: [{ type: "text", text: `[bb automation due:trg_automation_${made.id}]\n\n${checkinPrompt("Brief", "Summarize my day.")}`, mentions: [] }] }]);
  expect(mine()[0]!.input[0]!.text).toContain("[PASS]");
  // Both times run: the next one is the other time the same day or the next.
  expect(trigger(x, made.id)!.nextAt).toBe(nextRun(schedule, x.clock.now, "UTC"));
  x.scheduler.threadSettled("bot1", "succeeded", "[PASS]");
  expect(await x.auto.runs(made.id)).toMatchObject([{ status: "succeeded", manual: false, outcome: "Ran", threadId: "bot1" }]);
  expect((await x.auto.list()).find((each) => each.id === made.id)).toMatchObject({ lastRunAt: x.clock.now, lastOutcome: "succeeded" });
  // One time fewer: still the one trigger, on the new schedule.
  await x.auto.update({ id: made.id, schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00"] } });
  expect(x.engine.list("automation")).toHaveLength(1);
  expect(trigger(x, made.id)!.nextAt).toBe(nextRun({ type: "times", days: [1, 2, 3, 4, 5], times: ["08:00"] }, x.clock.now, localZone()));
  expect(await x.auto.setState(made.id, "paused")).toMatchObject({ state: "paused", nextRunAt: null });
  expect(trigger(x, made.id)!.state).toBe("off");
  expect(await x.auto.setState(made.id, "active")).toMatchObject({ state: "active" });
  expect(trigger(x, made.id)!.state).toBe("on");
  await x.auto.delete("Brief");
  expect(trigger(x, made.id)).toBeNull();
  expect(x.calls).toEqual([]);
});

it("never makes BB spawn a thread: check-ins and reminders wake the Bot's own thread, watchers run a script", async () => {
  // So no Bot-owned worker thread can land in BB's thread list (runners are hidden in src/runners.ts).
  const x = await setup();
  const checkin = await x.auto.create({ kind: "checkin", name: "Brief", instruction: "Summarize my day.", schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00"] } });
  const reminder = await x.auto.create({ kind: "reminder", name: "Deploy", instruction: "Check the deploy.", schedule: { type: "once", at: Date.now() + 7_200_000 } });
  await x.auto.create({ ...watcher, schedule: { type: "interval", every: 15, unit: "minutes", days: [0, 1, 2, 3, 4, 5, 6] } });
  // Only the watcher is a BB automation, and it runs a script.
  expect(x.automations.map((a) => (a.execution as { mode: string }).mode)).toEqual(["script"]);
  expect(x.engine.list("automation").map((each) => each.ownerId).sort()).toEqual([checkin.id, reminder.id].sort());
  await x.auto.runNow(checkin.id);
  await x.auto.runNow(reminder.id);
  expect(sent(x).map((each) => each.threadId)).toEqual(["bot1", "bot1"]);
  expect(x.calls.some((call) => call.method === "automations_run")).toBe(false);
});

it("refuses a bad schedule before touching BB", async () => {
  const x = await setup();
  await expect(x.auto.create({ kind: "checkin", name: "Never", instruction: "x", schedule: { type: "times", days: [0], times: ["23:00"], quiet: { from: "22:00", to: "07:00" } } })).rejects.toThrow(/Quiet hours/);
  await expect(x.auto.create({ kind: "reminder", name: "R", instruction: "x", schedule: { type: "times", days: [0], times: ["09:00"] } })).rejects.toThrow(/one time/);
  expect(x.automations).toHaveLength(0);
  expect((await x.auto.list())).toHaveLength(1);
});

it("a reminder fires once and then shows as done", async () => {
  const x = await setup();
  const at = Date.now() + 7_200_000;
  const made = await x.auto.create({ kind: "reminder", name: "Deploy", instruction: "Check the deploy.", schedule: { type: "once", at } });
  expect(trigger(x, made.id)).toMatchObject({ state: "on", nextAt: at });
  expect(made).toMatchObject({ state: "active", nextRunAt: at });
  await fire(x, made.id);
  expect(sent(x)).toMatchObject([{ threadId: "bot1", mode: "steer-if-active", input: [{ text: expect.stringMatching(new RegExp(`^\\[bb automation due:trg_automation_${made.id}\\]\\n\\nReminder "Deploy"`)) }] }]);
  expect(trigger(x, made.id)).toMatchObject({ state: "done", nextAt: null });
  expect((await x.auto.list()).find((each) => each.id === made.id)).toMatchObject({ state: "done", nextRunAt: null });
  // Later ticks send nothing more.
  x.clock.now += 86_400_000;
  await x.engine.tick();
  expect(sent(x).filter((each) => each.input[0]!.text.includes(made.id))).toHaveLength(1);
  // A new time brings it back.
  const again = await x.auto.update({ id: made.id, schedule: { type: "once", at: Date.now() + 86_400_000 * 3 } });
  expect(again.state).toBe("active");
  expect(trigger(x, made.id)!.state).toBe("on");
});

it("a reminder copied into the todos doesn't also wake the Bot: the todo carries it", async () => {
  const x = await setup();
  const made = await x.auto.create({ kind: "reminder", name: "Deploy", instruction: "Check the deploy.", schedule: { type: "once", at: Date.now() + 7_200_000 } });
  copiedReminders.add(made.id);
  try {
    await fire(x, made.id);
    expect(sent(x).filter((each) => each.input[0]!.text.includes(made.id))).toEqual([]);
  } finally { copiedReminders.delete(made.id); }
});

it("running a reminder now does not use it up", async () => {
  const x = await setup();
  const at = Date.now() + 7_200_000;
  const made = await x.auto.create({ kind: "reminder", name: "Deploy", instruction: "Check the deploy.", schedule: { type: "once", at } });
  expect(await x.auto.runNow(made.id)).toMatchObject({ state: "active", nextRunAt: at });
  expect(sent(x)).toHaveLength(1);
  expect(trigger(x, made.id)).toMatchObject({ state: "on", nextAt: at });
  x.scheduler.threadSettled("bot1", "succeeded");
  await x.auto.tick();
  expect(x.db.prepare("SELECT state FROM bot_automations WHERE id = ?").get(made.id)).toEqual({ state: "active" });
  // Its own time still comes, once.
  await fire(x, made.id);
  expect(sent(x)).toHaveLength(2);
  expect((await x.auto.list()).find((each) => each.id === made.id)?.state).toBe("done");
  expect((await x.auto.runs(made.id)).map((run) => run.manual)).toEqual([false, true]);
});

it("a watcher wakes the Bot only for output, once per run", async () => {
  const x = await setup();
  const made = await x.auto.create({ kind: "watcher", name: "Releases", instruction: "Tell me if it's a major.", schedule: { type: "interval", every: 15, unit: "minutes", days: [0, 1, 2, 3, 4, 5, 6] }, script: { body: "curl -s example | jq .tag", interpreter: "bash" } });
  expect(x.automations[0]!.execution).toMatchObject({ mode: "script", script: "curl -s example | jq .tag", interpreter: "bash", workingDirectory: { type: "automation-storage" } });
  const t = Date.now() + 1000;
  x.runs.set("a1", [
    { id: "r3", status: "succeeded", output: "v2.0.0 released\n", exitCode: 0, finishedAt: t + 3 },
    { id: "r2", status: "skipped", output: null, exitCode: 0, skipReason: "empty output", finishedAt: t + 2 },
    { id: "r1", status: "failed", output: "boom", exitCode: 1, finishedAt: t + 1 },
  ]);
  await x.auto.tick();
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: "bot1", input: [expect.objectContaining({ text: "Watcher Releases: v2.0.0 released" }), expect.objectContaining({ visibility: "agent-only" })] }));
  await x.auto.tick();
  expect(x.send).toHaveBeenCalledTimes(1);
  const runs = await x.auto.runs(made.id);
  expect(runs.map((run) => run.outcome)).toEqual(["Woke it: v2.0.0 released", "Nothing new", "Failed"]);
  expect((await x.auto.list()).find((each) => each.id === made.id)?.lastOutcome).toBe("Woke it: v2.0.0 released");
});

it("reads watcher output the way the contract says", () => {
  expect(watcherFinding({ status: "succeeded", output: "  \n", exitCode: 0 })).toBeNull();
  expect(watcherFinding({ status: "succeeded", output: "checked\n{\"wakeAgent\": false}", exitCode: 0 })).toBeNull();
  expect(watcherFinding({ status: "failed", output: "changed", exitCode: 2 })).toBeNull();
  expect(watcherFinding({ status: "succeeded", output: "changed\n", exitCode: 0 })).toBe("changed");
  expect(watcherMessage("W", "x".repeat(3000), "", false).text.length).toBeLessThan(1600);
  expect(watcherMessage("W", "x", "", true).note).toContain("runner_report");
});

it("Stop pauses them and Resume restores exactly those; they follow a handoff", async () => {
  const x = await setup();
  const a = await x.auto.create({ kind: "checkin", name: "A", instruction: "a", schedule: { type: "times", days: [1], times: ["09:00"] } });
  const b = await x.auto.create({ kind: "checkin", name: "B", instruction: "b", schedule: { type: "times", days: [1], times: ["10:00"] } });
  const w = await x.auto.create({ ...watcher, schedule: { type: "times", days: [1], times: ["11:00"] } });
  await x.auto.setState(b.id, "paused");
  const heard: string[] = [];
  expect((await x.auto.pauseAll("bot_main", (id) => heard.push(id))).sort()).toEqual([a.id, w.id].sort());
  expect(heard.sort()).toEqual([a.id, w.id].sort());
  // Check-ins go off on Studio's scheduler; the watcher's BB automation is paused.
  expect([trigger(x, a.id)!.state, trigger(x, b.id)!.state]).toEqual(["off", "off"]);
  expect(x.automations.map((each) => each.enabled)).toEqual([false]);
  x.bot.state = "stopped";
  expect(await x.auto.restore(a.id)).toBe(true);
  expect(await x.auto.restore(w.id)).toBe(true);
  expect([trigger(x, a.id)!.state, trigger(x, b.id)!.state]).toEqual(["on", "off"]);
  expect(x.automations.map((each) => each.enabled)).toEqual([true]);
  x.bot.state = "active";
  x.bot.threadId = "bot9";
  await x.auto.follow(x.bot);
  expect(x.db.prepare("SELECT target_thread_id FROM bot_automations WHERE id = ?").get(a.id)).toEqual({ target_thread_id: "bot9" });
  await fire(x, a.id);
  expect(sent(x).filter((each) => each.input[0]!.text.includes(a.id)).map((each) => each.threadId)).toEqual(["bot9"]);
});

it("edits the original check-in only as one cron, keeping it a heartbeat", async () => {
  const x = await setup();
  await x.auto.update({ id: "heartbeat", schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["07:30"] } });
  expect(x.setHeartbeat).toHaveBeenCalledWith("bot_main", expect.objectContaining({ enabled: true, cadence: "custom", cron: "30 7 * * 1-5" }));
  await expect(x.auto.update({ id: "heartbeat", schedule: { type: "times", days: [1], times: ["07:30", "18:00"] } })).rejects.toThrow(/one repeating cron/);
  await x.auto.setState("heartbeat", "paused");
  expect(x.heartbeat()?.enabled).toBe(false);
});

it("lists the skill curator, pauses it and runs it now, but won't edit or delete it", async () => {
  const x = await setup();
  const state = { paused: false, lastRunAt: null as number | null, lastOutcome: null as string | null, nextRunAt: 5000 as number | null };
  const auto = new Automations({
    db: x.db, sdk: (x.auto as unknown as { deps: { sdk: never } }).deps.sdk, scheduler: x.scheduler, changed: () => {}, bot: () => x.bot,
    heartbeat: { get: () => null, set: vi.fn(), automation: () => null },
    runners: { list: async () => [], get: vi.fn() as never, create: vi.fn() as never, update: vi.fn() as never, setState: vi.fn() as never, runNow: vi.fn() as never, delete: vi.fn() as never, automation: () => null },
    maintenance: {
      get: () => state,
      setPaused: async (_botId, paused) => { state.paused = paused; },
      run: async () => { state.lastRunAt = 7; state.lastOutcome = "1 stale"; },
    },
  });
  expect(await auto.list()).toEqual([expect.objectContaining({ id: "maintenance", name: "Maintenance", scheduleText: "Daily at 4 AM local", state: "active", nextRunAt: 5000 })]);
  expect(await auto.setState("maintenance", "paused")).toMatchObject({ state: "paused", nextRunAt: null });
  expect(await auto.runNow("maintenance")).toMatchObject({ lastRunAt: 7, lastOutcome: "1 stale" });
  expect(await auto.runs("maintenance")).toEqual([expect.objectContaining({ at: 7, outcome: "1 stale" })]);
  await expect(auto.update({ id: "maintenance", name: "x" })).rejects.toThrow(/Maintenance settings/);
  await expect(auto.delete("maintenance")).rejects.toThrow(/turn it off/);
  x.bot.kind = "external";
  expect(await auto.list()).toEqual([]);
});

it("auto-resume: watchers are on only while they and their Bot are active; resumes show among the runs", async () => {
  const x = await setup();
  const made = await x.auto.create({ ...watcher, schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00"], timezone: "America/New_York" } });
  const checkin = await x.auto.create({ kind: "checkin", name: "Brief", instruction: "Summarize my day.", schedule: { type: "times", days: [1], times: ["08:00"] } });
  // A check-in's target is Studio's own schedule: auto-resume (src/auto-resume.ts) leaves `trg_` ids alone.
  expect(x.auto.resumeTargets()).toEqual([expect.objectContaining({ automationId: "a1", ownerId: made.id, on: true }), expect.objectContaining({ automationId: `trg_automation_${checkin.id}`, ownerId: checkin.id, on: true })]);
  x.bot.state = "paused";
  expect(x.auto.resumeTargets()[0]!.on).toBe(false);
  x.bot.state = "stopped";
  expect(x.auto.resumeTargets()[0]!.on).toBe(false);
  x.bot.state = "active";
  await x.auto.setState(made.id, "paused");
  expect(x.auto.resumeTargets()[0]!.on).toBe(false);
  await x.auto.setState(made.id, "active");
  x.db.prepare("INSERT INTO automation_auto_resumes (automation_id, bot_id, owner, owner_id, event, reason, run_id, message, at) VALUES ('a1', 'bot_main', 'automation', ?, 'resumed', 'host disconnected', 'arun_1', 'Resumed after BB turned it off (host disconnected) — 1 of 3 today', ?)").run(made.id, Date.now());
  expect((await x.auto.runs(made.id))[0]).toMatchObject({ status: "resumed", outcome: expect.stringContaining("1 of 3 today") });
  expect((await x.auto.list()).find((each) => each.id === made.id)?.lastOutcome).toContain("Resumed after BB");
});

it("single-flights overlapping watcher ticks and releases the watcher afterward", async () => {
  const x = await setup();
  await x.auto.create({ kind: "watcher", name: "Releases", schedule: { type: "interval", every: 15, unit: "minutes", days: [1] }, script: { body: "echo", interpreter: "bash" } });
  const t = Date.now() + 1000;
  x.runs.set("a1", [{ id: "r1", status: "succeeded", output: "v2", exitCode: 0, finishedAt: t }]);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const sending = new Promise<void>((resolve) => { entered = resolve; });
  x.send.mockImplementationOnce(async () => { entered(); await blocked; return { ok: true }; });
  const first = x.auto.tick();
  await sending;
  const second = x.auto.tick();
  release();
  await Promise.all([first, second]);
  expect(x.send).toHaveBeenCalledTimes(1);
  x.runs.get("a1")!.push({ id: "r2", status: "succeeded", output: "v3", exitCode: 0, finishedAt: t + 1 });
  await x.auto.tick();
  expect(x.send).toHaveBeenCalledTimes(2);
});

it("catches up every watcher page and later-visible runs at the cursor timestamp", async () => {
  const x = await setup();
  await x.auto.create({ kind: "watcher", name: "Releases", schedule: { type: "cron", cron: "* * * * *" }, script: { body: "echo", interpreter: "bash" } });
  const t = Date.now() + 1000;
  x.runs.set("a1", Array.from({ length: 45 }, (_, i) => ({ id: `r${i}`, status: "succeeded", output: `${i}`, finishedAt: t + 45 - i })));
  await x.auto.tick();
  expect(x.send).toHaveBeenCalledTimes(45);
  x.runs.get("a1")!.unshift({ id: "late", status: "succeeded", output: "late", finishedAt: t + 45 });
  await x.auto.tick();
  expect(x.send).toHaveBeenCalledTimes(46);
  await x.auto.tick();
  expect(x.send).toHaveBeenCalledTimes(46);
});


it("keeps reads pure after handoff and reminder completion", async () => {
  const x = await setup();
  const a = await x.auto.create({ kind: "reminder", name: "Remind", instruction: "x", schedule: { type: "once", at: Date.now() + 10000 } });
  x.bot.threadId = "bot9";
  // It reads the Bot's thread when it is due, so it wakes the new one with no follow step.
  await fire(x, a.id);
  expect(sent(x).map((each) => each.threadId)).toEqual(["bot9"]);
  const before = x.db.prepare("SELECT * FROM bot_automations").all();
  expect((await x.auto.list()).find((v) => v.id === a.id)?.state).toBe("done");
  expect(x.db.prepare("SELECT * FROM bot_automations").all()).toEqual(before);
  expect(x.calls).toEqual([]);
});

it("retains a watcher's desired configuration after a partial update and retries on tick", async () => {
  const x = await setup();
  const made = await x.auto.create({ ...watcher, schedule: { type: "times", days: [1], times: ["08:00", "18:30"] } });
  expect(x.automations).toHaveLength(2);
  const original = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (args) => {
    if (args.method === "automations_update" && args.input.automationId === "a2") throw new Error("offline");
    return original(args);
  });
  await expect(x.auto.update({ id: made.id, script: { body: "echo desired", interpreter: "bash" } })).rejects.toThrow("offline");
  expect((await x.auto.list()).find((v) => v.id === made.id)).toMatchObject({ script: { body: "echo desired" }, lastOutcome: expect.stringContaining("retry") });
  x.callRpc.mockImplementation(original);
  await x.auto.tick();
  expect(x.automations.every((a) => (a.execution as { script: string }).script === "echo desired")).toBe(true);
  expect((await x.auto.list()).find((v) => v.id === made.id)?.lastOutcome).toBeNull();
});

it("retries a check-in left half-provisioned, on tick", async () => {
  const x = await setup();
  const made = await x.auto.create({ kind: "checkin", name: "Brief", instruction: "old", schedule: { type: "times", days: [1], times: ["08:00"] } });
  vi.spyOn(x.scheduler, "ensure").mockImplementationOnce(() => { throw new Error("disk full"); });
  await expect(x.auto.update({ id: made.id, instruction: "desired", schedule: { type: "times", days: [2], times: ["09:00"] } })).rejects.toThrow("disk full");
  expect((await x.auto.list()).find((v) => v.id === made.id)).toMatchObject({ instruction: "desired", lastOutcome: expect.stringContaining("retry") });
  await x.auto.tick();
  expect(trigger(x, made.id)!.nextAt).toBe(nextRun({ type: "times", days: [2], times: ["09:00"] }, x.clock.now, localZone()));
  expect((await x.auto.list()).find((v) => v.id === made.id)?.lastOutcome).toBeNull();
});

it("retains a watcher's failed creation cleanup and retries without leaving enabled resources", async () => {
  const x = await setup();
  const original = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (args) => {
    if (args.method === "automations_resume" || args.method === "automations_delete") throw new Error("offline");
    return original(args);
  });
  await expect(x.auto.create({ ...watcher, schedule: { type: "cron", cron: "0 8 * * *" } })).rejects.toThrow("offline");
  expect(x.db.prepare("SELECT * FROM bot_automations").all()).toHaveLength(1);
  x.callRpc.mockImplementation(original);
  await x.auto.tick();
  expect(x.automations).toHaveLength(0);
  expect(x.db.prepare("SELECT * FROM bot_automations").all()).toHaveLength(0);
});

it("leaves no trigger behind when making a check-in fails", async () => {
  const x = await setup();
  x.threads.set("bot1", { ...makeThreadResponse({ id: "bot1", projectId: "proj_personal" }), providerId: null } as never);
  await expect(x.auto.create({ kind: "checkin", name: "Brief", instruction: "x", schedule: { type: "cron", cron: "0 8 * * *" } })).rejects.toThrow(/provider and model/);
  expect(x.db.prepare("SELECT * FROM bot_automations").all()).toHaveLength(0);
  expect(x.engine.list("automation")).toEqual([]);
  // A cron Studio can't run is refused, not saved as a schedule that never fires.
  x.threads.set("bot1", makeThreadResponse({ id: "bot1", projectId: "proj_personal", providerId: "codex" }));
  await expect(x.auto.create({ kind: "checkin", name: "Brief", instruction: "x", schedule: { type: "cron", cron: "0 8 * * 1#2" } })).rejects.toThrow(/cron/);
  expect(x.engine.list("automation")).toEqual([]);
});


it("retains each BB resource's project during a failed move and deletes with those identities", async () => {
  const x = await setup();
  const made = await x.auto.create({ ...watcher, schedule: { type: "times", days: [1], times: ["08:00", "18:30"] } });
  // Its BB automations sit in another project (a row from when automations followed the thread's project).
  x.db.prepare("UPDATE bot_automations SET resources = ?, project_id = 'proj_old' WHERE id = ?").run(JSON.stringify([{ id: "a1", projectId: "proj_old" }, { id: "a2", projectId: "proj_old" }]), made.id);
  const original = x.callRpc.getMockImplementation()!;
  let count = 0;
  x.callRpc.mockImplementation(async (args) => {
    if (args.method === "automations_delete" && ++count === 2) throw new Error("offline");
    return original(args);
  });
  await expect(x.auto.update({ id: made.id, instruction: "new" })).rejects.toThrow("offline");
  const row = x.db.prepare("SELECT resources FROM bot_automations WHERE id = ?").get(made.id) as { resources: string };
  expect(JSON.parse(row.resources).map((r: { projectId: string }) => r.projectId)).toEqual(["proj_personal", "proj_old"]);
  x.callRpc.mockImplementation(original);
  x.calls.length = 0;
  await x.auto.delete(made.id);
  expect(x.calls.filter((c) => c.method === "automations_delete").map((c) => c.input.projectId)).toEqual(["proj_personal", "proj_old"]);
});

it("rejects reserved and runner names consistently and refuses ambiguous legacy names", async () => {
  const x = await setup();
  const input = { kind: "checkin" as const, instruction: "x", schedule: { type: "cron" as const, cron: "0 8 * * *" } };
  for (const name of ["heartbeat", "Maintenance", "Check-in"]) await expect(x.auto.create({ ...input, name })).rejects.toThrow(/already|reserved/);
  const made = await x.auto.create({ ...input, name: "Brief" });
  await expect(x.auto.update({ id: made.id, name: "heartbeat" })).rejects.toThrow(/already|reserved/);
  x.db.prepare("INSERT INTO bot_runners (id, bot_id, name, job, project_id, state, cadence, time, created_at, updated_at) VALUES ('run_old', 'bot_main', 'Brief', 'x', 'proj_personal', 'active', 'daily', '09:00', 1, 1)").run();
  await expect(x.auto.delete("Brief")).rejects.toThrow(/ambiguous/);
  await expect(x.auto.create({ ...input, name: "Brief" })).rejects.toThrow(/already/);
  await x.auto.delete(made.id);
  expect(x.db.prepare("SELECT id FROM bot_runners WHERE id = 'run_old'").get()).toBeTruthy();
});


it("returns the changed automation without reading unrelated runners", async () => {
  const x = await setup();
  x.listRunners.mockRejectedValue(new Error("unrelated runner unavailable"));
  const a = await x.auto.create({ kind: "checkin", name: "Brief", instruction: "x", schedule: { type: "cron", cron: "0 8 * * *" } });
  expect(await x.auto.update({ id: a.id, instruction: "new" })).toMatchObject({ instruction: "new" });
  expect(x.listRunners).not.toHaveBeenCalled();
});

it("completes reminders during reconciliation while reads stay pure", async () => {
  const x = await setup();
  const a = await x.auto.create({ kind: "reminder", name: "Remind", instruction: "x", schedule: { type: "once", at: Date.now() + 10000 } });
  await fire(x, a.id);
  await x.auto.list();
  expect(x.db.prepare("SELECT state FROM bot_automations WHERE id = ?").get(a.id)).toEqual({ state: "active" });
  await x.auto.tick();
  expect(x.db.prepare("SELECT state FROM bot_automations WHERE id = ?").get(a.id)).toEqual({ state: "done" });
  expect(await x.auto.restore(a.id)).toBe(false);
  expect(x.calls).toEqual([]);
});

it("retries a watcher's partially applied pause with the desired paused state", async () => {
  const x = await setup();
  const a = await x.auto.create({ ...watcher, schedule: { type: "times", days: [1], times: ["08:00", "18:30"] } });
  const original = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (args) => { if (args.method === "automations_pause" && args.input.automationId === "a2") throw new Error("offline"); return original(args); });
  await expect(x.auto.setState(a.id, "paused")).rejects.toThrow("offline");
  x.callRpc.mockImplementation(original);
  await x.auto.tick();
  expect(x.automations.every((a) => !a.enabled)).toBe(true);
  expect((await x.auto.list()).find((v) => v.id === a.id)).toMatchObject({ state: "paused", lastOutcome: null });
});

it.each(["offline", "invalid"])("reports an unavailable automation list (%s) for a watcher without changing stored schedules", async (failure) => {
  const x = await setup();
  await x.auto.create({ ...watcher, schedule: { type: "cron", cron: "0 8 * * *" } });
  const before = x.db.prepare("SELECT * FROM bot_automations").all();
  x.callRpc.mockImplementationOnce(async () => { if (failure === "offline") throw new Error("offline"); return [{}] as never; });
  await expect(x.auto.list()).rejects.toThrow();
  expect(x.db.prepare("SELECT * FROM bot_automations").all()).toEqual(before);
  expect(await x.auto.list()).toHaveLength(2);
});

it("lists, runs and changes check-ins and reminders with the automations plugin off", async () => {
  const x = await setup();
  x.callRpc.mockImplementation(async () => { throw new Error("Plugin automations is disabled"); });
  // Six hours from now, so the reminder fired two hours ahead never makes the check-in due too.
  const later = `${String((new Date(x.clock.now).getHours() + 6) % 24).padStart(2, "0")}:00`;
  const checkin = await x.auto.create({ kind: "checkin", name: "Brief", instruction: "Summarize my day.", schedule: { type: "times", days: [0, 1, 2, 3, 4, 5, 6], times: [later] } });
  const reminder = await x.auto.create({ kind: "reminder", name: "Later", instruction: "Check", schedule: { type: "once", at: Date.now() + 7_200_000 } });
  const listed = new Map((await x.auto.list()).map((each) => [each.id, [each.state, each.nextRunAt]]));
  expect(listed).toEqual(new Map([
    ["heartbeat", ["active", x.engine.get("heartbeat", "proj_personal")!.nextAt]], [checkin.id, ["active", trigger(x, checkin.id)!.nextAt]], [reminder.id, ["active", trigger(x, reminder.id)!.nextAt]],
  ]));
  await fire(x, reminder.id);
  expect(sent(x).filter((each) => each.input[0]!.text.startsWith(`[bb automation due:trg_automation_${reminder.id}]`))).toHaveLength(1);
  await x.auto.setState(checkin.id, "paused");
  await x.auto.runNow(checkin.id);
  await x.auto.tick();
  expect(await x.auto.runs(checkin.id)).toHaveLength(1);
  await x.auto.delete(checkin.id);
  await x.auto.delete(reminder.id);
  expect(x.engine.list("automation")).toEqual([]);
});


it("includes runner machine metadata in automation responses for Schedule", async () => {
  const x = await setup();
  x.listRunners.mockResolvedValue([{ id: "remote", name: "Security", job: "Check dependencies", threadId: "thr_remote", state: "active",
    schedule: { cadence: "hourly", time: "09:00" }, nextRunAt: null, lastRunAt: null, lastReport: null, lastLevel: null, lastReportAt: null,
    machineName: "homelab", machineOffline: true }]);
  expect((await x.auto.list()).find(item => item.id === "remote")).toMatchObject({ machineName: "homelab", machineOffline: true });
});

it("links a watcher's run to the message it sent, else to its automation's runs", async () => {
  const x = await setup();
  const made = await x.auto.create({ ...watcher, schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00"] } });
  const bbId = x.automations[0]!.id as string;
  x.runs.set(bbId, [
    { id: "late", status: "failed", threadId: "bot1", startedAt: 50_000_000, error: "Target thread bot1 is in an error state" },
    { id: "sent", status: "succeeded", threadId: "bot1", startedAt: 10_000_000 },
    { id: "none", status: "failed", threadId: null, startedAt: 20_000_000, error: "Target thread bot1 is in an error state" },
  ]);
  // The chat's requests, newest first: a later message, the run's, an older one.
  x.requests.set("bot1", [{ seq: 90, createdAt: 30_000_000 }, { seq: 41, createdAt: 10_000_400 }, { seq: 12, createdAt: 1_000 }]);
  expect(await x.auto.runLink(made.id, "sent")).toEqual({ threadId: "bot1", seq: 41, path: `/plugins/automations/automations/proj_personal/${bbId}` });
  // Failed before it sent anything, with no thread of its own: its automation's runs.
  expect(await x.auto.runLink(made.id, "none")).toEqual({ threadId: null, seq: null, path: `/plugins/automations/automations/proj_personal/${bbId}` });
  // A thread of its own with nothing sent: that thread.
  expect(await x.auto.runLink(made.id, "late")).toMatchObject({ threadId: "bot1", seq: null });
});

it("links a check-in's run to the message it sent in the Bot's chat; it has no page in the automations plugin", async () => {
  const x = await setup();
  const made = await x.auto.create({ kind: "checkin", name: "Brief", instruction: "Summarize my day.", schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00"] } });
  await fire(x, made.id);
  const run = (await x.auto.runs(made.id))[0]!;
  x.requests.set("bot1", [{ seq: 90, createdAt: x.clock.now + 40 * 60_000 }, { seq: 41, createdAt: x.clock.now + 400 }, { seq: 12, createdAt: 1_000 }]);
  expect(await x.auto.runLink(made.id, run.id)).toEqual({ threadId: "bot1", seq: 41, path: null });
});

// ---- bb's automations plugin off (a BB Studio copy) ----

const IMPORTED = Date.now() - 86_400_000;
/** A Studio row as the copy's import left it: made before the import, paused, its watcher on a bb automation. */
const imported = (x: X, id: string, kind: "watcher" | "checkin", bbIds: string[]) => x.db.prepare(`INSERT INTO bot_automations (id, bot_id, kind, name, instruction, script, target, schedule_json, state, project_id, bb_ids, seen_until, created_at, updated_at)
  VALUES (?, 'bot_main', ?, ?, 'Look', ?, 'main', ?, 'paused', 'proj_personal', ?, 0, ?, ?)`).run(id, kind, `Old ${id}`, kind === "watcher" ? "./old.sh" : null, JSON.stringify({ type: "times", days: [0, 1, 2, 3, 4, 5, 6], times: ["07:45"] }), JSON.stringify(bbIds), IMPORTED - 1000, IMPORTED - 1000);

it("with bb's automations plugin off, lists without it: its rows read-only from its data file", async () => {
  const x = await setup({ importedAt: IMPORTED, bbFile: () => [{ id: "auto_old", projectId: "proj_personal", name: "Dot · Old aut_old", enabled: false, cron: "45 7 * * *", runAt: null, nextRunAt: null, lastRunAt: 1234, lastRunStatus: "succeeded", threadIds: [], createdAt: IMPORTED - 1000, instruction: null }] });
  imported(x, "aut_old", "watcher", ["auto_old"]);
  const list = await x.auto.list();
  expect(list.find((each) => each.id === "aut_old")).toMatchObject({ state: "paused", inBb: true, lastRunAt: 1234, nextRunAt: null });
});

it("with bb's automations plugin off, a watcher made after the import runs on Studio's scheduler, fully editable", async () => {
  const runScript = vi.fn<RunWatcherScript>(async () => ({ exitCode: 0, output: "v2.0.0 released\n", error: null }));
  const x = await setup({ importedAt: IMPORTED, runScript });
  const made = await x.auto.create({ ...watcher, schedule: { type: "interval", every: 15, unit: "minutes", days: [0, 1, 2, 3, 4, 5, 6] } });
  expect(made).toMatchObject({ state: "active", inBb: false, bbIds: [`trg_watcher_${made.id}`] });
  expect(x.calls.filter((call) => call.method !== "automations_list")).toEqual([]);
  expect(x.engine.get("watcher", made.id)).toMatchObject({ state: "on" });

  x.clock.now = x.engine.get("watcher", made.id)!.nextAt! + 1;
  await x.engine.tick();
  expect(runScript).toHaveBeenCalledWith(expect.objectContaining({ body: "echo", interpreter: "bash" }));
  expect(sent(x)).toEqual([expect.objectContaining({ threadId: "bot1", input: [expect.objectContaining({ text: "Watcher Releases: v2.0.0 released" }), expect.objectContaining({ visibility: "agent-only" })] })]);
  expect((await x.auto.runs(made.id)).map((run) => run.outcome)).toEqual(["Woke it: v2.0.0 released"]);

  runScript.mockResolvedValueOnce({ exitCode: 0, output: "", error: null });
  await x.auto.runNow(made.id);
  expect(runScript).toHaveBeenCalledTimes(2);
  expect(sent(x)).toHaveLength(1);

  await x.auto.setState(made.id, "paused");
  expect(x.engine.get("watcher", made.id)?.state).toBe("off");
  await x.auto.setState(made.id, "active");
  expect(x.engine.get("watcher", made.id)?.state).toBe("on");
  const edited = await x.auto.update({ id: made.id, script: { body: "echo new", interpreter: "sh" } });
  expect(edited.bbIds).toEqual([`trg_watcher_${made.id}`]);
  await x.auto.delete(made.id);
  expect(x.engine.get("watcher", made.id)).toBeNull();
  expect(x.calls.filter((call) => call.method !== "automations_list")).toEqual([]);
});

it("with bb's automations plugin off, check-ins made after the import run, pause and edit on Studio's scheduler", async () => {
  const x = await setup({ importedAt: IMPORTED });
  const made = await x.auto.create({ kind: "checkin", name: "Evening", instruction: "Wrap up.", schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["18:00"] } });
  expect(made).toMatchObject({ state: "active", inBb: false });
  await x.auto.runNow(made.id);
  expect(sent(x)[0]?.input[0]?.text).toContain(`due:trg_automation_${made.id}`);
  await x.auto.setState(made.id, "paused");
  expect((await x.auto.update({ id: made.id, instruction: "Wrap up the day." })).instruction).toBe("Wrap up the day.");
  expect(x.calls.filter((call) => call.method !== "automations_list")).toEqual([]);
});

it("refuses every change to what the import paused, and leaves it as it was", async () => {
  const x = await setup({ importedAt: IMPORTED });
  imported(x, "aut_old", "checkin", ["trg_automation_aut_old"]);
  for (const change of [
    () => x.auto.setState("aut_old", "active"), () => x.auto.runNow("aut_old"), () => x.auto.delete("aut_old"),
    () => x.auto.update({ id: "aut_old", instruction: "New" }),
  ]) await expect(change()).rejects.toThrow("It runs in bb");
  expect(x.db.prepare("SELECT state, instruction FROM bot_automations WHERE id = 'aut_old'").get()).toEqual({ state: "paused", instruction: "Look" });
});

it("with the plugin on but not answering, still fails closed", async () => {
  const x = await setup();
  await x.auto.create({ ...watcher, schedule: { type: "interval", every: 15, unit: "minutes", days: [0, 1, 2, 3, 4, 5, 6] } });
  x.callRpc.mockImplementation(async () => { throw new Error("offline"); });
  await expect(x.auto.list()).rejects.toThrow("offline");
});
