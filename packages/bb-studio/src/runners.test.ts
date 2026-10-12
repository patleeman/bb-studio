import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { ADOPT_NOTE, parseSchedule, runnerInstructions, runnerPrompt, Runners, tellLine } from "./runners";
import { heartbeatCron } from "./project-lead";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });
type Thread = ReturnType<typeof makeThreadResponse>;

async function setup() {
  const threads = new Map<string, Thread>();
  let count = 0;
  const add = (fields: Partial<Thread> & { id: string }) => { const thread = makeThreadResponse({ projectId: "proj_personal", providerId: "codex", ...fields }); threads.set(thread.id, thread); return thread; };
  add({ id: "bot1", title: "Bot" });
  const spawn = vi.fn(async (args: { projectId: string; title?: string }) => add({ id: `thr_r${++count}`, projectId: args.projectId, title: args.title ?? null }));
  const get = vi.fn(async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("Not found"), { status: 404 }); return thread; });
  const send = vi.fn(async () => ({ ok: true, delivery: "sent" }));
  const update = vi.fn(async (args: { threadId: string; parentThreadId?: string | null; title?: string }) => { const thread = threads.get(args.threadId)!; threads.set(args.threadId, { ...thread, ...args } as Thread); return {}; });
  const archive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: 5 }); return { ok: true }; });
  const automations: Record<string, unknown>[] = [];
  const calls: { pluginId: string; method: string; input: Record<string, unknown> }[] = [];
  const callRpc = vi.fn(async ({ pluginId, method, input }: { pluginId: string; method: string; input: Record<string, unknown> }) => {
    calls.push({ pluginId, method, input });
    const row = automations.find((a) => a.id === input.automationId);
    if (method === "automations_list") return automations.filter((a) => a.projectId === input.projectId);
    if (method === "automations_create") { const made = { id: `a${automations.length + 1}`, projectId: input.projectId, name: input.name, enabled: false, trigger: input.trigger, execution: input.execution, nextRunAt: 99 }; automations.push(made); return made; }
    if (method === "automations_update") { if (!row) throw Object.assign(new Error("Not found"), { status: 404 }); Object.assign(row, { ...(input.trigger ? { trigger: input.trigger } : {}), ...(input.execution ? { execution: input.execution } : {}) }); return row; }
    if (method === "automations_resume" || method === "automations_pause") { if (row) row.enabled = method === "automations_resume"; return row; }
    if (method === "automations_delete") { automations.splice(automations.indexOf(row!), 1); return { ok: true }; }
    return { ok: true, sent: 1 };
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      spawn: spawn as never, get: get as never, send: send as never, update: update as never, archive: archive as never,
      defaultExecutionOptions: async () => ({ model: "model", reasoningLevel: "high", permissionMode: "accept-edits" }) as never,
    },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const bot = { id: "bot_main", name: "Jarvis", threadId: "bot1" as string | null, state: "active" };
  const started: { id: string; title: string; projectId: string | null; parentThreadId?: string | null }[] = [];
  add({ id: "bot2", title: "Scout" });
  const second = { id: "bot_two", name: "Scout", threadId: "bot2" as string | null, state: "active" };
  const runners = new Runners({ db, sdk: bb.sdk, changed: () => {}, bot: (botId) => botId === second.id ? second : !botId || botId === bot.id ? bot : null, startedThreads: async () => started, chain: () => ["bot1"] });
  return { runners, threads, add, spawn, send, update, archive, automations, calls, bot, started };
}

const schedule = { cadence: "every15minutes" as const, time: "09:00" };

it("keeps each Bot's runners apart: listing, names, reports and pausing", async () => {
  const x = await setup();
  await x.runners.create({ name: "Inbox", job: "Check mail.", schedule });
  const theirs = await x.runners.create({ name: "Inbox", job: "Check releases.", schedule }, "bot_two");
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ pluginMetadata: { runner: theirs.id, bot: "bot_two" } }));
  expect((await x.runners.list()).map((each) => each.job)).toEqual(["Check mail."]);
  expect((await x.runners.list("bot_two")).map((each) => each.job)).toEqual(["Check releases."]);
  expect((await x.runners.setState("Inbox", "paused", "bot_two")).id).toBe(theirs.id);
  expect(x.runners.instructions(x.runners.forThread(theirs.threadId)!)).toContain('"Scout"');
  await x.runners.report(theirs.threadId!, { level: "tell", summary: "v2 is out" });
  expect(x.send).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "bot2" }));
  const heard: string[] = [];
  expect(await x.runners.pauseAll(undefined, (id) => heard.push(id))).toHaveLength(1);
  expect(heard).toHaveLength(1);
  x.bot.state = "stopped";
  expect(await x.runners.restore(heard[0]!)).toBe(true);
  expect((await x.runners.list())[0]).toMatchObject({ state: "active" });
  expect(await x.runners.restore("run_gone")).toBe(false);
  x.bot.state = "active";
  expect(x.runners.threads("bot_two").has(theirs.threadId!)).toBe(true);
  expect(x.runners.threads().has(theirs.threadId!)).toBe(false);
});

