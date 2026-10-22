import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { ADOPT_NOTE, parseSchedule, runnerInstructions, runnerPrompt, Runners, tellLine } from "./runners";
import { resolveRunnerMachine, runnerEnvironment, RunnerPreflightError } from "./runner-machines";
import { Automations } from "./automations";
import { heartbeatCron } from "./project-lead";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });
type Thread = ReturnType<typeof makeThreadResponse>;

async function setup() {
  const threads = new Map<string, Thread>();
  let count = 0;
  const add = (fields: Partial<Thread> & { id: string }) => { const thread = makeThreadResponse({ projectId: "proj_personal", providerId: "codex", ...fields }); threads.set(thread.id, thread); return thread; };
  add({ id: "bot1", title: "Bot" });
  // Like BB: a spawn needs at least one input entry.
  const spawn = vi.fn(async (args: { projectId: string; title?: string; input?: unknown[] }) => { if (!args.input?.length) throw new Error("HTTP 400: input must contain at least one entry"); return add({ id: `thr_r${++count}`, projectId: args.projectId, title: args.title ?? null }); });
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
  const hosts = [{ id: "host_red4", name: "red4", status: "connected" }];
  const cli = { codex: { installed: true, displayName: "Codex" } };
  const providerStates = { providers: [{ providerId: "codex", status: "ready", loginCommand: "codex login" }] };
  const pathsExist = vi.fn(async ({ paths }: { paths: string[] }) => ({ existence: Object.fromEntries(paths.map(path => [path, !path.startsWith("/Users")])) }));
  const installProviderCli = vi.fn(async () => []);
  const timeline = vi.fn(async () => ({ rows: [] as unknown[] }));
  const environmentProviders = [{ id: "personal-workspace", acceptsEmptyInputs: true, availability: { status: "available" }, machineAvailability: {} }];
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      timeline: timeline as never, spawn: spawn as never, get: get as never, send: send as never, update: update as never, archive: archive as never,
      defaultExecutionOptions: async () => ({ model: "model", reasoningLevel: "high", permissionMode: "accept-edits" }) as never,
    },
    hosts: { list: async () => hosts as never, get: async ({ hostId }) => { const host = hosts.find(h => h.id === hostId); if (!host) throw new Error("Unknown host"); return host as never; }, providerCliStatus: async () => cli as never, pathsExist, installProviderCli },
    providers: { list: async () => [{ id: "codex", displayName: "Codex", strings: { signInHint: "Run codex login" } }] as never },
    system: { providerStates: async () => providerStates as never },
    environments: { listProviders: (async (args: { projectId?: string; hostId?: string }) => { if (args?.hostId && !args.projectId) throw new Error("HTTP 400: hostId requires projectId"); return environmentProviders; }) as never },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const bot = { id: "bot_main", name: "Jarvis", threadId: "bot1" as string | null, state: "active" };
  const started: { id: string; title: string; projectId: string | null; parentThreadId?: string | null }[] = [];
  add({ id: "bot2", title: "Scout" });
  const second = { id: "bot_two", name: "Scout", threadId: "bot2" as string | null, state: "active" };
  const changed = vi.fn(() => bb.realtime.publish("studio-changed", { pluginId: "studio" }));
  const runners = new Runners({ db, sdk: bb.sdk, changed, bot: (botId) => botId === second.id ? second : !botId || botId === bot.id ? bot : null, startedThreads: async () => started, chain: () => ["bot1"] });
  return { timeline, hosts, cli, providerStates, pathsExist, installProviderCli, environmentProviders, changed, harness, runners, threads, add, spawn, send, update, archive, automations, calls, callRpc, bot, started, db, sdk: bb.sdk };
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

it("rejects another Bot's runner id and thread at every scoped entry point", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Inbox", job: "Check releases.", schedule }, "bot_two");
  await x.runners.report(runner.threadId!, { level: "urgent", summary: "Needs you" });
  const before = await x.runners.list("bot_two");
  const calls = x.calls.length;
  for (const id of [runner.id, runner.threadId!]) {
    await expect(x.runners.update({ id, name: "Changed" }, "bot_main")).rejects.toThrow(/No runner/);
    await expect(x.runners.setState(id, "paused", "bot_main")).rejects.toThrow(/No runner/);
    await expect(x.runners.setState(id, "active", "bot_main")).rejects.toThrow(/No runner/);
    await expect(x.runners.runNow(id, "bot_main")).rejects.toThrow(/No runner/);
    expect(() => x.runners.seen(id, "bot_main")).toThrow(/No runner/);
    await expect(x.runners.delete(id, "bot_main")).rejects.toThrow(/No runner/);
  }
  expect(x.calls).toHaveLength(calls);
  expect(await x.runners.list("bot_two")).toEqual(before);
  expect(x.archive).not.toHaveBeenCalled();
});

