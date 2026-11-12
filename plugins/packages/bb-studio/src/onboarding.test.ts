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
import { STARTER_BOT, starterFirstChatPrompt } from "./starter-bot";
import { markWelcomeOpened, readFlag, readOnboarding, readyProvider, runOnboarding, welcomeThreadOf } from "./onboarding";
import { PERSONAL_PROJECT_ID, ProjectLeads } from "./project-lead";
import { testScheduler } from "./test/scheduler-fixture";

const dispose: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

type Thread = ReturnType<typeof makeThreadResponse>;

async function studio(threadList: string = "__automatic__", options: { refuseIdle?: boolean; idleThreads?: boolean } = {}) {
  const providerStates: { providerId: string; status: string; loginCommand: string | null }[] = [{ providerId: "claude-code", status: "not_installed", loginCommand: "claude /login" }, { providerId: "codex", status: "unauthenticated", loginCommand: "codex login" }, { providerId: "acp-omp", status: "ready", loginCommand: null }];
  const prefs = new Map<string, { value: unknown; revision: number }>([["sidebar.threadListProvider", { value: threadList, revision: 1 }]]);
  const dataDir = mkdtempSync(join(tmpdir(), "studio-onboarding-"));
  dispose.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const threads = new Map<string, Thread>();
  const queued = new Map<string, { id: string; threadId: string }>();
  const spawns: Record<string, unknown>[] = [];
  const turns: string[] = [];
  const sends: { threadId: string; input: unknown }[] = [];
  const deleted: string[] = [];
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
        const idle = Array.isArray(args.input) && args.input.length === 0;
        if (idle && options.refuseIdle) throw new Error("Invalid request: input must contain at least one entry");
        spawns.push(args);
        const id = `thr_${spawns.length}`;
        const thread = { ...makeThreadResponse({ id, projectId: String(args.projectId), title: String(args.title), status: idle ? "pending" : "active" }), providerId: String(args.providerId ?? "codex"), queuedMessageCount: 0 };
        threads.set(id, thread as Thread);
        if (!idle) turns.push(id);
        return thread;
      }) as never,
      send: (async ({ threadId, input }: { threadId: string; input: unknown }) => {
        sends.push({ threadId, input });
        turns.push(threadId);
        threads.set(threadId, { ...threads.get(threadId)!, status: "active" } as Thread);
        return {};
      }) as never,
      delete: (async ({ threadId }: { threadId: string }) => { deleted.push(threadId); threads.delete(threadId); return {}; }) as never,
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
    providers: async () => providerStates,
    seedBot: (input) => bots.seedStarter(input),
    startFirstChat: (input) => bots.startFirstChat(input),
    ...(options.idleThreads === undefined ? {} : { idleThreads: options.idleThreads }),
    now: () => 1_000,
  });
  const connect = (providerId: string) => { for (const state of providerStates) if (state.providerId === providerId) state.status = "ready"; };
  return { dataDir, db, bots, store, leads, run, connect, spawns, turns, queued, prefs, sends, deleted, threads };
}

function bbDatabase(dataDir: string, threadIds: string[]) {
  const bb = new Database(join(dataDir, "bb.db"));
  bb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT)");
  for (const id of threadIds) bb.prepare("INSERT INTO threads VALUES (?, ?)").run(id, "Imported");
  bb.close();
}