it("creates a runner: an unparented thread, its first run, and a schedule that wakes its own thread", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Inbox", job: "Check the inbox for replies from Dana.", schedule });
  const spawned = x.spawn.mock.calls[0]![0] as Record<string, unknown>;
  expect(spawned).not.toHaveProperty("parentThreadId");
  expect(spawned).not.toHaveProperty("lifecycleOwnerThreadId");
  expect(spawned).toMatchObject({ title: "Inbox · Runner", pluginMetadata: { runner: runner.id, bot: "bot_main" } });
  expect(x.automations).toHaveLength(1);
  expect(x.automations[0]).toMatchObject({ enabled: true, trigger: { cron: "*/15 * * * *" }, execution: { targetThreadId: runner.threadId, prompt: runnerPrompt({ name: "Inbox", job: "Check the inbox for replies from Dana." }) } });
  expect(runner).toMatchObject({ name: "Inbox", state: "active", adopted: false, nextRunAt: 99, schedule: { cadence: "every15minutes" } });
  expect(x.runners.forThread(runner.threadId)).toMatchObject({ id: runner.id });
  await expect(x.runners.create({ name: "inbox", job: "x", schedule })).rejects.toThrow(/already/);
});

it("updates, pauses, resumes, runs now and deletes", async () => {
  const x = await setup();
  const { id, threadId } = await x.runners.create({ name: "Inbox", job: "Check mail.", schedule });
  const updated = await x.runners.update({ id, name: "Mail", job: "Check mail twice.", schedule: { cadence: "custom", time: "09:00", cron: "0 8 * * 1-5" } });
  expect(updated).toMatchObject({ name: "Mail", job: "Check mail twice.", schedule: { cadence: "custom", cron: "0 8 * * 1-5" } });
  expect(x.automations[0]).toMatchObject({ trigger: { cron: "0 8 * * 1-5" }, execution: { prompt: expect.stringContaining("Check mail twice.") } });
  expect(x.threads.get(threadId!)?.title).toBe("Mail · Runner");
  expect(await x.runners.setState("Mail", "paused")).toMatchObject({ state: "paused", nextRunAt: null });
  expect(x.automations[0]!.enabled).toBe(false);
  await x.runners.setState(id, "active");
  expect(x.automations[0]!.enabled).toBe(true);
  await x.runners.runNow(id);
  expect(x.calls.some((call) => call.method === "automations_run" && call.input.automationId === "a1")).toBe(true);
  expect(await x.runners.delete(id)).toEqual({ deleted: true, kept: false });
  expect(x.automations).toHaveLength(0);
  expect(x.threads.get(threadId!)?.archivedAt).toBe(5);
  expect(await x.runners.list()).toEqual([]);
});

it("routes reports by level: log stays, tell posts one line, urgent also pushes and needs the user", async () => {
  const x = await setup();
  const { id, threadId } = await x.runners.create({ name: "Inbox", job: "Check mail.", schedule });
  await x.runners.report(threadId!, { level: "log", summary: "Two newsletters, nothing else." });
  expect(x.send).not.toHaveBeenCalled();
  expect(x.calls.some((call) => call.pluginId === "mobile")).toBe(false);
  expect((await x.runners.list())[0]).toMatchObject({ lastLevel: "log", lastReport: "Two newsletters, nothing else.", urgent: false });

  await x.runners.report(threadId!, { level: "tell", summary: "Dana replied about the lease." });
  expect(x.send).toHaveBeenCalledTimes(1);
  const told = (x.send.mock.calls[0] as unknown[])[0] as { threadId: string; senderThreadId: string; input: { text: string; visibility?: string }[] };
  expect(told).toMatchObject({ threadId: "bot1", senderThreadId: threadId });
  expect(told.input[0]!.text).toBe("From runner Inbox: Dana replied about the lease.");
  expect(told.input[1]!.visibility).toBe("agent-only");
  expect(x.calls.some((call) => call.pluginId === "mobile")).toBe(false);

  await x.runners.report(threadId!, { level: "urgent", summary: "The payment failed." });
  expect(x.send).toHaveBeenCalledTimes(2);
  expect(x.calls.find((call) => call.pluginId === "mobile")).toMatchObject({ method: "notify", input: { kind: "turn-finished", threadId: "bot1", body: "The payment failed.", coalesceKey: `runner:${id}` } });
  expect(x.runners.threads().get(threadId!)).toEqual({ urgent: true });
  // A later log or tell doesn't clear an unacknowledged urgent; only the user seeing it does.
  await x.runners.report(threadId!, { level: "log", summary: "Nothing new." });
  await x.runners.report(threadId!, { level: "tell", summary: "Still waiting." });
  expect(x.runners.threads().get(threadId!)).toEqual({ urgent: true });
  x.runners.seen(id);
  expect(x.runners.threads().get(threadId!)).toEqual({ urgent: false });
  await expect(x.runners.report("bot1", { level: "log", summary: "x" })).rejects.toThrow(/runner/);
});

