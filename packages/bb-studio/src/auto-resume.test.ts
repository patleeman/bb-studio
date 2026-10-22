import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { AutoResume, RESUME_CAP, resumedLine, resumeLog, transientReason, type ResumeTarget } from "./auto-resume";
import { MIGRATIONS } from "./migrations";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const DISCONNECT = "Thread interrupted because the host daemon disconnected";
const NOT_RUNNABLE = "Target thread thr_t is unavailable: missing, deleted, archived, or not runnable";

async function setup() {
  let now = 1_000_000_000;
  const threads = new Map([["thr_t", makeThreadResponse({ id: "thr_t", projectId: "proj_p" })]]);
  const automation = { id: "auto_1", projectId: "proj_p", name: "Heartbeat", enabled: false, updatedAt: now, execution: { targetThreadId: "thr_t" } };
  let runs: Record<string, unknown>[] = [];
  let seq = 0;
  /** BB's runs after a failed retry turned it off, newest first. */
  const failed = (...errors: string[]) => {
    runs = errors.map((error, i) => ({ id: `arun_${++seq}`, status: "failed", error, startedAt: now - i * 60_000, finishedAt: now - i * 60_000 + 1000 }));
    automation.enabled = false;
    automation.updatedAt = now + 1000;
  };
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: Record<string, unknown> }) => {
    if (method === "automations_list") return input.projectId === "proj_p" ? [automation] : [];
    if (method === "automations_runs") return { runs };
    if (method === "automations_resume") { automation.enabled = true; automation.updatedAt = now; return automation; }
    return { ok: true };
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: { get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("Not found"), { status: 404 }); return thread; }) as never },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const target: ResumeTarget = { automationId: "auto_1", projectId: "proj_p", botId: "bot_main", owner: "runner", ownerId: "run_1", name: "Lead", on: true };
  const resumed = vi.fn();
  const exhausted = vi.fn(async () => {});
  const log = vi.fn();
  const auto = new AutoResume({ log, db, sdk: bb.sdk, targets: () => [target], resumed, exhausted, now: () => now });
  const resumes = () => callRpc.mock.calls.filter(([call]) => call.method === "automations_resume").length;
  return { callRpc, log, auto, db, threads, automation, failed, target, resumed, exhausted, resumes, setRuns: (next: Record<string, unknown>[]) => { runs = next; }, advance: (ms: number) => { now += ms; } };
}

it("classifies BB's failures: host disconnects and a not-runnable thread are transient, the rest aren't", () => {
  expect(transientReason(DISCONNECT)).toEqual({ reason: "host disconnected", thread: false });
  expect(transientReason("Thread interrupted because the connection to the host was lost")).toMatchObject({ reason: "host connection lost" });
  expect(transientReason("Host daemon restarted while awaiting user interaction")).toMatchObject({ reason: "host restarted" });
  expect(transientReason("Live runtime work failed because the provider stopped sending progress")).toMatchObject({ reason: "provider stalled" });
  expect(transientReason(NOT_RUNNABLE)).toEqual({ reason: "thread not runnable", thread: true });
  expect(transientReason("Target thread thr_t is unavailable: Thread not found")).toBeNull();
  expect(transientReason("Script exited with code 1")).toBeNull();
  expect(transientReason("Turn failed")).toBeNull();
  expect(transientReason(null)).toBeNull();
});

it("resumes one BB turned off after a disconnect and its retry, and logs it", async () => {
  const x = await setup();
  x.failed(NOT_RUNNABLE, DISCONNECT);
  expect(await x.auto.sweep()).toBe(1);
  expect(x.automation.enabled).toBe(true);
  expect(x.resumed).toHaveBeenCalledWith(x.target, "Resumed after BB turned it off (host disconnected) — 1 of 3 today");
  expect(resumeLog(x.db, ["auto_1"])).toEqual([expect.objectContaining({ message: resumedLine("host disconnected", 1) })]);
  // On now: nothing more to do.
  expect(await x.auto.sweep()).toBe(0);
});

