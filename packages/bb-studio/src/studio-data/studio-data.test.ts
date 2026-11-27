// "Bring over BB Studio data": the swap Studio applies at its start, tested on
// Studio's real migrations, real onboarding and the real Bots, runners,
// automations and scheduler.
import Database from "better-sqlite3";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync as renameFile, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Automations } from "../automations";
import { BOT_ID, Bots } from "../bot";
import { MIGRATIONS } from "../migrations";
import { runOnboarding } from "../onboarding";
import { PagesService } from "../pages/service";
import { PageStore } from "../pages/store";
import { PERSONAL_PROJECT_ID, ProjectLeads } from "../project-lead";
import { Runners } from "../runners";
import { fromHeartbeat, localZone } from "../schedule";
import { SETTINGS_KV_KEY } from "../settings/store";
import { SKILLS_REGISTRY_KV_KEY } from "../skills-registry";
import { testScheduler } from "../test/scheduler-fixture";
import { BB_KV_FILE, BEFORE_DIR, BEFORE_KV_FILE, FROM_BB_FILE, REPLACED_DIR, STAGED_DIR, importDir, importPath, readJournal, studioDataFromBb, studioDir, writeJournal, type ImportJournal } from "./journal";
import { readImportedAt } from "../automation-table";
import { studioOwnData } from "./own-data";
import { previewStaged, studioDataStatus } from "./preview";
import { stopImportedStudio } from "./stop";
import { claimFirstLoad, finishStudioImport, prepareKv, replacedMainThreads } from "./start";
import type { StudioKv } from "./swap";
import { studioThreads } from "./threads";

const dispose: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0).reverse()) await fn(); });

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dispose.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

type Thread = ReturnType<typeof makeThreadResponse>;

/** A BB host for Studio's classes: threads the Bots use, and bb's automations plugin off (as in BB Studio). */
function host() {
  const threads = new Map<string, Thread>();
  const add = (id: string, projectId = PERSONAL_PROJECT_ID) => threads.set(id, makeThreadResponse({ id, projectId, providerId: "codex" }));
  for (const id of ["thr_main1", "thr_main2", "thr_runner", "thr_lead", "thr_conv", "thr_worker"]) add(id);
  const send = vi.fn(async (_args: { threadId: string }) => ({ ok: true }));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("Not found"), { status: 404 }); return thread; }) as never,
      list: (async () => []) as never,
      send: send as never,
      stop: (async () => ({})) as never,
      update: (async () => ({})) as never,
      interactions: { list: (async () => []) as never } as never,
      defaultExecutionOptions: (async () => ({ model: "model", reasoningLevel: "high", permissionMode: "accept-edits" })) as never,
    },
    plugins: {
      callRpc: (async () => { throw Object.assign(new Error('HTTP 503: plugin "automations" is not running (status: disabled)'), { status: 503 }); }) as never,
      list: async () => ({ plugins: [] }),
      experimental_discoverRpc: async () => [],
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  return { bb, send, threads };
}

type Host = ReturnType<typeof host>;

/** Studio's real Bots, project leads, runners, check-ins and scheduler on a database, wired as server.ts wires them. */
function studioOn(db: Database.Database, h: Host, clock = { now: Date.now() }) {
  const { engine, scheduler } = testScheduler(db, h.bb.sdk, clock);
  let bots!: Bots;
  const leads = new ProjectLeads({ db, sdk: h.bb.sdk, scheduler, changed: () => {}, personalPrompt: () => "Check in.", botPrompt: () => "Check in." });
  const runners = new Runners({ db, sdk: h.bb.sdk, scheduler, changed: () => {}, bot: (botId) => bots.stored(botId), startedThreads: async () => [], chain: (botId) => bots.chain(botId) });
  const automationBot = (botId?: string) => { const bot = bots.stored(botId); return bot ? { id: bot.id, name: bot.name, threadId: bot.threadId, state: bot.state, primary: bot.primary !== false, kind: bot.kind ?? "studio" } : null; };
  const automations = new Automations({
    db, sdk: h.bb.sdk, scheduler, changed: () => {}, bot: automationBot, copiedReminder: () => false, importedAt: () => 1,
    heartbeat: {
      get: (botId) => { const key = bots.heartbeatKey(botId); return key ? leads.runs.get(key) : null; },
      set: async (botId, run) => { await bots.setRun({ botId, ...run }); },
      automation: (botId) => { const key = bots.heartbeatKey(botId); return key ? leads.runs.automation(key) : null; },
    },
    runners: {
      list: (botId) => runners.list(botId), get: (id, botId) => runners.get(id, botId), create: (input, botId) => runners.create(input, botId), update: (input, botId) => runners.update(input, botId),
      setState: (id, state, botId) => runners.setState(id, state, botId), runNow: (id, botId) => runners.runNow(id, botId), delete: (id, botId) => runners.delete(id, botId), automation: (id) => runners.automation(id),
    },
  });
  bots = new Bots({
    db, sdk: h.bb.sdk, leads, changed: () => {}, presenceChanged: () => {},
    runners: { threads: (botId) => runners.threads(botId), pauseAll: (botId, onPaused) => runners.pauseAll(botId, onPaused), restore: (id) => runners.restore(id) },
    automations: { pauseAll: (botId, onPaused) => automations.pauseAll(botId, onPaused), restore: (id) => automations.restore(id), follow: async (botId) => { const bot = automationBot(botId); if (bot) await automations.follow(bot); } },
  });
  return { engine, scheduler, leads, runners, automations, bots, clock };
}

