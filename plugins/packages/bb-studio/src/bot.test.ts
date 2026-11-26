import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { defaultAppearance } from "./theme/appearance";
import { NORD } from "./theme/builtin/classic";
import { GRID } from "./theme/builtin/grid";
import { testScheduler } from "./test/scheduler-fixture";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { botHeartbeat, botInstructions, BOT_ID, Bots, newMainNote, CHECKIN_PRESETS, classifyActivity, descendants, setupInput, spawnedBy, startedBy } from "./bot";
import { SKILL_CHANGED } from "./bot-skills";
import { CORE_TEMPLATE, DEFAULT_CHECKIN, sectionText } from "./core-skill";
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
  // Like BB: hidden threads (runners, Bot-owned work, review forks) are listed only with includeHidden.
  const list = vi.fn(async (args: { sourceThreadId?: string; parentThreadId?: string; includeHidden?: boolean } = {}) => [...threads.values()].filter((thread) => (args.includeHidden || thread.visibility !== "hidden") &&
    (!args.sourceThreadId || thread.sourceThreadId === args.sourceThreadId) && (!args.parentThreadId || thread.parentThreadId === args.parentThreadId)));
  const stop = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, status: "idle" }); return {}; });
  const archive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: 5 }); return { ok: true }; });
  const del = vi.fn(async ({ threadId }: { threadId: string }) => { threads.delete(threadId); return {}; });
  const automations: Record<string, unknown>[] = [];
  // Each thread's interactions (threads.interactions.list).
  const pending = new Map<string, { id: string; status: string }[]>();
  const replies = new Map<string, { at: number; text: string }[]>();
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
  const signedOut = new Set<string>();
  const update = vi.fn(async ({ threadId, ...fields }: { threadId: string; model?: string; reasoningLevel?: string }) => { execution.set(threadId, { ...execution.get(threadId)!, ...fields }); return {}; });
  const send = vi.fn(async (_args: { threadId: string; mode: string; input: { text: string }[] }) => ({}));
  const providerDefaults = new Map<string, string>([["codex", "codex-default"]]);
  // Threads BB has no stored model for (defaultExecutionOptions answers null).
  const noModel = new Set<string>();
  const projectDefault = { current: null as { providerId: string; model: string; reasoningLevel?: string } | null };
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      send: send as never, spawn: spawn as never, get: get as never, archive: archive as never, delete: del as never, list: list as never, stop: stop as never,
      unpin: async () => ({}) as never, update: update as never, output: async () => ({ output: "All quiet." }),
      interactions: { list: (async ({ threadId }: { threadId: string }) => pending.get(threadId) ?? []) as never } as never,
      // The Bot's replies (item/completed agentMessage events), newest first.
      events: { list: (async ({ threadId }: { threadId: string }) => [...(replies.get(threadId) ?? [])].reverse().map(({ at, text }) => ({ type: "item/completed", createdAt: at, data: { item: { type: "agentMessage", text } } }))) as never } as never,
      search: (async ({ query }: { query: string }) => {
        const hit = (thread: Thread) => ({ thread, matches: [{ text: `${thread.title} mentions ${query}`, highlightRanges: [], sourceKind: "assistant_message", sourceSeq: 1 }] });
        return { active: { results: [...threads.values()].filter((thread) => !thread.archivedAt).map(hit) }, archived: { results: [...threads.values()].filter((thread) => thread.archivedAt).map(hit) } };
      }) as never,
      defaultExecutionOptions: (async ({ threadId }: { threadId: string }) => noModel.has(threadId) ? null : execution.get(threadId) ?? { model: "model", reasoningLevel: "high", permissionMode: "accept-edits" }) as never,
    },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
    providers: {
      list: (async () => providers) as never,
      // BB's model list per provider: its default marked (none listed for an unknown provider).
      // A signed-out provider's catalog can't be read.
      models: (async ({ providerId }: { providerId: string }) => signedOut.has(providerId) ? Promise.reject(new Error(`${providerId} is signed out`)) : ({ models: providerDefaults.has(providerId) ? [{ id: "other", model: "other", isDefault: false }, { id: providerDefaults.get(providerId)!, model: providerDefaults.get(providerId)!, isDefault: true }] : [] })) as never,
    },
    projects: { defaultExecutionOptions: (async () => projectDefault.current) as never } as never,
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const bots = { current: null as Bots | null };
  const clock = { now: Date.now() };
  const { engine, scheduler } = testScheduler(db, bb.sdk, clock);
  const leads = new ProjectLeads({ db, sdk: bb.sdk, scheduler, changed: () => {}, personalPrompt: () => bots.current!.prompt(), botPrompt: (key) => bots.current!.promptFor(key) });
  const pages = new Map<string, { title: string; markdown: string }>();
  const userSkillsDir = await mkdtemp(join(tmpdir(), "bot-skills-"));
  const memory = { exists: (id: string) => pages.has(id), markdown: (id: string) => pages.get(id)?.markdown ?? null };
  bots.current = new Bots({ db, sdk: bb.sdk, leads, changed: () => {}, presenceChanged: () => {}, memory, userSkillsDir });
  return { send, clock, engine, scheduler, bb, db, leads, bots: bots.current, threads, add, spawn, stop, callRpc, automations, pages, userSkillsDir, update, list, pending, replies, get, del, execution, providerDefaults, projectDefault, noModel, signedOut };
}

/** What each check-in on Studio's scheduler sends when it runs: its key, the thread it wakes and the prompt after the marker. */
async function checkins(x: Awaited<ReturnType<typeof setup>>) {
  x.send.mockClear();
  const keys = x.engine.list("heartbeat").filter((trigger) => trigger.state === "on").map((trigger) => trigger.ownerId);
  for (const ownerId of keys) await x.scheduler.runNow({ owner: "heartbeat", ownerId });
  return x.send.mock.calls.map(([arg], i) => ({ key: keys[i]!, threadId: arg.threadId, prompt: arg.input[0]!.text.replace(`[bb automation due:trg_heartbeat_${keys[i]}]\n\n`, "") }));
}
const prompts = async (x: Awaited<ReturnType<typeof setup>>) => (await checkins(x)).map((each) => each.prompt);

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
  expect(await prompts(x)).toEqual([botHeartbeat("Dot")]);
  // The prompt is read when the check-in runs, so a new name needs no rescheduling.
  await x.bots.set({ name: "Penny" });
  expect(await prompts(x)).toEqual([botHeartbeat("Penny")]);
  expect(x.callRpc.mock.calls.filter(([arg]) => String(arg.method).startsWith("automations_"))).toEqual([]);
});

it("a rename carries to the Main's title and the core profile's, unless the user retitled them", async () => {
  const x = await setup();
  await x.bots.create({ name: "Assistant", avatar: "🟣" });
  const retitle = vi.fn(() => true);
  (x.bots as unknown as { deps: { memory: { retitle: typeof retitle } } }).deps.memory.retitle = retitle;
  x.pages.set("pg_profile", { title: "Assistant's core profile", markdown: "" });
  x.db.prepare("UPDATE bots SET memory_page_id = 'pg_profile' WHERE id = ?").run(BOT_ID);
  await x.bots.set({ name: "Penny" });
  expect(x.update).toHaveBeenCalledWith({ threadId: "t1", title: "Penny" });
  expect(retitle).toHaveBeenCalledWith("pg_profile", "Assistant's core profile", "Penny's core profile");
  x.update.mockClear();
  x.threads.set("t1", { ...x.threads.get("t1")!, title: "Planning" });
  await x.bots.set({ name: "Juno" });
  expect(x.update).not.toHaveBeenCalledWith(expect.objectContaining({ title: expect.anything() }));
});

it("reads the primary thread from project leads without writing the Bot row", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const before = x.db.prepare("SELECT thread_id, updated_at FROM bots WHERE id = ?").get(BOT_ID);
  x.add({ id: "thr_reconciled" });
  x.db.prepare("UPDATE project_leads SET lead_thread_id = ? WHERE project_id = ?").run("thr_reconciled", PERSONAL_PROJECT_ID);

  expect((await x.bots.get()).bot?.threadId).toBe("thr_reconciled");
  expect(x.db.prepare("SELECT thread_id, updated_at FROM bots WHERE id = ?").get(BOT_ID)).toEqual(before);
});

it("the first-time flow's setup becomes a short hello the user sees and an agent-only note that has the Bot set its own profile", async () => {
  const x = await setup();
  await x.bots.create({ name: "Chief of Staff", avatar: "🤖", setup: "Watch my PRs" });
  const input = (x.spawn.mock.calls.at(-1)![0] as unknown as { input: { text: string; visibility?: string }[] }).input;
  expect(input).toHaveLength(2);
  expect(input[0]).toEqual({ type: "text", text: "Hi! You're my new Bot. I'd like help with: Watch my PRs", mentions: [] });
  expect(input[1]!.visibility).toBe("agent-only");
  expect(input[1]!.text).toContain("bot_profile_update");
  const blank = setupInput("  ");
  expect(blank[0]!.text).toBe("Hi! You're my new Bot.");
  expect(blank[1]!.text).toContain("hasn't said what they want help with");
  expect(blank.filter((part) => part.visibility !== "agent-only").map((part) => part.text).join(" ")).not.toMatch(/bot_profile_update|_/);
  // A prompt still wins.
  await x.bots.create({ name: "Scout", avatar: "🛰️", prompt: "Hi", setup: "ignored" });
  expect((x.spawn.mock.calls.at(-1)![0] as unknown as { input: { text: string }[] }).input[0]!.text).toBe("Hi");
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
  // Its check-in is its own schedule on its thread, with its name; not a project in project_leads.
  await x.bots.setRun({ botId: id, enabled: true, cadence: "daily", time: "07:30" });
  expect(await checkins(x)).toEqual([{ key: `bot:${id}`, threadId: "t2", prompt: botHeartbeat("Scout") }]);
  expect(x.automations).toEqual([]);
  expect((await x.bots.get(id)).run).toMatchObject({ enabled: true, cadence: "daily", time: "07:30" });
  expect((await x.bots.get()).run).toBeNull();
  expect(x.leads.list().map((lead) => lead.projectId)).toEqual([PERSONAL_PROJECT_ID]);
  expect((await x.bots.activity(id)).scheduled).toEqual([expect.objectContaining({ kind: "heartbeat", enabled: true })]);
  // Skills are its own.
  x.bots.writeSkill({ name: "release-watch", description: "d", body: "b" }, id);
  expect(x.bots.skills(id).map((s) => s.name)).toEqual(["release-watch"]);
  expect(x.bots.skills()).toEqual([]);
  // Pausing it leaves the primary alone and turns only its check-in off.
  await x.bots.pause(id);
  expect(x.bots.stored(id)?.state).toBe("paused");
  expect(x.bots.stored()?.state).toBe("active");
  expect(x.engine.list("heartbeat")).toEqual([]);
  await x.bots.resume(id);
  expect(x.engine.list("heartbeat").map((trigger) => [trigger.ownerId, trigger.state])).toEqual([[`bot:${id}`, "on"]]);
  // A handoff moves it to the new thread, check-in included.
  const { threadId } = await x.leads.handoff("t2", request);
  await x.bots.handedOff("t2", threadId);
  expect(x.bots.stored(id)?.threadId).toBe(threadId);
  expect(x.bots.chain(id)).toEqual(["t2", threadId]);
  expect((await checkins(x)).map((each) => each.threadId)).toEqual([threadId]);
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("t1");
  await expect(x.bots.setThread(threadId)).rejects.toThrow(/Scout/);
});

