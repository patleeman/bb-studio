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

it("keeps runner threads out of BB's thread list: a new one is spawned hidden, and is visible again once deleted", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Inbox", job: "Check mail.", schedule });
  expect(x.spawn.mock.calls[0]![0]).toMatchObject({ visibility: "hidden" });
  // Already hidden: the startup step has nothing to do.
  expect(await x.runners.hideThreads()).toBe(0);
  expect(x.update).not.toHaveBeenCalled();
  await x.runners.delete(runner.id);
  expect(x.update).toHaveBeenCalledWith({ threadId: runner.threadId, visibility: "visible" });
  expect(x.threads.get(runner.threadId!)?.archivedAt).toBe(5);
});

it("hides an adopted thread while it's a runner and shows it again when it's let go", async () => {
  const x = await setup();
  x.add({ id: "thr_lead", title: "Project lead", parentThreadId: "bot1", visibility: "visible" });
  x.started.push({ id: "thr_lead", title: "Project lead", projectId: "proj_personal", parentThreadId: "bot1" });
  x.automations.push({ id: "auto_lead", projectId: "proj_personal", name: "Lead heartbeat", enabled: true, trigger: { cron: "0 9 * * *" }, execution: { mode: "agent", targetThreadId: "thr_lead", prompt: "Check the project." } });
  const runner = await x.runners.adopt({ threadId: "thr_lead", automationId: "auto_lead" });
  expect(x.update).toHaveBeenCalledWith({ threadId: "thr_lead", visibility: "hidden", parentThreadId: null });
  expect(x.threads.get("thr_lead")).toMatchObject({ visibility: "hidden", parentThreadId: null });
  expect(await x.runners.hideThreads()).toBe(0);
  // Still a runner under the Bot.
  expect((await x.runners.list()).map((each) => each.threadId)).toEqual(["thr_lead"]);
  await x.runners.delete(runner.id);
  expect(x.threads.get("thr_lead")).toMatchObject({ visibility: "visible", archivedAt: null });
  // Recorded as hidden once, so the Bot-owned sweep (src/bot-owned.ts) leaves it visible.
  const db = (x.runners as unknown as { deps: { db: import("better-sqlite3").Database } }).deps.db;
  expect(db.prepare("SELECT bot_id, reason FROM bot_hidden_threads WHERE thread_id = 'thr_lead'").get()).toEqual({ bot_id: "bot_main", reason: "runner" });
});

it("hides runners from before once at startup, retries a failed hide, and never hides a Bot's own chat", async () => {
  const x = await setup();
  const db = (x.runners as unknown as { deps: { db: import("better-sqlite3").Database } }).deps.db;
  const insert = db.prepare(`INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, created_at, updated_at) VALUES (?, 'bot_main', ?, 'x', ?, 'proj_personal', 'active', 'daily', '09:00', 1, 1)`);
  x.add({ id: "thr_old", title: "Old · Runner", visibility: "visible" });
  x.add({ id: "thr_flaky", title: "Flaky · Runner", visibility: "visible" });
  insert.run("run_old", "Old", "thr_old");
  insert.run("run_flaky", "Flaky", "thr_flaky");
  insert.run("run_bot", "Mine", "bot1");
  insert.run("run_other_bot", "Theirs", "bot2");
  // A Bot's own chat (this Bot's or another's) stays in BB's list.
  (x.runners as unknown as { deps: { botThreads(): ReadonlySet<string> } }).deps.botThreads = () => new Set(["bot2"]);
  const update = x.update.getMockImplementation()!;
  let busy = true;
  x.update.mockImplementation(async (args) => { if (busy && args.threadId === "thr_flaky") throw new Error("server busy"); return update(args); });
  expect(await x.runners.hideThreads()).toBe(1);
  expect(x.threads.get("thr_old")?.visibility).toBe("hidden");
  expect(x.threads.get("thr_flaky")?.visibility).toBe("visible");
  busy = false;
  expect(await x.runners.hideThreads()).toBe(1);
  expect(x.threads.get("thr_flaky")?.visibility).toBe("hidden");
  // Done: nothing left to hide, nothing asked of BB.
  const calls = x.update.mock.calls.length;
  expect(await x.runners.hideThreads()).toBe(0);
  expect(x.update.mock.calls.length).toBe(calls);
  expect(x.threads.get("bot1")?.visibility).not.toBe("hidden");
  expect(x.threads.get("bot2")?.visibility).not.toBe("hidden");
  expect(x.update.mock.calls.filter(([args]) => args.threadId === "bot1" || args.threadId === "bot2")).toEqual([]);
});