it("creates a runner: an unparented thread, its first run, and a schedule that wakes its own thread", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Inbox", job: "Check the inbox for replies from Dana.", schedule });
  const spawned = x.spawn.mock.calls[0]![0] as Record<string, unknown>;
  expect(spawned).not.toHaveProperty("parentThreadId");
  expect(spawned).not.toHaveProperty("lifecycleOwnerThreadId");
  expect(spawned).toMatchObject({ title: "Inbox · Runner", pluginMetadata: { runner: runner.id, bot: "bot_main" } });
  expect(x.automations).toHaveLength(1);
  expect(x.automations[0]).toMatchObject({ enabled: true, trigger: { triggerType: "schedule", cron: "*/15 * * * *" }, execution: { targetThreadId: runner.threadId, prompt: runnerPrompt({ name: "Inbox", job: "Check the inbox for replies from Dana." }) } });
  expect(runner).toMatchObject({ name: "Inbox", state: "active", adopted: false, nextRunAt: 99, schedule: { cadence: "every15minutes" } });
  expect(x.runners.forThread(runner.threadId)).toMatchObject({ id: runner.id });
  await expect(x.runners.create({ name: "inbox", job: "x", schedule })).rejects.toThrow(/already/);
});

it("updates, pauses, resumes, runs now and deletes", async () => {
  const x = await setup();
  const { id, threadId } = await x.runners.create({ name: "Inbox", job: "Check mail.", schedule });
  const updated = await x.runners.update({ id, name: "Mail", job: "Check mail twice.", schedule: { cadence: "custom", time: "09:00", cron: "0 8 * * 1-5" } });
  expect(updated).toMatchObject({ name: "Mail", job: "Check mail twice.", schedule: { cadence: "custom", cron: "0 8 * * 1-5" } });
  expect(x.automations[0]).toMatchObject({ trigger: { triggerType: "schedule", cron: "0 8 * * 1-5" }, execution: { prompt: expect.stringContaining("Check mail twice.") } });
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
  x.automations.push({ id: "auto_staff", projectId: "proj_personal", name: "Staff · Heartbeat", enabled: true, trigger: { triggerType: "schedule", cron: "15 7,12,17,22 * * *" }, execution: { mode: "agent", targetThreadId: "thr_staff", prompt: "Staff heartbeat. Reply [PASS]." }, nextRunAt: 5, lastRunAt: 4 });
  x.automations.push({ id: "auto_other", projectId: "proj_personal", name: "Someone else's", enabled: true, trigger: { triggerType: "schedule", cron: "0 9 * * *" }, execution: { targetThreadId: "thr_user" } });
  const adoptable = await x.runners.adoptable();
  expect(adoptable).toEqual([expect.objectContaining({ threadId: "thr_staff", automationId: "auto_staff", cron: "15 7,12,17,22 * * *" })]);
  // Listing changes nothing.
  expect(x.automations[0]).toMatchObject({ execution: { prompt: "Staff heartbeat. Reply [PASS]." } });
  expect(x.update).not.toHaveBeenCalled();

  const runner = await x.runners.adopt({ threadId: "thr_staff", automationId: "auto_staff" });
  expect(runner).toMatchObject({ name: "Staff", adopted: true, state: "active", schedule: { cadence: "custom", cron: "15 7,12,17,22 * * *" }, nextRunAt: 5, lastRunAt: 4 });
  expect(x.automations[0]).toMatchObject({ id: "auto_staff", trigger: { triggerType: "schedule", cron: "15 7,12,17,22 * * *" }, execution: { targetThreadId: "thr_staff", prompt: `Staff heartbeat. Reply [PASS].${ADOPT_NOTE}` } });
  expect(x.threads.get("thr_staff")?.parentThreadId).toBeNull();
  expect(await x.runners.adoptable()).toEqual([]);

  // Letting it go keeps the thread and automation, without the note.
  expect(await x.runners.delete(runner.id)).toEqual({ deleted: true, kept: true });
  expect(x.automations[0]).toMatchObject({ id: "auto_staff", execution: { prompt: "Staff heartbeat. Reply [PASS]." } });
  expect(x.threads.get("thr_staff")?.archivedAt).toBeNull();
});