const daily = { cadence: "daily" as const, time: "09:00" };
const T0 = 1_700_000_000_000;

/** bb's Studio as a user with two active Bots, schedules of every kind, a project lead, approvals and chats has it. */
async function bbStudio(path: string, h: Host) {
  const db = new Database(path);
  h.bb.storage.migrate(db, MIGRATIONS);
  const insertBot = db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES (?, ?, '🧭', 'active', ?, 0, ?, ?)");
  insertBot.run(BOT_ID, "Chief", "thr_main1", T0, T0);
  insertBot.run("bot_two", "Scout", "thr_main2", T0 + 1, T0 + 1);
  db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, owner_conversation_id, title, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'studio', ?, ?)").run("thr_main1", BOT_ID, "conversation", 1, null, "Main", T0, T0);
  db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, owner_conversation_id, title, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'studio', ?, ?)").run("thr_worker", BOT_ID, "worker", 0, "thr_conv", "Worker", T0, T0);
  const lead = db.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?)");
  lead.run(PERSONAL_PROJECT_ID, "thr_main1", T0, T0);
  lead.run("proj_code", "thr_lead", T0, T0);
  const s = studioOn(db, h);
  await s.leads.runs.set(PERSONAL_PROJECT_ID, "thr_main1", { enabled: true, ...daily });
  await s.leads.runs.set("bot:bot_two", "thr_main2", { enabled: true, ...daily });
  await s.leads.runs.set("proj_code", "thr_lead", { enabled: true, ...daily });
  db.prepare("INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, automation_id, adopted, created_at, updated_at) VALUES ('run_1', ?, 'Inbox', 'Read the inbox', 'thr_runner', ?, 'active', 'daily', '09:00', 'trg_runner_run_1', 0, ?, ?)").run(BOT_ID, PERSONAL_PROJECT_ID, T0, T0);
  s.scheduler.ensure({ owner: "runner", ownerId: "run_1" }, { schedule: fromHeartbeat(daily), timeZone: localZone() }, true);
  const automation = db.prepare("INSERT INTO bot_automations (id, bot_id, kind, name, instruction, script, interpreter, env_json, schedule_json, state, project_id, bb_ids, resources, target_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'Do it', ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)");
  const schedule = JSON.stringify({ type: "daily", time: "13:00" });
  for (const [id, kind, owner, script, env] of [["aut_1", "checkin", "automation", null, null], ["aut_2", "watcher", "watcher", "echo hi", '{"TOKEN":"x"}']] as const) {
    const trigger = `trg_${owner}_${id}`;
    automation.run(id, BOT_ID, kind, kind, script, script ? "bash" : null, env, schedule, PERSONAL_PROJECT_ID, JSON.stringify([trigger]), JSON.stringify([{ id: trigger, projectId: PERSONAL_PROJECT_ID }]), "thr_main1", T0, T0);
    s.scheduler.ensure({ owner, ownerId: id }, { schedule: fromHeartbeat(daily), timeZone: localZone() }, true);
  }
  s.engine.upsert({ owner: "thread-sweeps", ownerId: "tick", spec: { kind: "interval", everyMs: 60_000 } });
  db.prepare("INSERT INTO mini_grants (mini_id, capability, granted_at) VALUES ('mini_1', 'net', ?)").run(T0);
  db.prepare("INSERT INTO mini_secrets (mini_id, name, header, value, updated_at) VALUES ('mini_1', 'key', 'x-key', 'secret', ?)").run(T0);
  db.prepare("INSERT INTO pages (id, title, created_at, updated_at) VALUES ('pg_1', 'Notes', ?, ?)").run(T0, T0);
  db.prepare("INSERT INTO tasks (id, record, owner, state, origin, conversation, created_at, updated_at) VALUES ('task_1', ?, 'cos', 'todo', 'task', 'thr_conv', ?, ?)").run(JSON.stringify({ workers: ["thr_taskworker"] }), T0, T0);
  db.prepare("INSERT INTO live_activity (thread_id, state, updated_at) VALUES ('thr_unrelated', 'idle', ?)").run(T0);
  return { db, s };
}

const rows = (db: Database.Database, sql: string) => db.prepare(sql).all();

/** What Stop decides, for comparing the real Stop with the staged one. */
function stopState(db: Database.Database) {
  return {
    bots: rows(db, "SELECT id, state, heartbeat_was_on FROM bots ORDER BY id"),
    runners: rows(db, "SELECT id, state FROM bot_runners ORDER BY id"),
    automations: rows(db, "SELECT id, state FROM bot_automations ORDER BY id"),
    paused: rows(db, "SELECT bot_id, kind, item_id, project_id FROM bot_stop_paused ORDER BY bot_id, kind, item_id"),
    runs: rows(db, "SELECT project_id, enabled, cadence, time, cron, automation_id, lead_thread_id FROM project_runs WHERE project_id != 'proj_code' ORDER BY project_id"),
    triggers: rows(db, "SELECT id, state FROM triggers WHERE owner_id != 'proj_code' ORDER BY id"),
  };
}

