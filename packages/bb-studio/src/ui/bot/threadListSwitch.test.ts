// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_PROVIDER as AUTO, BOT_LIST_PROVIDER as BOT, botOwnsThread, forgetBotOwnership, isBotPath, isStudioPath, knownBotOwned, listSwitch, markBotOwned, NATIVE_LIST_PROVIDER as NATIVE, NOT_OWNED_TTL_MS, providerForPath, SAVED_KEY, STUDIO_LIST_PROVIDER as STUDIO, syncThreadList, threadIdForPath, wantedProvider } from "./threadListSwitch";

describe("providerForPath", () => {
  it("maps the Bot page, the Studio panel and everything else", () => {
    expect(providerForPath("/plugins/studio/bot")).toBe(BOT);
    expect(providerForPath("/plugins/studio/bot/bot_1")).toBe(BOT);
    expect(providerForPath("/plugins/studio/studio")).toBe(STUDIO);
    expect(providerForPath("/plugins/studio/studio/browse")).toBe(STUDIO);
    expect(providerForPath("/threads/thr_1")).toBeNull();
    expect(providerForPath("/plugins/studio/studios")).toBeNull();
    expect(providerForPath("/plugins/studio/botany")).toBeNull();
  });
  it("matches paths exactly", () => {
    expect(isBotPath("/plugins/studio/bot/")).toBe(true);
    expect(isStudioPath("/plugins/studio/studio/")).toBe(true);
    expect(isStudioPath("/plugins/pages/pages")).toBe(false);
  });
});

describe("threadIdForPath", () => {
  it("reads BB's thread routes, in Personal and in a project", () => {
    expect(threadIdForPath("/threads/thr_1")).toBe("thr_1");
    expect(threadIdForPath("/threads/thr%201/")).toBe("thr 1");
    // BB routes a thread outside Personal under its project (getThreadRoutePath).
    expect(threadIdForPath("/projects/proj_hp88nshh8g/threads/thr_9s7rehr925")).toBe("thr_9s7rehr925");
    expect(threadIdForPath("/projects/proj_8ztiq6dkh5/threads/thr_jbjiha9hqc/")).toBe("thr_jbjiha9hqc");
    // BB's thread routes match anything under the thread too (/threads/:threadId/*).
    expect(threadIdForPath("/threads/thr_1/files")).toBe("thr_1");
    expect(threadIdForPath("/projects/proj_1/threads/thr_1/files/a")).toBe("thr_1");
    expect(threadIdForPath("/threads")).toBeNull();
    expect(threadIdForPath("/projects/proj_1/threads")).toBeNull();
    expect(threadIdForPath("/projects/proj_1")).toBeNull();
    expect(threadIdForPath("/projects/proj_1/archived")).toBeNull();
    expect(threadIdForPath("/archived")).toBeNull();
    expect(threadIdForPath("/plugins/studio/bot")).toBeNull();
    expect(threadIdForPath("/plugins/x/threads/thr_1")).toBeNull();
  });
});

