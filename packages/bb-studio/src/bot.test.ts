import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { botHeartbeat, botInstructions, BOT_ID, Bots, CHECKIN_PRESETS, classifyActivity, descendants, MEMORY_TEMPLATE, spawnedBy, startedBy } from "./bot";
import { PERSONAL_PROJECT_ID, ProjectLeads } from "./project-lead";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const BOTS = MIGRATIONS.findIndex((statement) => statement.includes("CREATE TABLE bots"));
const request = {
  projectId: "elsewhere", providerId: "codex", model: "model", reasoningLevel: "high" as const, permissionMode: "accept-edits" as const,
  executionInputSources: {}, environment: { type: "project-default" }, input: [{ type: "text", text: "Carry on", mentions: [] }],
} as never;
type Thread = ReturnType<typeof makeThreadResponse>;

async function setup(migrations = MIGRATIONS) {
  const threads = new Map<string, Thread>();
  let count = 0;
  const add = (fields: Partial<Thread> & { id: string }) => { const thread = makeThreadResponse({ projectId: "p", providerId: "codex", updatedAt: 1000 + ++count, ...fields }); threads.set(thread.id, thread); return thread; };
  // What each thread runs with, as BB resolves it (threads.defaultExecutionOptions).
  const execution = new Map<string, { model: string; reasoningLevel: string; permissionMode: string }>();
  const spawn = vi.fn(async (args: { projectId: string; title?: string; providerId?: string; model?: string; reasoningLevel?: string; permissionMode?: string }) => {
    const thread = add({ id: `t${count + 1}`, projectId: args.projectId, title: args.title ?? null, providerId: args.providerId ?? "codex" });
    execution.set(thread.id, { model: args.model ?? "model", reasoningLevel: args.reasoningLevel ?? "high", permissionMode: args.permissionMode ?? "accept-edits" });
    return thread;
  });
  const get = vi.fn(async ({ threadId }: { threadId: string }) => {
    const thread = threads.get(threadId);
    if (!thread) throw Object.assign(new Error("Not found"), { status: 404 });
    return thread;
  });
  const list = vi.fn(async (args: { sourceThreadId?: string; parentThreadId?: string } = {}) => [...threads.values()].filter((thread) =>
    (!args.sourceThreadId || thread.sourceThreadId === args.sourceThreadId) && (!args.parentThreadId || thread.parentThreadId === args.parentThreadId)));
  const stop = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, status: "idle" }); return {}; });
  const archive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: 5 }); return { ok: true }; });
  const automations: Record<string, unknown>[] = [];
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: Record<string, unknown> }) => {
    if (method === "automations_list") return automations;
    if (method === "automations_create") { const made = { id: `a${automations.length + 1}`, name: input.name, enabled: false, trigger: input.trigger, execution: input.execution, nextRunAt: 99 }; automations.push(made); return made; }
    if (method === "automations_update") { const row = automations.find((a) => a.id === input.automationId); if (row) Object.assign(row, { trigger: input.trigger, execution: input.execution }); return {}; }
    if (method === "automations_resume" || method === "automations_pause") { const row = automations.find((a) => a.id === input.automationId); if (row) row.enabled = method === "automations_resume"; return {}; }
    if (method === "automations_delete") { const at = automations.findIndex((a) => a.id === input.automationId); if (at >= 0) automations.splice(at, 1); return {}; }
    return {};
  });
  const providers = [
    { id: "codex", capabilities: { permissionModes: ["accept-edits", "auto", "full"] } },
    { id: "claude", capabilities: { permissionModes: ["accept-edits", "auto", "full"] } },
    { id: "hermes", capabilities: { permissionModes: ["accept-edits", "full"] } },
    { id: "grok", capabilities: { permissionModes: ["full"] } },
  ];
  const update = vi.fn(async ({ threadId, ...fields }: { threadId: string; model?: string; reasoningLevel?: string }) => { execution.set(threadId, { ...execution.get(threadId)!, ...fields }); return {}; });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      spawn: spawn as never, get: get as never, archive: archive as never, list: list as never, stop: stop as never,
      unpin: async () => ({}) as never, update: update as never, output: async () => ({ output: "All quiet." }),
      search: (async ({ query }: { query: string }) => {
        const hit = (thread: Thread) => ({ thread, matches: [{ text: `${thread.title} mentions ${query}`, highlightRanges: [], sourceKind: "assistant_message", sourceSeq: 1 }] });
        return { active: { results: [...threads.values()].filter((thread) => !thread.archivedAt).map(hit) }, archived: { results: [...threads.values()].filter((thread) => thread.archivedAt).map(hit) } };
      }) as never,
      defaultExecutionOptions: (async ({ threadId }: { threadId: string }) => execution.get(threadId) ?? { model: "model", reasoningLevel: "high", permissionMode: "accept-edits" }) as never,
    },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
    providers: { list: (async () => providers) as never },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const bots = { current: null as Bots | null };
  const leads = new ProjectLeads({ db, sdk: bb.sdk, changed: () => {}, personalPrompt: () => bots.current!.prompt(), botPrompt: (key) => bots.current!.promptFor(key) });
  const pages = new Map<string, { title: string; markdown: string }>();
  let made = 0;
  const userSkillsDir = await mkdtemp(join(tmpdir(), "bot-skills-"));
  const memory = { exists: (id: string) => pages.has(id), create: (page: { title: string; markdown: string }) => { const id = `pg${++made}`; pages.set(id, page); return id; } };
  bots.current = new Bots({ db, sdk: bb.sdk, leads, changed: () => {}, memory, userSkillsDir });
  return { bb, db, leads, bots: bots.current, threads, add, spawn, stop, callRpc, automations, pages, userSkillsDir, update };
}