it("shows a runner paused when BB turned its automation off, and Resume turns it back on", async () => {
  const x = await setup();
  x.add({ id: "thr_lead", title: "Project Lead", parentThreadId: "bot1" });
  x.started.push({ id: "thr_lead", title: "Project Lead", projectId: "proj_personal", parentThreadId: "bot1" });
  x.automations.push({ id: "auto_lead", projectId: "proj_personal", name: "Lead heartbeat", enabled: true, trigger: { triggerType: "schedule", cron: "0 */2 * * *", timezone: "America/New_York" }, execution: { mode: "agent", targetThreadId: "thr_lead", prompt: "Check the project." }, nextRunAt: 7 });
  const runner = await x.runners.adopt({ threadId: "thr_lead", automationId: "auto_lead" });
  expect(runner).toMatchObject({ state: "active", nextRunAt: 7 });
  // A run failed and BB disabled the automation: no next run, so not "active" with a bare cron.
  Object.assign(x.automations[0]!, { enabled: false, nextRunAt: null, lastRunStatus: "failed" });
  expect((await x.runners.list())[0]).toMatchObject({ state: "paused", nextRunAt: null });
  // Resume re-enables it (the fake has BB's next run back).
  x.automations[0]!.nextRunAt = 8;
  expect(await x.runners.setState(runner.id, "active")).toMatchObject({ state: "active", nextRunAt: 8 });
  expect(x.automations[0]).toMatchObject({ enabled: true });
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
  x.automations.push({ id: "auto_lead", projectId: "proj_personal", name: "Lead heartbeat", enabled: true, trigger: { triggerType: "schedule", cron: "0 9 * * *" }, execution: { mode: "agent", targetThreadId: "thr_lead", prompt: "Check the project." } });
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

it("auto-resume: a runner's automation is on only while the runner and its Bot are active; past the cap it reports urgent", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Inbox", job: "Check mail.", schedule });
  expect(x.runners.resumeTargets()).toEqual([expect.objectContaining({ ownerId: runner.id, botId: "bot_main", on: true })]);
  x.bot.state = "paused";
  expect(x.runners.resumeTargets()[0]!.on).toBe(false);
  x.bot.state = "stopped";
  expect(x.runners.resumeTargets()[0]!.on).toBe(false);
  x.bot.state = "active";
  await x.runners.setState(runner.id, "paused");
  expect(x.runners.resumeTargets()[0]!.on).toBe(false);
  await x.runners.setState(runner.id, "active");
  x.runners.note(runner.id, "Resumed after BB turned it off (host disconnected) — 1 of 3 today");
  expect((await x.runners.list())[0]).toMatchObject({ lastLevel: "log", lastReport: expect.stringContaining("1 of 3"), urgent: false });
  x.send.mockClear();
  await x.runners.alert(runner.id, "Inbox is off");
  expect((await x.runners.list())[0]).toMatchObject({ lastLevel: "urgent", urgent: true });
  expect(x.runners.threads().get(runner.threadId!)).toEqual({ urgent: true });
  expect(x.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: "bot1", input: expect.arrayContaining([expect.objectContaining({ text: tellLine("Inbox", "urgent", "Inbox is off") })]) }));
  expect(x.calls.some((call) => call.pluginId === "mobile" && call.method === "notify")).toBe(true);
});

