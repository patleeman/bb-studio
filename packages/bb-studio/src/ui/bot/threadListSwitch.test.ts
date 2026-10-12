// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_PROVIDER as AUTO, BOT_LIST_PROVIDER as BOT, isBotPath, isStudioPath, listSwitch, NATIVE_LIST_PROVIDER as NATIVE, providerForPath, SAVED_KEY, STUDIO_LIST_PROVIDER as STUDIO, syncThreadList } from "./threadListSwitch";

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
  afterEach(() => localStorage.clear());
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
  it("skips a BB without the preference", async () => {
    const x = fake({});
    await syncThreadList(x.sdk, "/plugins/studio/studio");
    expect(x.set).not.toHaveBeenCalled();
  });
});