it("gives a Bot whose Main was deleted a new, empty Main that its check-in follows, and leaves a Main that is there alone", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const id = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!.id;
  await x.bots.setRun({ botId: id, enabled: true, cadence: "daily", time: "07:30" });
  const spawned = x.spawn.mock.calls.length;
  expect(await x.bots.restoreMains()).toEqual([]);
  expect(x.spawn.mock.calls.length).toBe(spawned);

  x.threads.delete("t2");
  x.get.mockRejectedValueOnce(new Error("socket hang up"));
  expect(await x.bots.restoreMain(id, "t2")).toBeNull();
  expect(x.bots.stored(id)?.threadId).toBe("t2");

  const [made] = await Promise.all([x.bots.restoreMain(id, "t2"), x.bots.restoreMains()]);
  expect(x.spawn.mock.calls.length).toBe(spawned + 1);
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: PERSONAL_PROJECT_ID, title: "Scout", pluginMetadata: { bot: id }, input: [expect.objectContaining({ text: newMainNote("Scout", "deleted"), visibility: "agent-only" })] }));
  expect(x.bots.stored(id)?.threadId).toBe(made);
  expect(x.bots.forThread(made!)?.id).toBe(id);
  expect(await checkins(x)).toEqual([{ key: `bot:${id}`, threadId: made, prompt: botHeartbeat("Scout") }]);
  expect(await x.bots.restoreMain(id, "t2")).toBeNull();

  x.threads.set("t1", { ...x.threads.get("t1")!, deletedAt: 9 });
  // A read keeps the deleted lead (and its heartbeat) until the new Main takes them.
  expect((await x.bots.get()).bot?.threadId).toBe("t1");
  const primary = await x.bots.restoreMain(BOT_ID, "t1");
  expect(primary).toBeTruthy();
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe(primary);
  expect(x.bots.list().map((bot) => bot.name)).toEqual(["Dot", "Scout"]);

  await x.bots.pause(id);
  x.threads.delete(made!);
  const copy = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, importedAt: () => Date.now() });
  expect(await copy.restoreMain(id, made!)).toBeNull();
  expect(x.bots.stored(id)?.threadId).toBe(made);
});

it("gives a Bot whose Main was archived a new Main with a note, and its check-ins land there; the old Main stays archived", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const id = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!.id;
  await x.bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
  await x.bots.setRun({ botId: id, enabled: true, cadence: "daily", time: "07:30" });
  // Scout's Main archived (BB's menu, the CLI, a tool): a new Main.
  x.threads.set("t2", { ...x.threads.get("t2")!, archivedAt: 9 });
  const made = await x.bots.restoreMain(id, "t2");
  expect(made).toBeTruthy();
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Scout", pluginMetadata: { bot: id }, input: [expect.objectContaining({ text: newMainNote("Scout", "archived") })] }));
  expect(x.bots.stored(id)?.threadId).toBe(made);
  expect(x.threads.get("t2")?.archivedAt).toBe(9);
  // The primary's too: its lead moves, with its heartbeat.
  x.threads.set("t1", { ...x.threads.get("t1")!, archivedAt: 9 });
  const primary = await x.bots.restoreMain(BOT_ID, "t1");
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe(primary);
  expect(new Map((await checkins(x)).map((each) => [each.key, each.threadId]))).toEqual(new Map([[PERSONAL_PROJECT_ID, primary], [`bot:${id}`, made]]));
  // At startup nothing more to do.
  expect(await x.bots.restoreMains()).toEqual([]);
});

it("heals at startup: a Bot whose Main was archived or deleted while Studio was off gets a new Main", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const id = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!.id;
  x.threads.set("t1", { ...x.threads.get("t1")!, archivedAt: 9 });
  x.threads.delete("t2");
  const made = await x.bots.restoreMains();
  expect(made).toHaveLength(2);
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe(made[0]);
  expect(x.bots.stored(id)?.threadId).toBe(made[1]);
});

it("doesn't let a check-in die with an archived Main: the run finds the new Main instead of turning off", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const id = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!.id;
  await x.bots.setRun({ botId: id, enabled: true, cadence: "daily", time: "07:30" });
  x.scheduler.onThreadGone((threadId) => x.bots.rescueMain(threadId));
  // Archived without Studio hearing of it (the event was missed).
  x.threads.set("t2", { ...x.threads.get("t2")!, archivedAt: 9 });
  const [run] = await checkins(x);
  const main = x.bots.stored(id)?.threadId;
  expect(main).not.toBe("t2");
  expect(run).toEqual({ key: `bot:${id}`, threadId: main, prompt: botHeartbeat("Scout") });
  expect(x.engine.list("heartbeat").find((trigger) => trigger.ownerId === `bot:${id}`)?.state).toBe("on");
  // A thread that was no Bot's Main still turns its run off.
  expect(await x.bots.rescueMain("t_other")).toBeNull();
});

describe("a new Main never goes without a model", () => {
  /** Dot, the primary, with check-ins on; no model saved anywhere on it, and BB with none stored for its Main. */
  async function bare() {
    const x = await setup();
    await x.bots.create({ name: "Dot", avatar: "🟣" });
    await x.bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
    x.db.prepare("UPDATE bots SET main_provider_id = NULL, main_model = NULL, main_reasoning = NULL, default_provider_id = NULL, default_model = NULL").run();
    // Like BB for a thread with no stored model: it can't say what t1 runs on.
    x.noModel.add("t1");
    return x;
  }
  const spawnedOn = (x: Awaited<ReturnType<typeof setup>>) => x.spawn.mock.calls.at(-1)![0] as { providerId?: string; model?: string; executionInputSources?: Record<string, string> };

  it("deletes a Main with no stored model: the new Main starts on its provider's default, takes the heartbeat, and a read never drops them first", async () => {
    const x = await bare();
    x.threads.delete("t1");
    // A read before the new Main (bot_get from any window) keeps the lead and the heartbeat.
    expect((await x.bots.get()).run?.enabled).toBe(true);
    const made = await x.bots.heal(BOT_ID, "t1");
    expect(made).toBeTruthy();
    expect(spawnedOn(x)).toMatchObject({ providerId: "codex", model: "codex-default", executionInputSources: { providerId: "explicit", model: "explicit" } });
    expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe(made);
    expect((await checkins(x)).map((each) => each.threadId)).toEqual([made]);
  });

  it("archives a Main with no stored model: the same, on the provider's default", async () => {
    const x = await bare();
    x.threads.set("t1", { ...x.threads.get("t1")!, archivedAt: 9 });
    const made = await x.bots.heal(BOT_ID, "t1");
    expect(spawnedOn(x)).toMatchObject({ providerId: "codex", model: "codex-default" });
    expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe(made);
  });

  it("heals at startup, also a primary an older Studio left with no lead at all", async () => {
    const x = await bare();
    x.threads.delete("t1");
    x.db.prepare("UPDATE project_leads SET lead_thread_id = NULL").run();
    const made = await x.bots.restoreMains();
    expect(made).toHaveLength(1);
    expect(spawnedOn(x)).toMatchObject({ providerId: "codex", model: "codex-default" });
    expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe(made[0]);
  });

  it("starts on the old Main's model, saved while it could still be read, before any default", async () => {
    const x = await setup();
    await x.bots.create({ name: "Dot", avatar: "🟣" });
    x.execution.set("t1", { model: "gpt-main", reasoningLevel: "high", permissionMode: "accept-edits" });
    await x.bots.get();
    x.db.prepare("UPDATE bots SET default_provider_id = 'claude', default_model = 'opus'").run();
    x.threads.delete("t1");
    await x.bots.heal(BOT_ID, "t1");
    expect(spawnedOn(x)).toMatchObject({ providerId: "codex", model: "gpt-main", reasoningLevel: "high" });
  });

  it("falls back to the Bot's default model, then the project's, in that order", async () => {
    const x = await bare();
    x.db.prepare("UPDATE bots SET provider_id = 'claude', default_provider_id = 'claude', default_model = 'opus'").run();
    x.threads.delete("t1");
    await x.bots.heal(BOT_ID, "t1");
    expect(spawnedOn(x)).toMatchObject({ providerId: "claude", model: "opus" });

    const y = await bare();
    y.db.prepare("UPDATE bots SET provider_id = 'claude'").run();
    y.projectDefault.current = { providerId: "claude", model: "sonnet" };
    y.threads.delete("t1");
    await y.bots.heal(BOT_ID, "t1");
    expect(spawnedOn(y)).toMatchObject({ providerId: "claude", model: "sonnet" });
  });

  it("with no model anywhere: no thread, no throw, a plain problem with Choose a model, and choosing one starts the Main", async () => {
    const x = await bare();
    x.db.prepare("UPDATE bots SET provider_id = 'claude'").run();
    x.threads.delete("t1");
    const before = x.spawn.mock.calls.length;
    const warn = vi.fn();
    expect(await x.bots.heal(BOT_ID, "t1", warn)).toBeNull();
    expect(x.spawn.mock.calls.length).toBe(before);
    expect(warn.mock.calls[0]![0]).toContain("Choose one in Default model.");
    expect((await x.bots.get()).bot).toMatchObject({ mainProblem: "No model for a new Main", mainNeedsModel: true });
    await x.bots.setDefaultModel({ botId: BOT_ID, providerId: "claude", model: "opus" });
    expect(spawnedOn(x)).toMatchObject({ providerId: "claude", model: "opus" });
    expect((await x.bots.get()).bot).toMatchObject({ mainProblem: null, mainNeedsModel: false, threadId: x.leads.storedLead(PERSONAL_PROJECT_ID) });
  });
});

it("deletes the new thread when the Main can't move there, and backs off the heal: no empty Main every 5 minutes", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  await x.bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
  x.threads.set("t1", { ...x.threads.get("t1")!, archivedAt: 9 });
  const refuse = vi.spyOn(x.leads, "setLead").mockRejectedValue(new Error("Choose a provider and model for the lead before turning on its heartbeat."));
  const warn = vi.fn();
  const t0 = 1_000_000;
  const spawned = () => x.spawn.mock.calls.length;
  const before = spawned();
  expect(await x.bots.restoreMains(warn, t0)).toEqual([]);
  expect(spawned()).toBe(before + 1);
  const made = (await x.spawn.mock.results.at(-1)!.value as { id: string }).id;
  expect(x.del).toHaveBeenLastCalledWith({ threadId: made, childThreadsConfirmed: false });
  expect(x.threads.has(made)).toBe(false);
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("t1");
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]![0]).toContain("Trying again in 5 min.");
  // Within the wait: no try at all.
  await x.bots.restoreMains(warn, t0 + 4 * 60_000);
  expect(spawned()).toBe(before + 1);
  // After it: one more try, the same error said once, and the wait doubles.
  await x.bots.restoreMains(warn, t0 + 5 * 60_000);
  expect(spawned()).toBe(before + 2);
  expect(warn).toHaveBeenCalledTimes(1);
  await x.bots.restoreMains(warn, t0 + 5 * 60_000 + 9 * 60_000);
  expect(spawned()).toBe(before + 2);
  // Once it works, the new Main stays and the back-off is gone.
  refuse.mockRestore();
  const healed = await x.bots.restoreMains(warn, t0 + 15 * 60_000);
  expect(healed).toHaveLength(1);
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe(healed[0]);
});

