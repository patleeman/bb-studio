// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";
import { AUTOMATIC_PROVIDER as AUTO, BOT_LIST_PROVIDER as BOT, BOT_NAVIGATION_PROVIDER as BOT_NAV, isBotPath, listSwitch, NATIVE_LIST_PROVIDER as NATIVE, NATIVE_NAVIGATION_PROVIDER as NATIVE_NAV, NAVIGATION_SWITCH, sidebarSwitch, syncThreadList } from "./threadListSwitch";

describe("listSwitch", () => {
  it("switches to the Bots list on the Bot page and remembers the choice", () => {
    expect(listSwitch(AUTO, true, null)).toEqual({ set: BOT, save: AUTO });
    expect(listSwitch("other/list", true, null)).toEqual({ set: BOT, save: "other/list" });
    expect(listSwitch(BOT, true, "other/list")).toEqual({});
  });
  it("restores a pinned list on leaving", () => {
    expect(listSwitch(BOT, false, "other/list")).toEqual({ set: "other/list", save: null });
    expect(listSwitch(BOT, false, NATIVE)).toEqual({ set: NATIVE, save: null });
  });
  it("restores BB's list, never automatic, when nothing was pinned", () => {
    expect(listSwitch(BOT, false, AUTO)).toEqual({ set: NATIVE, save: null });
    expect(listSwitch(BOT, false, null)).toEqual({ set: NATIVE, save: null });
    expect(listSwitch(BOT, false, BOT)).toEqual({ set: NATIVE, save: null });
  });
  it("replaces automatic off the Bot page and leaves other choices alone", () => {
    expect(listSwitch(AUTO, false, null)).toEqual({ set: NATIVE });
    expect(listSwitch(NATIVE, false, "x")).toEqual({});
    expect(listSwitch("other/list", false, null)).toEqual({});
  });
});

describe("isBotPath", () => {
  it("matches the Bot page only", () => {
    expect(isBotPath("/plugins/studio/bot")).toBe(true);
    expect(isBotPath("/plugins/studio/bot/")).toBe(true);
    expect(isBotPath("/plugins/studio/botany")).toBe(false);
    expect(isBotPath("/threads/thr_1")).toBe(false);
  });
});

describe("navigation switch", () => {
  const nav = (current: string, onBotPage: boolean, saved: string | null) => sidebarSwitch(NAVIGATION_SWITCH, current, onBotPage, saved);
  it("shows Studio's navigation (New bot) on the Bot page and remembers the choice", () => {
    expect(nav(AUTO, true, null)).toEqual({ set: BOT_NAV, save: AUTO });
    expect(nav(NATIVE_NAV, true, null)).toEqual({ set: BOT_NAV, save: NATIVE_NAV });
    expect(nav(BOT_NAV, true, NATIVE_NAV)).toEqual({});
  });
  it("restores BB's bundled navigation, never automatic, on leaving", () => {
    expect(nav(BOT_NAV, false, AUTO)).toEqual({ set: NATIVE_NAV, save: null });
    expect(nav(BOT_NAV, false, null)).toEqual({ set: NATIVE_NAV, save: null });
    expect(nav(BOT_NAV, false, "other/nav")).toEqual({ set: "other/nav", save: null });
    expect(nav(AUTO, false, null)).toEqual({ set: NATIVE_NAV });
    expect(nav(NATIVE_NAV, false, null)).toEqual({});
  });
});

describe("syncThreadList", () => {
  afterEach(() => localStorage.clear());
  const fake = (prefs: Record<string, string>) => {
    const values = { ...prefs };
    const set = vi.fn(async ({ key, value }: { key: string; value: string }) => { values[key] = value; });
    const sdk = { system: { uiPreferences: {
      list: async () => ({ preferences: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, revision: 1 }])) }),
      set,
    } } };
    return { sdk: sdk as never, values, set };
  };
  it("switches both the list and the navigation, and puts BB's back", async () => {
    const x = fake({ "sidebar.threadListProvider": NATIVE, "sidebar.navigationProvider": AUTO });
    await syncThreadList(x.sdk, true);
    expect(x.values).toEqual({ "sidebar.threadListProvider": BOT, "sidebar.navigationProvider": BOT_NAV });
    await syncThreadList(x.sdk, false);
    expect(x.values).toEqual({ "sidebar.threadListProvider": NATIVE, "sidebar.navigationProvider": NATIVE_NAV });
  });
  it("skips a preference this BB doesn't have", async () => {
    const x = fake({ "sidebar.threadListProvider": NATIVE });
    await syncThreadList(x.sdk, true);
    expect(x.values).toEqual({ "sidebar.threadListProvider": BOT });
    expect(x.set).toHaveBeenCalledTimes(1);
  });
});