const prompts = (x: Awaited<ReturnType<typeof setup>>) => x.automations.map((a) => (a.execution as { prompt: string }).prompt);

it("turns an existing Chief of Staff into the Bot, keeping its thread and heartbeat", async () => {
  const x = await setup(MIGRATIONS.slice(0, BOTS));
  x.add({ id: "thr_chief" });
  x.db.prepare("INSERT INTO project_leads VALUES (?, ?, 1, 2)").run(PERSONAL_PROJECT_ID, "thr_chief");
  x.db.prepare("INSERT INTO project_runs VALUES (?, 1, 'daily', '08:00', NULL, 'a0', ?)").run(PERSONAL_PROJECT_ID, "p");
  x.bb.storage.migrate(x.db, MIGRATIONS);
  expect(await x.bots.get()).toMatchObject({ bot: { id: BOT_ID, name: "Chief of Staff", state: "active", threadId: "thr_chief" }, run: { enabled: true, cadence: "daily", time: "08:00" } });
});

it("makes no Bot when there was no Chief of Staff", async () => {
  const x = await setup();
  expect(await x.bots.get()).toEqual({ bot: null, run: null });
});

it("creates a Bot with a new chat in the personal project and names it in the heartbeat", async () => {
  const x = await setup();
  const view = await x.bots.create({ name: "Dot", avatar: "🟣", prompt: "Watch my inbox" });
  // Its instructions come from agents.configure, so its only message is the user's, and the title isn't the instructions.
  expect(x.spawn).toHaveBeenCalledWith(expect.objectContaining({ projectId: PERSONAL_PROJECT_ID, title: "Dot", pluginMetadata: { bot: BOT_ID }, input: [expect.objectContaining({ text: "Watch my inbox" })] }));
  expect(view.bot).toMatchObject({ name: "Dot", avatar: "🟣", threadId: "t1" });
  await x.bots.setRun({ enabled: true, cadence: "hourly" });
  expect(prompts(x)).toEqual([botHeartbeat("Dot")]);
  await x.bots.set({ name: "Penny" });
  expect(prompts(x)).toEqual([botHeartbeat("Penny")]);
});

