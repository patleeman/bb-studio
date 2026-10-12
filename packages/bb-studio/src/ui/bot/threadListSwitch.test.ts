// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";
import { AUTOMATIC_PROVIDER as AUTO, BOT_LIST_PROVIDER as BOT, isBotPath, listSwitch, NATIVE_LIST_PROVIDER as NATIVE, hideItemSwitch, NEW_THREAD_ITEM as NEW, syncThreadList } from "./threadListSwitch";

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

describe("hideItemSwitch", () => {
  const sw = (current: unknown, onBotPage: boolean, saved: number | null) => hideItemSwitch(NEW, current, onBotPage, saved);
  it("hides New thread on the Bot page and remembers its index", () => {
    expect(sw([NEW, "a", "b"], true, null)).toEqual({ set: ["a", "b"], save: 0 });
    expect(sw(["a", NEW], true, null)).toEqual({ set: ["a"], save: 1 });
  });
  it("leaves the list alone when New thread is already hidden", () => {
    expect(sw(["a"], true, null)).toEqual({});
    expect(sw(["a"], true, 0)).toEqual({});
  });
  it("puts it back at the remembered index, clamped, and forgets", () => {
    expect(sw(["a", "b"], false, 0)).toEqual({ set: [NEW, "a", "b"], save: null });
    expect(sw(["a", "b"], false, 1)).toEqual({ set: ["a", NEW, "b"], save: null });
    expect(sw(["a"], false, 5)).toEqual({ set: ["a", NEW], save: null });
  });
  it("keeps a New thread the user hid hidden", () => {
    expect(sw(["a"], false, null)).toEqual({});
  });
  it("only forgets when the user showed it again", () => {
    expect(sw([NEW, "a"], false, 0)).toEqual({ save: null });
  });
  it("skips a null (BB default) or non-list value", () => {
    expect(sw(null, true, null)).toEqual({});
    expect(sw(null, false, 0)).toEqual({});
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
  it("switches the list and hides New thread, and puts BB's back", async () => {
    const x = fake({ "sidebar.threadListProvider": NATIVE, "sidebar.visiblePluginPanels": ["a", NEW, "b"] });
    await syncThreadList(x.sdk, true);
    expect(x.values).toEqual({ "sidebar.threadListProvider": BOT, "sidebar.visiblePluginPanels": ["a", "b"] });
    await syncThreadList(x.sdk, false);
    expect(x.values).toEqual({ "sidebar.threadListProvider": NATIVE, "sidebar.visiblePluginPanels": ["a", NEW, "b"] });
  });
  it("leaves a New thread the user hid hidden", async () => {
    const x = fake({ "sidebar.visiblePluginPanels": ["a"] });
    await syncThreadList(x.sdk, true);
    await syncThreadList(x.sdk, false);
    expect(x.values).toEqual({ "sidebar.visiblePluginPanels": ["a"] });
    expect(x.set).not.toHaveBeenCalled();
  });
  it("skips a preference this BB doesn't have", async () => {
    const x = fake({ "sidebar.threadListProvider": NATIVE });
    await syncThreadList(x.sdk, true);
    expect(x.values).toEqual({ "sidebar.threadListProvider": BOT });
    expect(x.set).toHaveBeenCalledTimes(1);
  });
});
