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
  it("reads BB's thread route only", () => {
    expect(threadIdForPath("/threads/thr_1")).toBe("thr_1");
    expect(threadIdForPath("/threads/thr%201/")).toBe("thr 1");
    expect(threadIdForPath("/threads")).toBeNull();
    expect(threadIdForPath("/threads/thr_1/files")).toBeNull();
    expect(threadIdForPath("/plugins/studio/bot")).toBeNull();
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
  it("treats a failed ask as no, without remembering it", async () => {
    expect(await botOwnsThread("thr_x", vi.fn(async () => { throw new Error("offline"); }))).toBe(false);
    expect(knownBotOwned("thr_x")).toBeUndefined();
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
  it("skips a BB without the preference", async () => {
    const x = fake({});
    await syncThreadList(x.sdk, "/plugins/studio/studio");
    expect(x.set).not.toHaveBeenCalled();
  });
});
