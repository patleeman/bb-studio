import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { BotThreads, type Signals, type ThreadFacts } from "./bot-threads";
import { PING_TEXT } from "./bot-cache";
import { MainPushes, previewOf, type MainPushInput } from "./main-push";
import { quietByDefault, repliesAllowed, type PushLevel } from "./push-levels";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); vi.useRealTimers(); });

function signals(over: Partial<Signals> = {}): Signals {
  return {
    bots: [{ id: "bot_dot", threadId: "thr_main", chain: ["thr_main"] }],
    focusedBotId: null,
    sideThread: () => null,
    runnerBot: (id) => (id === "thr_runner" ? "bot_dot" : null),
    leadThreads: new Set(["thr_lead"]),
    internal: new Set(),
    managedBot: () => null,
    ...over,
  };
}

function store(threads: ThreadFacts[], over: () => Partial<Signals> = () => ({})) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: (async () => [...byId.values()]) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = byId.get(threadId); if (!thread) throw new Error("Not found"); return thread; }) as never,
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const workers: string[] = [];
  const botThreads = new BotThreads({ db, sdk: bb.sdk, signals: () => signals(over()), changed: () => {}, becameWorker: (id) => workers.push(id) });
  return { botThreads, workers };
}

describe("a Bot's new threads push only questions and errors", () => {
  it("marks a new lead, runner and spawned worker, not Main or a thread the user started", async () => {
    const { botThreads, workers } = store([{ id: "thr_main" }, { id: "thr_lead" }, { id: "thr_runner", visibility: "hidden" }, { id: "thr_w", parentThreadId: "thr_main" }, { id: "thr_user" }]);
    for (const id of ["thr_main", "thr_lead", "thr_runner", "thr_w", "thr_user"]) await botThreads.created({ id, ...(id === "thr_w" ? { parentThreadId: "thr_main" } : {}), ...(id === "thr_runner" ? { visibility: "hidden" } : {}) });
    expect(workers).toEqual(["thr_lead", "thr_runner", "thr_w"]);
  });

  it("marks a thread that a later sweep finds is a lead, and nothing the backfill adopts", async () => {
    let leads = new Set<string>();
    const { botThreads, workers } = store([{ id: "thr_main" }, { id: "thr_old_worker", parentThreadId: "thr_main" }, { id: "thr_new_lead" }], () => ({ leadThreads: leads }));
    await botThreads.backfill(true);
    expect(workers).toEqual([]);
    await botThreads.created({ id: "thr_new_lead" });
    expect(workers).toEqual([]);
    leads = new Set(["thr_new_lead"]);
    botThreads.reconcile();
    expect(workers).toEqual(["thr_new_lead"]);
  });
});

function pushPlugin(levels: Record<string, { own: PushLevel; cap?: PushLevel }>, options: { down?: boolean } = {}) {
  const set: Array<{ threadId: string; level: string }> = [];
  const callRpc = vi.fn(async (call: { pluginId: string; method: string; input: never }) => {
    if (options.down || call.pluginId !== "push-notifications") throw new Error("plugin is not running");
    const input = call.input as { threadIds?: string[]; threadId?: string; level?: string };
    if (call.method === "threadNotifications.list") {
      return { threads: Object.fromEntries(input.threadIds!.map((id) => [id, { own: levels[id]?.own ?? "inherit", ancestorCap: levels[id]?.cap ? { level: levels[id]!.cap, threadId: "thr_parent" } : null }])) };
    }
    set.push({ threadId: input.threadId!, level: input.level! });
    return { own: input.level, ancestorCap: null };
  });
  return { callRpc, set };
}

describe("push levels", () => {
  it("sets input-only on the thread itself, so the global and child defaults can stay 'all', and keeps a level the user chose", async () => {
    const rpc = pushPlugin({ thr_chosen: { own: "all" }, thr_muted: { own: "muted" } });
    expect(await quietByDefault(rpc.callRpc as never, ["thr_new", "thr_chosen", "thr_muted"])).toEqual(["thr_new"]);
    expect(rpc.set).toEqual([{ threadId: "thr_new", level: "input-only" }]);
  });

  it("reports when push-notifications can't be reached, so the sweep runs again", async () => {
    expect(await quietByDefault(pushPlugin({}, { down: true }).callRpc as never, ["thr_a"])).toBeNull();
  });

  it("lets replies through at the default or 'all', not at input-only, muted, or under a quieter parent", async () => {
    const rpc = pushPlugin({ thr_all: { own: "all" }, thr_input: { own: "input-only" }, thr_muted: { own: "muted" }, thr_capped: { own: "inherit", cap: "input-only" } });
    const allowed = async (id: string) => repliesAllowed(rpc.callRpc as never, id);
    expect([await allowed("thr_default"), await allowed("thr_all"), await allowed("thr_input"), await allowed("thr_muted"), await allowed("thr_capped")]).toEqual([true, true, false, false, false]);
    expect(await repliesAllowed(pushPlugin({}, { down: true }).callRpc as never, "thr_x")).toBe(true);
  });
});

