// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_PROVIDER as AUTO, BOT_LIST_PROVIDER as BOT, forgetListMode, isBotPath, isStudioPath, listSwitch, MODE_KEY, NATIVE_LIST_PROVIDER as NATIVE, nextListMode, openedFromBotsList, providerForMode, readListMode, SAVED_KEY, STUDIO_LIST_PROVIDER as STUDIO, syncThreadList, threadIdForPath, type ListMode } from "./threadListSwitch";

describe("paths", () => {
  it("matches the Bot page and the Studio panel exactly", () => {
    expect(isBotPath("/plugins/studio/bot")).toBe(true);
    expect(isBotPath("/plugins/studio/bot/")).toBe(true);
    expect(isBotPath("/plugins/studio/bot/bot_1")).toBe(true);
    expect(isBotPath("/plugins/studio/botany")).toBe(false);
    expect(isStudioPath("/plugins/studio/studio/")).toBe(true);
    expect(isStudioPath("/plugins/studio/studios")).toBe(false);
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

describe("nextListMode", () => {
  // Thread routes as BB's navigate.toThread makes them: Personal, other projects, sub-paths.
  const threads = [
    "/threads/thr_5gn5rp5knj",
    "/projects/proj_hp88nshh8g/threads/thr_9s7rehr925",
    "/projects/proj_8ztiq6dkh5/threads/thr_jbjiha9hqc",
    "/threads/thr_1/files",
    "/projects/proj_1/threads/thr_1/files/a",
  ];
  // Rail destinations and other non-thread routes (AppNavRail, sidebarNavigationItems, route-paths).
  const leaving = [
    "/", "/plugins/pages/pages", "/plugins/automations/automations", "/plugins/studio/page/b",
    "/plugins/studio/settings", "/plugins/studio/botany", "/settings", "/settings/plugins/studio",
    "/extensions", "/extensions/plugins/browse", "/skills", "/plugins", "/archived",
    "/projects/proj_1", "/projects/proj_1/archived",
  ];
  const modes: (ListMode | null)[] = [null, "bots", "native", "studio"];
  it("opening anything from the Bots list is bots, from any mode, on any route", () => {
    for (const previous of modes) for (const path of [...threads, ...leaving, "/plugins/studio/bot", ""]) {
      expect(nextListMode(previous, path, "bots-list")).toBe("bots");
    }
  });
  it("the Bot page (the rail's Bot) is bots", () => {
    for (const previous of modes) for (const path of ["/plugins/studio/bot", "/plugins/studio/bot/bot_1", "/plugins/studio/bot/new"]) {
      expect(nextListMode(previous, path, "route")).toBe("bots");
    }
  });
  it("the Studio panel is studio", () => {
    for (const previous of modes) expect(nextListMode(previous, "/plugins/studio/studio/browse", "route")).toBe("studio");
  });
  it("bots stays on every thread route: opens, reloads, runners, workers, other projects, archived, sub-paths", () => {
    for (const path of threads) expect(nextListMode("bots", path, "route")).toBe("bots");
  });
  it("native stays on every thread route: a thread opened from BB's list", () => {
    for (const path of threads) expect(nextListMode("native", path, "route")).toBe("native");
  });
  it("a thread after the Studio panel is BB's list", () => {
    for (const path of threads) expect(nextListMode("studio", path, "route")).toBe("native");
  });
  it("any other route leaves: native", () => {
    for (const previous of modes) for (const path of leaving) expect(nextListMode(previous, path, "route")).toBe("native");
  });
  it("a window with no mode on a thread asks the owner", () => {
    for (const path of threads) expect(nextListMode(null, path, "route")).toBe("detect");
  });
  it("maps modes to lists", () => {
    expect(providerForMode("bots")).toBe(BOT);
    expect(providerForMode("studio")).toBe(STUDIO);
    expect(providerForMode("native")).toBeNull();
  });
});

describe("this window's mode", () => {
  afterEach(() => forgetListMode());
  it("is kept in sessionStorage, so a reload keeps it", () => {
    expect(readListMode()).toBeNull();
    openedFromBotsList();
    expect(sessionStorage.getItem(MODE_KEY)).toBe("bots");
    expect(readListMode()).toBe("bots");
    sessionStorage.setItem(MODE_KEY, "junk");
    expect(readListMode()).toBeNull();
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
  afterEach(() => { localStorage.clear(); forgetListMode(); });
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
  const owner = (botId: string | null) => vi.fn(async (_method: string, _input?: unknown) => ({ botId }));
  it("follows the route and puts the user's list back", async () => {
    const x = fake({ [KEY]: "other/list" });
    await syncThreadList(x.sdk, "/plugins/studio/studio");
    expect(x.values[KEY]).toBe(STUDIO);
    expect(localStorage.getItem(SAVED_KEY)).toBe("other/list");
    await syncThreadList(x.sdk, "/plugins/studio/bot");
    expect(x.values[KEY]).toBe(BOT);
    await syncThreadList(x.sdk, "/");
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
  it("keeps the Bots list on every thread after the Bot page, whoever owns it, until a rail destination", async () => {
    const x = fake({ [KEY]: AUTO });
    const call = owner(null);
    await syncThreadList(x.sdk, "/plugins/studio/bot", call);
    expect(x.values[KEY]).toBe(BOT);
    expect(localStorage.getItem(SAVED_KEY)).toBe(AUTO);
    for (const path of ["/threads/thr_bot", "/threads/thr_run", "/projects/proj_8ztiq6dkh5/threads/thr_archived", "/threads/thr_worker/files"]) {
      openedFromBotsList();
      await syncThreadList(x.sdk, path, call);
    }
    // A reload: same window, same route.
    await syncThreadList(x.sdk, "/threads/thr_worker/files", call);
    expect(x.values[KEY]).toBe(BOT);
    expect(x.set).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
    // Home on the rail: automatic was the user's choice, so BB's list.
    await syncThreadList(x.sdk, "/", call);
    expect(x.values[KEY]).toBe(NATIVE);
    expect(readListMode()).toBe("native");
    // A thread from BB's list, even a Bot's: BB's list stays.
    await syncThreadList(x.sdk, "/threads/thr_run", owner("bot_main"));
    expect(x.values[KEY]).toBe(NATIVE);
    expect(x.set).toHaveBeenCalledTimes(2);
  });
  it("a window with no mode on a thread asks the owner once and keeps the answer", async () => {
    const x = fake({ [KEY]: NATIVE });
    const call = owner("bot_main");
    await syncThreadList(x.sdk, "/threads/thr_run", call);
    expect(call).toHaveBeenCalledWith("bot_thread_owner", { threadId: "thr_run" });
    expect(x.values[KEY]).toBe(BOT);
    expect(readListMode()).toBe("bots");
    await syncThreadList(x.sdk, "/threads/thr_other", call);
    expect(call).toHaveBeenCalledTimes(1);
    forgetListMode();
    const y = fake({ [KEY]: BOT });
    await syncThreadList(y.sdk, "/threads/thr_user", owner(null));
    expect(y.values[KEY]).toBe(NATIVE);
    expect(readListMode()).toBe("native");
  });
  it("leaves the sidebar alone while the owner is asked, and lets a Bots list open decide", async () => {
    const x = fake({ [KEY]: NATIVE });
    let answer!: (value: { botId: string | null }) => void;
    const call = vi.fn(() => new Promise<{ botId: string | null }>((resolve) => { answer = resolve; }));
    const sync = syncThreadList(x.sdk, "/threads/thr_run", call);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(x.set).not.toHaveBeenCalled();
    openedFromBotsList();
    answer({ botId: null });
    await sync;
    expect(x.values[KEY]).toBe(BOT);
  });
  it("leaves the sidebar alone, without a mode, when the owner can't be asked", async () => {
    const x = fake({ [KEY]: BOT });
    await syncThreadList(x.sdk, "/projects/proj_1/threads/thr_q", vi.fn(async () => { throw new Error("offline"); }));
    await syncThreadList(x.sdk, "/projects/proj_1/threads/thr_q");
    expect(x.set).not.toHaveBeenCalled();
    expect(readListMode()).toBeNull();
  });
  it("skips a BB without the preference", async () => {
    const x = fake({});
    await syncThreadList(x.sdk, "/plugins/studio/studio");
    expect(x.set).not.toHaveBeenCalled();
  });
});