it("leaves permanent failures and deleted or archived targets off", async () => {
  const x = await setup();
  x.failed("Script exited with code 2", DISCONNECT);
  expect(await x.auto.sweep()).toBe(0);
  x.failed(NOT_RUNNABLE, DISCONNECT);
  x.threads.set("thr_t", { ...x.threads.get("thr_t")!, archivedAt: 5 });
  expect(await x.auto.sweep()).toBe(0);
  x.threads.delete("thr_t");
  expect(await x.auto.sweep()).toBe(0);
  expect(x.resumes()).toBe(0);
});

it("doesn't resume what the user paused", async () => {
  const x = await setup();
  // Paused in BB with no failed last run.
  x.setRuns([{ id: "arun_ok", status: "succeeded", startedAt: 1, finishedAt: 2 }]);
  expect(await x.auto.sweep()).toBe(0);
  // Paused through Studio (runner or Studio automation paused, or Bot stopped): the target is off.
  x.failed(DISCONNECT);
  x.target.on = false;
  expect(await x.auto.sweep()).toBe(0);
  x.target.on = true;
  // Paused in BB well after the failure.
  x.automation.updatedAt += 10 * 60_000;
  expect(await x.auto.sweep()).toBe(0);
  // Resumed once, then paused again with no new run.
  x.failed(DISCONNECT);
  expect(await x.auto.sweep()).toBe(1);
  x.automation.enabled = false;
  expect(await x.auto.sweep()).toBe(0);
  expect(x.resumes()).toBe(1);
});

it("resumes at most three times a day, then Needs you once until it's on again", async () => {
  const x = await setup();
  for (let i = 1; i <= RESUME_CAP; i++) {
    x.advance(60 * 60_000);
    x.failed(DISCONNECT);
    expect(await x.auto.sweep()).toBe(1);
    expect(x.resumed).toHaveBeenLastCalledWith(x.target, `Resumed after BB turned it off (host disconnected) — ${i} of 3 today`);
  }
  x.advance(60 * 60_000);
  x.failed(NOT_RUNNABLE, DISCONNECT);
  expect(await x.auto.sweep()).toBe(0);
  expect(await x.auto.sweep()).toBe(0);
  expect(x.automation.enabled).toBe(false);
  expect(x.exhausted).toHaveBeenCalledTimes(1);
  expect(x.exhausted).toHaveBeenCalledWith(x.target, expect.stringContaining("Lead is off"));
  expect(x.auto.alerts("bot_main")).toEqual([expect.objectContaining({ automationId: "auto_1", owner: "runner" })]);
  // The user turns it back on: the entry goes.
  x.automation.enabled = true;
  await x.auto.sweep();
  expect(x.auto.alerts("bot_main")).toEqual([]);
  // A day after the first resumes, the window has room again.
  x.advance(24 * 60 * 60_000);
  x.failed(DISCONNECT);
  expect(await x.auto.sweep()).toBe(1);
  expect(x.resumes()).toBe(RESUME_CAP + 1);
});

it("retries an exhaustion notification until delivery succeeds, even after the cap window", async () => {
  const x = await setup();
  for (let i = 0; i < RESUME_CAP; i++) { x.failed(DISCONNECT); await x.auto.sweep(); x.advance(60000); }
  x.failed(DISCONNECT);
  x.exhausted.mockRejectedValueOnce(new Error("offline"));
  await x.auto.sweep();
  expect(x.exhausted).toHaveBeenCalledTimes(1);
  x.advance(25 * 60 * 60000);
  await x.auto.sweep();
  expect(x.exhausted).toHaveBeenCalledTimes(2);
  await x.auto.sweep();
  expect(x.exhausted).toHaveBeenCalledTimes(2);
});

it.each(["automations_list", "automations_runs"])("logs failed %s reads and resumes after recovery", async (method) => {
  const x = await setup();
  x.failed(DISCONNECT);
  const original = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (call) => { if (call.method === method) throw new Error("offline"); return original(call); });
  expect(await x.auto.sweep()).toBe(0);
  expect(x.log).toHaveBeenCalledTimes(1);
  expect(x.resumes()).toBe(0);
  x.callRpc.mockImplementation(original);
  expect(await x.auto.sweep()).toBe(1);
});