it("doesn't make a new Main for a stopped or paused Bot; Resume makes it, and its heartbeat comes back there", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const id = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!.id;
  await x.bots.setRun({ botId: id, enabled: true, cadence: "daily", time: "07:30" });
  await x.bots.stop(id);
  x.threads.set("t2", { ...x.threads.get("t2")!, archivedAt: 9 });
  const before = x.spawn.mock.calls.length;
  expect(await x.bots.restoreMain(id, "t2")).toBeNull();
  expect(await x.bots.restoreMains()).toEqual([]);
  expect(await x.bots.rescueMain("t2")).toBeNull();
  expect(x.spawn.mock.calls.length).toBe(before);
  expect(x.bots.stored(id)?.threadId).toBe("t2");
  const view = await x.bots.resume(id);
  const made = x.bots.stored(id)?.threadId;
  expect(made).not.toBe("t2");
  expect(view.bot).toMatchObject({ state: "active", threadId: made });
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ input: [expect.objectContaining({ text: newMainNote("Scout", "archived") })] }));
  expect(await checkins(x)).toEqual([{ key: `bot:${id}`, threadId: made, prompt: botHeartbeat("Scout") }]);
  // Paused the same way.
  await x.bots.pause(id);
  x.threads.set(made!, { ...x.threads.get(made!)!, archivedAt: 9 });
  expect(await x.bots.restoreMain(id, made!)).toBeNull();
  await x.bots.resume(id);
  expect(x.bots.stored(id)?.threadId).not.toBe(made);
});

it("turns back on a check-in a lost Main already turned off, once the Bot has a new Main", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const id = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!.id;
  await x.bots.setRun({ botId: id, enabled: true, cadence: "daily", time: "07:30" });
  const state = () => x.engine.list("heartbeat").find((trigger) => trigger.ownerId === `bot:${id}`)?.state;
  // Before this fix: the run found the Main archived and went off for good.
  x.threads.set("t2", { ...x.threads.get("t2")!, archivedAt: 9 });
  await expect(x.scheduler.runNow({ owner: "heartbeat", ownerId: `bot:${id}` })).rejects.toThrow("deleted or archived");
  expect(state()).toBe("off");
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, revive: (key) => x.scheduler.revive(key) });
  const made = await bots.restoreMain(id, "t2");
  expect(state()).toBe("on");
  expect(await checkins(x)).toEqual([{ key: `bot:${id}`, threadId: made, prompt: botHeartbeat("Scout") }]);
  // One the user turned off stays off.
  await bots.setRun({ botId: id, enabled: false, cadence: "daily", time: "07:30" });
  expect(x.scheduler.revive({ owner: "heartbeat", ownerId: `bot:${id}` })).toBe(false);
});

it("makes a conversation the Main: check-ins move at once, the old Main stays an ordinary conversation, and the records follow", async () => {
  const x = await setup();
  const mainMoved = vi.fn();
  const owners = new Map<string, string>();
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, mainMoved, conversationBot: (threadId) => owners.get(threadId) ?? (threadId.startsWith("conv") ? BOT_ID : null) });
  await bots.create({ name: "Dot", avatar: "🟣" });
  const scout = (await bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  await bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
  x.add({ id: "conv_1", projectId: PERSONAL_PROJECT_ID });
  const view = await bots.makeMain("conv_1");
  expect(view.bot).toMatchObject({ id: BOT_ID, threadId: "conv_1" });
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("conv_1");
  expect(mainMoved).toHaveBeenLastCalledWith(BOT_ID, "conv_1", "t1");
  expect(x.threads.get("t1")?.archivedAt ?? null).toBeNull();
  expect((await checkins(x)).find((each) => each.key === PERSONAL_PROJECT_ID)?.threadId).toBe("conv_1");
  // Already the Main: nothing changes.
  mainMoved.mockClear();
  await bots.makeMain("conv_1", BOT_ID);
  expect(mainMoved).not.toHaveBeenCalled();
  // Refused: archived, gone, or another Bot's Main.
  x.add({ id: "conv_2", projectId: PERSONAL_PROJECT_ID, archivedAt: 3 });
  await expect(bots.makeMain("conv_2")).rejects.toThrow("archived. Unarchive it first");
  await expect(bots.makeMain("conv_gone")).rejects.toThrow("no longer exists");
  // Only Dot's own threads: not Scout's Main or conversation, not a thread no Bot owns, not another project's.
  await expect(bots.makeMain(scout.threadId!, BOT_ID)).rejects.toThrow("isn't one of Dot's conversations");
  owners.set("thr_scouts", scout.id);
  x.add({ id: "thr_scouts", projectId: PERSONAL_PROJECT_ID });
  await expect(bots.makeMain("thr_scouts", BOT_ID)).rejects.toThrow("That conversation is Scout's, not Dot's.");
  x.add({ id: "thr_loose", projectId: PERSONAL_PROJECT_ID });
  await expect(bots.makeMain("thr_loose", BOT_ID)).rejects.toThrow("isn't one of Dot's conversations");
  owners.set("thr_repo", BOT_ID);
  x.add({ id: "thr_repo", projectId: "proj_repo" });
  await expect(bots.makeMain("thr_repo", BOT_ID)).rejects.toThrow("in another project");
  // A worker of Dot's in the personal project may become its Main.
  owners.set("thr_worker", BOT_ID);
  x.add({ id: "thr_worker", projectId: PERSONAL_PROJECT_ID });
  expect((await bots.makeMain("thr_worker", BOT_ID)).bot?.threadId).toBe("thr_worker");
  await bots.makeMain("conv_1", BOT_ID);
  // A thread BB has no model for (it never ran a turn): said plainly, and nothing moves.
  x.add({ id: "conv_3", projectId: PERSONAL_PROJECT_ID, providerId: null as never });
  await expect(bots.makeMain("conv_3")).rejects.toThrow("has no model yet");
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("conv_1");
});

it("on a BB Studio copy, a stopped Bot from before the import is in bb, and Resume runs it here: active and no longer in bb", async () => {
  const x = await setup();
  const made = await x.bots.create({ name: "Scout", avatar: "🛰️" });
  const id = made.bot!.id;
  expect(made.bot).toMatchObject({ state: "active", inBb: false });
  await x.bots.stop(id);
  const copy = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, importedAt: () => Date.now() + 1 });
  expect((await copy.get(id)).bot).toMatchObject({ state: "stopped", inBb: true });
  expect((await copy.resume(id)).bot).toMatchObject({ state: "active", inBb: false });
});

it("starts a new Bot active, never in bb, on a copy whose import ran before it was made", async () => {
  const x = await setup();
  const copy = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, importedAt: () => Date.now() - 60_000 });
  const made = await copy.create({ name: "First", avatar: "🧭" });
  expect(made.bot).toMatchObject({ state: "active", inBb: false });
  await copy.pause(made.bot!.id);
  expect((await copy.get(made.bot!.id)).bot).toMatchObject({ state: "paused", inBb: false });
});

it("keeps a drawn avatar and a role it's told, with the emoji as a fallback", async () => {
  const x = await setup();
  const view = await x.bots.create({ name: "Dot", avatar: "🤖", shape: "blob", color: "#5b8def" });
  expect(view.bot).toMatchObject({ avatar: "🤖", shape: "blob", color: "#5b8def", role: null });
  const set = await x.bots.set({ shape: "hexagon", color: "#e5484d", role: "  You are my chief of staff.  " });
  expect(set.bot).toMatchObject({ shape: "hexagon", color: "#e5484d", role: "You are my chief of staff." });
  expect(x.bots.instructions(set.bot!)).toContain("Your role, in their words: You are my chief of staff.");
  expect((await x.bots.set({ role: "" })).bot?.role).toBeNull();
});

it("reads a Bot row that still has the old sidebar tint: the tint is ignored, the row is left alone, and the Bot keeps working", async () => {
  const x = await setup();
  const view = await x.bots.create({ name: "Dot", avatar: "🤖" });
  const id = view.bot!.id;
  const old = JSON.stringify({ colors: ["#4f7df2", "#ec4899"], mode: "dark", grain: 0.3 });
  x.db.prepare("UPDATE bots SET theme_json = ? WHERE id = ?").run(old, id);
  const listed = x.bots.list().find((bot) => bot.id === id)!;
  expect(listed).not.toHaveProperty("theme");
  expect(listed.name).toBe("Dot");
  expect(listed.appearance).toBeNull();
  expect((await x.bots.get(id)).bot).not.toHaveProperty("theme");
  x.db.prepare("UPDATE bots SET theme_json = ? WHERE id = ?").run("{not json", id);
  expect(x.bots.list().find((bot) => bot.id === id)?.name).toBe("Dot");
  const set = await x.bots.setAppearance({ botId: id, appearance: defaultAppearance(GRID) });
  expect(set.bot?.appearance?.themeId).toBe("grid");
  expect(set.bot).not.toHaveProperty("theme");
  expect((x.db.prepare("SELECT theme_json FROM bots WHERE id = ?").get(id) as { theme_json: string }).theme_json).toBe("{not json");
  expect(x.bots).not.toHaveProperty("setTheme");
});

it("keeps each Bot's own theme and its settings, two Bots on two themes, and takes it off with null", async () => {
  const x = await setup();
  const dot = (await x.bots.create({ name: "Dot", avatar: "🤖" })).bot!;
  const scout = (await x.bots.create({ name: "Scout", avatar: "🦉" })).bot!;
  expect(dot.appearance).toBeNull();
  const grid = { ...defaultAppearance(GRID), intensity: 0.3, effects: { workers: true, finished: false, needsYou: true, error: true } };
  await x.bots.setAppearance({ botId: dot.id, appearance: grid });
  await x.bots.setAppearance({ botId: scout.id, appearance: defaultAppearance(NORD) });
  const listed = new Map(x.bots.list().map((bot) => [bot.id, bot.appearance]));
  expect(listed.get(dot.id)).toEqual(grid);
  expect(listed.get(scout.id)?.themeId).toBe("nord");
  expect((await x.bots.setAppearance({ botId: dot.id, appearance: null })).bot?.appearance).toBeNull();
  expect(x.bots.list().find((bot) => bot.id === scout.id)?.appearance?.themeId).toBe("nord");
  await expect(x.bots.setAppearance({ botId: "nope", appearance: grid })).rejects.toThrow();
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
  // With titles read by id, since chain threads are hidden: title, then titleFallback, then "Untitled".
  x.threads.set("bot1", { ...x.threads.get("bot1")!, title: null, titleFallback: "Relay", visibility: "hidden" });
  x.threads.set(threadId, { ...x.threads.get(threadId)!, title: "  ", titleFallback: null });
  expect(await x.bots.chainThreads()).toEqual([{ id: "bot1", title: "Relay" }, { id: threadId, title: "Untitled" }]);
  x.threads.set(threadId, { ...x.threads.get(threadId)!, title: "Today" });
  expect((await x.bots.chainThreads()).map((t) => t.title)).toEqual(["Relay", "Today"]);
});

it("keeps hidden runner threads under the Bot: out of BB's list and Activity's thread lists; its chat isn't the runners' to hide", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  x.add({ id: "run_t", visibility: "hidden", title: "Inbox · Runner", status: "idle" });
  x.add({ id: "run_quiet", visibility: "hidden", title: "Feeds · Runner", status: "idle" });
  x.add({ id: "w1", parentThreadId: "bot1", status: "idle" });
  const runnerThreads = new Set(["run_t", "run_quiet"]);
  (x.bots as unknown as { deps: { runners: unknown } }).deps.runners = { threads: () => runnerThreads, pauseAll: async () => [], restore: async () => true };
  const activity = await x.bots.activity();
  expect(activity.attention).toBeNull();
  expect([...activity.inProgress, ...activity.waiting, ...activity.completed].map((t) => t.id)).toEqual(["w1"]);
  expect(x.threads.get("bot1")?.visibility).toBe("visible");
  expect(x.update).not.toHaveBeenCalled();
});