/** A copy of a database file. */
function copyDb(db: Database.Database, path: string): Database.Database {
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  return new Database(path);
}

describe("stopping bb's Studio in the staged copy", () => {
  it("writes what the real Bots.stop writes, so Resume turns back on exactly those", async () => {
    const dir = temp("studio-stop-");
    const h = host();
    const { db } = await bbStudio(join(dir, "bb.db"), h);
    const real = copyDb(db, join(dir, "real.db"));
    const staged = copyDb(db, join(dir, "staged.db"));
    const live = studioOn(real, h);
    for (const bot of live.bots.list()) await live.bots.stop(bot.id);
    const summary = stopImportedStudio(staged, Date.now());
    expect(stopState(staged)).toEqual(stopState(real));
    expect(summary).toMatchObject({ bots: 2, heartbeats: 2, runners: 1, automations: 2, leads: 1, approvals: 1 });
    // Beyond Stop: the project lead's heartbeat is off too, approvals are gone, the engine's own rows stay.
    expect(rows(staged, "SELECT enabled, lead_thread_id FROM project_runs WHERE project_id = 'proj_code'")).toEqual([{ enabled: 0, lead_thread_id: null }]);
    expect(rows(staged, "SELECT id, state FROM triggers WHERE state = 'on'")).toEqual([{ id: "thread-sweeps:tick", state: "on" }]);
    expect(rows(staged, "SELECT * FROM mini_grants")).toEqual([]);
    for (const each of [db, real, staged]) each.close();
  });

  it("fires nothing on Studio's scheduler afterwards, while the same data before the stop does", async () => {
    const dir = temp("studio-tick-");
    const h = host();
    const { db } = await bbStudio(join(dir, "bb.db"), h);
    const before = copyDb(db, join(dir, "before.db"));
    stopImportedStudio(db, Date.now());
    const clock = { now: Date.now() + 3 * 24 * 60 * 60_000 };
    const control = studioOn(before, h, clock);
    expect(await control.engine.tick()).toBeGreaterThan(0);
    expect(h.send).toHaveBeenCalled();
    h.send.mockClear();
    const stopped = studioOn(db, h, clock);
    for (let minute = 0; minute < 5; minute++) {
      clock.now += 60_000;
      await stopped.engine.tick();
    }
    expect(h.send).not.toHaveBeenCalled();
    expect(rows(db, "SELECT COUNT(*) AS n FROM trigger_runs")).toEqual([{ n: 0 }]);
    before.close();
    db.close();
  });

  it("lets Resume bring a Bot's heartbeat, runner, check-in and watcher back", async () => {
    const dir = temp("studio-resume-");
    const h = host();
    const { db } = await bbStudio(join(dir, "bb.db"), h);
    stopImportedStudio(db, Date.now());
    const s = studioOn(db, h);
    await s.bots.resume(BOT_ID);
    expect(rows(db, "SELECT state, heartbeat_was_on FROM bots WHERE id = 'bot_main'")).toEqual([{ state: "active", heartbeat_was_on: 0 }]);
    expect(s.engine.get("heartbeat", PERSONAL_PROJECT_ID)?.state).toBe("on");
    expect(s.engine.get("runner", "run_1")?.state).toBe("on");
    expect(s.engine.get("automation", "aut_1")?.state).toBe("on");
    expect(s.engine.get("watcher", "aut_2")?.state).toBe("on");
    expect(rows(db, "SELECT * FROM bot_stop_paused WHERE bot_id = 'bot_main'")).toEqual([]);
    // The other Bot stays stopped until it is resumed too.
    expect(rows(db, "SELECT state FROM bots WHERE id = 'bot_two'")).toEqual([{ state: "stopped" }]);
    expect(s.engine.get("heartbeat", "bot:bot_two")).toBeNull();
    db.close();
  });
});

describe("the threads Studio's data needs", () => {
  it("names the Bots' threads, workers, task conversations and chat links, not every thread Studio saw", async () => {
    const dir = temp("studio-threads-");
    const { db } = await bbStudio(join(dir, "bb.db"), host());
    const threads = studioThreads(db, [{ key: "link:pages:pg_1", value: JSON.stringify({ threadId: "thr_chat", at: 1 }) }, { key: "rail", value: "\"thr_notalink\"" }]);
    expect(threads.required).toEqual(["thr_main1", "thr_main2"]);
    expect(threads.wanted).toEqual(expect.arrayContaining(["thr_main1", "thr_main2", "thr_worker", "thr_conv", "thr_runner", "thr_lead", "thr_taskworker", "thr_chat"]));
    expect(threads.wanted).not.toContain("thr_unrelated");
    expect(threads.wanted).not.toContain("thr_notalink");
    db.close();
  });
});