describe("first-run onboarding", () => {
  const hidden = (text: string) => [{ type: "text", text, mentions: [], visibility: "agent-only" }];

  it("seeds the starter Bot with an idle Main, and starts its first chat there once a provider is connected", async () => {
    const env = await studio();
    bbDatabase(env.dataDir, []);
    const seeded = await env.run();
    expect(seeded).toEqual({ version: 1, state: "seeded", at: 1_000, botId: BOT_ID, welcomeThreadId: "thr_1", opened: false });
    const bot = env.bots.stored(BOT_ID)!;
    expect(bot.name).toBe(STARTER_BOT.name);
    expect(bot.threadId).toBe("thr_1");
    expect(env.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("thr_1");
    expect(env.spawns).toEqual([expect.objectContaining({ title: STARTER_BOT.name, input: [], pluginMetadata: { bot: BOT_ID } })]);
    expect(env.turns).toEqual([]);
    expect(env.prefs.get("sidebar.threadListProvider")).toEqual({ value: "studio/everything", revision: 2 });
    expect(welcomeThreadOf(env.dataDir)).toEqual({ threadId: "thr_1", botId: BOT_ID, opened: false });
    expect(await env.run()).toEqual(seeded);
    expect(env.bots.list()).toHaveLength(1);

    env.connect("codex");
    const done = await env.run();
    expect(done).toMatchObject({ state: "done", reason: "ran", botId: BOT_ID, welcomeThreadId: "thr_1", opened: false });
    expect(env.sends).toEqual([{ threadId: "thr_1", input: hidden(starterFirstChatPrompt(STARTER_BOT.name)) }]);
    expect(env.spawns).toHaveLength(1);
    expect(env.turns).toEqual(["thr_1"]);
    expect((env.db.prepare("SELECT count(*) AS n FROM bot_threads WHERE kind = 'conversation' AND is_main = 0").get() as { n: number }).n).toBe(0);
    expect(markWelcomeOpened(env.dataDir)).toBe(true);
    expect(markWelcomeOpened(env.dataDir)).toBe(false);
  });

  it("moves Main to the connected provider when it was made on another, never deleting the Main the user opened, and opens the new one", async () => {
    const env = await studio();
    await env.run();
    expect(markWelcomeOpened(env.dataDir)).toBe(true);
    env.connect("claude-code");
    const done = await env.run();
    expect(done).toMatchObject({ state: "done", reason: "ran", welcomeThreadId: "thr_2", opened: false });
    expect(env.spawns[1]).toMatchObject({ providerId: "claude-code", input: hidden(starterFirstChatPrompt(STARTER_BOT.name)), pluginMetadata: { handoffFrom: "thr_1" } });
    expect(env.deleted).toEqual([]);
    expect(env.threads.has("thr_1")).toBe(true);
    expect(env.bots.stored(BOT_ID)!.threadId).toBe("thr_2");
    expect(env.bots.list()).toHaveLength(1);
    expect(welcomeThreadOf(env.dataDir)).toEqual({ threadId: "thr_2", botId: BOT_ID, opened: false });
  });

  it("keeps the user's open of Main when it lands while the first chat starts", async () => {
    const env = await studio();
    await env.run();
    const send = env.bots.startFirstChat.bind(env.bots);
    env.bots.startFirstChat = async (input) => { markWelcomeOpened(env.dataDir); return await send(input); };
    env.connect("codex");
    expect(await env.run()).toMatchObject({ state: "done", reason: "ran", welcomeThreadId: "thr_1", opened: true });
  });

  it("on a BB that can't make an idle thread, marks onboarding done once instead of retrying", async () => {
    const stock = await studio("__automatic__", { idleThreads: false });
    expect(await stock.run()).toMatchObject({ state: "done", reason: "unsupported", botId: null, welcomeThreadId: null, opened: true });
    expect(stock.spawns).toEqual([]);
    const refused = await studio("__automatic__", { refuseIdle: true });
    expect(await refused.run()).toMatchObject({ state: "done", reason: "unsupported" });
    expect(readFlag(refused.dataDir)).toMatchObject({ state: "done", reason: "unsupported" });
    expect(await refused.run()).toMatchObject({ reason: "unsupported" });
    expect(refused.bots.list()).toEqual([]);
    expect(refused.prefs.get("sidebar.threadListProvider")?.value).toBe("__automatic__");
  });

  it("after a failed seed, gives no starter Bot to a user who started threads meanwhile", async () => {
    const env = await studio();
    const seed = env.bots.seedStarter.bind(env.bots);
    let fail = true;
    env.bots.seedStarter = async (input) => { if (fail) throw new Error("host not connected"); return await seed(input); };
    await expect(env.run()).rejects.toThrow("host not connected");
    expect(readFlag(env.dataDir)).toMatchObject({ state: "waiting" });
    fail = false;
    bbDatabase(env.dataDir, ["thr_mine"]);
    expect(await env.run()).toMatchObject({ state: "done", reason: "threads" });
    expect(env.bots.list()).toEqual([]);
  });

  it("leaves Main alone when the user already wrote in it", async () => {
    const env = await studio();
    await env.run();
    env.threads.set("thr_1", { ...env.threads.get("thr_1")!, status: "active" } as never);
    env.connect("codex");
    expect(await env.run()).toMatchObject({ state: "done", reason: "ran", welcomeThreadId: "thr_1" });
    expect(env.sends).toEqual([]);
  });

  it("keeps the starter Bot through threads the user makes before connecting", async () => {
    const env = await studio();
    await env.run();
    bbDatabase(env.dataDir, ["thr_early"]);
    env.connect("codex");
    expect(await env.run()).toMatchObject({ state: "done", reason: "ran" });
  });

  it("prefers Claude Code, then Codex, then any signed-in provider, and never one that can't say it is signed in", () => {
    const login = "login";
    expect(readyProvider([{ providerId: "codex", status: "ready", loginCommand: login }, { providerId: "claude-code", status: "ready", loginCommand: login }])).toBe("claude-code");
    expect(readyProvider([{ providerId: "pi", status: "ready", loginCommand: login }, { providerId: "codex", status: "ready", loginCommand: login }])).toBe("codex");
    expect(readyProvider([{ providerId: "pi", status: "ready", loginCommand: login }])).toBe("pi");
    expect(readyProvider([{ providerId: "codex", status: "unauthenticated", loginCommand: login }])).toBeNull();
    expect(readyProvider([{ providerId: "acp-omp", status: "ready", loginCommand: null }])).toBeNull();
  });

  it("never seeds a second Bot", async () => {
    const env = await studio();
    expect(await env.run()).toMatchObject({ state: "seeded" });
    writeFileSync(join(env.dataDir, "plugins", "studio", "onboarding.json"), JSON.stringify({ version: 1, state: "waiting", at: 1 }));
    expect(await env.run()).toMatchObject({ state: "done", reason: "bots" });
    expect(env.bots.list()).toHaveLength(1);
    expect(env.spawns).toHaveLength(1);
  });

  it("leaves a thread list the user chose", async () => {
    const env = await studio("thread-list/thread-list");
    await env.run();
    expect(env.prefs.get("sidebar.threadListProvider")?.value).toBe("thread-list/thread-list");
  });

  it("never runs on an imported data dir, and marks it done", async () => {
    for (const marker of ["fork-import.json", "fork-import.db"]) {
      const env = await studio();
      writeFileSync(join(env.dataDir, marker), marker.endsWith(".json") ? JSON.stringify({ version: 1, sourceDataDir: "/nowhere" }) : "");
      env.connect("codex");
      expect(await env.run()).toMatchObject({ reason: "import", botId: null, welcomeThreadId: null, opened: true });
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
    expect(readFlag(env.dataDir)).toMatchObject({ state: "done", reason: "bots" });
  });

  it("makes nothing once Studio's database is closed", async () => {
    const env = await studio();
    env.db.close();
    await env.run().catch(() => null);
    expect(env.spawns).toEqual([]);
  });
});

describe("the first-chat prompt", () => {
  it("asks for a short chat that personalizes through the Bot's own tools, then hands off", () => {
    const prompt = starterFirstChatPrompt("Assistant");
    expect(prompt).toContain("You are Assistant");
    for (const tool of ["presence_list", "theme_list", "presence_apply", "theme_apply", "bot_set"]) expect(prompt).toContain(tool);
    expect(prompt).toMatch(/two to four exchanges/);
    expect(prompt).toMatch(/skip/);
  });
});

describe("the Accounts and Edit space links", () => {
  it("resolve through the link router", async () => {
    const opened: string[] = [];
    const deps = { inMain: () => true, action: (action: string) => { opened.push(action); return true; } } as unknown as LinkDeps;
    for (const link of ["bb://edit-space", "bb://accounts"]) {
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