it("makes a second Bot with its own thread, check-in, memory, skills and handoff, the first staying primary", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const two = await x.bots.create({ name: "Scout", avatar: "🛰️", prompt: "Watch releases" });
  const id = two.bot!.id;
  expect(id).not.toBe(BOT_ID);
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: PERSONAL_PROJECT_ID, title: "Scout", pluginMetadata: { bot: id } }));
  expect(two.bot).toMatchObject({ name: "Scout", threadId: "t2", primary: false });
  // The primary stays the personal project's lead; the new Bot isn't a lead.
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("t1");
  expect(x.bots.list().map((bot) => [bot.name, bot.primary])).toEqual([["Dot", true], ["Scout", false]]);
  expect((await x.bots.get()).bot?.name).toBe("Dot");
  expect(x.bots.forThread("t2")?.id).toBe(id);
  expect(x.bots.instructions(x.bots.forThread("t2")!)).toContain("one of the user's Bots");
  // Its check-in is its own automation on its thread, with its name; not a project in project_leads.
  await x.bots.setRun({ botId: id, enabled: true, cadence: "daily", time: "07:30" });
  expect(x.automations).toEqual([expect.objectContaining({ name: `Studio project heartbeat bot:${id}`, execution: expect.objectContaining({ targetThreadId: "t2", prompt: botHeartbeat("Scout") }) })]);
  expect((await x.bots.get(id)).run).toMatchObject({ enabled: true, cadence: "daily", time: "07:30" });
  expect((await x.bots.get()).run).toBeNull();
  expect(x.leads.list().map((lead) => lead.projectId)).toEqual([PERSONAL_PROJECT_ID]);
  expect((await x.bots.activity(id)).scheduled).toEqual([expect.objectContaining({ kind: "heartbeat", enabled: true })]);
  // Memory and skills are its own.
  expect(x.bots.memoryPage(id)).not.toBe(x.bots.memoryPage());
  x.bots.writeSkill({ name: "release-watch", description: "d", body: "b" }, id);
  expect(x.bots.skills(id).map((s) => s.name)).toEqual(["release-watch"]);
  expect(x.bots.skills()).toEqual([]);
  // Pausing it leaves the primary alone and turns only its check-in off.
  await x.bots.pause(id);
  expect(x.bots.stored(id)?.state).toBe("paused");
  expect(x.bots.stored()?.state).toBe("active");
  expect(x.automations).toEqual([]);
  await x.bots.resume(id);
  expect(x.automations).toHaveLength(1);
  // A handoff moves it to the new thread, check-in included.
  const { threadId } = await x.leads.handoff("t2", request);
  await x.bots.handedOff("t2", threadId);
  expect(x.bots.stored(id)?.threadId).toBe(threadId);
  expect(x.bots.chain(id)).toEqual(["t2", threadId]);
  expect((x.automations[0]!.execution as { targetThreadId: string }).targetThreadId).toBe(threadId);
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("t1");
  await expect(x.bots.setThread(threadId)).rejects.toThrow(/Scout/);
});

it("keeps a drawn avatar and a role it's told, with the emoji as a fallback", async () => {
  const x = await setup();
  const view = await x.bots.create({ name: "Dot", avatar: "🤖", shape: "blob", color: "#5b8def" });
  expect(view.bot).toMatchObject({ avatar: "🤖", shape: "blob", color: "#5b8def", role: null });
  const set = await x.bots.set({ shape: "hexagon", color: "#e5484d", role: "  You are my chief of staff.  " });
  expect(set.bot).toMatchObject({ shape: "hexagon", color: "#e5484d", role: "You are my chief of staff." });
  expect(x.bots.instructions(set.bot!)).toContain("Your role, in the user's words: You are my chief of staff.");
  expect((await x.bots.set({ role: "" })).bot?.role).toBeNull();
});

it("keeps the Bot across a handoff, and counts threads its old thread started", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  x.add({ id: "w1", sourceThreadId: "bot1", status: "active" });
  const { threadId } = await x.leads.handoff("bot1", request);
  expect((await x.bots.get()).bot).toMatchObject({ name: "Bot", threadId });
  x.add({ id: "w2", parentThreadId: threadId, status: "idle" });
  const activity = await x.bots.activity();
  expect(activity.inProgress.map((t) => t.id)).toEqual(["w1"]);
  expect(activity.completed.map((t) => t.id)).toEqual(["w2"]);
  // Its chat reads the chain as one conversation, oldest first.
  expect(x.bots.chain()).toEqual(["bot1", threadId]);
});

it("applies check-in presets: one schedule and one Memory line each; Off turns check-ins off", async () => {
  const x = await setup();
  const lines: string[] = [];
  (x.bots as unknown as { deps: { memory: { addCheckin(pageId: string, line: string): boolean } } }).deps.memory.addCheckin = (_pageId, line) => { lines.push(line); return true; };
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const morning = await x.bots.checkinPreset("morning");
  expect(morning.run).toMatchObject({ enabled: true, cadence: "weekdays", time: "08:00" });
  const working = await x.bots.checkinPreset("working");
  expect(working.run).toMatchObject({ enabled: true, cadence: "custom", cron: "0 9-17/2 * * 1-5" });
  expect(lines).toEqual([CHECKIN_PRESETS.morning.line, CHECKIN_PRESETS.working.line]);
  expect((await x.bots.checkinPreset("off")).run?.enabled).toBe(false);
  expect(lines).toHaveLength(2);
});

