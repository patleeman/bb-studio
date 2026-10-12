import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { botHeartbeat, botInstructions, BOT_ID, Bots, CHECKIN_PRESETS, classifyActivity, MEMORY_TEMPLATE, startedBy } from "./bot";
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
  const spawn = vi.fn(async (args: { projectId: string; title?: string }) => add({ id: `t${count + 1}`, projectId: args.projectId, title: args.title ?? null }));
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
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      spawn: spawn as never, get: get as never, archive: archive as never, list: list as never, stop: stop as never,
      unpin: async () => ({}) as never, output: async () => ({ output: "All quiet." }),
      search: (async ({ query }: { query: string }) => {
        const hit = (thread: Thread) => ({ thread, matches: [{ text: `${thread.title} mentions ${query}`, highlightRanges: [], sourceKind: "assistant_message", sourceSeq: 1 }] });
        return { active: { results: [...threads.values()].filter((thread) => !thread.archivedAt).map(hit) }, archived: { results: [...threads.values()].filter((thread) => thread.archivedAt).map(hit) } };
      }) as never,
      defaultExecutionOptions: async () => ({ model: "model", reasoningLevel: "high", permissionMode: "accept-edits" }) as never,
    },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const bots = { current: null as Bots | null };
  const leads = new ProjectLeads({ db, sdk: bb.sdk, changed: () => {}, personalPrompt: () => bots.current!.prompt() });
  const pages = new Map<string, { title: string; markdown: string }>();
  let made = 0;
  const userSkillsDir = await mkdtemp(join(tmpdir(), "bot-skills-"));
  const memory = { exists: (id: string) => pages.has(id), create: (page: { title: string; markdown: string }) => { const id = `pg${++made}`; pages.set(id, page); return id; } };
  bots.current = new Bots({ db, sdk: bb.sdk, leads, changed: () => {}, memory, userSkillsDir });
  return { bb, db, leads, bots: bots.current, threads, add, spawn, stop, callRpc, automations, pages, userSkillsDir };
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
  await expect(x.bots.create({ name: "Two", avatar: "2" })).rejects.toThrow(/already/);
  await x.bots.setRun({ enabled: true, cadence: "hourly" });
  expect(prompts(x)).toEqual([botHeartbeat("Dot")]);
  await x.bots.set({ name: "Penny" });
  expect(prompts(x)).toEqual([botHeartbeat("Penny")]);
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
  expect(botHeartbeat("Dot")).toMatch(/without a final assistant message: no "✓"/);
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