it("offers only recurring cron adoption and preserves the adopted timezone on edits", async () => {
  const x = await setup();
  x.add({ id: "thr_once", title: "Once" });
  x.add({ id: "thr_cron", title: "Cron" });
  x.started.push({ id: "thr_once", title: "Once", projectId: "proj_personal" }, { id: "thr_cron", title: "Cron", projectId: "proj_personal" });
  x.automations.push(
    { id: "once", projectId: "proj_personal", name: "Reminder", enabled: true, trigger: { triggerType: "once" }, execution: { mode: "agent", targetThreadId: "thr_once", prompt: "Remind me" } },
    { id: "cron", projectId: "proj_personal", name: "Daily", enabled: true, trigger: { triggerType: "schedule", cron: "0 8 * * *", timezone: "Asia/Tokyo" }, execution: { mode: "agent", targetThreadId: "thr_cron", prompt: "Check" } },
  );
  expect((await x.runners.adoptable()).map((a) => a.automationId)).toEqual(["cron"]);
  await expect(x.runners.adopt({ threadId: "thr_once", automationId: "once" })).rejects.toThrow(/recurring cron/);
  expect(x.automations[0]).toMatchObject({ enabled: true, trigger: { triggerType: "once" } });
  const adopted = await x.runners.adopt({ threadId: "thr_cron", automationId: "cron" });
  expect(adopted.schedule).toMatchObject({ timezone: "Asia/Tokyo" });
  await x.runners.update({ id: adopted.id, schedule: { cadence: "custom", time: "09:00", cron: "0 10 * * *" } });
  expect(x.automations[1]).toMatchObject({ trigger: { triggerType: "schedule", cron: "0 10 * * *", timezone: "Asia/Tokyo" } });
});


it("retains runner cleanup after a failed archive and retries it", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Inbox", job: "Check", schedule });
  x.archive.mockRejectedValueOnce(new Error("offline"));
  await expect(x.runners.delete(runner.id)).rejects.toThrow("offline");
  expect(x.db.prepare("SELECT id FROM bot_runners WHERE id = ?").get(runner.id)).toBeTruthy();
  await x.runners.retryCleanup();
  expect(x.db.prepare("SELECT id FROM bot_runners WHERE id = ?").get(runner.id)).toBeUndefined();
  expect(x.threads.get(runner.threadId!)?.archivedAt).toBe(5);
});

it("retains failed creation rollback until the remote thread can be archived", async () => {
  const x = await setup();
  const original = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (args) => { if (args.method === "automations_create") throw new Error("offline"); return original(args); });
  x.archive.mockRejectedValueOnce(new Error("offline"));
  await expect(x.runners.create({ name: "Inbox", job: "Check", schedule })).rejects.toThrow("offline");
  expect(x.db.prepare("SELECT id FROM bot_runners").all()).toHaveLength(1);
  await x.runners.retryCleanup();
  expect(x.db.prepare("SELECT id FROM bot_runners").all()).toHaveLength(0);
});


it("keeps the timezone when editing an adopted runner through unified automations", async () => {
  const x = await setup();
  x.add({ id: "thr_cron", title: "Tokyo" });
  x.started.push({ id: "thr_cron", title: "Tokyo", projectId: "proj_personal" });
  x.automations.push({ id: "cron", projectId: "proj_personal", name: "Tokyo", enabled: true, trigger: { triggerType: "schedule", cron: "0 8 * * *", timezone: "Asia/Tokyo" }, execution: { mode: "agent", targetThreadId: "thr_cron", prompt: "Check" } });
  const runner = await x.runners.adopt({ threadId: "thr_cron", automationId: "cron" });
  // Registrations made before timezone storage existed recover it from BB.
  x.db.prepare("UPDATE bot_runners SET timezone = NULL WHERE id = ?").run(runner.id);
  const auto = new Automations({ db: x.db, sdk: x.sdk, bot: () => ({ ...x.bot, primary: true, kind: "studio" }), changed: () => {}, heartbeat: { get: () => null, set: vi.fn(), automation: () => null }, runners: x.runners });
  const view = await auto.update({ id: runner.id, schedule: { type: "cron", cron: "0 10 * * *", timezone: "Asia/Tokyo" } });
  expect(view.schedule).toMatchObject({ timezone: "Asia/Tokyo", cron: "0 10 * * *" });
  expect(x.automations[0]).toMatchObject({ trigger: { timezone: "Asia/Tokyo", cron: "0 10 * * *" } });
});