it("pauses, resumes and stops", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  await x.bots.setRun({ enabled: true, cadence: "daily" });
  x.automations.push({ id: "other", name: "Inbox sweep", enabled: true, trigger: { cron: "0 9 * * *" }, execution: { targetThreadId: "bot1" }, nextRunAt: 50 });
  x.add({ id: "w1", lifecycleOwnerThreadId: "bot1", status: "active" });
  x.add({ id: "mine", status: "active" });

  expect(await x.bots.pause()).toMatchObject({ bot: { state: "paused" }, run: { enabled: false } });
  await expect(x.bots.setRun({ enabled: true, cadence: "daily" })).rejects.toThrow(/paused/);
  expect(await x.bots.resume()).toMatchObject({ bot: { state: "active" }, run: { enabled: true } });

  const stopped = await x.bots.stop();
  expect(stopped).toMatchObject({ bot: { state: "stopped" }, run: { enabled: false }, stoppedThreadIds: ["w1"], pausedAutomationIds: ["other"] });
  expect(x.stop).toHaveBeenCalledTimes(1);
  expect(x.threads.get("mine")!.status).toBe("active");
  expect(await x.bots.resume()).toMatchObject({ bot: { state: "active" }, run: { enabled: true } });
});

it("Stop stops only threads the Bot spawned, not forks or continuations of its chat", async () => {
  const x = await setup();
  x.add({ id: "bot0", status: "idle" });
  x.add({ id: "bot1" });
  x.db.prepare("INSERT INTO project_thread_handoffs (old_thread_id, new_thread_id, project_id, lead, archived) VALUES ('bot0', 'bot1', NULL, 0, 0)").run();
  await x.bots.setThread("bot1");
  x.add({ id: "child", parentThreadId: "bot1", status: "active" });
  x.add({ id: "owned", lifecycleOwnerThreadId: "bot0", status: "active" });
  x.add({ id: "fork", sourceThreadId: "bot1", originKind: "fork", status: "active" });
  x.add({ id: "continued", sourceThreadId: "bot0", originKind: "fork", status: "active" });
  expect(spawnedBy({ parentThreadId: null, lifecycleOwnerThreadId: null }, new Set(["bot1"]))).toBe(false);
  const stopped = await x.bots.stop();
  expect(stopped.stoppedThreadIds.sort()).toEqual(["child", "owned"]);
  expect(x.threads.get("fork")!.status).toBe("active");
  expect(x.threads.get("continued")!.status).toBe("active");
});

it("Resume turns back on only the automations and runners Stop paused", async () => {
  const x = await setup();
  const runnerStates = new Map([["run_on", "active"], ["run_off", "paused"]]);
  const restore = vi.fn(async (id: string) => { if (!runnerStates.has(id)) return false; runnerStates.set(id, "active"); return true; });
  const runners = {
    threads: () => new Map<string, { urgent: boolean }>(),
    pauseAll: async (_botId?: string, onPaused?: (id: string) => void) => {
      const paused = [...runnerStates].filter(([, state]) => state === "active").map(([id]) => id);
      for (const id of paused) { runnerStates.set(id, "paused"); onPaused?.(id); }
      return paused;
    },
    restore,
  };
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, runners });
  x.add({ id: "bot1" });
  await bots.setThread("bot1");
  x.automations.push(
    { id: "on", name: "Inbox sweep", enabled: true, trigger: { cron: "0 9 * * *" }, execution: { targetThreadId: "bot1" } },
    { id: "gone", name: "Old sweep", enabled: true, trigger: { cron: "0 9 * * *" }, execution: { targetThreadId: "bot1" } },
    { id: "off", name: "Weekly", enabled: false, trigger: { cron: "0 9 * * 1" }, execution: { targetThreadId: "bot1" } },
  );
  expect((await bots.stop()).pausedAutomationIds).toEqual(["on", "gone"]);
  x.automations.splice(x.automations.findIndex((a) => a.id === "gone"), 1);
  // One re-enable fails: the Bot stays stopped and keeps what's left to restore.
  const real = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (args) => { if (args.method === "automations_resume" && args.input.automationId === "on") throw new Error("down"); return real(args); });
  await expect(bots.resume()).rejects.toThrow("down");
  expect((await bots.get()).bot?.state).toBe("stopped");
  expect(runnerStates.get("run_on")).toBe("active");
  x.callRpc.mockImplementation(real);
  expect(await bots.resume()).toMatchObject({ bot: { state: "active" } });
  expect(x.automations.map((a) => [a.id, a.enabled])).toEqual([["on", true], ["off", false]]);
  expect(runnerStates.get("run_off")).toBe("paused");
  expect(restore.mock.calls.map(([id]) => id)).toEqual(["run_on"]);
  expect(x.db.prepare("SELECT COUNT(*) AS n FROM bot_stop_paused").get()).toEqual({ n: 0 });
});