describe("Main's pushes", () => {
  type Setup = { request?: unknown; read?: boolean; allowed?: boolean; needs?: Record<string, boolean>; taskPushAt?: number };
  function main(options: Setup = {}) {
    vi.useFakeTimers();
    const sent: MainPushInput[] = [];
    const pushes = new MainPushes({
      mainOf: (id) => (id === "thr_main" ? { botId: "bot_dot", name: "Dot" } : null),
      thread: async (id) => ({ id, visibility: "hidden", projectId: "proj_personal", lastReadAt: options.read ? 10 : 1, latestAttentionAt: 5 }),
      lastRequest: async () => options.request ?? { initiator: "user", input: [{ type: "text", text: "[bb message from thread:thr_w] CI is green." }] },
      allowed: async () => options.allowed ?? true,
      notify: async (input) => { sent.push(input); },
      ...(options.needs ? { needsUser: (card: { id: string }) => options.needs![card.id] ?? true } : {}),
      ...(options.taskPushAt !== undefined ? { pushedTaskSince: (_botId: string, since: number) => options.taskPushAt! >= since } : {}),
      defaultProjectId: "proj_personal",
    });
    dispose.push(async () => pushes.dispose());
    const idle = async (text: string | null, extra: { quiet?: boolean; visibility?: string; threadId?: string } = {}) => {
      pushes.idle({ thread: { id: extra.threadId ?? "thr_main", visibility: extra.visibility ?? "hidden" }, lastAssistantText: text, ...(extra.quiet ? { experimental_quiet: true } : {}) });
      await vi.advanceTimersByTimeAsync(2_000);
    };
    return { sent, idle };
  }

  it("pushes a real message as the Bot, on Main's conversation", async () => {
    const { sent, idle } = main();
    await idle("The new iOS build is on TestFlight: **20261114.0604**.");
    expect(sent).toEqual([{ title: "Dot", body: "The new iOS build is on TestFlight: 20261114.0604.", kind: "turn-finished", threadId: "thr_main", projectId: "proj_personal", botId: "bot_dot", conversationId: "thr_main" }]);
  });

  it("pushes the morning card, and a reply that is only a loop or a work card", async () => {
    const { sent, idle } = main();
    await idle("## Saturday, Nov 14\n\n**Calendar**\n- 10:00 AM · Swim class\n\n::loops{more=\"2\"}");
    await idle('::loop{id="loop_1" row="1"}');
    await idle('::work{id="wc_1"}');
    expect(sent.map((input) => input.body)).toEqual(["Saturday, Nov 14 · Calendar · 10:00 AM · Swim class", "New on your list", "A work card needs you"]);
  });

  it("pushes a reply that is only cards only when one of them needs the user: not a worker's running card", async () => {
    const { sent, idle } = main({ needs: { task_running: false, task_needs: true, loop_mine: true } });
    await idle('::work{id="task_running"}');
    expect(sent).toEqual([]);
    await idle('::work{id="task_needs"}');
    await idle('::loop{id="loop_mine"}');
    await idle('Started the build.\n::work{id="task_running"}');
    expect(sent.map((input) => input.body)).toEqual(["A work card needs you", "New on your list", "Started the build."]);
  });

  it("pushes no Bot reply within a few minutes of a task push to the phone, so one event is one push", async () => {
    const { sent, idle } = main({ taskPushAt: Date.now() });
    await idle("Disk /var is 99% full; I put it in your Today.");
    expect(sent).toEqual([]);
    const later = main({ taskPushAt: Date.now() - 4 * 60_000 });
    await later.idle("Disk /var is 99% full; I put it in your Today.");
    expect(later.sent).toHaveLength(1);
  });

  it("pushes nothing for a quiet pass, a relayed message folded with [PASS], or an approval card alone", async () => {
    const { sent, idle } = main();
    await idle("[PASS]");
    await idle("`[pass]`", { quiet: true });
    await idle(null);
    await idle('::approval{thread="thr_w" id="int_1"}');
    expect(sent).toEqual([]);
  });

  it("pushes nothing for a cache keepalive, even when the reply isn't [PASS]", async () => {
    const { sent, idle } = main({ request: { initiator: "user", input: [{ type: "text", text: PING_TEXT, visibility: "agent-only" }] } });
    await idle("Okay.");
    expect(sent).toEqual([]);
  });

  it("pushes nothing the user already read, or when Main's own level is input-only or muted", async () => {
    const read = main({ read: true });
    await read.idle("Done.");
    const quiet = main({ allowed: false });
    await quiet.idle("Done.");
    expect([...read.sent, ...quiet.sent]).toEqual([]);
  });

  it("leaves a visible thread to BB, and ignores threads that aren't a Bot's Main", async () => {
    const { sent, idle } = main();
    await idle("Done.", { visibility: "visible" });
    await idle("Done.", { threadId: "thr_runner" });
    expect(sent).toEqual([]);
  });

  it("previews plain text from markdown", () => {
    expect(previewOf("> **Heads up:** the [deploy](https://example.com) failed.\n\n```\nlog\n```")).toBe("Heads up: the deploy failed.");
    expect(previewOf("| a | b |\n|---|---|")).toBe("New message");
  });
});