it("retains adopted runner registration when removing its reporting note fails", async () => {
  const x = await setup();
  x.add({ id: "thr_cron", title: "Cron" });
  x.started.push({ id: "thr_cron", title: "Cron", projectId: "proj_personal" });
  x.automations.push({ id: "cron", projectId: "proj_personal", name: "Cron", enabled: true, trigger: { triggerType: "schedule", cron: "0 8 * * *" }, execution: { mode: "agent", targetThreadId: "thr_cron", prompt: "Check" } });
  const runner = await x.runners.adopt({ threadId: "thr_cron", automationId: "cron" });
  x.callRpc.mockRejectedValueOnce(new Error("offline"));
  await expect(x.runners.delete(runner.id)).rejects.toThrow("offline");
  expect(x.db.prepare("SELECT cleanup_pending FROM bot_runners WHERE id = ?").get(runner.id)).toEqual({ cleanup_pending: 1 });
  await x.runners.retryCleanup();
  expect(x.automations[0]).toMatchObject({ execution: { prompt: "Check" } });
});

it("reports failed phone push delivery instead of claiming success", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Inbox", job: "Check", schedule });
  x.callRpc.mockRejectedValueOnce(new Error("push offline"));
  await expect(x.runners.alert(runner.id, "Needs you")).rejects.toThrow("push offline");
});

it.each(["offline", "invalid"])("does not publish an empty runner schedule on %s reads", async (failure) => {
  const x = await setup();
  await x.runners.create({ name: "Inbox", job: "Check", schedule });
  const before = await x.runners.list();
  x.callRpc.mockImplementationOnce(async () => { if (failure === "offline") throw new Error("offline"); return [{}] as never; });
  await expect(x.runners.list()).rejects.toThrow();
  expect(await x.runners.list()).toEqual(before);
});


it("publishes sidebar invalidation after creating, updating and deleting a runner", async () => {
  const x = await setup();
  for (const mutate of [
    async () => { await x.runners.create({ name: "Security", job: "Check dependencies", schedule }); },
    async () => { await x.runners.update({ id: "Security", name: "Security audit" }); },
    async () => { await x.runners.delete("Security audit"); },
  ]) {
    const before = x.harness.realtimeSignals.length;
    await mutate();
    expect(x.harness.realtimeSignals.slice(before)).toContainEqual(expect.objectContaining({ channel: "studio-changed" }));
  }
  expect(await x.runners.list()).toEqual([]);
});

it("exposes the last automation failure separately from a previous successful report", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Security", job: "Check dependencies", schedule });
  await x.runners.report(runner.threadId!, { level: "tell", summary: "All clear" });
  Object.assign(x.automations[0]!, { lastRunAt: Date.now() + 60_000, lastRunStatus: "failed" });
  expect((await x.runners.list())[0]).toMatchObject({ lastRunStatus: "failed", lastLevel: "tell" });
});


it("resolves machine ids and unique names, refuses ambiguous or missing names", async () => {
  const x = await setup();
  expect(await resolveRunnerMachine(x.sdk, "")).toBeNull();
  expect((await resolveRunnerMachine(x.sdk, "RED4"))?.id).toBe("host_red4");
  expect((await resolveRunnerMachine(x.sdk, "host_red4"))?.name).toBe("red4");
  await expect(resolveRunnerMachine(x.sdk, "missing")).rejects.toThrow("No machine");
  x.hosts.push({ id: "duplicate", name: "red4", status: "connected" });
  await expect(resolveRunnerMachine(x.sdk, "red4")).rejects.toThrow("ambiguous");
});

it("checks paths and Mac tools before creating, requires confirmation without making a row", async () => {
  const x = await setup();
  const input = { name: "Files", job: "Use Beeper and osascript for /Users/patrick/mail and ~/notes", schedule, machine: "red4" };
  const check = await x.runners.preflight(input);
  expect(check.warnings).toEqual(expect.arrayContaining([expect.stringContaining("/Users/patrick/mail"), expect.stringContaining("Beeper"), expect.stringContaining("osascript")]));
  expect(x.pathsExist).toHaveBeenCalledWith({ hostId: "host_red4", paths: ["/Users/patrick/mail", "~/notes"] });
  await expect(x.runners.create(input)).rejects.toBeInstanceOf(RunnerPreflightError);
  expect(await x.runners.list()).toEqual([]);
  const runner = await x.runners.create({ ...input, confirm: true });
  expect(runner).toMatchObject({ machine: "host_red4", machineName: "red4" });
  expect(x.spawn).toHaveBeenCalledWith(expect.objectContaining({ environment: { type: "provider", environmentProviderId: "personal-workspace", inputs: null, machine: { type: "existing", hostId: "host_red4" } } }));
});