/** A new install's Studio: Studio's migrations and a real onboarding run, with the Bot's core profile page made. */
async function freshStudio(dataDir: string) {
  const threads = new Map<string, Thread>();
  const prefs = new Map<string, { value: unknown; revision: number }>([["sidebar.threadListProvider", { value: "__automatic__", revision: 1 }]]);
  let spawned = 0;
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    system: {
      uiPreferences: {
        list: (async () => ({ preferences: Object.fromEntries(prefs) })) as never,
        set: (async ({ key, value, expectedRevision }: { key: string; value: unknown; expectedRevision: number }) => { prefs.set(key, { value, revision: expectedRevision + 1 }); return {}; }) as never,
      },
    },
    threads: {
      spawn: (async (args: Record<string, unknown>) => { const id = `thr_${++spawned}`; const thread = { ...makeThreadResponse({ id, projectId: String(args.projectId), title: String(args.title), status: "idle" }), providerId: String(args.providerId ?? "codex"), queuedMessageCount: 0 }; threads.set(id, thread as Thread); return thread; }) as never,
      send: (async () => ({})) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("Not found"), { status: 404 }); return thread; }) as never,
      list: (async () => [...threads.values()]) as never,
      defaultExecutionOptions: (async () => ({ model: "model" })) as never,
      queuedMessages: { list: (async () => []) as never, delete: (async () => ({})) as never },
    },
  } as never });
  dispose.push(() => harness.lifecycle.dispose());
  mkdirSync(studioDir(dataDir), { recursive: true });
  const db = new Database(join(studioDir(dataDir), "data.db"));
  db.pragma("journal_mode = WAL");
  bb.storage.migrate(db, MIGRATIONS);
  const store = new PageStore(db);
  const pages = new PagesService(bb as never, store);
  dispose.push(() => pages.hub.disposeAll());
  const leads = new ProjectLeads({ db, sdk: bb.sdk, scheduler: testScheduler(db, bb.sdk).scheduler, changed: () => {}, personalPrompt: () => "", botPrompt: () => null });
  const bots = new Bots({ db, sdk: bb.sdk, leads, changed: () => {}, presenceChanged: () => {}, memory: { exists: (id) => !!store.meta(id), markdown: (id) => (db.prepare("SELECT markdown FROM pages WHERE id = ?").get(id) as { markdown: string } | undefined)?.markdown ?? null } });
  const bbDb = new Database(join(dataDir, "bb.db"));
  bbDb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY)");
  bbDb.close();
  const onboard = () => runOnboarding({
    dataDir, db, sdk: bb.sdk as never,
    providers: async () => [{ providerId: "codex", status: "ready", loginCommand: "codex login" }],
    seedBot: (input) => bots.seedStarter(input),
    firstBot: async () => true,
    startFirstChat: (input) => bots.startFirstChat(input),
  });
  const flag = await onboard();
  expect(flag).toMatchObject({ state: "done", reason: "ran" });
  // A new Bot gets its always-on core skill (src/core-skill-migrate.ts), not a page.
  expect(bots.ensureCore(BOT_ID)).toMatchObject({ state: "created", skill: "core-profile" });
  expect(bots.memoryPage(BOT_ID)).toBeNull();
  return { db, bb, pages, bots };
}

describe("whether this install has data of its own", () => {
  it("says no for a new install after onboarding, and yes once the user made something", async () => {
    const dataDir = temp("studio-own-");
    const fresh = await freshStudio(dataDir);
    expect(studioOwnData(fresh.db)).toEqual({ has: false });
    fresh.pages.createPage({ projectId: PERSONAL_PROJECT_ID, parentId: null, title: "Groceries", markdown: "Milk", actor: "user" });
    expect(studioOwnData(fresh.db)).toEqual({ has: true, reason: "it has 1 pages" });
    fresh.db.close();
  });

  it("counts a changed core profile, a second conversation, and tables it doesn't know", async () => {
    const dataDir = temp("studio-own2-");
    const fresh = await freshStudio(dataDir);
    fresh.bots.writeSkill({ name: "core-profile", description: "Always on.", body: "## Preferences\n\n- Likes tea.\n" }, BOT_ID);
    expect(studioOwnData(fresh.db)).toMatchObject({ has: true, reason: expect.stringMatching(/always-on skill was changed|skills were edited/) });
    fresh.bots.ensureCore(BOT_ID);
    const other = new Database(":memory:");
    host().bb.storage.migrate(other, MIGRATIONS);
    other.exec("CREATE TABLE later_feature (id TEXT); INSERT INTO later_feature VALUES ('x')");
    expect(studioOwnData(other)).toEqual({ has: true, reason: "it has later feature" });
    other.prepare("DELETE FROM later_feature").run();
    for (const kind of ["conversation", "conversation"]) other.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, source, created_at, updated_at) VALUES (?, 'bot_main', ?, 0, 'studio', 1, 1)").run(`thr_${Math.random()}`, kind);
    other.prepare("INSERT INTO bots (id, name, avatar, state, created_at, updated_at) VALUES ('bot_main', 'A', 'a', 'active', 1, 1)").run();
    expect(studioOwnData(other)).toMatchObject({ has: true, reason: "its Bot has 2 conversations" });
    other.close();
    fresh.db.close();
  });

  it("fails closed when the database can't be read", () => {
    const db = new Database(":memory:");
    db.close();
    expect(studioOwnData(db)).toMatchObject({ has: true, reason: expect.stringContaining("could not be read") });
    const empty = new Database(":memory:");
    expect(studioOwnData(empty)).toMatchObject({ has: true });
    empty.close();
  });
});

/** Studio's key-value rows in memory. */
function memoryKv(initial: Record<string, unknown> = {}, failOn?: string): StudioKv & { values: Map<string, unknown> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async (key: string, value: unknown) => { if (key === failOn) throw new Error(`kv ${key} refused`); values.set(key, JSON.parse(JSON.stringify(value))); },
    delete: async (key: string) => { values.delete(key); },
    list: async (prefix?: string) => [...values.keys()].filter((key) => !prefix || key.startsWith(prefix)),
  };
}