it("a run with nothing to report produces nothing: the instructions say so, and no call means no message", async () => {
  const x = await setup();
  await x.runners.create({ name: "Inbox", job: "Check mail.", schedule });
  expect(x.send).not.toHaveBeenCalled();
  expect(runnerPrompt({ name: "Inbox", job: "Check mail." })).toMatch(/Nothing new, or after reporting: reply exactly \[PASS\]/);
  expect(runnerInstructions({ name: "Inbox", job: "Check mail.", state: "active" }, "Jarvis")).toMatch(/\[PASS\]/);
  expect(runnerInstructions({ name: "Inbox", job: "Check mail.", state: "paused" }, "Jarvis")).toMatch(/paused/);
  expect(tellLine("Inbox", "urgent", "  Payment\n failed ")).toBe("⚠️ From runner Inbox: Payment failed");
});

it("maps schedules to cron like the heartbeat does", () => {
  expect(heartbeatCron({ enabled: true, ...parseSchedule({ cadence: "weekdays", time: "07:30" }) })).toBe("30 7 * * 1-5");
  expect(heartbeatCron({ enabled: true, ...parseSchedule({ cadence: "hourly", time: "10:05" }) })).toBe("5 * * * *");
  expect(parseSchedule({ cadence: "daily" })).toEqual({ cadence: "daily", time: "09:00" });
  expect(() => parseSchedule({ cadence: "custom" })).toThrow(/cron/);
});

it("offers a thread the Bot started with an automation for adoption, and adopts it only when asked", async () => {
  const x = await setup();
  x.add({ id: "thr_staff", title: "Staff · Runner", parentThreadId: "bot1" });
  x.started.push({ id: "thr_staff", title: "Staff · Runner", projectId: "proj_personal", parentThreadId: "bot1" });
  x.automations.push({ id: "auto_staff", projectId: "proj_personal", name: "Staff · Heartbeat", enabled: true, trigger: { cron: "15 7,12,17,22 * * *" }, execution: { mode: "agent", targetThreadId: "thr_staff", prompt: "Staff heartbeat. Reply [PASS]." }, nextRunAt: 5, lastRunAt: 4 });
  x.automations.push({ id: "auto_other", projectId: "proj_personal", name: "Someone else's", enabled: true, trigger: { cron: "0 9 * * *" }, execution: { targetThreadId: "thr_user" } });
  const adoptable = await x.runners.adoptable();
  expect(adoptable).toEqual([expect.objectContaining({ threadId: "thr_staff", automationId: "auto_staff", cron: "15 7,12,17,22 * * *" })]);
  // Listing changes nothing.
  expect(x.automations[0]).toMatchObject({ execution: { prompt: "Staff heartbeat. Reply [PASS]." } });
  expect(x.update).not.toHaveBeenCalled();

  const runner = await x.runners.adopt({ threadId: "thr_staff", automationId: "auto_staff" });
  expect(runner).toMatchObject({ name: "Staff", adopted: true, state: "active", schedule: { cadence: "custom", cron: "15 7,12,17,22 * * *" }, nextRunAt: 5, lastRunAt: 4 });
  expect(x.automations[0]).toMatchObject({ id: "auto_staff", trigger: { cron: "15 7,12,17,22 * * *" }, execution: { targetThreadId: "thr_staff", prompt: `Staff heartbeat. Reply [PASS].${ADOPT_NOTE}` } });
  expect(x.threads.get("thr_staff")?.parentThreadId).toBeNull();
  expect(await x.runners.adoptable()).toEqual([]);

  // Letting it go keeps the thread and automation, without the note.
  expect(await x.runners.delete(runner.id)).toEqual({ deleted: true, kept: true });
  expect(x.automations[0]).toMatchObject({ id: "auto_staff", execution: { prompt: "Staff heartbeat. Reply [PASS]." } });
  expect(x.threads.get("thr_staff")?.archivedAt).toBeNull();
});