it("blocks missing CLI and sign-in even when confirmed, installs only on the selected host", async () => {
  const x = await setup();
  const input = { name: "Files", job: "Check files", schedule, machine: "red4", confirm: true };
  x.cli.codex.installed = false;
  await expect(x.runners.create(input)).rejects.toThrow("Install Codex on red4");
  await x.runners.installProvider({ machine: "red4" });
  expect(x.installProviderCli).toHaveBeenCalledWith({ hostId: "host_red4", provider: "codex", actionKind: "install" });
  x.cli.codex.installed = true;
  x.providerStates.providers[0]!.status = "unauthenticated";
  await expect(x.runners.create(input)).rejects.toThrow("needs sign-in on red4. Run codex login");
  expect(x.spawn).not.toHaveBeenCalled();
});

it("skips offline runs, alerts once per outage and clears state on reconnection", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Files", job: "Check files", schedule, machine: "red4" });
  x.hosts[0]!.status = "disconnected";
  await x.runners.runNow(runner.id);
  await x.runners.runNow(runner.id);
  await x.runners.checkMachines();
  expect(x.calls.filter(c => c.method === "automations_run")).toHaveLength(0);
  expect(x.send).toHaveBeenCalledTimes(1);
  expect((await x.runners.get(runner.id)).machineOffline).toBe(true);
  expect(x.runners.resumeTargets()[0]?.on).toBe(false);
  x.hosts[0]!.status = "connected";
  await x.runners.checkMachines();
  expect((await x.runners.get(runner.id)).machineOffline).toBe(false);
  await x.runners.runNow(runner.id);
  expect(x.calls.filter(c => c.method === "automations_run")).toHaveLength(1);
  x.hosts[0]!.status = "disconnected";
  await x.runners.checkMachines();
  expect(x.send).toHaveBeenCalledTimes(2);
});

it("migrates the same row and automation with the last 3 reports, then archives; moves back too", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Files", job: "Check files", schedule });
  for (const summary of ["discard", "one", "two", "three"]) await x.runners.report(runner.threadId!, { level: "log", summary });
  const automationId = x.runners.automation(runner.id)!.id;
  const moved = await x.runners.migrate({ id: runner.id, machine: "red4" });
  expect(moved).toMatchObject({ id: runner.id, machine: "host_red4", name: runner.name, job: runner.job, schedule: runner.schedule, lastReport: "three" });
  expect(moved.threadId).not.toBe(runner.threadId);
  expect(x.runners.automation(runner.id)?.id).toBe(automationId);
  expect(x.automations[0]).toMatchObject({ execution: { targetThreadId: moved.threadId } });
  const text = (x.spawn.mock.calls.at(-1) as unknown as [{ input: { text: string }[] }])[0].input[0]!.text;
  expect(text).toContain("one\ntwo\nthree");
  expect(text).not.toContain("discard");
  expect(text).toContain("Don't run the job now");
  expect(x.threads.get(runner.threadId!)?.archivedAt).toBe(5);
  expect(x.db.prepare("SELECT bot_id FROM bot_hidden_threads WHERE thread_id = ?").get(moved.threadId)).toEqual({ bot_id: "bot_main" });
  const back = await x.runners.migrate({ id: runner.id, machine: null });
  expect(back.machine).toBeNull();
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ environment: { type: "project-default" } }));
});

it("refuses migration during a run or to an unready provider", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Files", job: "Check files", schedule });
  const old = x.threads.get(runner.threadId!)!;
  x.threads.set(old.id, { ...old, status: "active" });
  await expect(x.runners.migrate({ id: runner.id, machine: "red4" })).rejects.toThrow("run is in progress");
  x.threads.set(old.id, { ...old, status: "idle" });
  x.cli.codex.installed = false;
  await expect(x.runners.migrate({ id: runner.id, machine: "red4", confirm: true })).rejects.toThrow("Install Codex");
  expect(x.spawn).toHaveBeenCalledTimes(1);
  expect(x.archive).not.toHaveBeenCalled();
});