it("lists heartbeat and automations aimed at the Bot as Scheduled", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  await x.bots.setRun({ enabled: true, cadence: "daily", time: "07:00" });
  x.automations.push({ id: "other", name: "Inbox sweep", enabled: true, trigger: { cron: "0 9 * * *" }, execution: { targetThreadId: "bot1" }, nextRunAt: 50 });
  x.automations.push({ id: "else", name: "Not mine", enabled: true, trigger: {}, execution: { targetThreadId: "zz" } });
  const { scheduled } = await x.bots.activity();
  expect(scheduled.map((each) => [each.kind, each.id])).toEqual([["heartbeat", "a1"], ["automation", "other"]]);
});

it("classifies activity: pending interactions first, running, then completed threads it started", () => {
  const t = (id: string, { hasPendingInteraction = false, ...fields }: Partial<Thread> & { hasPendingInteraction?: boolean }) => ({ ...makeThreadResponse({ id, projectId: "p", providerId: "codex", ...fields }), hasPendingInteraction });
  const result = classifyActivity([
    t("bot", { status: "active", updatedAt: 9 }),
    t("ask", { status: "active", hasPendingInteraction: true, updatedAt: 1 }),
    t("run", { status: "starting", updatedAt: 2 }),
    t("old", { status: "idle", updatedAt: 3 }),
    t("err", { status: "error", updatedAt: 4 }),
    t("gone", { status: "idle", archivedAt: 1 }),
  ], "bot");
  expect(result.needsYou.map((each) => each.id)).toEqual(["ask"]);
  expect(result.inProgress.map((each) => [each.id, each.relation])).toEqual([["bot", "self"], ["run", "started"]]);
  expect(result.completed.map((each) => each.id)).toEqual(["err", "old"]);
  expect(startedBy({ sourceThreadId: null, parentThreadId: null, lifecycleOwnerThreadId: "b" }, new Set(["b"]))).toBe(true);
  expect(startedBy({ sourceThreadId: null, parentThreadId: null, lifecycleOwnerThreadId: null }, new Set(["b"]))).toBe(false);
});

it("keeps the chief_of_staff view in step with the Bot (deprecated aliases)", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  expect(await x.leads.chief()).toEqual({ threadId: "bot1", run: null });
  expect((await x.bots.get()).bot?.threadId).toBe("bot1");
});

it("knows its new thread by spawn metadata before it becomes the lead", async () => {
  const x = await setup();
  x.db.prepare("INSERT INTO bots (id, name, avatar, state, created_at, updated_at) VALUES (?, 'Dot', '🟣', 'active', 1, 1)").run(BOT_ID);
  expect(x.bots.forThread("t9", { bot: BOT_ID })).toMatchObject({ name: "Dot", threadId: "t9" });
  expect(x.bots.forThread("t9", {})).toBeNull();
  x.add({ id: "bot1" });
  await x.leads.setLead(PERSONAL_PROJECT_ID, "bot1");
  expect(x.bots.forThread("t9", { bot: BOT_ID })).toBeNull();
});

it("makes one Memory page on first need and points the Bot at it briefly", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  const bot = x.bots.forThread("bot1")!;
  const text = x.bots.instructions(bot);
  expect(x.pages.size).toBe(1);
  expect(x.pages.get("pg1")).toEqual({ title: "Bot's Memory", markdown: MEMORY_TEMPLATE });
  expect(MEMORY_TEMPLATE.startsWith("## Check-in")).toBe(true);
  expect(text).toContain("pg1");
  expect(text.length).toBeLessThan(800);
  x.bots.instructions(bot);
  expect(x.pages.size).toBe(1);
  expect((await x.bots.get()).bot?.memoryPageId).toBe("pg1");
  // Deleted: a new one next time.
  x.pages.delete("pg1");
  expect(x.bots.memoryPage()).toBe("pg2");
  expect(botHeartbeat("Dot")).toMatch(/Memory page/);
  expect(botHeartbeat("Dot")).toMatch(/reply exactly \[PASS\]: no "✓"/);
  expect(botInstructions({ name: "Dot", state: "active" })).toMatch(/finished fine.*no "✓"/);
  expect(botInstructions({ name: "Dot", state: "paused", memoryPageId: "pg1" })).not.toContain("pg1");
});

