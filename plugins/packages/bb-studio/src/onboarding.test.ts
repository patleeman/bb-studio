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
import { ONBOARDING_BOT_NAME, onboardingPrompt } from "./onboarding-prompt";
import { markWelcomeOpened, readFlag, readOnboarding, readyProvider, runOnboarding, welcomeThreadOf } from "./onboarding";
import { PERSONAL_PROJECT_ID, ProjectLeads } from "./project-lead";
import { testScheduler } from "./test/scheduler-fixture";

const dispose: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

type Thread = ReturnType<typeof makeThreadResponse>;

async function studio(threadList: string = "__automatic__") {
  const providerStates: { providerId: string; status: string; loginCommand: string | null }[] = [{ providerId: "claude-code", status: "not_installed", loginCommand: "claude /login" }, { providerId: "codex", status: "unauthenticated", loginCommand: "codex login" }, { providerId: "acp-omp", status: "ready", loginCommand: null }];
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
    providers: async () => providerStates,
    createBot: async (input) => { const made = (await bots.create({ ...input, promptHidden: true })).bot!; return { id: made.id, threadId: made.threadId ?? null }; },
    now: () => 1_000,
  });
  const connect = (providerId: string) => { for (const state of providerStates) if (state.providerId === providerId) state.status = "ready"; };
  return { dataDir, db, bots, store, leads, run, connect, spawns, turns, queued, prefs };
}

function bbDatabase(dataDir: string, threadIds: string[]) {
  const bb = new Database(join(dataDir, "bb.db"));
  bb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT)");
  for (const id of threadIds) bb.prepare("INSERT INTO threads VALUES (?, ?)").run(id, "Imported");
  bb.close();
}

describe("first-run onboarding", () => {
  it("waits for a connected provider, then makes the Bot and starts its first chat on Main on that provider", async () => {
    const env = await studio();
    bbDatabase(env.dataDir, []);
    expect(await env.run()).toEqual({ version: 1, state: "waiting", at: 1_000 });
    expect(env.spawns).toEqual([]);
    expect(env.bots.list()).toEqual([]);
    expect(readOnboarding(env.dataDir)).toBeNull();
    expect(await env.run()).toMatchObject({ state: "waiting" });
    env.connect("codex");
    const flag = await env.run();
    expect(flag).toMatchObject({ state: "done", reason: "ran", botId: BOT_ID, welcomeThreadId: "thr_1", opened: false });
    const bot = env.bots.stored(BOT_ID)!;
    expect(bot.name).toBe(ONBOARDING_BOT_NAME);
    expect(bot.threadId).toBe("thr_1");
    expect(env.leads.storedLead(PERSONAL_PROJECT_ID)).toBe("thr_1");
    expect(env.spawns).toHaveLength(1);
    expect(env.spawns[0]).toMatchObject({ providerId: "codex", pluginMetadata: { bot: BOT_ID } });
    expect(env.spawns[0]!.sendAt).toBeUndefined();
    expect(env.spawns[0]!.input).toEqual([{ type: "text", text: onboardingPrompt(ONBOARDING_BOT_NAME), mentions: [], visibility: "agent-only" }]);
    expect(env.turns).toEqual(["thr_1"]);
    expect(env.queued.size).toBe(0);
    expect((env.db.prepare("SELECT count(*) AS n FROM bot_threads WHERE kind = 'conversation' AND is_main = 0").get() as { n: number }).n).toBe(0);
    expect(welcomeThreadOf(env.dataDir)).toEqual({ threadId: "thr_1", botId: BOT_ID, opened: false });
    expect(markWelcomeOpened(env.dataDir)).toBe(true);
    expect(markWelcomeOpened(env.dataDir)).toBe(false);
    expect(env.prefs.get("sidebar.threadListProvider")).toEqual({ value: "studio/everything", revision: 2 });
  });

  it("keeps waiting after the user makes threads before connecting", async () => {
    const env = await studio();
    expect(await env.run()).toMatchObject({ state: "waiting" });
    bbDatabase(env.dataDir, ["thr_early"]);
    env.connect("claude-code");
    expect(await env.run()).toMatchObject({ state: "done", reason: "ran" });
    expect(env.spawns[0]).toMatchObject({ providerId: "claude-code" });
  });

  it("prefers Claude Code, then Codex, then any signed-in provider, and never one that can't say it is signed in", () => {
    const login = "login";
    expect(readyProvider([{ providerId: "codex", status: "ready", loginCommand: login }, { providerId: "claude-code", status: "ready", loginCommand: login }])).toBe("claude-code");
    expect(readyProvider([{ providerId: "pi", status: "ready", loginCommand: login }, { providerId: "codex", status: "ready", loginCommand: login }])).toBe("codex");
    expect(readyProvider([{ providerId: "pi", status: "ready", loginCommand: login }])).toBe("pi");
    expect(readyProvider([{ providerId: "codex", status: "unauthenticated", loginCommand: login }])).toBeNull();
    expect(readyProvider([{ providerId: "acp-omp", status: "ready", loginCommand: null }])).toBeNull();
  });

  it("does nothing on a later start", async () => {
    const env = await studio();
    env.connect("codex");
    const first = await env.run();
    const second = await env.run();
    expect(second).toEqual(first);
    expect(env.spawns).toHaveLength(1);
    expect(env.bots.list()).toHaveLength(1);
  });

  it("leaves a thread list the user chose", async () => {
    const env = await studio("thread-list/thread-list");
    env.connect("codex");
    await env.run();
    expect(env.prefs.get("sidebar.threadListProvider")?.value).toBe("thread-list/thread-list");
  });

  it("never runs on an imported data dir, and marks it done", async () => {
    for (const marker of ["fork-import.json", "fork-import.db"]) {
      const env = await studio();
      writeFileSync(join(env.dataDir, marker), marker.endsWith(".json") ? JSON.stringify({ version: 1, sourceDataDir: "/nowhere" }) : "");
      env.connect("codex");
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
    env.connect("codex");
    expect(await env.run()).toMatchObject({ reason: "threads" });
    expect(env.spawns).toEqual([]);
    expect(env.bots.list()).toEqual([]);
  });

  it("never runs on a data dir that already has Bots, and marks it done", async () => {
    const env = await studio();
    env.db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES (?, 'Dot', '🤖', 'active', 'thr_main', 0, 1, 1)").run(BOT_ID);
    env.connect("codex");
    expect(await env.run()).toMatchObject({ reason: "bots" });
    expect(env.spawns).toEqual([]);
    expect(env.bots.list().map((bot) => bot.name)).toEqual(["Dot"]);
    expect(readFlag(env.dataDir)).toMatchObject({ state: "done", reason: "bots" });
  });

  it("makes nothing once Studio's database is closed", async () => {
    const env = await studio();
    env.connect("codex");
    env.db.close();
    await env.run().catch(() => null);
    expect(env.spawns).toEqual([]);
  });
});

describe("the first-chat prompt", () => {
  it("asks for a short chat that personalizes through the Bot's own tools, then hands off", () => {
    const prompt = onboardingPrompt("Assistant");
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