const OUR_KV = { [SETTINGS_KV_KEY]: { theme: "ours" }, "rail:layout": ["ours"] };

/** A data dir with this install's new Studio and bb's staged by the server, journal "ready". */
async function staged(options: { own?: boolean } = {}) {
  const dataDir = temp("studio-swap-");
  const h = host();
  const fresh = await freshStudio(dataDir);
  if (options.own) fresh.pages.createPage({ projectId: PERSONAL_PROJECT_ID, parentId: null, title: "Mine", markdown: "Mine", actor: "user" });
  fresh.db.close();
  const studio = studioDir(dataDir);
  mkdirSync(join(studio, "artifacts"), { recursive: true });
  writeFileSync(join(studio, "artifacts", "ours.bin"), "ours");
  mkdirSync(join(studio, "secrets"), { recursive: true });
  writeFileSync(join(studio, "secrets", "key"), "our secret");
  const stagedDir = importPath(dataDir, STAGED_DIR);
  mkdirSync(stagedDir, { recursive: true, mode: 0o700 });
  const { db } = await bbStudio(join(stagedDir, "data.db"), h);
  db.pragma("journal_mode = DELETE");
  db.close();
  mkdirSync(join(stagedDir, "talk"), { recursive: true });
  writeFileSync(join(stagedDir, "talk", "rec.txt"), "bb's recording");
  writeFileSync(join(stagedDir, "onboarding.json"), JSON.stringify({ version: 1, state: "seeded", at: 1, botId: BOT_ID, welcomeThreadId: "thr_main1", opened: false }));
  writeFileSync(importPath(dataDir, BB_KV_FILE), JSON.stringify({ plugin_kv: [
    { key: SETTINGS_KV_KEY, value: JSON.stringify({ loopsEnabled: true, theme: "bb" }) },
    { key: SKILLS_REGISTRY_KV_KEY, value: "true" },
    { key: "link:pages:pg_1", value: JSON.stringify({ threadId: "thr_conv", at: 1 }) },
  ], plugin_settings: [] }), { mode: 0o600 });
  const journal: ImportJournal = { version: 1, id: "imp_1", state: "ready", stagedAt: T0, snapshotAt: T0, updatedAt: T0, error: null, required: ["thr_main1", "thr_main2"] };
  writeJournal(dataDir, journal);
  const kv = memoryKv(OUR_KV);
  const log = { info: vi.fn(), warn: vi.fn() };
  const start = (extra: Partial<Parameters<typeof finishStudioImport>[0]> = {}) => finishStudioImport({ dataDir, kv, migrate: (database, statements) => h.bb.storage.migrate(database, statements), migrations: MIGRATIONS, log, firstLoad: true, ...extra });
  return { dataDir, studio, stagedDir, kv, log, start, h };
}

const mode = (path: string) => statSync(path).mode & 0o777;
const openStudio = (dataDir: string) => new Database(join(studioDir(dataDir), "data.db"), { readonly: true });