it("hides the Bot's chain from BB's list as it gets a thread: made, set or handed off", async () => {
  const x = await setup();
  const claimed: string[][] = [];
  (x.bots as unknown as { deps: { claimChains(): Promise<unknown> } }).deps.claimChains = async () => { claimed.push(x.bots.list().flatMap((bot) => x.bots.chain(bot.id))); };
  await x.bots.create({ name: "Bot", avatar: "🤖" });
  expect(claimed.at(-1)).toEqual(["t1"]);
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  expect(claimed.at(-1)).toEqual(["t1", scout.threadId]);
  x.add({ id: "mine" });
  await x.bots.setThread("mine");
  expect(claimed.at(-1)).toContain("mine");
  const moved = await x.bots.switchModel(scout.threadId!, { providerId: "claude", model: "sonnet" });
  // Claimed once the Bot has moved to its new thread.
  expect(claimed.at(-1)).toEqual(expect.arrayContaining([scout.threadId, moved.threadId]));
  const count = claimed.length;
  // A handoff of a thread that is no Bot's claims nothing.
  x.add({ id: "plain", providerId: "codex" });
  await x.bots.switchModel("plain", { providerId: "claude", model: "opus" });
  expect(claimed.length).toBe(count);
  // A failure never fails the Bot: the sweep retries.
  (x.bots as unknown as { deps: { claimChains(): Promise<unknown> } }).deps.claimChains = async () => { throw new Error("busy"); };
  await expect(x.bots.create({ name: "Third", avatar: "3️⃣" })).resolves.toBeTruthy();
});

it("the Bot's attention: a question in its hidden chat, until it's answered", async () => {
  const x = await setup();
  x.add({ id: "bot1", visibility: "hidden", status: "idle" });
  await x.bots.setThread("bot1");
  x.pending.set("bot1", [{ id: "q1", status: "pending", payload: { kind: "user_question" } } as never]);
  // Past BB's recent list: Studio fetches it, and its interactions say it waits on you.
  x.list.mockImplementation(async () => []);
  expect((await x.bots.activity()).attention).toMatchObject({ reason: "Asked you a question", count: 1 });
  expect(await x.bots.botAttention()).toMatchObject({ reason: "Asked you a question", count: 1 });
  expect(await x.bots.attentionView()).toMatchObject({ attention: { reason: "Asked you a question" }, hasBot: true });
  x.pending.set("bot1", [{ id: "q1", status: "resolved" } as never]);
  expect((await x.bots.activity()).attention).toBeNull();
});

it("bot_attention says when there's no Bot, so widgets fall back to BB's own count", async () => {
  const x = await setup();
  expect(await x.bots.attentionView()).toEqual({ attention: null, hasBot: false, working: false });
  expect(await x.bots.attentionView("bot_gone")).toEqual({ attention: null, hasBot: false, working: false });
  x.add({ id: "bot1", status: "idle" });
  await x.bots.setThread("bot1");
  expect(await x.bots.attentionView()).toEqual({ attention: null, hasBot: true, working: false });
});

it("bot_attention says when the Bot's hidden chat is busy, which BB's sidebar view leaves out", async () => {
  const x = await setup();
  x.add({ id: "bot1", visibility: "hidden", status: "active" });
  await x.bots.setThread("bot1");
  expect(await x.bots.attentionView()).toMatchObject({ hasBot: true, working: true });
  x.add({ id: "bot1", visibility: "hidden", status: "starting" });
  expect((await x.bots.attentionView()).working).toBe(true);
  x.add({ id: "bot1", visibility: "hidden", status: "idle" });
  expect((await x.bots.attentionView()).working).toBe(false);
  x.add({ id: "bot1", visibility: "hidden", status: "error" });
  expect((await x.bots.attentionView()).working).toBe(false);
});

it("the Bot's attention: its replies the user hasn't read, not [PASS], until the chat is read", async () => {
  const x = await setup();
  x.add({ id: "bot1", status: "idle", lastReadAt: 100 });
  await x.bots.setThread("bot1");
  x.replies.set("bot1", [{ at: 90, text: "Morning: nothing new." }, { at: 150, text: "[PASS]" }, { at: 200, text: "Deploy watch: staging is down since build 419. Roll back?" }]);
  expect((await x.bots.activity()).attention).toEqual({ reason: "1", count: 1, since: 200, unread: 1 });
  x.replies.set("bot1", [...x.replies.get("bot1")!, { at: 300, text: "Also: the lease payment failed." }]);
  expect((await x.bots.activity()).attention).toMatchObject({ reason: "2", count: 2 });
  // An approval in its chat comes first.
  x.pending.set("bot1", [{ id: "p1", status: "pending", payload: { kind: "approval" } } as never]);
  expect((await x.bots.activity()).attention).toMatchObject({ reason: "Waiting for approval", count: 3 });
  x.pending.set("bot1", []);
  x.threads.set("bot1", { ...x.threads.get("bot1")!, lastReadAt: 300 });
  expect((await x.bots.activity()).attention).toBeNull();
});

it("a thread the Bot started that waits on an approval runs under Running, saying so; it's the Bot's, not the user's", async () => {
  const x = await setup();
  x.add({ id: "bot1", status: "idle" });
  await x.bots.setThread("bot1");
  x.add({ id: "deploy", parentThreadId: "bot1", status: "active", hasPendingInteraction: true } as never);
  x.pending.set("deploy", [{ id: "p1", status: "pending", payload: { kind: "approval" } } as never]);
  const activity = await x.bots.activity();
  expect(activity.inProgress).toEqual([expect.objectContaining({ id: "deploy", waitingFor: "Waiting for approval" })]);
  expect(activity.attention).toBeNull();
});

it("lists the threads a Bot owns in Activity though they're hidden from BB's list, but not hidden forks", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  x.add({ id: "child", parentThreadId: "bot1", visibility: "hidden", status: "active" });
  x.add({ id: "grandchild", parentThreadId: "child", visibility: "hidden", status: "idle" });
  // An automation the child made: its run is top-level; src/bot-owned.ts knows it's the Bot's.
  x.add({ id: "run", originPluginId: "automations", visibility: "hidden", status: "idle" });
  x.add({ id: "run_sub", parentThreadId: "run", visibility: "hidden", status: "idle" });
  x.add({ id: "side_chat", sourceThreadId: "bot1", originKind: "fork", visibility: "hidden", status: "idle" });
  x.add({ id: "user_fork", sourceThreadId: "bot1", originKind: "fork", status: "idle" });
  // BB's side-chat makes the chat its fork's lifecycle owner: still the user's side chat, not the Bot's work.
  x.add({ id: "bb_side_chat", sourceThreadId: "bot1", lifecycleOwnerThreadId: "bot1", originKind: "fork", originPluginId: "side-chat", visibility: "hidden", status: "active" });
  (x.bots as unknown as { deps: { ownedThreads(botId: string): ReadonlySet<string> } }).deps.ownedThreads = () => new Set(["run"]);
  const activity = await x.bots.activity();
  expect(activity.inProgress.map((t) => t.id)).toEqual(["child"]);
  expect(activity.completed.map((t) => t.id).sort()).toEqual(["grandchild", "run", "run_sub", "user_fork"]);
  expect(activity.completed.find((t) => t.id === "run_sub")?.parentId).toBe("run");
  // Stop reaches the hidden work it spawned.
  expect((await x.bots.stop()).stoppedThreadIds).toEqual(["child"]);
});

it("keeps the Bot's side threads out of Activity, Studio's own forks included", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  // With side-chat off, Studio forks the chat itself: the chat owns the fork, so only the side threads table says it's one.
  x.add({ id: "studio_side", sourceThreadId: "bot1", lifecycleOwnerThreadId: "bot1", originKind: "fork", originPluginId: "studio", visibility: "hidden", status: "active" });
  x.add({ id: "child", parentThreadId: "bot1", visibility: "hidden", status: "active" });
  const deps = (x.bots as unknown as { deps: { hiddenThreads(): ReadonlySet<string> } }).deps;
  expect((await x.bots.activity()).inProgress.map((t) => t.id).sort()).toEqual(["child", "studio_side"]);
  deps.hiddenThreads = () => new Set(["studio_side"]);
  expect((await x.bots.activity()).inProgress.map((t) => t.id)).toEqual(["child"]);
});

it("applies check-in presets: one schedule and one line in the always-on skill's Check-in each; Off turns check-ins off", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const checkin = () => sectionText(x.bots.skill("core-profile")!.body, "Check-in")!.split("\n").filter((line) => !DEFAULT_CHECKIN.includes(line)).map((line) => line.replace(/^- /, ""));
  let lines: string[] = [];
  const morning = await x.bots.checkinPreset("morning");
  expect(morning.run).toMatchObject({ enabled: true, cadence: "weekdays", time: "08:00" });
  const working = await x.bots.checkinPreset("working");
  expect(working.run).toMatchObject({ enabled: true, cadence: "custom", cron: "0 9-17/2 * * 1-5" });
  lines = checkin();
  expect(lines).toEqual([CHECKIN_PRESETS.morning.line, CHECKIN_PRESETS.working.line]);
  // Once each: the same preset again adds nothing.
  await x.bots.checkinPreset("morning");
  expect((await x.bots.checkinPreset("off")).run?.enabled).toBe(false);
  expect(checkin()).toHaveLength(2);
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
    threads: () => new Set<string>(),
    pauseAll: async (_botId?: string, onPaused?: (id: string) => void) => {
      const paused = [...runnerStates].filter(([, state]) => state === "active").map(([id]) => id);
      for (const id of paused) { runnerStates.set(id, "paused"); onPaused?.(id); }
      return paused;
    },
    restore,
  };
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, runners });
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
  // The check-in comes from Studio's scheduler, with its next run; the user's own BB automation from BB's list.
  const next = x.engine.get("heartbeat", PERSONAL_PROJECT_ID)!.nextAt;
  expect(scheduled).toEqual([
    { id: `trg_heartbeat_${PERSONAL_PROJECT_ID}`, kind: "heartbeat", name: "Check-in (heartbeat)", cron: "0 7 * * *", enabled: true, nextRunAt: next },
    { id: "other", kind: "automation", name: "Inbox sweep", cron: "0 9 * * *", enabled: true, nextRunAt: 50 },
  ]);
  // The Bot's check-ins and reminders (src/automations.ts) are listed from Studio's scheduler too, and the list holds with the automations plugin off.
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, automations: { pauseAll: async () => [], restore: async () => true, follow: async () => {}, scheduled: () => [{ id: "trg_automation_aut_1", name: "Dot · Brief", cron: null, enabled: true, nextRunAt: 20 }] } });
  x.callRpc.mockRejectedValue(new Error("Plugin automations is disabled"));
  expect((await bots.activity()).scheduled.map((each) => [each.kind, each.id, each.nextRunAt])).toEqual([["heartbeat", `trg_heartbeat_${PERSONAL_PROJECT_ID}`, next], ["automation", "trg_automation_aut_1", 20]]);
});

