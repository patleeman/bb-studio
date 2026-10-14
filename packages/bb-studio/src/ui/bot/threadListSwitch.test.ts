// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_PROVIDER as AUTO, BOT_LIST_PROVIDER as BOT, botLanding, botThreadVisit, forgetLastBotThread, readLastBotThread, threadRoute, forgetListMode, isBotPath, isStudioPath, listSwitch, MODE_KEY, NATIVE_LIST_PROVIDER as NATIVE, nextListMode, providerForMode, readListMode, SAVED_KEY, STUDIO_LIST_PROVIDER as STUDIO, syncThreadList, threadIdForPath } from "./threadListSwitch";

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
  it("the Studio panel is studio; every other route, threads included, is bots", () => {
    for (const path of ["/plugins/studio/studio", "/plugins/studio/studio/browse"]) expect(nextListMode(path)).toBe("studio");
    for (const path of [
      "/", "/threads/thr_1", "/projects/proj_1/threads/thr_1/files", "/plugins/studio/bot", "/plugins/studio/bot/bot_1",
      "/plugins/pages/pages", "/settings", "/extensions", "/skills", "/archived", "/projects/proj_1",
    ]) expect(nextListMode(path)).toBe("bots");
  });
  it("maps modes to lists", () => {
    expect(providerForMode("bots")).toBe(BOT);
    expect(providerForMode("studio")).toBe(STUDIO);
  });
});

describe("this window's mode", () => {
  afterEach(() => { forgetListMode(); forgetLastBotThread(); });
  it("is kept in sessionStorage, so a reload keeps it, and ignores junk", async () => {
    expect(readListMode()).toBeNull();
    const sdk = { system: { uiPreferences: { list: async () => ({ preferences: {} }), set: vi.fn() } } } as never;
    await syncThreadList(sdk, "/threads/thr_1");
    expect(sessionStorage.getItem(MODE_KEY)).toBe("bots");
    expect(readListMode()).toBe("bots");
    sessionStorage.setItem(MODE_KEY, "native");
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

describe("the last Bot thread", () => {
  it("is a thread shown in bots mode only", () => {
    expect(botThreadVisit("bots", "/projects/proj_1/threads/thr_r/files")).toBe("thr_r");
    expect(botThreadVisit("bots", "/threads/thr_chat")).toBe("thr_chat");
    expect(botThreadVisit("bots", "/plugins/studio/bot")).toBeNull();
    expect(botThreadVisit("studio", "/threads/thr_chat")).toBeNull();
    expect(botThreadVisit(null, "/threads/thr_chat")).toBeNull();
  });
  it("routes threads as BB does", () => {
    expect(threadRoute("thr_1", "proj_personal")).toBe("/threads/thr_1");
    expect(threadRoute("thr_1", "proj_9")).toBe("/projects/proj_9/threads/thr_1");
  });
  it("lands on the last thread, else the Bot's chat, else nowhere", async () => {
    const routes: Record<string, string> = { thr_r: "/projects/p/threads/thr_r", thr_chat: "/threads/thr_chat" };
    const locate = vi.fn(async (id: string) => routes[id] ?? null);
    expect(await botLanding("thr_r", "thr_chat", locate)).toEqual({ threadId: "thr_r", path: "/projects/p/threads/thr_r" });
    expect(await botLanding("thr_gone", "thr_chat", locate)).toEqual({ threadId: "thr_chat", path: "/threads/thr_chat" });
    expect(await botLanding(null, "thr_chat", locate)).toEqual({ threadId: "thr_chat", path: "/threads/thr_chat" });
    expect(await botLanding("thr_gone", null, locate)).toBeNull();
    expect(await botLanding(null, null, locate)).toBeNull();
    locate.mockClear();
    expect(await botLanding("thr_gone2", "thr_gone2", locate)).toBeNull();
    expect(locate).toHaveBeenCalledTimes(1);
  });
});

describe("syncThreadList", () => {
  afterEach(() => { localStorage.clear(); forgetListMode(); forgetLastBotThread(); });
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
  it("remembers the last thread shown, per window", async () => {
    const x = fake({ [KEY]: "other/list" });
    await syncThreadList(x.sdk, "/plugins/studio/bot");
    expect(readLastBotThread()).toBeNull();
    await syncThreadList(x.sdk, "/projects/proj_1/threads/thr_runner");
    expect(readLastBotThread()).toBe("thr_runner");
    await syncThreadList(x.sdk, "/plugins/studio/studio");
    expect(readLastBotThread()).toBe("thr_runner");
  });
  it("shows the Bots list everywhere but the Studio panel, and remembers the user's list", async () => {
    const x = fake({ [KEY]: "other/list" });
    await syncThreadList(x.sdk, "/");
    expect(x.values[KEY]).toBe(BOT);
    expect(localStorage.getItem(SAVED_KEY)).toBe("other/list");
    await syncThreadList(x.sdk, "/plugins/studio/studio");
    expect(x.values[KEY]).toBe(STUDIO);
    for (const path of ["/threads/thr_1", "/projects/proj_1/threads/thr_2", "/plugins/pages/pages", "/settings"]) {
      await syncThreadList(x.sdk, path);
      expect(x.values[KEY]).toBe(BOT);
    }
    expect(x.set).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem(SAVED_KEY)).toBe("other/list");
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
  it("skips a BB without the preference", async () => {
    const x = fake({});
    await syncThreadList(x.sdk, "/plugins/studio/studio");
    expect(x.set).not.toHaveBeenCalled();
  });
});
