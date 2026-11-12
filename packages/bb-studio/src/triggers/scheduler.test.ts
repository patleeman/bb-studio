import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { testScheduler } from "../test/scheduler-fixture";
import { isScheduleId, scheduleId, scheduleKey, type RunTarget } from "./scheduler";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

type Thread = ReturnType<typeof makeThreadResponse>;
const START = Date.parse("2026-11-10T12:00:00Z");
const HOURLY = { schedule: { type: "cron" as const, cron: "0 * * * *" }, timeZone: "UTC" };
const KEY = { owner: "runner" as const, ownerId: "run_1" };
const ID = "trg_runner_run_1";

async function setup() {
  const threads = new Map<string, Thread>();
  const add = (fields: Partial<Thread> & { id: string }) => { const thread = makeThreadResponse({ projectId: "p", providerId: "codex", status: "idle", ...fields }); threads.set(thread.id, thread); return thread; };
  add({ id: "thr", environmentId: "env_thr" });
  const hosts = new Map([["host_1", { id: "host_1", status: "connected" }]]);
  const send = vi.fn(async (_args: { threadId: string; mode: string; permissionMode?: string; input: { type: string; text: string; mentions: unknown[] }[] }) => ({}));
  const get = vi.fn(async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("Not found"), { status: 404 }); return thread; });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: { get: get as never, send: send as never, defaultExecutionOptions: (async () => ({ model: "m", permissionMode: "auto" })) as never },
    environments: { get: (async ({ environmentId }: { environmentId: string }) => ({ id: environmentId, hostId: "host_1" })) as never },
    hosts: { get: (async ({ hostId }: { hostId: string }) => hosts.get(hostId)) as never },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const clock = { now: START };
  const { engine, scheduler, warnings } = testScheduler(db, bb.sdk, clock);
  const target: { current: RunTarget | null } = { current: { threadId: "thr", prompt: "Check the inbox." } };
  scheduler.resolve("runner", () => target.current);
  const set = (id: string, fields: Partial<Thread>) => threads.set(id, { ...threads.get(id)!, ...fields } as Thread);
  /** Moves the clock just past the next due time and runs what is due. */
  const due = async () => { clock.now = engine.get("runner", "run_1")!.nextAt! + 1000; return engine.tick(); };
  return { db, clock, engine, scheduler, warnings, threads, add, set, hosts, send, get, target, due };
}

it("names its ids so features can tell them from BB automation ids", () => {
  expect(scheduleId({ owner: "heartbeat", ownerId: "bot:bot_1" })).toBe("trg_heartbeat_bot:bot_1");
  expect(scheduleKey("trg_heartbeat_proj_personal")).toEqual({ owner: "heartbeat", ownerId: "proj_personal" });
  expect(scheduleKey("trg_automation_aut_x1")).toEqual({ owner: "automation", ownerId: "aut_x1" });
  expect(scheduleKey("aut_x1")).toBeNull();
  expect(scheduleKey("trg_other_x")).toBeNull();
  expect([isScheduleId("trg_runner_r"), isScheduleId("a1"), isScheduleId(null)]).toEqual([true, false, false]);
});