it("classifies activity: running (a thread held by a question is the Bot's, so it's running), then completed threads it started", () => {
  const t = (id: string, { hasPendingInteraction = false, ...fields }: Partial<Thread> & { hasPendingInteraction?: boolean }) => ({ ...makeThreadResponse({ id, projectId: "p", providerId: "codex", ...fields }), hasPendingInteraction });
  const result = classifyActivity([
    t("bot", { status: "active", updatedAt: 9 }),
    t("ask", { status: "active", hasPendingInteraction: true, updatedAt: 1 }),
    t("run", { status: "starting", updatedAt: 2 }),
    t("old", { status: "idle", updatedAt: 3 }),
    t("err", { status: "error", updatedAt: 4 }),
    t("gone", { status: "idle", archivedAt: 1 }),
  ], "bot");
  expect(result).not.toHaveProperty("needsYou");
  expect(result.inProgress.map((each) => [each.id, each.relation, each.waitingFor ?? null])).toEqual([["bot", "self", null], ["run", "started", null], ["ask", "started", "Waiting for an answer"]]);
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

it("gives a new Bot an always-on core skill, not a page, and lists only on-demand skills in its instructions", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  const bot = x.bots.forThread("bot1")!;
  x.bots.writeSkill({ name: "weekly-review", description: "Run the weekly review", body: "Steps." });
  const text = x.bots.instructions(bot);
  expect(x.pages.size).toBe(0);
  expect(x.bots.memoryPage()).toBeNull();
  const core = x.bots.alwaysOnSkills();
  expect(core).toEqual([expect.objectContaining({ name: "core-profile", body: CORE_TEMPLATE })]);
  expect(x.bots.skill("core-profile")).toMatchObject({ alwaysOn: true, pinned: true });
  // Always-on skills come in full from src/memory, so the on-demand list leaves them out.
  expect(text).toContain("- weekly-review: Run the weekly review");
  expect(text).not.toContain("core-profile");
  expect(text.length).toBeLessThan(800);
  expect(botHeartbeat("Dot")).toMatch(/"## Check-in" section of your always-on skill/);
  expect(botHeartbeat("Dot")).toMatch(/reply exactly \[PASS\]: no "✓"/);
  expect(botInstructions({ name: "Dot", state: "active" })).toMatch(/finished fine.*no "✓"/);
  expect(botInstructions({ name: "Dot", state: "active" })).toMatch(/You triage: reports, alerts and your threads. questions come to you/);
});

it("moves a Bot's core profile page into its always-on skill once, whole, even over the budget", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const long = `## Who the user is\n\n${"- A rule that matters.\n".repeat(200)}\n## Check-in\n\n- Look at the inbox.`;
  x.pages.set("pg_profile", { title: "Dot's core profile", markdown: long });
  x.db.prepare("INSERT INTO memory_profiles (bot_id, profile_page_id, legacy_page_id, split_at, created_at) VALUES (?, 'pg_profile', NULL, NULL, 1)").run(BOT_ID);
  const moved = x.bots.ensureCore();
  expect(moved).toMatchObject({ state: "moved", skill: "core-profile", sourcePageId: "pg_profile", chars: long.trim().length });
  const skill = x.bots.skill("core-profile")!;
  // Not cut: the whole text, flagged over budget.
  expect(skill.body.trim()).toBe(long.trim());
  expect(x.bots.skillBudget()).toMatchObject({ over: true, cap: 2000 });
  // Moved text is the user's: Maintenance leaves it until the user edits it in Studio.
  expect(x.bots.coreSkill()).toMatchObject({ name: "core-profile", migrated: true });
  x.bots.userEditedSkill("weekly-review");
  expect(x.bots.coreSkill()).toMatchObject({ migrated: true });
  x.bots.userEditedSkill("core-profile");
  expect(x.bots.coreSkill()).toMatchObject({ migrated: false });
  expect(x.bots.skillLint({ name: "core-profile", body: skill.body })).toEqual(expect.arrayContaining([expect.stringContaining("over the 2,000 budget")]));
  // Once: a second run, or an edit to the page afterwards, changes nothing.
  x.pages.set("pg_profile", { title: "Dot's core profile", markdown: "## Check-in\n\n- Something else." });
  expect(x.bots.ensureCore()).toEqual({ state: "done" });
  expect(x.bots.skill("core-profile")!.body.trim()).toBe(long.trim());
  expect(x.pages.get("pg_profile")).toBeDefined();
  // A name the user already took for an on-demand skill stays theirs.
  const other = await x.bots.create({ name: "Scout", avatar: "🛰️" });
  x.bots.writeSkill({ name: "core-profile", description: "Mine", body: "Not a profile." }, other.bot!.id);
  expect(x.bots.ensureCore(other.bot!.id)).toMatchObject({ state: "created", skill: "core-profile-moved" });
  expect(x.bots.skill("core-profile", other.bot!.id)).toMatchObject({ alwaysOn: false, description: "Mine" });
});

it("writes a skill as a compare-and-swap with ifBody: only over the text the client read, never over a newer edit", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  // null: only while there's no such skill (a new skill never replaces one the Bot just made).
  x.bots.writeSkill({ name: "inbox", description: "Sort mail", body: "v1", ifBody: null });
  expect(() => x.bots.writeSkill({ name: "inbox", description: "Sort mail", body: "mine", ifBody: null })).toThrow(SKILL_CHANGED);
  // The Bot edits after the client read "v1": the client's write is refused and changes nothing.
  x.bots.writeSkill({ name: "inbox", description: "Sort mail", body: "v2 by the Bot" });
  expect(() => x.bots.writeSkill({ name: "inbox", description: "Sort mail", body: "mine", ifBody: "v1" })).toThrow(SKILL_CHANGED);
  expect(x.bots.skillHistory(undefined, undefined, "inbox")[0]?.body).toBe("v2 by the Bot");
  // Over the text it read, it writes; without ifBody it writes as before.
  x.bots.writeSkill({ name: "inbox", description: "Sort mail", body: "mine", ifBody: "v2 by the Bot" });
  expect(x.bots.skillHistory(undefined, undefined, "inbox")[0]?.body).toBe("mine");
});

it("keeps skills to the Bot until shared into BB's user skills, and deletes them", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  expect(() => x.bots.writeSkill({ name: "Bad Name", description: "d", body: "b" })).toThrow(/lowercase/);
  x.bots.writeSkill({ name: "weekly-review", description: "Fridays: sum up the week", body: "1. Read threads" });
  x.bots.writeSkill({ name: "inbox", description: "Sort mail", body: "Steps" });
  expect(x.bots.skills().map((skill) => skill.name)).toEqual(["inbox", "weekly-review"]);
  expect(x.bots.instructions(x.bots.forThread("bot1")!)).toContain("- inbox: Sort mail\n- weekly-review: Fridays: sum up the week");
  // Archived skills are hidden from the Bot until restored; loading a stale one makes it active; pins stick.
  expect(x.bots.setSkillState("inbox", "archived")).toBe(true);
  expect(x.bots.instructions(x.bots.forThread("bot1")!)).not.toContain("inbox: Sort");
  x.bots.setSkillState("inbox", "active");
  expect(x.bots.skill("inbox")).toMatchObject({ state: "active", pinned: false, usedAt: expect.any(Number) });
  x.bots.setSkillState("weekly-review", "stale");
  x.bots.touchSkill("weekly-review");
  expect(x.bots.skill("weekly-review")?.state).toBe("active");
  expect(x.bots.pinSkill("weekly-review", true)).toBe(true);
  expect(x.bots.skills().find((skill) => skill.name === "weekly-review")?.pinned).toBe(true);
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
  vi.spyOn(x.scheduler, "ensure").mockImplementationOnce(() => { throw new Error("down"); });
  await expect(x.bots.resume()).rejects.toThrow("down");
  expect((await x.bots.get()).bot?.state).toBe("paused");
  expect(await x.bots.resume()).toMatchObject({ bot: { state: "active" }, run: { enabled: true } });
  expect(x.engine.get("heartbeat", PERSONAL_PROJECT_ID)?.state).toBe("on");
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
  // Check-ins still work: a schedule that messages its thread.
  await x.bots.setRun({ botId: made.bot!.id, enabled: true, cadence: "daily", time: "09:00" });
  const checkin = (await checkins(x)).at(-1)!;
  expect(checkin.threadId).toBe(made.bot!.threadId);
  expect(checkin.prompt).not.toContain("Memory page");
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
  expect((await checkins(x)).at(-1)).toMatchObject({ threadId: moved.threadId });
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

it("Pause and Stop turn the Bot's own automations off; Resume turns back on only those", async () => {
  const x = await setup();
  const states = new Map([["aut_on", "active"], ["aut_off", "paused"]]);
  const automations = {
    pauseAll: async (_botId: string, onPaused?: (id: string) => void) => {
      const paused = [...states].filter(([, state]) => state === "active").map(([id]) => id);
      for (const id of paused) { states.set(id, "paused"); onPaused?.(id); }
      return paused;
    },
    restore: vi.fn(async (id: string) => { states.set(id, "active"); return true; }),
    follow: vi.fn(async () => {}),
  };
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, automations });
  x.add({ id: "bot1" });
  await bots.setThread("bot1");
  await bots.pause();
  expect(states.get("aut_on")).toBe("paused");
  await bots.stop();
  await bots.resume();
  expect(automations.restore.mock.calls.map(([id]) => id)).toEqual(["aut_on"]);
  expect([...states.values()]).toEqual(["active", "paused"]);
});


it("applies skill saves immediately, preserves diffs and warnings, and reverts without losing history", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  x.bots.writeSkill({ name: "deploy", description: "Before deploying", body: "old step" });
  const first = x.bots.skillHistory()[0]!;
  x.bots.writeSkill({ name: "deploy", description: "Before deploying", body: "Yesterday we tried PR #482" });
  expect(x.bots.skill("deploy")?.body).toBe("Yesterday we tried PR #482");
  const second = x.bots.skillHistory()[0]!;
  expect(second.diff).toBe("- old step\n+ Yesterday we tried PR #482");
  expect(second.warnings[0]).toMatch(/log of one session/);
  x.bots.lintSkillVersion(second.id, ["Check the deployment target."]);
  expect(x.bots.skillHistory()[0]!.warnings).toContain("Check the deployment target.");
  expect(x.bots.skill("deploy")?.body).toBe(second.body);
  x.bots.revertSkill(first.id);
  expect(x.bots.skill("deploy")?.body).toBe("old step");
  expect(x.bots.skillHistory()).toHaveLength(3);
  x.bots.deleteSkill("deploy");
  expect(x.bots.skillHistory()[0]!.body).toBeNull();
  x.bots.revertSkill(second.id);
  expect(x.bots.skill("deploy")?.body).toBe(second.body);
  expect(() => x.bots.revertSkill(first.id, "other-bot")).toThrow();
  expect(() => x.db.prepare("UPDATE bot_skill_versions SET body = 'changed'").run()).toThrow(/append-only/);
  expect(() => x.db.prepare("DELETE FROM bot_skill_versions").run()).toThrow(/append-only/);
  expect(() => x.db.prepare("DELETE FROM bot_skill_lints").run()).toThrow(/append-only/);
});