it("keeps skills to the Bot until shared into BB's user skills, and deletes them", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  expect(() => x.bots.writeSkill({ name: "Bad Name", description: "d", body: "b" })).toThrow(/lowercase/);
  x.bots.writeSkill({ name: "weekly-review", description: "Fridays: sum up the week", body: "1. Read threads" });
  x.bots.writeSkill({ name: "inbox", description: "Sort mail", body: "Steps" });
  expect(x.bots.skills().map((skill) => skill.name)).toEqual(["inbox", "weekly-review"]);
  expect(x.bots.instructions(x.bots.forThread("bot1")!)).toContain("inbox, weekly-review");
  const { path } = await x.bots.shareSkill("weekly-review");
  expect(path).toBe(join(x.userSkillsDir, "weekly-review", "SKILL.md"));
  expect(await readFile(path, "utf8")).toBe('---\nname: weekly-review\ndescription: "Fridays: sum up the week"\n---\n\n1. Read threads\n');
  expect(x.bots.skills().map((skill) => skill.name)).toEqual(["inbox"]);
  x.bots.writeSkill({ name: "weekly-review", description: "again", body: "b" });
  await expect(x.bots.shareSkill("weekly-review")).rejects.toThrow(/already shared/);
  expect(x.bots.deleteSkill("inbox")).toBe(true);
  expect(x.bots.deleteSkill("inbox")).toBe(false);
});

it("searches only its own threads", async () => {
  const x = await setup();
  x.add({ id: "bot1", title: "Bot chat" });
  await x.bots.setThread("bot1");
  x.add({ id: "w1", sourceThreadId: "bot1", title: "Worker" });
  x.add({ id: "other", title: "Someone else's" });
  const hits = await x.bots.historySearch("invoice");
  expect(hits.map((hit) => hit.threadId).sort()).toEqual(["bot1", "w1"]);
  expect(hits[0]!.text).toContain("invoice");
});

it("puts queued threads under Waiting to start, not In progress", () => {
  const t = (id: string, { queuedWork = "none", ...fields }: Partial<Thread> & { queuedWork?: "none" | "waiting" }) => ({ ...makeThreadResponse({ id, projectId: "p", providerId: "codex", ...fields }), queuedWork });
  const result = classifyActivity([
    t("queued", { status: "pending" }),
    t("later", { status: "idle", queuedWork: "waiting" }),
    t("run", { status: "active", queuedWork: "waiting" }),
  ], "bot");
  expect(result.waiting.map((each) => each.id).sort()).toEqual(["later", "queued"]);
  expect(result.inProgress.map((each) => each.id)).toEqual(["run"]);
  expect(result.completed).toEqual([]);
});

it("keeps the Bot paused, and the heartbeat remembered, when resuming fails to restore it", async () => {
  const x = await setup();
  x.add({ id: "thr_bot" });
  await x.bots.create({ name: "Ada", avatar: "A", threadId: "thr_bot" });
  await x.bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
  await x.bots.pause();
  const real = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (args) => { if (args.method === "automations_resume") throw new Error("down"); return real(args); });
  await expect(x.bots.resume()).rejects.toThrow("down");
  expect((await x.bots.get()).bot?.state).toBe("paused");
  x.callRpc.mockImplementation(real);
  expect(await x.bots.resume()).toMatchObject({ bot: { state: "active" }, run: { enabled: true } });
});

it("threads its threads started count too, nested by parentId", () => {
  const row = (id: string, parentThreadId: string | null, sourceThreadId: string | null = null) => ({ id, parentThreadId, sourceThreadId, lifecycleOwnerThreadId: null });
  const recent = [row("grand", "child"), row("child", null, "top"), row("stranger", "elsewhere"), row("top", "bot")];
  expect(descendants(recent, new Set(["top"])).map((thread) => thread.id)).toEqual(["child", "grand"]);
  const base = { title: "x", titleFallback: null, status: "idle", projectId: null, updatedAt: 1, archivedAt: null };
  const result = classifyActivity([
    { ...base, id: "bot" },
    { ...base, id: "top", parentThreadId: "bot" },
    { ...base, id: "child", sourceThreadId: "top" },
  ] as never, "bot");
  expect(Object.fromEntries(result.completed.map((thread) => [thread.id, thread.parentId]))).toEqual({ top: null, child: "top" });
});

