import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { Automations, checkinPrompt, watcherFinding, watcherMessage, type AutomationRunner } from "./automations";
import type { HeartbeatRun } from "./contract";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

async function setup() {
  const threads = new Map([["bot1", makeThreadResponse({ id: "bot1", projectId: "proj_personal", providerId: "codex" })], ["bot9", makeThreadResponse({ id: "bot9", projectId: "proj_personal", providerId: "codex" })]]);
  const send = vi.fn(async () => ({ ok: true }));
  const automations: Record<string, unknown>[] = [];
  const runs = new Map<string, Record<string, unknown>[]>();
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: Record<string, unknown> }) => {
    calls.push({ method, input });
    const row = automations.find((a) => a.id === input.automationId);
    if (method === "automations_list") return automations.filter((a) => a.projectId === input.projectId);
    if (method === "automations_create") { const made = { id: `a${automations.length + 1}`, projectId: input.projectId, name: input.name, enabled: false, trigger: input.trigger, execution: input.execution, nextRunAt: 1000 + automations.length, lastRunAt: null }; automations.push(made); return made; }
    if (method === "automations_update") { if (!row) throw Object.assign(new Error("Not found"), { status: 404 }); Object.assign(row, input); return row; }
    if (method === "automations_resume" || method === "automations_pause") { if (row) row.enabled = method === "automations_resume"; return row; }
    if (method === "automations_delete") { if (row) automations.splice(automations.indexOf(row), 1); return { ok: true }; }
    if (method === "automations_runs") return { runs: runs.get(String(input.automationId)) ?? [] };
    return { ok: true };
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      get: (async ({ threadId }: { threadId: string }) => threads.get(threadId)!) as never, send: send as never,
      defaultExecutionOptions: async () => ({ model: "gpt-big", reasoningLevel: "high", permissionMode: "accept-edits" }) as never,
    },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const bot = { id: "bot_main", name: "Dot", threadId: "bot1" as string | null, state: "active", primary: true, kind: "studio" };
  let heartbeat: HeartbeatRun | null = { enabled: true, cadence: "weekdays", time: "08:00" };
  const setHeartbeat = vi.fn(async (_botId: string, run: HeartbeatRun) => { heartbeat = run; });
  const runnerList: AutomationRunner[] = [];
  const auto = new Automations({
    db, sdk: bb.sdk, changed: () => {}, bot: () => bot,
    heartbeat: { get: () => heartbeat, set: setHeartbeat, automation: () => ({ id: "hb", projectId: "proj_personal" }) },
    runners: {
      list: async () => runnerList, create: vi.fn() as never, update: vi.fn() as never, setState: vi.fn() as never, runNow: vi.fn() as never, delete: vi.fn() as never, automation: () => null,
    },
  });
  return { auto, automations, runs, calls, send, bot, setHeartbeat, db, heartbeat: () => heartbeat };
}

it("lists the original check-in first, unchanged, then new ones", async () => {
  const x = await setup();
  const list = await x.auto.list();
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: "heartbeat", kind: "checkin", name: "Check-in", original: true, state: "active", scheduleText: "Weekdays 8:00" });
  expect(x.setHeartbeat).not.toHaveBeenCalled();
  expect(x.calls.some((call) => call.method !== "automations_list")).toBe(false);
});

it("makes a check-in with two times as one automation, on a cheaper model", async () => {
  const x = await setup();
  const made = await x.auto.create({ kind: "checkin", name: "Brief", instruction: "Summarize my day.", schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00", "18:30"], timezone: "America/New_York" }, model: { model: "gpt-mini", reasoning: "low" } });
  expect(x.automations).toHaveLength(2);
  expect(x.automations.map((a) => (a.trigger as { cron: string }).cron)).toEqual(["0 8 * * 1-5", "30 18 * * 1-5"]);
  expect(x.automations.every((a) => a.enabled)).toBe(true);
  expect(x.automations[0]!.execution).toMatchObject({ mode: "agent", targetThreadId: "bot1", model: "gpt-mini", reasoningLevel: "low", prompt: checkinPrompt("Brief", "Summarize my day.") });
  expect(String((x.automations[0]!.execution as { prompt: string }).prompt)).toContain("[PASS]");
  expect(made).toMatchObject({ kind: "checkin", state: "active", nextRunAt: 1000, scheduleText: "Weekdays 8:00, 18:30" });
  // One time fewer: the extra BB automation goes.
  await x.auto.update({ id: made.id, schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00"] } });
  expect(x.automations).toHaveLength(1);
  await x.auto.setState(made.id, "paused");
  expect(x.automations[0]!.enabled).toBe(false);
  await x.auto.delete("Brief");
  expect(x.automations).toHaveLength(0);
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
  const made = await x.auto.create({ kind: "reminder", name: "Deploy", instruction: "Check the deploy.", schedule: { type: "once", at: Date.now() + 7_200_000 } });
  expect(x.automations[0]!.trigger).toMatchObject({ triggerType: "once" });
  expect(made.state).toBe("active");
  Object.assign(x.automations[0]!, { nextRunAt: null, lastRunAt: Date.now() });
  expect((await x.auto.list()).find((each) => each.id === made.id)?.state).toBe("done");
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
  await x.auto.setState(b.id, "paused");
  const heard: string[] = [];
  expect(await x.auto.pauseAll("bot_main", (id) => heard.push(id))).toEqual([a.id]);
  expect(x.automations.every((each) => !each.enabled)).toBe(true);
  x.bot.state = "stopped";
  expect(await x.auto.restore(a.id)).toBe(true);
  expect(x.automations.map((each) => each.enabled)).toEqual([true, false]);
  x.bot.state = "active";
  x.bot.threadId = "bot9";
  await x.auto.list();
  expect((x.automations[0]!.execution as { targetThreadId: string }).targetThreadId).toBe("bot9");
});

it("edits the original check-in only as one cron, keeping it a heartbeat", async () => {
  const x = await setup();
  await x.auto.update({ id: "heartbeat", schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["07:30"] } });
  expect(x.setHeartbeat).toHaveBeenCalledWith("bot_main", expect.objectContaining({ enabled: true, cadence: "custom", cron: "30 7 * * 1-5" }));
  await expect(x.auto.update({ id: "heartbeat", schedule: { type: "times", days: [1], times: ["07:30", "18:00"] } })).rejects.toThrow(/one repeating cron/);
  await x.auto.setState("heartbeat", "paused");
  expect(x.heartbeat()?.enabled).toBe(false);
});