it("migrates pending writes and deletes as approved once, preserving prior and applied versions", async () => {
  const skillHistoryMigration = MIGRATIONS.findIndex((sql) => sql.includes("CREATE TABLE bot_skill_versions"));
  expect(skillHistoryMigration).toBeGreaterThan(0);
  const x = await setup(MIGRATIONS.slice(0, skillHistoryMigration));
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  const insert = x.db.prepare("INSERT INTO bot_skills(bot_id, name, description, body, created_at, updated_at) VALUES ('bot_main', ?, 'd', ?, 1, 1)");
  insert.run("deploy", "old"); insert.run("retired", "keep in history");
  const pending = x.db.prepare("INSERT INTO bot_skill_pending(id, bot_id, name, action, description, body, created_at) VALUES (?, 'bot_main', ?, ?, 'new description', ?, 2)");
  pending.run("p1", "deploy", "write", "new"); pending.run("p2", "retired", "delete", null); pending.run("p3", "inbox", "write", "sort mail");
  x.db.prepare("INSERT INTO bot_learning(bot_id, approval) VALUES ('bot_main', 1)").run();
  x.bb.storage.migrate(x.db, MIGRATIONS);
  expect(x.bots.skill("deploy")).toMatchObject({ body: "new", description: "new description" });
  expect(x.bots.skill("inbox")?.body).toBe("sort mail");
  expect(x.bots.skill("retired")).toBeNull();
  expect(x.bots.skillHistory().find((v) => v.name === "deploy")?.diff).toBe("- old\n+ new");
  expect(x.bots.skillHistory().filter((v) => v.name === "retired").map((v) => v.body)).toEqual([null, "keep in history"]);
  expect(x.db.prepare("SELECT name FROM sqlite_master WHERE name = 'bot_skill_pending'").get()).toBeUndefined();
  expect(x.db.prepare("SELECT approval FROM bot_learning").get()).toEqual({ approval: 0 });
  x.bb.storage.migrate(x.db, MIGRATIONS);
  expect(x.bots.skillHistory()).toHaveLength(5);
});

it("pages skill history without preventing reverts or lint on older versions", async () => {
  const x = await setup();
  x.add({ id: "bot1" }); await x.bots.setThread("bot1");
  x.bots.writeSkill({ name: "deploy", description: "d", body: "first" });
  const first = x.bots.skillHistory()[0]!;
  for (let i = 0; i < 50; i++) x.bots.writeSkill({ name: "deploy", description: "d", body: `step ${i}` });
  const recent = x.bots.skillHistory();
  expect(recent).toHaveLength(50);
  expect(x.bots.skillHistory(undefined, recent[49]!.id).map((v) => v.id)).toEqual([first.id]);
  x.bots.lintSkillVersion(first.id, ["Historical warning"]);
  expect(x.bots.skillHistory(undefined, recent[49]!.id)[0]!.warnings).toEqual(["Historical warning"]);
  x.bots.revertSkill(first.id);
  expect(x.bots.skill("deploy")?.body).toBe("first");
});

it("remembers an enabled heartbeat across a failed Pause and retry", async () => {
  const x = await setup();
  const pauseAll = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, automations: { pauseAll, restore: async () => true, follow: async () => {} } });
  x.add({ id: "retry_bot" });
  await bots.setThread("retry_bot");
  await bots.setRun({ enabled: true, cadence: "daily", time: "09:00" });
  await expect(bots.pause()).rejects.toThrow("offline");
  expect(x.leads.runs.get(PERSONAL_PROJECT_ID)?.enabled).toBe(false);
  expect(bots.stored()?.state).toBe("active");
  await bots.pause();
  await bots.resume();
  expect(x.leads.runs.get(PERSONAL_PROJECT_ID)?.enabled).toBe(true);
});

it("a Bot's default model starts as its Main's, once; setting it switches no thread, and a thread's model is its own", async () => {
  const x = await setup();
  await x.bots.create({ name: "Bot", avatar: "🤖" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  // Filled from Main's model the first time the Bot is read.
  expect(scout.defaultModel).toMatchObject({ providerId: "codex", model: "model", reasoningLevel: "high" });
  // Main moves on (BB's composer): the default stays what it was.
  await x.bots.switchModel(scout.threadId!, { providerId: "codex", model: "faster", reasoning: "low" });
  expect((await x.bots.get(scout.id)).bot).toMatchObject({ model: "faster", defaultModel: { model: "model" } });
  x.update.mockClear();
  // The user sets the default: no thread changes, Main included.
  const set = await x.bots.setDefaultModel({ botId: scout.id, providerId: "claude", model: "sonnet", reasoning: "medium" });
  expect(set.bot).toMatchObject({ model: "faster", defaultModel: { providerId: "claude", model: "sonnet", reasoningLevel: "medium" } });
  expect(x.bots.defaultModel(scout.id)).toEqual({ providerId: "claude", model: "sonnet", reasoning: "medium" });
  expect(x.update).not.toHaveBeenCalled();
  expect(await x.bots.threadModel(scout.threadId!)).toMatchObject({ providerId: "codex", model: "faster", reasoningLevel: "low" });
  // A conversation on another model reads as its own.
  x.add({ id: "conv", providerId: "claude" });
  await x.bots.switchModel("conv", { providerId: "claude", model: "haiku", reasoning: "low" });
  expect(await x.bots.threadModel("conv")).toMatchObject({ providerId: "claude", model: "haiku", modelName: expect.any(String) });
  await expect(x.bots.setDefaultModel({ botId: scout.id, providerId: "grok", model: "grok-4" })).rejects.toThrow(/Studio's tools/);
  await expect(x.bots.setDefaultModel({ botId: scout.id, providerId: "nope", model: "m" })).rejects.toThrow(/isn't an agent provider/);
});

it("searches only the calling Bot's skills, ranked by title, then description, then body", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!.id;
  x.bots.writeSkill({ name: "deploy-check", description: "Before a release: verify the build", body: "Run the smoke tests." });
  x.bots.writeSkill({ name: "weekly-review", description: "Fridays: a deploy summary for the week", body: "Read the threads." });
  x.bots.writeSkill({ name: "inbox-sweep", description: "Sort mail", body: "Archive newsletters. Flag anything about a deploy window." });
  x.bots.writeSkill({ name: "old-deploy", description: "Retired deploy steps", body: "deploy deploy deploy" });
  x.bots.setSkillState("old-deploy", "archived");
  x.bots.writeSkill({ name: "deploy-watch", description: "Watch release deploys", body: "Scout's own." }, scout);

  expect(x.bots.searchSkills("deploy").map((hit) => hit.name)).toEqual(["deploy-check", "weekly-review", "inbox-sweep"]);
  expect(x.bots.searchSkills("deploy")[2]).toMatchObject({ fields: ["body"], snippet: expect.stringContaining("deploy window") });
  expect(x.bots.searchSkills("smoke tests").map((hit) => hit.name)).toEqual(["deploy-check"]);
  expect(x.bots.searchSkills("newsletter").map((hit) => hit.name)).toEqual(["inbox-sweep"]);
  expect(x.bots.searchSkills("kubernetes")).toEqual([]);
  expect(x.bots.searchSkills("deploy", 1)).toHaveLength(1);
  expect(x.bots.searchSkills("deploy", 10, scout).map((hit) => hit.name)).toEqual(["deploy-watch"]);
  expect(x.bots.searchSkills("smoke", 10, scout)).toEqual([]);
  expect(x.bots.searchSkills("own").map((hit) => hit.name)).toEqual([]);
});

it("lists eight skills in the Bot's instructions, pinned and recent first, and points at bot_skill (op: list) for the rest", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  for (let n = 0; n < 10; n += 1) x.bots.writeSkill({ name: `task-${n}`, description: `Task ${n}`, body: "b" });
  x.bots.pinSkill("task-0", true);
  const text = x.bots.instructions(x.bots.forThread("bot1")!);
  expect(text).toContain("bot_skill (op: list)");
  expect(text).toContain("- task-0: Task 0");
  expect(text.match(/^- task-/gm)).toHaveLength(8);
  expect(text).toContain("2 more: bot_skill (op: list).");
});

it("keeps one skill's history apart, reverts to an old version and restores a deleted skill", async () => {
  const x = await setup();
  x.add({ id: "bot1" });
  await x.bots.setThread("bot1");
  x.bots.writeSkill({ name: "deploy-check", description: "d", body: "v1" });
  x.bots.writeSkill({ name: "deploy-check", description: "d", body: "v2" });
  x.bots.writeSkill({ name: "inbox", description: "Sort mail", body: "Steps" });
  const history = x.bots.skillHistory(undefined, undefined, "deploy-check");
  expect(history.map((version) => version.body)).toEqual(["v2", "v1"]);
  expect(history[0]!.diff).toBe("- v1\n+ v2");
  x.bots.revertSkill(history[1]!.id);
  expect(x.bots.skill("deploy-check")?.body).toBe("v1");
  expect(x.bots.deleteSkill("inbox")).toBe(true);
  const deleted = x.bots.skillHistory(undefined, undefined, "inbox")[0]!;
  expect(deleted.body).toBeNull();
  x.bots.revertSkill(x.bots.skillHistory(undefined, undefined, "inbox")[1]!.id);
  expect(x.bots.skill("inbox")?.body).toBe("Steps");
  expect(x.bots.skillHistory().length).toBeGreaterThan(x.bots.skillHistory(undefined, undefined, "inbox").length);
});

it("leaves the harnesses' own skill folders alone while a Bot writes, searches, reverts and deletes its skills", async () => {
  const { mkdir, writeFile, readdir, stat } = await import("node:fs/promises");
  const home = await mkdtemp(join(tmpdir(), "harness-home-"));
  const folders = [join(home, ".claude", "skills", "native-one"), join(home, ".agents", "skills", "native-two")];
  for (const folder of folders) { await mkdir(folder, { recursive: true }); await writeFile(join(folder, "SKILL.md"), "---\nname: native\ndescription: d\n---\nbody\n"); }
  const snapshot = async () => Promise.all(folders.map(async (folder) => ({ files: await readdir(folder), mtime: (await stat(join(folder, "SKILL.md"))).mtimeMs, text: await readFile(join(folder, "SKILL.md"), "utf8") })));
  const before = await snapshot();
  vi.stubEnv("HOME", home);
  try {
    const x = await setup();
    x.add({ id: "bot1" });
    await x.bots.setThread("bot1");
    x.bots.writeSkill({ name: "native-one", description: "Same name as a harness skill", body: "v1" });
    x.bots.writeSkill({ name: "native-one", description: "Same name as a harness skill", body: "v2" });
    expect(x.bots.searchSkills("harness").map((hit) => hit.name)).toEqual(["native-one"]);
    x.bots.revertSkill(x.bots.skillHistory(undefined, undefined, "native-one")[1]!.id);
    x.bots.deleteSkill("native-one");
    expect(await snapshot()).toEqual(before);
    expect(await readdir(join(home, ".claude", "skills"))).toEqual(["native-one"]);
    expect(await readdir(join(home, ".agents", "skills"))).toEqual(["native-two"]);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("starts a new Bot on a signed-in model: the primary's default model, else the primary's provider, else any signed-in one, else BB's default", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  x.db.prepare("UPDATE bots SET provider_id = 'codex', default_provider_id = 'claude-code', default_model = 'opus', default_reasoning = 'medium' WHERE id = ?").run(BOT_ID);
  let states: { providerId: string; status: string; loginCommand?: string | null }[] = [{ providerId: "claude-code", status: "ready", loginCommand: "claude login" }, { providerId: "codex", status: "unauthenticated", loginCommand: "codex login" }];
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, providerStates: async () => states });
  const spawned = () => x.spawn.mock.calls.at(-1)![0] as Record<string, unknown>;
  await bots.create({ name: "Scout", avatar: "🛰️" });
  expect(spawned()).toMatchObject({ providerId: "claude-code", model: "opus", reasoningLevel: "medium", executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit" } });
  states = [{ providerId: "claude-code", status: "unauthenticated", loginCommand: "claude login" }, { providerId: "codex", status: "ready", loginCommand: "codex login" }];
  await bots.create({ name: "Ledger", avatar: "📒" });
  expect(spawned()).toMatchObject({ providerId: "codex", executionInputSources: { providerId: "explicit" } });
  expect(spawned()).not.toHaveProperty("model");
  x.db.prepare("UPDATE bots SET provider_id = 'opencode', default_provider_id = NULL, default_model = NULL WHERE id = ?").run(BOT_ID);
  states = [{ providerId: "opencode", status: "unauthenticated", loginCommand: null }, { providerId: "codex", status: "unauthenticated", loginCommand: "codex login" }, { providerId: "claude-code", status: "ready", loginCommand: "claude login" }];
  await bots.create({ name: "Atlas", avatar: "🗺️" });
  expect(spawned()).toMatchObject({ providerId: "claude-code" });
  states = [{ providerId: "codex", status: "unauthenticated", loginCommand: "codex login" }];
  await bots.create({ name: "Echo", avatar: "🔔" });
  expect(spawned()).not.toHaveProperty("providerId");
});

// ---------------------------------------------------------------------------
// Failure modes: nothing the Bot infers (its Main, a thread's model, a
// provider) may break it. Each case is a row of the failure-mode table.

it("FM: a read after the Main is deleted keeps the check-in on, and the new Main gets it", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  await x.bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
  x.threads.delete("t1");
  // The sidebar reads the Bot before Studio hears of the delete.
  await x.bots.get();
  const made = await x.bots.restoreMain(BOT_ID, "t1");
  expect(made).toBeTruthy();
  expect((await x.bots.get()).run?.enabled).toBe(true);
  expect(await checkins(x)).toEqual([{ key: PERSONAL_PROJECT_ID, threadId: made, prompt: botHeartbeat("Dot") }]);
});

it("FM: the heal finds a primary Main that a read already forgot (deleted while Studio was off)", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  await x.bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
  x.threads.delete("t1");
  await x.bots.get();
  const made = await x.bots.restoreMains();
  expect(made).toHaveLength(1);
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe(made[0]);
  expect(await checkins(x)).toEqual([{ key: PERSONAL_PROJECT_ID, threadId: made[0], prompt: botHeartbeat("Dot") }]);
});

it("FM: Make this the Main on a conversation with no model fills it from the Bot's default model, else the provider's, check-ins on or off", async () => {
  const x = await setup();
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, conversationBot: (threadId) => threadId.startsWith("conv") ? BOT_ID : null });
  await bots.create({ name: "Dot", avatar: "🟣" });
  // Check-ins off: before, it moved and every later check-in failed in BB.
  x.add({ id: "conv_a", projectId: PERSONAL_PROJECT_ID, providerId: "codex" });
  x.execution.set("conv_a", { model: null as never, reasoningLevel: "high", permissionMode: "accept-edits" });
  // The Bot's default (taken from its first Main) is on another provider, so the provider's default.
  x.db.prepare("UPDATE bots SET default_provider_id = 'claude', default_model = 'claude-x'").run();
  await bots.makeMain("conv_a");
  expect(x.update).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "conv_a", model: "codex-default" }));
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("conv_a");
  // With the Bot's default model on that provider, that one; check-ins on.
  await bots.setDefaultModel({ botId: BOT_ID, providerId: "codex", model: "other", reasoning: "low" });
  await bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
  x.add({ id: "conv_b", projectId: PERSONAL_PROJECT_ID, providerId: "codex" });
  x.execution.set("conv_b", { model: null as never, reasoningLevel: "high", permissionMode: "accept-edits" });
  await bots.makeMain("conv_b");
  expect(x.update).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "conv_b", model: "other", reasoningLevel: "low" }));
  expect((await checkins(x))[0]?.threadId).toBe("conv_b");
});

