import { describe, expect, it } from "vitest";
import { AUTOMATIC_PROVIDER as AUTO, BOT_LIST_PROVIDER as BOT, isBotPath, listSwitch, NATIVE_LIST_PROVIDER as NATIVE } from "./threadListSwitch";

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