it("imports an external bot: its thread runs on the provider and model, and Studio-local features are off", async () => {
  const x = await setup();
  await expect(x.bots.create({ name: "Herm", avatar: "🤖", external: { providerId: "hermes", model: "hermes-agent" } })).rejects.toThrow(/first bot/);
  await x.bots.create({ name: "Bot", avatar: "🤖" });
  await expect(x.bots.create({ name: "X", avatar: "🤖", external: { providerId: "codex", model: "m" } })).rejects.toThrow(/isn't an external/);
  const made = await x.bots.create({ name: "Herm", avatar: "🤖", external: { providerId: "hermes", model: "hermes-agent" } });
  expect(made.bot).toMatchObject({ kind: "external", providerId: "hermes", model: "hermes-agent", primary: false });
  expect(x.spawn.mock.calls.at(-1)![0]).toMatchObject({ providerId: "hermes", model: "hermes-agent", reasoningLevel: "none", permissionMode: "accept-edits", pluginMetadata: { bot: made.bot!.id } });
  expect(x.bots.memoryPage(made.bot!.id)).toBeNull();
  expect(() => x.bots.requireStudio(made.bot!.id, "skills")).toThrow("Herm has no Studio skills. Runs on Hermes — its memory and tools live there.");
  expect(() => x.bots.requireStudio(undefined, "skills")).not.toThrow();
  const told = x.bots.instructions(made.bot!);
  expect(told).toContain("check-in message");
  expect(told).not.toMatch(/bot_skill|runner_create|pages_read/);
  // Check-ins still work: an automation that messages its thread.
  await x.bots.setRun({ botId: made.bot!.id, enabled: true, cadence: "daily", time: "09:00" });
  expect(x.automations.at(-1)).toMatchObject({ execution: { targetThreadId: made.bot!.threadId } });
  expect((x.automations.at(-1)!.execution as { prompt: string }).prompt).not.toContain("Memory page");
  expect((await x.bots.pause(made.bot!.id)).bot!.state).toBe("paused");
});

it("resolves the Bot a thread acts for: own thread or handoff chain, its runners, threads it started; else none", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!.id;
  x.add({ id: "run_t" });
  x.add({ id: "child", parentThreadId: "t2" });
  x.add({ id: "grandchild", sourceThreadId: "child" });
  x.add({ id: "runner_child", lifecycleOwnerThreadId: "run_t" });
  x.add({ id: "loose" });
  const runnerBot = (id: string) => id === "run_t" ? scout : null;
  expect(await x.bots.actingFor("t2", runnerBot)).toEqual({ botId: scout, via: "own" });
  expect(await x.bots.actingFor("run_t", runnerBot)).toEqual({ botId: scout, via: "runner" });
  expect(await x.bots.actingFor("grandchild", runnerBot)).toEqual({ botId: scout, via: "started" });
  expect(await x.bots.actingFor("runner_child", runnerBot)).toEqual({ botId: scout, via: "started" });
  expect(await x.bots.actingFor("loose", runnerBot)).toBeNull();
  const { threadId } = await x.leads.handoff("t2", request);
  await x.bots.handedOff("t2", threadId);
  expect(await x.bots.actingFor("t2", runnerBot)).toEqual({ botId: scout, via: "own" });
  expect(await x.bots.actingFor(threadId, runnerBot)).toEqual({ botId: scout, via: "own" });
});

it("imports with the permission picked, falling back to what the provider supports", async () => {
  const x = await setup();
  await x.bots.create({ name: "Bot", avatar: "🤖" });
  await x.bots.create({ name: "Herm", avatar: "🤖", external: { providerId: "hermes", model: "h", permissionMode: "full" } });
  expect(x.spawn.mock.calls.at(-1)![0]).toMatchObject({ permissionMode: "full" });
  // Grok runs with full access only.
  await x.bots.create({ name: "G", avatar: "🤖", external: { providerId: "grok", model: "g" } });
  expect(x.spawn.mock.calls.at(-1)![0]).toMatchObject({ permissionMode: "full" });
});