it.each(["spawn", "retarget"])("keeps the old runner intact after %s failure", async failure => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Files", job: "Check files", schedule });
  const execution = structuredClone(x.automations[0]!.execution);
  if (failure === "spawn") x.spawn.mockRejectedValueOnce(new Error("spawn failed"));
  if (failure === "retarget") {
    const original = x.callRpc.getMockImplementation()!;
    x.callRpc.mockImplementationOnce(async args => original(args)); // automation list
    x.callRpc.mockImplementationOnce(async args => original(args)); // temporary pause
    x.callRpc.mockImplementationOnce(async () => { throw new Error("retarget failed"); });
  }
  await expect(x.runners.migrate({ id: runner.id, machine: "red4" })).rejects.toThrow(`${failure} failed`);
  expect((await x.runners.get(runner.id)).threadId).toBe(runner.threadId);
  expect(x.automations[0]!.execution).toEqual(execution);
  expect(x.automations[0]!.enabled).toBe(true);
  expect(x.threads.get(runner.threadId!)?.archivedAt).toBeNull();
  expect(x.archive).not.toHaveBeenCalledWith({ threadId: runner.threadId });
});

it("uses the target default directory when personal workspace is unavailable", async () => {
  const x = await setup();
  x.environmentProviders.splice(0);
  expect(await runnerEnvironment(x.sdk, "host_red4")).toEqual({ type: "host", hostId: "host_red4", workspace: { type: "unmanaged", path: null } });
});

it("records offline admission without sending a nested dispatch; the sweep alerts once", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Files", job: "Check files", schedule, machine: "red4" });
  x.hosts[0]!.status = "disconnected";
  expect(await x.runners.available(runner.id, false)).toBe(false);
  expect(x.send).not.toHaveBeenCalled();
  await Promise.all([x.runners.checkMachines(), x.runners.checkMachines()]);
  expect(x.send).toHaveBeenCalledTimes(1);
});

it("ignores URL paths during preflight and respects host-specific provider availability", async () => {
  const x = await setup();
  const check = await x.runners.preflight({ machine: "red4", job: "Check https://example.com/news and /srv/data" });
  expect(check.warnings).toEqual([]);
  expect(x.pathsExist).toHaveBeenCalledWith({ hostId: "host_red4", paths: ["/srv/data"] });
  x.environmentProviders[0]!.machineAvailability = { host_red4: { status: "unavailable" } } as never;
  expect(await runnerEnvironment(x.sdk, "host_red4")).toMatchObject({ type: "host", hostId: "host_red4" });
});

it("suspends the automation through an outage and resumes on reconnection without replaying a run", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Files", job: "Check files", schedule, machine: "red4" });
  x.hosts[0]!.status = "disconnected";
  await x.runners.checkMachines();
  expect(x.automations[0]!.enabled).toBe(false);
  expect((await x.runners.get(runner.id))).toMatchObject({ state: "active", machineOffline: true });
  await x.runners.checkMachines();
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.calls.filter(c => c.method === "automations_run")).toEqual([]);
  x.hosts[0]!.status = "connected";
  await x.runners.checkMachines();
  expect(x.automations[0]!.enabled).toBe(true);
  expect((await x.runners.get(runner.id)).machineOffline).toBe(false);
  expect(x.calls.filter(c => c.method === "automations_run")).toEqual([]);
});

it("keeps a user's pause during an outage and across reconnection", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Files", job: "Check files", schedule, machine: "red4" });
  x.hosts[0]!.status = "disconnected";
  await x.runners.checkMachines();
  await x.runners.setState(runner.id, "paused");
  x.hosts[0]!.status = "connected";
  await x.runners.checkMachines();
  expect(x.automations[0]!.enabled).toBe(false);
  expect((await x.runners.get(runner.id)).state).toBe("paused");
});


it("recovers pre-buffer reports from the old thread for migration", async () => {
  const x = await setup();
  const runner = await x.runners.create({ name: "Files", job: "Check files", schedule });
  x.timeline.mockResolvedValue({ rows: [1, 2, 3, 4].map(n => ({ kind: "turn", children: [{ kind: "work", workKind: "tool", toolName: "mcp__studio__runner_report", toolArgs: { summary: `old ${n}` }, createdAt: n }] })) });
  await x.runners.migrate({ id: runner.id, machine: "red4" });
  const text = (x.spawn.mock.calls.at(-1) as unknown as [{ input: { text: string }[] }])[0].input[0]!.text;
  expect(text).toContain("old 2\nold 3\nold 4");
  expect(text).not.toContain("old 1");
});