it("FM: Make this the Main on a conversation with no model whose provider is signed out says what to do, and nothing moves", async () => {
  const x = await setup();
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, conversationBot: (threadId) => threadId.startsWith("conv") ? BOT_ID : null });
  await bots.create({ name: "Dot", avatar: "🟣" });
  x.add({ id: "conv_c", projectId: PERSONAL_PROJECT_ID, providerId: "claude" });
  x.execution.set("conv_c", { model: null as never, reasoningLevel: "high", permissionMode: "accept-edits" });
  x.signedOut.add("claude");
  await expect(bots.makeMain("conv_c")).rejects.toThrow(/has no model yet.*Choose a model/);
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("t1");
});

it("FM: Start a new Main: a fresh conversation on the Bot's default model becomes the Main; the old one stays a conversation", async () => {
  const x = await setup();
  const mainMoved = vi.fn();
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, mainMoved, providerStates: async () => [{ providerId: "codex", status: "ready" }, { providerId: "claude", status: "signed-out" }] as never });
  await bots.create({ name: "Dot", avatar: "🟣" });
  await bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
  await bots.setDefaultModel({ botId: BOT_ID, providerId: "codex", model: "other" });
  const view = await bots.newMain(BOT_ID);
  const made = view.bot!.threadId!;
  expect(made).not.toBe("t1");
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: PERSONAL_PROJECT_ID, providerId: "codex", model: "other", pluginMetadata: { bot: BOT_ID } }));
  expect(mainMoved).toHaveBeenLastCalledWith(BOT_ID, made, "t1");
  expect(x.threads.get("t1")?.archivedAt ?? null).toBeNull();
  expect((await checkins(x))[0]?.threadId).toBe(made);
  // The default's provider signed out: a signed-in one instead, not a spawn BB refuses.
  // Set while claude was signed in; it signed out since (setDefaultModel now refuses a signed-out one).
  x.db.prepare("UPDATE bots SET default_provider_id = 'claude', default_model = 'claude-x'").run();
  await bots.newMain(BOT_ID);
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: "codex" }));
  expect(x.spawn.mock.lastCall?.[0]).not.toHaveProperty("model", "claude-x");
});

it("FM: Start a new Main with no provider signed in says so in plain words and keeps the old Main", async () => {
  const x = await setup();
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, providerStates: async () => [] });
  await bots.create({ name: "Dot", avatar: "🟣" });
  x.db.prepare("UPDATE bots SET provider_id = NULL").run();
  await expect(bots.newMain(BOT_ID)).rejects.toThrow("Sign in to a provider");
  expect(x.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("t1");
  // BB refusing the spawn for want of a model reads the same.
  x.db.prepare("UPDATE bots SET provider_id = 'codex'").run();
  x.spawn.mockRejectedValueOnce(new Error("Thread t9 has no stored execution model"));
  await expect(bots.newMain(BOT_ID)).rejects.toThrow("Sign in to a provider");
});

it("FM: a rename with check-ins on goes through when the Main is gone or has no model", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  await x.bots.setRun({ enabled: true, cadence: "daily", time: "08:00" });
  await x.bots.setRun({ botId: scout.id, enabled: true, cadence: "daily", time: "08:00" });
  // Before: the rename was saved, then re-scheduling the check-in threw BB's 404 or "Choose a provider and model".
  x.threads.delete(scout.threadId!);
  await expect(x.bots.set({ botId: scout.id, name: "Scout II" })).resolves.toMatchObject({ bot: { name: "Scout II" } });
  x.execution.set("t1", { model: null as never, reasoningLevel: "high", permissionMode: "accept-edits" });
  x.signedOut.add("codex");
  await expect(x.bots.set({ name: "Penny" })).resolves.toMatchObject({ bot: { name: "Penny" } });
  // The check-in still carries the new name: its prompt is read when it runs.
  x.execution.set("t1", { model: "model", reasoningLevel: "high", permissionMode: "accept-edits" });
  x.send.mockClear();
  await x.scheduler.runNow({ owner: "heartbeat", ownerId: PERSONAL_PROJECT_ID });
  expect(x.send.mock.lastCall?.[0].input[0]!.text).toContain(botHeartbeat("Penny"));
});

it("FM: turning check-ins on for a Bot with no Main says what to do instead of storing them off and saying it worked", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  x.db.prepare("UPDATE bots SET thread_id = NULL WHERE id = ?").run(scout.id);
  await expect(x.bots.setRun({ botId: scout.id, enabled: true, cadence: "daily", time: "08:00" })).rejects.toThrow("Pick one in Bot settings");
  await expect(x.bots.checkinPreset("morning", scout.id)).rejects.toThrow("Pick one in Bot settings");
  // Off is always fine.
  await expect(x.bots.setRun({ botId: scout.id, enabled: false, cadence: "daily", time: "08:00" })).resolves.toBeTruthy();
});

it("FM: Resume works when the Main is gone and a new one can't start yet", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  await x.bots.pause(scout.id);
  x.threads.delete(scout.threadId!);
  x.spawn.mockRejectedValueOnce(new Error("Thread t9 has no stored execution model"));
  // Before: the raw error, and the Bot stayed paused.
  await expect(x.bots.resume(scout.id)).resolves.toMatchObject({ bot: { state: "active" } });
});

it("FM: switching a worktree conversation to another provider keeps its workspace; a gone one is said plainly", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  x.add({ id: "wt", providerId: "codex", environmentId: "env_worktree" } as never);
  await x.bots.switchModel("wt", { providerId: "claude", model: "sonnet" });
  // Before: the new thread started in the project's default workspace, away from the worktree.
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: "claude", environment: { type: "reuse", environmentId: "env_worktree" } }));
  x.add({ id: "plain", providerId: "codex", environmentId: null } as never);
  await x.bots.switchModel("plain", { providerId: "claude", model: "sonnet" });
  expect(x.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ environment: { type: "project-default" } }));
  await expect(x.bots.switchModel("gone", { providerId: "claude", model: "sonnet" })).rejects.toThrow("That conversation no longer exists.");
});

it("FM: the default model can't be set to a signed-out provider or a model its provider doesn't offer", async () => {
  const x = await setup();
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, providerStates: async () => [{ providerId: "codex", status: "ready" }, { providerId: "claude", status: "signed-out" }] as never });
  await bots.create({ name: "Dot", avatar: "🟣" });
  // Before: both were saved, and every later + New, Ask and new Main failed with BB's raw error.
  await expect(bots.setDefaultModel({ botId: BOT_ID, providerId: "claude", model: "opus" })).rejects.toThrow("isn't signed in");
  await expect(bots.setDefaultModel({ botId: BOT_ID, providerId: "codex", model: "retired-model" })).rejects.toThrow("doesn't offer retired-model any more");
  await expect(bots.setDefaultModel({ botId: BOT_ID, providerId: "codex", model: "codex-default" })).resolves.toMatchObject({ bot: { defaultModel: { providerId: "codex", model: "codex-default" } } });
});