it("derives a bot's kind from its current provider, and fills it in from its thread", async () => {
  const { botKind, pickPermission, modelChange } = await import("./bot");
  expect(botKind("hermes")).toBe("external");
  expect(botKind("codex")).toBe("studio");
  expect(botKind(null)).toBe("studio");
  expect(pickPermission(["accept-edits", "full"])).toBe("accept-edits");
  expect(pickPermission(["full"], "accept-edits")).toBe("full");
  expect(pickPermission(["accept-edits", "auto", "full"], "auto")).toBe("auto");
  const x = await setup();
  const made = await x.bots.create({ name: "Dot", avatar: "🟣" });
  // A bot's provider and model are its current thread's.
  expect(made.bot).toMatchObject({ kind: "studio", providerId: "codex", model: "model" });
  expect(modelChange({ providerId: "claude", model: "opus" }, { providerId: "claude", model: "sonnet" })).toBe("in-place");
  expect(modelChange({ providerId: "claude", model: "opus" }, { providerId: "codex", model: "gpt" })).toBe("handoff");
  expect(modelChange({ providerId: "claude", model: "opus" }, { providerId: "claude", model: "opus" })).toBe("unchanged");
  expect(modelChange({ providerId: null, model: null }, { providerId: "claude", model: "opus" })).toBe("in-place");
});

it("switches a thread's model in place on the same provider, and hands a bot's thread off to another provider", async () => {
  const x = await setup();
  await x.bots.create({ name: "Bot", avatar: "🤖" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  const first = scout.threadId!;
  expect(await x.bots.switchModel(first, { providerId: "codex", model: "model" })).toEqual({ change: "unchanged", threadId: first });
  expect(await x.bots.switchModel(first, { providerId: "codex", model: "faster", reasoning: "low" })).toEqual({ change: "in-place", threadId: first });
  expect(x.update).toHaveBeenCalledWith({ threadId: first, model: "faster", reasoningLevel: "low" });
  expect((await x.bots.get(scout.id)).bot).toMatchObject({ model: "faster" });
  await x.bots.setRun({ botId: scout.id, enabled: true, cadence: "daily", time: "09:00" });
  const moved = await x.bots.switchModel(first, { providerId: "claude", model: "sonnet", reasoning: "medium" });
  expect(moved.change).toBe("handoff");
  expect(moved.threadId).not.toBe(first);
  // The thread's permission is carried forward.
  expect(x.spawn.mock.calls.at(-1)![0]).toMatchObject({ projectId: PERSONAL_PROJECT_ID, providerId: "claude", model: "sonnet", permissionMode: "accept-edits", pluginMetadata: { handoffFrom: first } });
  expect((await x.bots.get(scout.id)).bot).toMatchObject({ threadId: moved.threadId, providerId: "claude", model: "sonnet", kind: "studio" });
  expect(x.bots.chain(scout.id)).toEqual([first, moved.threadId]);
  expect(x.automations.at(-1)).toMatchObject({ execution: { targetThreadId: moved.threadId } });
  // The new thread's first turn is the bot's, before it moves.
  expect(x.bots.forThread("t99", { handoffFrom: moved.threadId })).toMatchObject({ id: scout.id });
  // Onto an external provider: its kind follows the thread, so Studio's Memory, skills and runners are off.
  const external = await x.bots.switchModel(moved.threadId, { providerId: "grok", model: "grok-4" });
  expect(x.spawn.mock.calls.at(-1)![0]).toMatchObject({ providerId: "grok", reasoningLevel: "none", permissionMode: "full" });
  expect((await x.bots.get(scout.id)).bot).toMatchObject({ threadId: external.threadId, kind: "external", providerId: "grok" });
  expect(() => x.bots.requireStudio(scout.id, "skills")).toThrow(/Runs on Grok/);
  // Any thread works, not only a bot's.
  x.add({ id: "plain", providerId: "codex" });
  expect((await x.bots.switchModel("plain", { providerId: "claude", model: "opus" })).change).toBe("handoff");
  // The primary bot leads with Studio's tools.
  const primary = (await x.bots.get()).bot!.threadId!;
  await expect(x.bots.switchModel(primary, { providerId: "hermes", model: "h" })).rejects.toThrow(/personal project/);
  await expect(x.bots.switchModel(primary, { providerId: "nope", model: "h" })).rejects.toThrow(/isn't an agent provider/);
});