describe("Bot-owned threads", () => {
  afterEach(() => forgetBotOwnership());
  const owner = (botId: string | null) => vi.fn(async (_method: string, _input?: unknown) => ({ botId }));
  it("wants the Bots list on a Bot-owned thread, the page's list elsewhere", async () => {
    expect(await wantedProvider("/threads/thr_run", owner("bot_main"))).toBe(BOT);
    expect(await wantedProvider("/threads/thr_user", owner(null))).toBeNull();
    expect(await wantedProvider("/plugins/studio/studio", owner("bot_main"))).toBe(STUDIO);
    expect(await wantedProvider("/plugins/pages/pages", owner("bot_main"))).toBeNull();
  });
  it("knows a thread opened from the Bots list at once, without asking", async () => {
    const call = owner(null);
    markBotOwned("thr_spawned");
    expect(knownBotOwned("thr_spawned")).toBe(true);
    expect(await wantedProvider("/threads/thr_spawned", call)).toBe(BOT);
    // Without a client, only what's known counts.
    expect(await wantedProvider("/threads/thr_spawned")).toBe(BOT);
    expect(await wantedProvider("/threads/thr_other")).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
  it("asks once per thread, shares concurrent asks, and rechecks a no later", async () => {
    vi.useFakeTimers();
    try {
      const call = owner(null);
      await Promise.all([botOwnsThread("thr_a", call), botOwnsThread("thr_a", call)]);
      expect(call).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledWith("bot_thread_owner", { threadId: "thr_a" });
      expect(knownBotOwned("thr_a")).toBe(false);
      await botOwnsThread("thr_a", call);
      expect(call).toHaveBeenCalledTimes(1);
      // An automation's run is linked a little after BB makes it.
      vi.advanceTimersByTime(NOT_OWNED_TTL_MS + 1);
      expect(knownBotOwned("thr_a")).toBeUndefined();
      expect(await botOwnsThread("thr_a", owner("bot_main"))).toBe(true);
      expect(knownBotOwned("thr_a")).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("treats a failed ask as unknown, without remembering it", async () => {
    expect(await botOwnsThread("thr_x", vi.fn(async () => { throw new Error("offline"); }))).toBeUndefined();
    expect(knownBotOwned("thr_x")).toBeUndefined();
    expect(await wantedProvider("/threads/thr_x", vi.fn(async () => { throw new Error("offline"); }))).toBeUndefined();
  });
  it("keeps a thread opened from the Bots list the Bot's over a cached or later no", async () => {
    await botOwnsThread("thr_let_go", owner(null));
    expect(knownBotOwned("thr_let_go")).toBe(false);
    markBotOwned("thr_let_go");
    expect(await wantedProvider("/projects/proj_8ztiq6dkh5/threads/thr_let_go", owner(null))).toBe(BOT);
  });
  it("remembers threads opened from the Bots list across a reload of this window", () => {
    markBotOwned("thr_9s7rehr925");
    forgetBotOwnership({ keepSession: true });
    expect(knownBotOwned("thr_9s7rehr925")).toBe(true);
    forgetBotOwnership();
    expect(knownBotOwned("thr_9s7rehr925")).toBeUndefined();
  });
});

describe("listSwitch", () => {
  it("switches to the page's list and remembers the user's choice", () => {
    expect(listSwitch(AUTO, BOT, null)).toEqual({ set: BOT, save: AUTO });
    expect(listSwitch("other/list", STUDIO, null)).toEqual({ set: STUDIO, save: "other/list" });
    expect(listSwitch(BOT, BOT, "other/list")).toEqual({});
    expect(listSwitch(STUDIO, STUDIO, null)).toEqual({});
  });
  it("moves between Studio's lists without forgetting the user's choice", () => {
    expect(listSwitch(BOT, STUDIO, "other/list")).toEqual({ set: STUDIO });
    expect(listSwitch(STUDIO, BOT, "other/list")).toEqual({ set: BOT });
  });
  it("restores a pinned list on leaving", () => {
    expect(listSwitch(BOT, null, "other/list")).toEqual({ set: "other/list", save: null });
    expect(listSwitch(STUDIO, null, NATIVE)).toEqual({ set: NATIVE, save: null });
  });
  it("restores BB's list, never automatic or a Studio list, when nothing was pinned", () => {
    expect(listSwitch(STUDIO, null, AUTO)).toEqual({ set: NATIVE, save: null });
    expect(listSwitch(BOT, null, null)).toEqual({ set: NATIVE, save: null });
    expect(listSwitch(BOT, null, STUDIO)).toEqual({ set: NATIVE, save: null });
  });
  it("replaces automatic elsewhere and leaves other choices alone", () => {
    expect(listSwitch(AUTO, null, null)).toEqual({ set: NATIVE });
    expect(listSwitch(NATIVE, null, "x")).toEqual({});
    expect(listSwitch("other/list", null, null)).toEqual({});
  });
});

describe("syncThreadList", () => {
  afterEach(() => { localStorage.clear(); forgetBotOwnership(); });
  const fake = (prefs: Record<string, unknown>) => {
    const values = { ...prefs };
    const set = vi.fn(async ({ key, value }: { key: string; value: unknown }) => { values[key] = value; });
    const sdk = { system: { uiPreferences: {
      list: async () => ({ preferences: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, revision: 1 }])) }),
      set,
    } } };
    return { sdk: sdk as never, values, set };
  };
  const KEY = "sidebar.threadListProvider";
  it("follows the route and puts the user's list back", async () => {
    const x = fake({ [KEY]: "other/list" });
    await syncThreadList(x.sdk, "/plugins/studio/studio");
    expect(x.values[KEY]).toBe(STUDIO);
    expect(localStorage.getItem(SAVED_KEY)).toBe("other/list");
    await syncThreadList(x.sdk, "/plugins/studio/bot");
    expect(x.values[KEY]).toBe(BOT);
    await syncThreadList(x.sdk, "/threads/thr_1");
    expect(x.values[KEY]).toBe("other/list");
    expect(localStorage.getItem(SAVED_KEY)).toBeNull();
  });
  it("folds calls during a write into one pass with the latest route", async () => {
    const x = fake({ [KEY]: NATIVE });
    const first = syncThreadList(x.sdk, "/plugins/studio/bot");
    void syncThreadList(x.sdk, "/plugins/studio/studio");
    void syncThreadList(x.sdk, "/plugins/studio/studio/browse");
    await first;
    expect(x.values[KEY]).toBe(STUDIO);
    expect(x.set).toHaveBeenCalledTimes(2);
  });
  it("keeps the Bots list on a Bot-owned thread and restores the user's list off it", async () => {
    const x = fake({ [KEY]: AUTO });
    const call = vi.fn(async (_method: string, input?: unknown) => ({ botId: (input as { threadId: string }).threadId === "thr_run" ? "bot_main" : null }));
    await syncThreadList(x.sdk, "/plugins/studio/bot", call);
    expect(x.values[KEY]).toBe(BOT);
    expect(localStorage.getItem(SAVED_KEY)).toBe(AUTO);
    markBotOwned("thr_spawned");
    await syncThreadList(x.sdk, "/threads/thr_spawned", call);
    await syncThreadList(x.sdk, "/threads/thr_run", call);
    expect(x.values[KEY]).toBe(BOT);
    expect(x.set).toHaveBeenCalledTimes(1);
    // Automatic was the user's choice: off the Bot's threads it becomes BB's list.
    await syncThreadList(x.sdk, "/threads/thr_user", call);
    expect(x.values[KEY]).toBe(NATIVE);
    expect(localStorage.getItem(SAVED_KEY)).toBeNull();
    // From BB's list onto a Bot-owned thread: the Bots list, remembering BB's.
    await syncThreadList(x.sdk, "/threads/thr_run", call);
    expect(x.values[KEY]).toBe(BOT);
    expect(localStorage.getItem(SAVED_KEY)).toBe(NATIVE);
  });
  it("leaves the sidebar alone while ownership loads", async () => {
    const x = fake({ [KEY]: BOT });
    let answer!: (value: { botId: string | null }) => void;
    const call = vi.fn(() => new Promise<{ botId: string | null }>((resolve) => { answer = resolve; }));
    const sync = syncThreadList(x.sdk, "/threads/thr_run", call);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(x.set).not.toHaveBeenCalled();
    answer({ botId: "bot_main" });
    await sync;
    expect(x.set).not.toHaveBeenCalled();
    expect(x.values[KEY]).toBe(BOT);
  });
  // Threads Patrick opened from the Bots list (Runners and Recent), at the routes BB's navigate.toThread uses.
  const reported = [
    ["Staff", "/threads/thr_5gn5rp5knj"],
    ["Project Lead", "/projects/proj_hp88nshh8g/threads/thr_9s7rehr925"],
    ["Verizon gift card watch", "/threads/thr_2ydbj29je7"],
    ["GitHub watch", "/threads/thr_9wi75jarmc"],
    ["Experiment article backlog", "/projects/proj_8a9v3g9zxy/threads/thr_g3hgcvzv2n"],
    ["Claim our Verizon credit (archived, let go)", "/projects/proj_8ztiq6dkh5/threads/thr_jbjiha9hqc"],
  ] as const;
  for (const [name, path] of reported) {
    it(`keeps the Bots list on "${name}" opened from it`, async () => {
      const x = fake({ [KEY]: BOT });
      // Let go: the server no longer counts it the Bot's; the click still does.
      const call = vi.fn(async () => ({ botId: null }));
      markBotOwned(threadIdForPath(path)!);
      await syncThreadList(x.sdk, path, call);
      expect(x.set).not.toHaveBeenCalled();
      expect(x.values[KEY]).toBe(BOT);
    });
    it(`switches to the Bots list on "${name}" reached elsewhere when the Bot owns it`, async () => {
      const x = fake({ [KEY]: NATIVE });
      await syncThreadList(x.sdk, path, vi.fn(async () => ({ botId: "bot_main" })));
      expect(x.values[KEY]).toBe(BOT);
    });
  }
  it("leaves the sidebar alone when the owner can't be asked", async () => {
    const x = fake({ [KEY]: BOT });
    await syncThreadList(x.sdk, "/projects/proj_1/threads/thr_q", vi.fn(async () => { throw new Error("offline"); }));
    expect(x.set).not.toHaveBeenCalled();
  });
  it("skips a BB without the preference", async () => {
    const x = fake({});
    await syncThreadList(x.sdk, "/plugins/studio/studio");
    expect(x.set).not.toHaveBeenCalled();
  });
});
