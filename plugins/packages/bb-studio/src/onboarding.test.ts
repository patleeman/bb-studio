import Database from "better-sqlite3";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BOT_ID, Bots } from "./bot";
import { BotThreads } from "./bot-threads";
import { runLinkAction, setLinkActionHandler } from "./links/actions";
import { openLink, parseLink, type LinkDeps } from "./links/router";
import { MIGRATIONS } from "./migrations";
import { ACCOUNTS_LINK, EDIT_SPACE_LINK, WELCOME_BOT_NAME, WELCOME_TITLE, welcomeLinks, welcomeText } from "./onboarding-message";
import { markWelcomeOpened, readOnboarding, runOnboarding, welcomeThreadOf } from "./onboarding";
import { PERSONAL_PROJECT_ID, ProjectLeads } from "./project-lead";
import { testScheduler } from "./test/scheduler-fixture";

const dispose: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

type Thread = ReturnType<typeof makeThreadResponse>;

async function studio(threadList: string = "__automatic__", options: { hostDownFor?: number; noProvider?: boolean } = {}) {
  let hostDown = options.hostDownFor ?? 0;
  const sleeps: number[] = [];
  const prefs = new Map<string, { value: unknown; revision: number }>([["sidebar.threadListProvider", { value: threadList, revision: 1 }]]);
  const dataDir = mkdtempSync(join(tmpdir(), "studio-onboarding-"));
  dispose.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const threads = new Map<string, Thread>();
  const queued = new Map<string, { id: string; threadId: string }>();
  const spawns: Record<string, unknown>[] = [];
  const turns: string[] = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    system: {
      uiPreferences: {
        list: (async () => ({ preferences: Object.fromEntries(prefs) })) as never,
        set: (async ({ key, value, expectedRevision }: { key: string; value: unknown; expectedRevision: number }) => {
          const current = prefs.get(key);
          if (current && current.revision !== expectedRevision) throw new Error("stale revision");
          prefs.set(key, { value, revision: expectedRevision + 1 });
          return {};
        }) as never,
      },
    },
    threads: {
      spawn: (async (args: Record<string, unknown>) => {
        if (hostDown > 0) { hostDown--; throw Object.assign(new Error("Host is not connected"), { code: "host_unavailable" }); }
        if (options.noProvider && args.model === undefined) throw Object.assign(new Error("Unable to load acp-hermes-agent models to resolve the default."), { code: "model_catalog_unavailable" });
        spawns.push(args);
        const id = `thr_${spawns.length}`;
        const thread = makeThreadResponse({ id, projectId: String(args.projectId), title: String(args.title), status: "pending" });
        threads.set(id, thread);
        if (typeof args.sendAt === "number") queued.set(`q_${id}`, { id: `q_${id}`, threadId: id });
        else turns.push(id);
        return thread;
      }) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("Not found"), { status: 404 }); return thread; }) as never,
      list: (async () => [...threads.values()]) as never,
      defaultExecutionOptions: (async () => ({ model: "model" })) as never,
      queuedMessages: {
        list: (async ({ threadId }: { threadId: string }) => [...queued.values()].filter((row) => row.threadId === threadId)) as never,
        delete: (async ({ queuedMessageId }: { queuedMessageId: string }) => { queued.delete(queuedMessageId); return {}; }) as never,
      },
    },
  } as never });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const leads = new ProjectLeads({ db, sdk: bb.sdk, scheduler: testScheduler(db, bb.sdk).scheduler, changed: () => {}, personalPrompt: () => "", botPrompt: () => null });
  const bots = new Bots({ db, sdk: bb.sdk, leads, changed: () => {}, presenceChanged: () => {} });
  const store = new BotThreads({ db, sdk: bb.sdk, signals: () => ({ bots: [], focusedBotId: null, sideThread: () => null, runnerBot: () => null, leadThreads: new Set(), internal: new Set(), managedBot: () => null }), changed: () => {} });
  const run = () => runOnboarding({
    dataDir, db, sdk: bb.sdk as never,
    createBot: async (input) => (await bots.create(input)).bot!,
    recordConversation: (threadId, botId) => { store.recordConversation(threadId, botId); },
    now: () => 1_000,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { dataDir, db, bots, store, leads, run, spawns, turns, queued, prefs, sleeps };
}

function bbDatabase(dataDir: string, threadIds: string[]) {
  const bb = new Database(join(dataDir, "bb.db"));
  bb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT)");
  for (const id of threadIds) bb.prepare("INSERT INTO threads VALUES (?, ?)").run(id, "Imported");
  bb.close();
}