it("sends a due run as the automations plugin does: the marker, the prompt, steer-if-active and the thread's permission mode", async () => {
  const x = await setup();
  expect(x.scheduler.ensure(KEY, HOURLY, true)).toBe(ID);
  expect(x.scheduler.status(KEY)).toEqual({ on: true, done: false, nextRunAt: Date.parse("2026-11-10T13:00:00Z"), lastRunAt: null, lastRunStatus: null });
  expect(await x.engine.tick()).toBe(0);
  expect(x.send).not.toHaveBeenCalled();
  await x.due();
  expect(x.send.mock.calls).toEqual([[{ threadId: "thr", mode: "steer-if-active", permissionMode: "auto", input: [{ type: "text", text: "[bb automation due:trg_runner_run_1]\n\nCheck the inbox.", mentions: [] }] }]]);
  expect(x.scheduler.status(KEY)).toEqual({ on: true, done: false, nextRunAt: Date.parse("2026-11-10T14:00:00Z"), lastRunAt: x.clock.now, lastRunStatus: "running" });
  expect(x.scheduler.runs(KEY)).toEqual([{ id: expect.stringMatching(/^trg_runner_run_1#\d+$/), status: "running", reason: "time", threadId: "thr", scheduledFor: Date.parse("2026-11-10T13:00:00Z"), startedAt: x.clock.now, finishedAt: null, error: null, output: null }]);
  // A resolver's own permission mode wins.
  x.scheduler.threadSettled("thr", "succeeded");
  x.target.current = { threadId: "thr", prompt: "Again.", permissionMode: "full" };
  await x.due();
  expect(x.send.mock.calls[1]![0]).toMatchObject({ permissionMode: "full", input: [{ text: "[bb automation due:trg_runner_run_1]\n\nAgain." }] });
});

it("closes a run when its thread goes idle (succeeded, with the reply) or fails (failed, with the error)", async () => {
  const x = await setup();
  x.scheduler.ensure(KEY, HOURLY, true);
  await x.due();
  const started = x.clock.now;
  x.clock.now += 90_000;
  x.scheduler.threadSettled("other", "succeeded", "not this one");
  expect(x.scheduler.status(KEY).lastRunStatus).toBe("running");
  x.scheduler.threadSettled("thr", "succeeded", "[PASS]");
  expect(x.scheduler.runs(KEY)[0]).toMatchObject({ status: "succeeded", startedAt: started, finishedAt: x.clock.now, output: "[PASS]", error: null });
  // A later idle does not touch a finished run.
  x.clock.now += 1000;
  x.scheduler.threadSettled("thr", "failed", "late");
  expect(x.scheduler.runs(KEY)[0]).toMatchObject({ status: "succeeded", output: "[PASS]" });
  await x.due();
  x.scheduler.threadSettled("thr", "failed", "The provider stopped sending progress.");
  expect(x.scheduler.runs(KEY)[0]).toMatchObject({ status: "failed", error: "The provider stopped sending progress.", output: null });
  expect(x.scheduler.status(KEY)).toMatchObject({ on: true, lastRunStatus: "failed" });
  // A send BB refuses is a failed run, and the schedule goes on.
  x.send.mockRejectedValueOnce(new Error("Runner is moving to another machine; this run was skipped."));
  await x.due();
  expect(x.scheduler.runs(KEY)[0]).toMatchObject({ status: "failed", error: "Runner is moving to another machine; this run was skipped." });
  expect(x.warnings).toEqual(["Trigger runner:run_1 failed: Runner is moving to another machine; this run was skipped."]);
  expect(x.scheduler.status(KEY).on).toBe(true);
});

it.each(["pending", "starting", "stopping"] as const)("waits while the thread is %s: the run stays due and goes out at the next tick", async (status) => {
  const x = await setup();
  x.scheduler.ensure(KEY, HOURLY, true);
  const dueAt = x.engine.get("runner", "run_1")!.nextAt;
  x.set("thr", { status });
  await x.due();
  x.clock.now += 60_000;
  await x.engine.tick();
  expect(x.send).not.toHaveBeenCalled();
  expect(x.engine.get("runner", "run_1")).toMatchObject({ state: "on", nextAt: dueAt, lastAt: null });
  expect(x.scheduler.status(KEY)).toMatchObject({ on: true, nextRunAt: dueAt, lastRunAt: null });
  x.set("thr", { status: "idle" });
  x.clock.now += 60_000;
  await x.engine.tick();
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.scheduler.runs(KEY)).toMatchObject([{ status: "running", scheduledFor: dueAt }]);
  expect(x.engine.get("runner", "run_1")!.nextAt).toBe(Date.parse("2026-11-10T14:00:00Z"));
});

it("waits while no host is connected, noting it once, and does not replay the runs it missed", async () => {
  const x = await setup();
  x.scheduler.ensure(KEY, HOURLY, true);
  const dueAt = x.engine.get("runner", "run_1")!.nextAt;
  x.hosts.set("host_1", { id: "host_1", status: "disconnected" });
  await x.due();
  // Three hours of ticks with the host away.
  for (let minute = 0; minute < 180; minute++) { x.clock.now += 60_000; await x.engine.tick(); }
  expect(x.send).not.toHaveBeenCalled();
  expect(x.scheduler.runs(KEY)).toMatchObject([{ status: "skipped", error: "No host connected.", scheduledFor: dueAt }]);
  expect(x.scheduler.status(KEY)).toMatchObject({ on: true, nextRunAt: dueAt, lastRunAt: null, lastRunStatus: "skipped" });
  x.hosts.set("host_1", { id: "host_1", status: "connected" });
  x.clock.now += 60_000;
  await x.engine.tick();
  await x.engine.tick();
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.engine.get("runner", "run_1")!.nextAt).toBe(Date.parse("2026-11-10T17:00:00Z"));
});

it.each([
  ["archived", (x: Awaited<ReturnType<typeof setup>>) => x.set("thr", { archivedAt: 5 })],
  ["deleted", (x: Awaited<ReturnType<typeof setup>>) => x.set("thr", { deletedAt: 5 })],
  ["gone from BB", (x: Awaited<ReturnType<typeof setup>>) => x.threads.delete("thr")],
  ["no longer wanted by its feature", (x: Awaited<ReturnType<typeof setup>>) => { x.target.current = null; }],
])("turns the trigger off when its thread is %s", async (_what, change) => {
  const x = await setup();
  x.scheduler.ensure(KEY, HOURLY, true);
  change(x);
  await x.due();
  x.clock.now += 2 * 3_600_000;
  await x.engine.tick();
  expect(x.send).not.toHaveBeenCalled();
  expect(x.scheduler.status(KEY)).toMatchObject({ on: false, nextRunAt: null, lastRunStatus: "skipped" });
  expect(x.scheduler.runs(KEY)).toMatchObject([{ status: "skipped", error: expect.stringMatching(/deleted or archived|Nothing to run/) }]);
});

it("keeps waiting, not off, when BB can't say whether the thread is there", async () => {
  const x = await setup();
  x.scheduler.ensure(KEY, HOURLY, true);
  const dueAt = x.engine.get("runner", "run_1")!.nextAt;
  x.get.mockRejectedValueOnce(Object.assign(new Error("Server unavailable"), { status: 503 }));
  await x.due();
  expect(x.scheduler.status(KEY)).toMatchObject({ on: true, nextRunAt: dueAt });
  x.clock.now += 60_000;
  await x.engine.tick();
  expect(x.send).toHaveBeenCalledTimes(1);
});

it("never runs two at once: a due run is skipped while the one before is still going", async () => {
  const x = await setup();
  x.scheduler.ensure(KEY, HOURLY, true);
  await x.due();
  x.set("thr", { status: "active" });
  await x.due();
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.scheduler.runs(KEY).map((run) => [run.status, run.error])).toEqual([["skipped", "The run before it was still going."], ["running", null]]);
  // Its next time comes as usual, and Run now is refused meanwhile.
  expect(x.scheduler.status(KEY)).toMatchObject({ on: true, nextRunAt: Date.parse("2026-11-10T15:00:00Z"), lastRunStatus: "running" });
  await expect(x.scheduler.runNow(KEY)).rejects.toThrow("It's already running.");
  x.set("thr", { status: "idle" });
  x.scheduler.threadSettled("thr", "succeeded", "Done.");
  await x.due();
  expect(x.send).toHaveBeenCalledTimes(2);
});

it("takes a run whose end it missed as over once the thread is no longer running", async () => {
  const x = await setup();
  x.scheduler.ensure(KEY, HOURLY, true);
  await x.due();
  // Studio restarted and never heard thread.idle; the thread is idle now.
  await x.due();
  expect(x.send).toHaveBeenCalledTimes(2);
  expect(x.scheduler.runs(KEY).map((run) => run.status)).toEqual(["running", "succeeded"]);
});

it("runs now without moving the schedule, also while off, and says why when it can't", async () => {
  const x = await setup();
  await expect(x.scheduler.runNow(KEY)).rejects.toThrow(/no schedule/);
  x.scheduler.ensure(KEY, HOURLY, false);
  expect(x.scheduler.status(KEY)).toMatchObject({ on: false, nextRunAt: null });
  await x.scheduler.runNow(KEY);
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.scheduler.runs(KEY)).toMatchObject([{ reason: "manual", status: "running", scheduledFor: null }]);
  expect(x.engine.get("runner", "run_1")).toMatchObject({ state: "off", nextAt: Date.parse("2026-11-10T13:00:00Z") });
  x.scheduler.threadSettled("thr", "succeeded");
  x.set("thr", { status: "starting" });
  await expect(x.scheduler.runNow(KEY)).rejects.toThrow("Its thread was starting or stopping.");
  x.set("thr", { status: "idle" });
  x.hosts.set("host_1", { id: "host_1", status: "disconnected" });
  await expect(x.scheduler.runNow(KEY)).rejects.toThrow("No host connected.");
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.scheduler.runs(KEY)).toHaveLength(1);
});