it("FM (review F1): Resume with check-ins on and the Main gone goes through; check-ins come back with the new Main", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  await x.bots.setRun({ botId: scout.id, enabled: true, cadence: "daily", time: "07:30" });
  await x.bots.pause(scout.id);
  x.threads.delete(scout.threadId!);
  x.spawn.mockRejectedValueOnce(new Error("Provider codex is busy"));
  // Before: "The Bot's Main conversation is gone… then turn check-ins on", and the Bot stayed paused.
  await expect(x.bots.resume(scout.id)).resolves.toMatchObject({ bot: { state: "active" } });
  // The heal right after Resume makes the new Main, and the check-in is on there.
  await vi.waitFor(() => expect(x.bots.stored(scout.id)?.threadId).not.toBe(scout.threadId));
  const made = x.bots.stored(scout.id)!.threadId!;
  await vi.waitFor(() => expect(x.leads.runs.get(`bot:${scout.id}`)?.enabled).toBe(true));
  x.send.mockClear();
  await x.scheduler.runNow({ owner: "heartbeat", ownerId: `bot:${scout.id}` });
  expect(x.send.mock.lastCall?.[0].threadId).toBe(made);
});

it("FM (review F1): turning check-ins off forgets a heartbeat waiting for a new Main", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  await x.bots.setRun({ botId: scout.id, enabled: true, cadence: "daily", time: "07:30" });
  await x.bots.pause(scout.id);
  await x.bots.setRun({ botId: scout.id, enabled: false, cadence: "daily", time: "07:30" });
  expect((x.db.prepare("SELECT heartbeat_was_on FROM bots WHERE id = ?").get(scout.id) as { heartbeat_was_on: number }).heartbeat_was_on).toBe(0);
});

it("FM (review F2): a Bot brought over from bb whose Main was deleted there gets a new Main on Resume (Run here)", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  const scout = (await x.bots.create({ name: "Scout", avatar: "🛰️" })).bot!;
  await x.bots.setRun({ botId: scout.id, enabled: true, cadence: "daily", time: "07:30" });
  await x.bots.stop(scout.id);
  // Brought over: stopped, made before the import, its Main deleted in bb (left out of the bring-over).
  const copy = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, importedAt: () => Date.now() + 1 });
  x.threads.delete(scout.threadId!);
  expect(copy.stored(scout.id)?.inBb).toBe(true);
  // Before: Resume failed, Start a new Main was refused ("runs in bb"), and there was no way out.
  await expect(copy.resume(scout.id)).resolves.toMatchObject({ bot: { state: "active", inBb: false } });
  const made = copy.stored(scout.id)!.threadId!;
  expect(made).not.toBe(scout.threadId);
  expect(x.threads.has(made)).toBe(true);
  expect(x.leads.runs.get(`bot:${scout.id}`)?.enabled).toBe(true);
});

it("FM (review F3): picking or starting a Main clears the sidebar's \"can't start a new Main\" line at once", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  x.threads.delete("t1");
  x.spawn.mockRejectedValueOnce(new Error("Provider codex is busy"));
  expect(await x.bots.heal(BOT_ID, "t1")).toBeNull();
  expect((await x.bots.get()).bot?.mainProblem).toBe("Couldn't start a new Main yet; trying again");
  // Before: the line stayed until the heal's next try (up to an hour).
  await x.bots.newMain(BOT_ID);
  expect((await x.bots.get()).bot?.mainProblem).toBeNull();
});

it("FM (review F4): Start a new Main on a paused Bot doesn't wake it: no first message", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  await x.bots.pause();
  await x.bots.newMain(BOT_ID);
  expect(x.spawn.mock.lastCall?.[0]).toMatchObject({ input: [] });
});

it("FM (review F6): the automatic new Main skips a signed-out provider; with none signed in, the sidebar says to sign in or choose a model", async () => {
  const x = await setup();
  const states = [{ providerId: "codex", status: "signed-out", loginCommand: "codex login" }, { providerId: "claude", status: "ready", loginCommand: "claude login" }];
  const bots = new Bots({ db: x.db, sdk: x.bb.sdk, leads: x.leads, changed: () => {}, presenceChanged: () => {}, providerStates: async () => states as never });
  await bots.create({ name: "Dot", avatar: "🟣" });
  x.threads.delete("t1");
  // The old Main ran on codex, now signed out: claude, which is signed in.
  const warn = vi.fn();
  const first = await bots.heal(BOT_ID, "t1", warn);
  expect(warn.mock.calls).toEqual([]);
  expect(first).toBeTruthy();
  expect(x.spawn.mock.lastCall?.[0]).toMatchObject({ providerId: "claude" });
  // Nothing signed in: no spawn, and plain words with the action.
  const main = x.leads.storedLead(PERSONAL_PROJECT_ID)!;
  x.threads.delete(main);
  states[1]!.status = "signed-out";
  const before = x.spawn.mock.calls.length;
  expect(await bots.heal(BOT_ID, main)).toBeNull();
  expect(x.spawn.mock.calls.length).toBe(before);
  // The Main last ran on Claude, so that is the one to sign in to.
  expect((await bots.get()).bot).toMatchObject({ mainProblem: "Sign in to Claude or choose a model", mainNeedsModel: true });
});

it("logs and tolerates corrupted warnings JSON in bot_skill_versions without crashing skillHistory()", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const x = await setup();
    await x.bots.create({ name: "Dot", avatar: "🟣" });
    x.db.prepare("INSERT INTO bot_skill_versions(bot_id, name, description, body, old_body, warnings, at) VALUES (?, 'triage', 'Triage inbox', 'Step 1', '', '{broken', 1000)").run(BOT_ID);
    const history = x.bots.skillHistory(BOT_ID);
    expect(history).toHaveLength(1);
    expect(history[0]?.warnings).toEqual([]);
    const matching = () => warn.mock.calls.filter(([msg]) => typeof msg === "string" && msg.includes("bot_skill_versions"));
    expect(matching()).toHaveLength(1);

    // Repeated reads warn at most once per version row.
    x.bots.skillHistory(BOT_ID);
    expect(matching()).toHaveLength(1);
  } finally {
    warn.mockRestore();
  }
});

it("stop() does not mark stopped or pause later automations when an earlier pause fails", async () => {
  const x = await setup();
  const created = await x.bots.create({ name: "Dot", avatar: "🟣" });
  const threadId = created.bot!.threadId!;
  for (let i = 1; i <= 8; i++) {
    x.automations.push({ id: `auto_${i}`, name: `Auto ${i}`, enabled: true, trigger: { cron: "0 9 * * *" }, execution: { targetThreadId: threadId }, nextRunAt: 99 });
  }
  const pausedIds: string[] = [];
  const real = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (args) => {
    if (args.method === "automations_pause") {
      const id = String(args.input.automationId);
      pausedIds.push(id);
      if (id === "auto_1") throw new Error("pause-boom-1");
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    return real(args);
  });

  await expect(x.bots.stop()).rejects.toThrow("pause-boom-1");
  expect((await x.bots.get()).bot?.state).not.toBe("stopped");
  // Concurrency is 6: auto_7 and auto_8 must not have been started after auto_1 failed.
  expect(pausedIds).not.toContain("auto_7");
  expect(pausedIds).not.toContain("auto_8");
});

it("restorePaused() restores surviving items, keeps failed ones, and throws the lowest-rowid failure", async () => {
  const x = await setup();
  const created = await x.bots.create({ name: "Dot", avatar: "🟣" });
  const threadId = created.bot!.threadId!;
  for (const id of ["auto_1", "auto_2", "auto_3"]) {
    x.automations.push({ id, name: id, enabled: true, trigger: { cron: "0 9 * * *" }, execution: { targetThreadId: threadId }, nextRunAt: 99 });
  }
  await x.bots.stop();
  expect((await x.bots.get()).bot?.state).toBe("stopped");

  const real = x.callRpc.getMockImplementation()!;
  x.callRpc.mockImplementation(async (args) => {
    if (args.method === "automations_resume") {
      const id = String(args.input.automationId);
      if (id === "auto_2") {
        // Fails slower than auto_3, but has lower rowid so its error must win.
        await new Promise((resolve) => setTimeout(resolve, 25));
        throw new Error("resume-fail-2");
      }
      if (id === "auto_3") {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("resume-fail-3");
      }
    }
    return real(args);
  });

  await expect(x.bots.resume()).rejects.toThrow("resume-fail-2");
  expect((await x.bots.get()).bot?.state).toBe("stopped");
  // auto_1 succeeded and was forgotten; auto_2 and auto_3 stay recorded for retry.
  expect(x.automations.find((a) => a.id === "auto_1")?.enabled).toBe(true);
  const remaining = (x.db.prepare("SELECT item_id FROM bot_stop_paused WHERE bot_id = ? ORDER BY rowid").all(BOT_ID) as { item_id: string }[]).map((r) => r.item_id);
  expect(remaining).toEqual(["auto_2", "auto_3"]);
});

it("finds the core skill by its marker, never by name or order: check-ins and Memory follow it", async () => {
  const x = await setup();
  const scout = await x.bots.create({ name: "Scout", avatar: "🛰️" });
  const id = scout.bot!.id;
  // The user already had an on-demand "core-profile", so the core skill is made as core-profile-moved.
  x.bots.writeSkill({ name: "core-profile", description: "Mine", body: "Not a profile." }, id);
  expect(x.bots.ensureCore(id)).toMatchObject({ skill: "core-profile-moved" });
  // Another always-on skill that sorts first by name.
  x.bots.writeSkill({ name: "aaa-notes", description: "Also always on", body: "## Notes\n\n- One.\n", alwaysOn: true }, id);
  expect(x.bots.alwaysOnSkills(id).map((skill) => [skill.name, skill.core])).toEqual([["core-profile-moved", true], ["aaa-notes", false]]);
  expect(x.bots.coreSkill(id)).toMatchObject({ name: "core-profile-moved", migrated: false });
  expect(x.bots.addCheckin(id, "Every Friday: the weekly review.")).toBe(true);
  expect(x.bots.skill("core-profile-moved", id)!.body).toContain("- Every Friday: the weekly review.");
  expect(x.bots.skill("aaa-notes", id)!.body).not.toContain("Friday");
  expect(x.bots.skill("core-profile", id)!.body).toBe("Not a profile.");
  // Without its core skill, a check-in line goes nowhere rather than into another skill.
  x.bots.deleteSkill("core-profile-moved", id);
  expect(x.bots.coreSkill(id)).toBeNull();
  expect(x.bots.addCheckin(id, "Another line.")).toBe(false);
  expect(x.bots.skill("aaa-notes", id)!.body).not.toContain("Another line.");
});

it("repairs the core marker when the core skill was renamed, never by guessing among several", async () => {
  const x = await setup();
  await x.bots.create({ name: "Dot", avatar: "🟣" });
  x.bots.ensureCore();
  const core = x.bots.skill("core-profile")!;
  // Renamed: written anew under another name, the old one deleted.
  x.bots.writeSkill({ name: "my-rules", description: core.description, body: core.body, alwaysOn: true });
  x.bots.writeSkill({ name: "travel-rules", description: "Also always on", body: "- Aisle seats.\n", alwaysOn: true });
  x.bots.deleteSkill("core-profile");
  expect(x.bots.coreSkill()).toMatchObject({ name: "my-rules" });
  expect(x.bots.addCheckin(x.bots.list()[0]!.id, "Fridays: the review.")).toBe(true);
  expect(x.bots.skill("my-rules")!.body).toContain("Fridays: the review.");
  // Deleted with no copy left, and more than one other: nothing is guessed.
  x.bots.deleteSkill("my-rules");
  x.bots.writeSkill({ name: "home-rules", description: "Always on", body: "- Quiet.\n", alwaysOn: true });
  expect(x.bots.coreSkill()).toBeNull();
});