describe("first-run onboarding", () => {
  it("on a fresh data dir makes the Bot, the Welcome conversation and its message once, with no turn, and sets the flag", async () => {
    const env = await studio();
    bbDatabase(env.dataDir, []);
    const flag = await env.run();
    expect(flag).toMatchObject({ state: "done", reason: "ran", botId: BOT_ID, opened: false });
    const bot = env.bots.stored(BOT_ID)!;
    expect(bot.name).toBe(WELCOME_BOT_NAME);
    expect(env.spawns.map((each) => each.title)).toEqual([WELCOME_BOT_NAME, WELCOME_TITLE]);
    expect(env.spawns.every((each) => each.projectId === PERSONAL_PROJECT_ID && typeof each.sendAt === "number")).toBe(true);
    expect(env.turns).toEqual([]);
    expect(env.queued.size).toBe(0);
    expect(bot.threadId).toBe("thr_1");
    expect(env.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("thr_1");
    expect(env.store.get("thr_2")).toMatchObject({ botId: BOT_ID, kind: "conversation", isMain: false });
    expect(env.spawns[1]!.pluginMetadata).toEqual({ botConversation: BOT_ID });
    expect(env.bots.presenceOf(BOT_ID)).toBeTruthy();
    expect(bot.appearance ?? null).toBeNull();
    expect(welcomeThreadOf(env.dataDir)).toEqual({ threadId: "thr_2", botId: BOT_ID, opened: false });
    expect(readOnboarding(env.dataDir)).toEqual(flag);
    expect(markWelcomeOpened(env.dataDir)).toBe(true);
    expect(markWelcomeOpened(env.dataDir)).toBe(false);
    expect(welcomeThreadOf(env.dataDir)?.opened).toBe(true);
    expect(env.prefs.get("sidebar.threadListProvider")).toEqual({ value: "studio/everything", revision: 2 });
  });

  it("waits for the host to connect, and starts on Claude Code's default model when no provider can name one", async () => {
    const env = await studio("__automatic__", { hostDownFor: 3, noProvider: true });
    const flag = await env.run();
    expect(flag).toMatchObject({ reason: "ran", welcomeThreadId: "thr_2" });
    expect(env.sleeps).toEqual([5_000, 5_000, 5_000]);
    expect(env.spawns.map((each) => [each.title, each.providerId, each.model])).toEqual([
      [WELCOME_BOT_NAME, "claude-code", "default"],
      [WELCOME_TITLE, "claude-code", "default"],
    ]);
    expect(env.turns).toEqual([]);
  });

  it("stops waiting when Studio stops, without making anything", async () => {
    const env = await studio("__automatic__", { hostDownFor: 2 });
    const first = env.run().catch((error: Error) => error);
    env.db.close();
    expect(await first).toBeInstanceOf(Error);
    expect(env.spawns).toEqual([]);
    expect(readOnboarding(env.dataDir)).toBeNull();
  });

  it("leaves a thread list the user chose", async () => {
    const env = await studio("thread-list/thread-list");
    await env.run();
    expect(env.prefs.get("sidebar.threadListProvider")?.value).toBe("thread-list/thread-list");
  });

  it("does nothing on a second start", async () => {
    const env = await studio();
    const first = await env.run();
    const second = await env.run();
    expect(second).toEqual(first);
    expect(env.spawns).toHaveLength(2);
    expect(env.bots.list()).toHaveLength(1);
    expect((env.db.prepare("SELECT count(*) AS n FROM bot_threads WHERE kind = 'conversation' AND is_main = 0").get() as { n: number }).n).toBe(1);
  });

  it("never runs on an imported data dir, and marks it done", async () => {
    for (const marker of ["fork-import.json", "fork-import.db"]) {
      const env = await studio();
      writeFileSync(join(env.dataDir, marker), marker.endsWith(".json") ? JSON.stringify({ version: 1, sourceDataDir: "/nowhere" }) : "");
      const flag = await env.run();
      expect(flag).toMatchObject({ reason: "import", botId: null, welcomeThreadId: null, opened: true });
      expect(env.spawns).toEqual([]);
      expect(env.bots.list()).toEqual([]);
      expect(readOnboarding(env.dataDir)?.reason).toBe("import");
      expect(welcomeThreadOf(env.dataDir)).toBeNull();
      expect(env.prefs.get("sidebar.threadListProvider")?.value).toBe("__automatic__");
    }
  });

  it("never runs on a data dir with threads from before, and marks it done", async () => {
    const env = await studio();
    bbDatabase(env.dataDir, ["thr_old"]);
    expect(await env.run()).toMatchObject({ reason: "threads" });
    expect(env.spawns).toEqual([]);
    expect(env.bots.list()).toEqual([]);
  });

  it("never runs on a data dir that already has Bots, and marks it done", async () => {
    const env = await studio();
    env.db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES (?, 'Dot', '🤖', 'active', 'thr_main', 0, 1, 1)").run(BOT_ID);
    expect(await env.run()).toMatchObject({ reason: "bots" });
    expect(env.spawns).toEqual([]);
    expect(env.bots.list().map((bot) => bot.name)).toEqual(["Dot"]);
    expect(readOnboarding(env.dataDir)?.reason).toBe("bots");
  });
});

describe("the welcome message", () => {
  it("links Accounts and Edit space, and both resolve through the link router", async () => {
    expect(welcomeLinks()).toEqual([EDIT_SPACE_LINK, ACCOUNTS_LINK]);
    expect(welcomeText()).toContain(`[Accounts](${ACCOUNTS_LINK})`);
    expect(welcomeText()).toContain(`[Edit space](${EDIT_SPACE_LINK})`);
    const opened: string[] = [];
    const deps = { inMain: () => true, action: (action: string) => { opened.push(action); return true; } } as unknown as LinkDeps;
    for (const link of welcomeLinks()) {
      const target = parseLink(link);
      expect(target).toMatchObject({ type: "action", link });
      expect(await openLink(target!, { source: "transcript" }, deps)).toMatchObject({ via: "action", opened: true });
    }
    expect(opened).toEqual(["edit-space", "accounts"]);
    expect(parseLink("bb://Accounts/")).toMatchObject({ type: "action", action: "accounts" });
  });

  it("opens through the registered handlers, and reports when nothing can open it", () => {
    expect(runLinkAction("accounts")).toBe(false);
    let accounts = 0;
    const off = setLinkActionHandler("accounts", () => { accounts++; return true; });
    expect(runLinkAction("accounts")).toBe(true);
    expect(accounts).toBe(1);
    off();
    expect(runLinkAction("accounts")).toBe(false);
  });
});

describe("link action handlers", () => {
  it("use the latest handler while it is registered, then the one before", () => {
    const calls: string[] = [];
    const offHost = setLinkActionHandler("edit-space", () => { calls.push("host"); return true; });
    const offSidebar = setLinkActionHandler("edit-space", () => { calls.push("sidebar"); return true; });
    expect(runLinkAction("edit-space")).toBe(true);
    offSidebar();
    expect(runLinkAction("edit-space")).toBe(true);
    offHost();
    expect(runLinkAction("edit-space")).toBe(false);
    expect(calls).toEqual(["sidebar", "host"]);
  });
});
