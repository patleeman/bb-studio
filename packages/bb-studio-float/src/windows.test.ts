import { describe, expect, it } from "vitest";
import {
  bringForward,
  closeWindow,
  EMPTY,
  fitCount,
  GAP,
  MAX_WINDOWS,
  openWindow,
  parseState,
  setMinimized,
  toggleHidden,
  type FloatState,
} from "./windows";

const thread = (threadId: string) => ({ kind: "thread" as const, threadId });
const keys = (state: FloatState) => state.windows.map((window) => `${window.key}${window.minimized ? " (min)" : ""}`);

describe("openWindow", () => {
  it("adds windows at the right and brings back one already open", () => {
    let state = openWindow(EMPTY, thread("a"));
    state = openWindow(state, { kind: "path", path: "/plugins/pages/pages/pg_1", title: "Plan" });
    state = setMinimized(state, "thread:a", true);
    state = openWindow(state, thread("a"));
    expect(keys(state)).toEqual(["thread:a", "path:/plugins/pages/pages/pg_1"]);
  });

  it("doesn't fold an open window when asked for a minimized one", () => {
    const state = openWindow(openWindow(EMPTY, thread("a")), thread("a"), { minimized: true });
    expect(keys(state)).toEqual(["thread:a"]);
  });

  it("swaps a minimized window opened under the same tag", () => {
    let state = openWindow(EMPTY, thread("a"), { minimized: true, tag: "item" });
    state = openWindow(state, thread("b"));
    state = openWindow(state, thread("c"), { minimized: true, tag: "item" });
    expect(keys(state)).toEqual(["thread:c (min)", "thread:b"]);
  });

  it("keeps a tagged window the user opened, and moves the tag on", () => {
    let state = openWindow(EMPTY, thread("a"), { tag: "item" });
    state = openWindow(state, thread("c"), { minimized: true, tag: "item" });
    expect(keys(state)).toEqual(["thread:a", "thread:c (min)"]);
    expect(state.windows[0]!.tag).toBeUndefined();
    state = openWindow(state, thread("d"), { minimized: true, tag: "item" });
    expect(keys(state)).toEqual(["thread:a", "thread:d (min)"]);
  });

  it("shows hidden windows again, unless the new one is minimized", () => {
    const hidden = toggleHidden(openWindow(EMPTY, thread("a")));
    expect(hidden.hidden).toBe(true);
    expect(openWindow(hidden, thread("b"), { minimized: true }).hidden).toBe(true);
    expect(openWindow(hidden, thread("b")).hidden).toBe(false);
  });

  it("closes the oldest past the limit", () => {
    let state = EMPTY;
    for (let index = 0; index <= MAX_WINDOWS; index += 1) state = openWindow(state, thread(String(index)));
    expect(state.windows).toHaveLength(MAX_WINDOWS);
    expect(state.windows[0]!.key).toBe("thread:1");
  });
});

it("closes, and brings a window forward opened", () => {
  let state = openWindow(openWindow(openWindow(EMPTY, thread("a")), thread("b")), thread("c"));
  state = setMinimized(state, "thread:a", true);
  state = bringForward(closeWindow(state, "thread:b"), "thread:a");
  expect(keys(state)).toEqual(["thread:c", "thread:a"]);
});

it("parses saved state, dropping bad entries and duplicates", () => {
  const state = parseState({
    hidden: true,
    windows: [
      { target: thread("a"), minimized: true, tag: "item" },
      { target: thread("a") },
      { target: { kind: "path", path: "relative" } },
      { target: { kind: "nope" } },
      null,
    ],
  });
  expect(state).toEqual({ hidden: true, windows: [{ key: "thread:a", target: thread("a"), minimized: true, tag: "item" }] });
  expect(parseState("garbage")).toBe(EMPTY);
});

describe("fitCount", () => {
  it("fits all when there's room", () => {
    expect(fitCount([400, 240], 1000, 40)).toBe(2);
  });

  it("keeps room for the overflow menu", () => {
    // 400 + 8 + 400 = 808, plus 8 + 40 for the menu = 856.
    expect(fitCount([400, 400, 400], 856, 40)).toBe(2);
    expect(fitCount([400, 400, 400], 855, 40)).toBe(1);
    expect(fitCount([240, 400, 400], 400 * 2 + GAP * 2 + 240, 40)).toBe(3);
  });

  it("always shows the newest", () => {
    expect(fitCount([400, 400], 100, 40)).toBe(1);
    expect(fitCount([], 100, 40)).toBe(0);
  });
});