describe("applying bb's Studio data at Studio's start", () => {
  it("does nothing at all when nothing is staged, on a first start and on a reload", async () => {
    const dataDir = temp("studio-nothing-staged-");
    const h = host();
    const fresh = await freshStudio(dataDir);
    fresh.db.close();
    const studio = studioDir(dataDir);
    const before = readdirSync(studio).sort();
    const dbBefore = readFileSync(join(studio, "data.db"));
    const kv = memoryKv(OUR_KV);
    const log = { info: vi.fn(), warn: vi.fn() };
    const migrate = vi.fn((database: Database.Database, statements: string[]) => h.bb.storage.migrate(database, statements));
    for (const firstLoad of [true, false]) {
      expect(await finishStudioImport({ dataDir, kv, migrate, migrations: MIGRATIONS, log, firstLoad })).toBeNull();
    }
    expect(existsSync(importDir(dataDir))).toBe(false);
    expect(readdirSync(studio).sort()).toEqual(before);
    expect(readFileSync(join(studio, "data.db")).equals(dbBefore)).toBe(true);
    expect(Object.fromEntries(kv.values)).toEqual(OUR_KV);
    expect(migrate).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("does nothing when the data dir has no Studio folder yet (a brand-new install)", async () => {
    const dataDir = temp("studio-no-folder-");
    const kv = memoryKv();
    const log = { info: vi.fn(), warn: vi.fn() };
    expect(await finishStudioImport({ dataDir, kv, migrate: () => { throw new Error("not called"); }, migrations: MIGRATIONS, log, firstLoad: true })).toBeNull();
    expect(readdirSync(dataDir)).toEqual([]);
    expect(kv.values.size).toBe(0);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("swaps the data, keeps this install's set aside and its secrets in place, and leaves every Bot stopped", async () => {
    const x = await staged();
    const journal = await x.start();
    expect(journal).toMatchObject({ state: "applied", error: null, stopped: { bots: 2, runners: 1, automations: 2 } });
    const db = openStudio(x.dataDir);
    expect(rows(db, "SELECT id, state FROM bots ORDER BY id")).toEqual([{ id: "bot_main", state: "stopped" }, { id: "bot_two", state: "stopped" }]);
    expect(rows(db, "SELECT COUNT(*) AS n FROM triggers WHERE state = 'on' AND owner_id != 'tick'")).toEqual([{ n: 0 }]);
    db.close();
    expect(readFileSync(join(x.studio, "talk", "rec.txt"), "utf8")).toBe("bb's recording");
    expect(readFileSync(join(x.studio, "secrets", "key"), "utf8")).toBe("our secret");
    expect(existsSync(join(x.studio, "artifacts"))).toBe(false);
    expect(JSON.parse(readFileSync(join(x.studio, "onboarding.json"), "utf8"))).toMatchObject({ state: "done", reason: "import" });
    const before = importPath(x.dataDir, BEFORE_DIR);
    expect(readdirSync(before).sort()).toEqual(expect.arrayContaining(["artifacts", "data.db", "onboarding.json"]));
    expect(mode(before)).toBe(0o700);
    expect(mode(importDir(x.dataDir))).toBe(0o700);
    expect(mode(importPath(x.dataDir, BEFORE_KV_FILE))).toBe(0o600);
    expect(JSON.parse(readFileSync(importPath(x.dataDir, BEFORE_KV_FILE), "utf8")).plugin_kv).toEqual([{ key: "rail:layout", value: '["ours"]' }, { key: SETTINGS_KV_KEY, value: '{"theme":"ours"}' }]);
    // bb's kv: the skill registry's approval not carried, settings and chat links kept.
    expect(Object.fromEntries(x.kv.values)).toEqual({ [SETTINGS_KV_KEY]: { loopsEnabled: true, theme: "bb" }, "link:pages:pg_1": { threadId: "thr_conv", at: 1 } });
    expect(existsSync(x.stagedDir)).toBe(false);
    expect(existsSync(importPath(x.dataDir, BB_KV_FILE))).toBe(false);
    // A second start changes nothing.
    expect(await x.start()).toMatchObject({ state: "applied" });
  });

  it("makes the brought-over Bots this install's: none is in bb on a BB Studio copy, even with the set-aside data deleted", async () => {
    const x = await staged();
    writeFileSync(join(x.dataDir, "fork-import.json"), JSON.stringify({ version: 1, sourceDataDir: "/Users/x/.bb", importedAt: Date.now() + 60_000 }));
    expect(readImportedAt(x.dataDir)).not.toBeNull();
    await x.start();
    expect(JSON.parse(readFileSync(join(x.studio, FROM_BB_FILE), "utf8"))).toMatchObject({ version: 1 });
    expect(studioDataFromBb(x.dataDir)).toBe(true);
    expect(readImportedAt(x.dataDir)).toBeNull();
    rmSync(importDir(x.dataDir), { recursive: true });
    expect(readImportedAt(x.dataDir)).toBeNull();
  });

  it("takes the marker away with bb's data when the old data is put back", async () => {
    const x = await staged();
    await x.start();
    writeJournal(x.dataDir, { ...(readJournal(x.dataDir) as ImportJournal), state: "restore-requested" });
    await x.start();
    expect(existsSync(join(x.studio, FROM_BB_FILE))).toBe(false);
    expect(readdirSync(importPath(x.dataDir, REPLACED_DIR))).toContain(FROM_BB_FILE);
    expect(studioDataFromBb(x.dataDir)).toBe(false);
  });

  it("archives this install's own Main once the swap applies, unarchives it at a put-back, and retries what failed", async () => {
    const x = await staged();
    const calls: string[] = [];
    let refuse = true;
    const threads = {
      archive: async (threadId: string) => { calls.push(`archive ${threadId}`); if (refuse) throw new Error("host offline"); return {}; },
      unarchive: async (threadId: string) => { calls.push(`unarchive ${threadId}`); return {}; },
    };
    const first = await x.start({ threads });
    expect(first).toMatchObject({ state: "applied", replacedThreads: ["thr_1"], replacedArchived: false });
    expect(calls).toEqual(["archive thr_1"]);
    refuse = false;
    expect(await x.start({ threads })).toMatchObject({ state: "applied", replacedArchived: true });
    expect(await x.start({ threads })).toMatchObject({ replacedArchived: true });
    expect(calls).toEqual(["archive thr_1", "archive thr_1"]);
    writeJournal(x.dataDir, { ...(readJournal(x.dataDir) as ImportJournal), state: "restore-requested" });
    expect(await x.start({ threads })).toMatchObject({ state: "restored", replacedArchived: false });
    expect(calls.at(-1)).toBe("unarchive thr_1");
  });

  it("archives only this install's Mains, never a project lead, worker, task or chat thread its data names", async () => {
    const dir = temp("studio-replaced-");
    const h = host();
    const install = new Database(join(dir, "install.db"));
    h.bb.storage.migrate(install, MIGRATIONS);
    install.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES ('bot_main', 'A', 'a', 'active', NULL, 0, 1, 1)").run();
    const lead = install.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES (?, ?, 1, 1)");
    lead.run(PERSONAL_PROJECT_ID, "thr_ownmain");
    lead.run("proj_code", "thr_codelead");
    const bt = install.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, owner_conversation_id, source, created_at, updated_at) VALUES (?, 'bot_main', ?, ?, ?, 'studio', 1, 1)");
    bt.run("thr_ownmain", "conversation", 1, null);
    bt.run("thr_conv", "conversation", 0, null);
    bt.run("thr_worker", "worker", 0, "thr_conv");
    install.prepare("INSERT INTO tasks (id, record, owner, state, origin, conversation, created_at, updated_at) VALUES ('task_1', ?, 'cos', 'todo', 'task', 'thr_task', 1, 1)").run(JSON.stringify({ workers: ["thr_taskworker"] }));
    install.prepare("INSERT INTO chats (thread_id, page_id, created_at) VALUES ('thr_chat', 'pg_1', 1)").run();
    install.close();
    const { db } = await bbStudio(join(dir, "bb.db"), h);
    db.close();
    expect(replacedMainThreads(join(dir, "install.db"), join(dir, "bb.db"))).toEqual(["thr_ownmain"]);
  });

  it("puts the old data back when asked, keeping bb's in a folder", async () => {
    const x = await staged();
    await x.start();
    const journal = readJournal(x.dataDir) as ImportJournal;
    writeJournal(x.dataDir, { ...journal, state: "restore-requested" });
    expect(await x.start()).toMatchObject({ state: "restored", error: null });
    const db = openStudio(x.dataDir);
    expect(rows(db, "SELECT id, name FROM bots")).toEqual([{ id: BOT_ID, name: expect.not.stringMatching(/^Chief$/) }]);
    db.close();
    expect(readFileSync(join(x.studio, "artifacts", "ours.bin"), "utf8")).toBe("ours");
    expect(Object.fromEntries(x.kv.values)).toEqual(OUR_KV);
    expect(readdirSync(importPath(x.dataDir, REPLACED_DIR))).toEqual(expect.arrayContaining(["data.db", "talk"]));
    expect(existsSync(importPath(x.dataDir, BEFORE_DIR))).toBe(false);
  });

  it("refuses when this install has data of its own by then, and changes nothing", async () => {
    const x = await staged({ own: true });
    expect(await x.start()).toMatchObject({ state: "refused", error: expect.stringContaining("data of its own") });
    expect(readFileSync(join(x.studio, "artifacts", "ours.bin"), "utf8")).toBe("ours");
    expect(existsSync(join(x.stagedDir, "data.db"))).toBe(true);
    expect(Object.fromEntries(x.kv.values)).toEqual(OUR_KV);
  });

  it("refuses data from a newer BB Studio, and data whose migrations don't match", async () => {
    const x = await staged();
    const db = new Database(join(x.stagedDir, "data.db"));
    db.prepare("INSERT INTO _bb_migrations (id, applied_at, statement_hash) VALUES (?, 1, 'later')").run(MIGRATIONS.length);
    db.close();
    expect(await x.start()).toMatchObject({ state: "refused", error: expect.stringContaining("newer BB Studio") });
    const y = await staged();
    const other = new Database(join(y.stagedDir, "data.db"));
    other.prepare("UPDATE _bb_migrations SET statement_hash = 'changed' WHERE id = 3").run();
    other.close();
    expect(await y.start()).toMatchObject({ state: "refused", error: expect.stringContaining("doesn't match") });
    expect(readFileSync(join(y.studio, "artifacts", "ours.bin"), "utf8")).toBe("ours");
  });

  it("finishes a swap a crash left halfway", async () => {
    // This install's data moved out and one of bb's files moved in when "the process" stopped.
    const y = await staged();
    const journal = readJournal(y.dataDir) as ImportJournal;
    const before = importPath(y.dataDir, BEFORE_DIR);
    mkdirSync(before, { recursive: true, mode: 0o700 });
    writeFileSync(importPath(y.dataDir, BEFORE_KV_FILE), JSON.stringify({ plugin_kv: [{ key: "rail:layout", value: '["ours"]' }] }), { mode: 0o600 });
    for (const name of readdirSync(y.studio)) if (name !== "secrets" && name !== "import-staged") renameFile(join(y.studio, name), join(before, name));
    renameFile(join(y.stagedDir, "talk"), join(y.studio, "talk"));
    writeJournal(y.dataDir, { ...journal, state: "applying", phase: "in", incoming: ["data.db", "onboarding.json", "talk"] });
    expect(await y.start()).toMatchObject({ state: "applied", error: null });
    expect(readdirSync(y.studio).sort()).toEqual(["data.db", "import-staged", "onboarding.json", "secrets", "talk"]);
    expect(Object.fromEntries(y.kv.values)).toMatchObject({ "link:pages:pg_1": { threadId: "thr_conv", at: 1 } });
  });

  it("rolls back when the swap fails, and keeps everything with its folder named when the rollback fails too", async () => {
    const x = await staged();
    expect(await x.start({ kv: memoryKv(OUR_KV, "link:pages:pg_1") })).toMatchObject({ state: "failed", error: expect.stringContaining("back as it was") });
    expect(readFileSync(join(x.studio, "artifacts", "ours.bin"), "utf8")).toBe("ours");
    expect(existsSync(join(x.stagedDir, "data.db"))).toBe(true);
    expect(existsSync(importPath(x.dataDir, BEFORE_DIR))).toBe(false);

    const y = await staged();
    const journal = readJournal(y.dataDir) as ImportJournal;
    const before = importPath(y.dataDir, BEFORE_DIR);
    mkdirSync(before, { recursive: true, mode: 0o700 });
    writeFileSync(importPath(y.dataDir, BEFORE_KV_FILE), JSON.stringify({ plugin_kv: [] }), { mode: 0o600 });
    for (const name of readdirSync(y.studio)) if (name !== "secrets" && name !== "import-staged") renameFile(join(y.studio, name), join(before, name));
    // Something made artifacts/ in Studio's folder after this install's data moved out, and the kv step then fails.
    mkdirSync(join(y.studio, "artifacts"));
    writeJournal(y.dataDir, { ...journal, state: "applying", phase: "in", incoming: ["data.db", "onboarding.json", "talk"] });
    const done = await y.start({ kv: memoryKv(OUR_KV, "link:pages:pg_1") });
    expect(done).toMatchObject({ state: "rollback-failed", undoing: "applying", error: expect.stringContaining(before) });
    expect(readFileSync(join(before, "artifacts", "ours.bin"), "utf8")).toBe("ours");
    expect(existsSync(join(y.stagedDir, "talk", "rec.txt"))).toBe(true);
    // Not touched again at the next start.
    expect(await y.start()).toMatchObject({ state: "rollback-failed" });
  });

  it("resumes a rollback a crash cut short, moving back only what the swap moved in", async () => {
    const x = await staged();
    const journal = readJournal(x.dataDir) as ImportJournal;
    const before = importPath(x.dataDir, BEFORE_DIR);
    mkdirSync(before, { recursive: true, mode: 0o700 });
    writeFileSync(importPath(x.dataDir, BEFORE_KV_FILE), JSON.stringify({ plugin_kv: [{ key: "rail:layout", value: '["ours"]' }] }), { mode: 0o600 });
    for (const name of readdirSync(x.studio)) if (name !== "secrets" && name !== "import-staged") renameFile(join(x.studio, name), join(before, name));
    for (const name of ["data.db", "talk"]) renameFile(join(x.stagedDir, name), join(x.studio, name));
    // This install's artifacts/ was already moved back before the crash; Studio also wrote a file of its own.
    renameFile(join(before, "artifacts"), join(x.studio, "artifacts"));
    writeFileSync(join(x.studio, "data.before-x.db"), "studio's own");
    writeJournal(x.dataDir, { ...journal, state: "rolling-back", undoing: "applying", phase: "kv", incoming: ["data.db", "onboarding.json", "talk"] });
    const kv = memoryKv({ [SETTINGS_KV_KEY]: { loopsEnabled: false, theme: "bb" } });
    expect(await x.start({ kv })).toMatchObject({ state: "failed", error: expect.stringContaining("back as it was") });
    expect(readFileSync(join(x.studio, "artifacts", "ours.bin"), "utf8")).toBe("ours");
    expect(readFileSync(join(x.studio, "data.before-x.db"), "utf8")).toBe("studio's own");
    expect(existsSync(join(x.stagedDir, "talk", "rec.txt"))).toBe(true);
    expect(existsSync(join(x.stagedDir, "data.db"))).toBe(true);
    const db = openStudio(x.dataDir);
    expect(rows(db, "SELECT COUNT(*) AS n FROM bots")).toEqual([{ n: 1 }]);
    db.close();
    expect(Object.fromEntries(kv.values)).toEqual({ "rail:layout": ["ours"] });
    expect(existsSync(before)).toBe(false);
  });

  it("leaves the journal alone when Studio is only reloaded, and applies it at the next real start", async () => {
    const x = await staged();
    expect(await x.start({ firstLoad: false })).toMatchObject({ state: "ready" });
    expect(readFileSync(join(x.studio, "artifacts", "ours.bin"), "utf8")).toBe("ours");
    expect(Object.fromEntries(x.kv.values)).toEqual(OUR_KV);
    expect(x.log.info).toHaveBeenCalledWith(expect.stringContaining("reloaded, not restarted"));
    expect(await x.start()).toMatchObject({ state: "applied" });
    const scope: Record<symbol, unknown> = {};
    expect([claimFirstLoad(scope), claimFirstLoad(scope)]).toEqual([true, false]);
  });
});

describe("Settings' view of it", () => {
  it("previews a staged copy: counts, threads, secrets that come along", async () => {
    const x = await staged();
    const preview = previewStaged(x.dataDir, MIGRATIONS)!;
    expect(preview).toMatchObject({ bots: 2, pages: 1, tasks: 1, minisWithSecrets: 1, watchersWithEnv: 1, problem: null });
    expect(preview.threads.wanted).toContain("thr_conv");
    const live = new Database(":memory:");
    x.h.bb.storage.migrate(live, MIGRATIONS);
    expect(studioDataStatus(x.dataDir, live, MIGRATIONS)).toMatchObject({ ownData: { has: false }, journal: { state: "ready" }, keptIn: null, preview: { bots: 2 } });
    live.close();
  });

  it("drops the registry approval in bb's key-value rows and keeps the settings as they are", () => {
    expect(prepareKv({ plugin_kv: [{ key: SKILLS_REGISTRY_KV_KEY, value: "true" }, { key: SETTINGS_KV_KEY, value: '{"theme":"bb"}' }] })).toEqual({ plugin_kv: [{ key: SETTINGS_KV_KEY, value: '{"theme":"bb"}' }], prepared: true });
  });
});