it("turns on and off, keeps an unchanged schedule's next time, and forgets its runs when removed", async () => {
  const x = await setup();
  x.scheduler.ensure(KEY, HOURLY, true);
  x.clock.now += 20 * 60_000;
  x.scheduler.ensure(KEY, HOURLY, true);
  expect(x.scheduler.status(KEY).nextRunAt).toBe(Date.parse("2026-11-10T13:00:00Z"));
  x.scheduler.setOn(KEY, false);
  expect(x.scheduler.status(KEY)).toMatchObject({ on: false, nextRunAt: null });
  x.clock.now += 3 * 3_600_000;
  expect(await x.engine.tick()).toBe(0);
  x.scheduler.setOn(KEY, true);
  expect(x.scheduler.status(KEY)).toMatchObject({ on: true, nextRunAt: Date.parse("2026-11-10T16:00:00Z") });
  await x.due();
  expect(x.scheduler.runs(KEY)).toHaveLength(1);
  x.scheduler.remove(KEY);
  expect(x.scheduler.has(KEY)).toBe(false);
  expect(x.scheduler.runs(KEY)).toEqual([]);
  expect(x.scheduler.status(KEY)).toEqual({ on: false, done: false, nextRunAt: null, lastRunAt: null, lastRunStatus: null });
  expect(() => x.scheduler.ensure(KEY, { schedule: { type: "cron", cron: "0 9 * * 1#2" }, timeZone: "UTC" }, true)).toThrow(/cron/);
});

it("a one-time schedule fires once and is then done", async () => {
  const x = await setup();
  const at = START + 30 * 60_000;
  x.scheduler.ensure(KEY, { schedule: { type: "once", at }, timeZone: "UTC" }, true);
  expect(x.scheduler.status(KEY)).toMatchObject({ on: true, done: false, nextRunAt: at });
  await x.due();
  x.scheduler.threadSettled("thr", "succeeded", "Reminded.");
  x.clock.now += 86_400_000;
  await x.engine.tick();
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.scheduler.status(KEY)).toEqual({ on: false, done: true, nextRunAt: null, lastRunAt: at + 1000, lastRunStatus: "succeeded" });
});
