import { describe, expect, it } from "vitest";
import {
  closeAll,
  closeTab,
  dropPlace,
  EMPTY,
  ICON_TAB_WIDTH,
  LABELED_TAB_WIDTH,
  MAX_TABS,
  moveTab,
  goBack,
  navigateTab,
  openTab,
  replaceTab,
  panelSize,
  parseState,
  placeAt,
  resizeRect,
  resizeTo,
  selectTab,
  stripLayout,
  toggleCollapsed,
  toggleHidden,
  type FloatState,
} from "./stack";

const thread = (threadId: string) => ({ kind: "thread" as const, threadId });
const keys = (state: FloatState) => state.tabs.map((tab) => tab.key);

describe("openTab", () => {
  it("adds tabs at the end, shows the new one, and reuses an open tab", () => {
    let state = openTab(EMPTY, thread("a"));
    state = openTab(state, { kind: "path", path: "/plugins/pages/pages/pg_1", title: "Plan" });
    expect(state.active).toBe("path:/plugins/pages/pages/pg_1");
    state = openTab(toggleCollapsed(state), thread("a"));
    expect(keys(state)).toEqual(["thread:a", "path:/plugins/pages/pages/pg_1"]);
    expect(state).toMatchObject({ active: "thread:a", collapsed: false });
  });

  it("opens a minimized tab behind the one showing, or folded in an empty stack", () => {
    const first = openTab(EMPTY, thread("a"), { minimized: true });
    expect(first).toMatchObject({ active: "thread:a", collapsed: true });
    const behind = openTab(openTab(EMPTY, thread("a")), thread("b"), { minimized: true });
    expect(keys(behind)).toEqual(["thread:a", "thread:b"]);
    expect(behind).toMatchObject({ active: "thread:a", collapsed: false });
  });

  it("swaps a tab opened under the same tag while you're not looking at it", () => {
    let state = openTab(EMPTY, thread("a"), { minimized: true, tag: "item" });
    state = openTab(state, thread("b"));
    state = openTab(state, thread("c"), { minimized: true, tag: "item" });
    expect(keys(state)).toEqual(["thread:c", "thread:b"]);
    expect(state.active).toBe("thread:b");
  });

  it("keeps a tagged tab you're looking at, and moves the tag on", () => {
    let state = openTab(EMPTY, thread("a"), { tag: "item" });
    state = openTab(state, thread("c"), { minimized: true, tag: "item" });
    expect(keys(state)).toEqual(["thread:a", "thread:c"]);
    expect(state.tabs[0]!.tag).toBeUndefined();
    state = openTab(state, thread("d"), { minimized: true, tag: "item" });
    expect(keys(state)).toEqual(["thread:a", "thread:d"]);
  });

  it("swaps the folded active tab and keeps it active", () => {
    let state = openTab(EMPTY, thread("a"), { minimized: true, tag: "item" });
    state = openTab(state, thread("b"), { minimized: true, tag: "item" });
    expect(state).toMatchObject({ active: "thread:b", collapsed: true });
    expect(keys(state)).toEqual(["thread:b"]);
  });

  it("shows a hidden panel again, unless the new tab is minimized", () => {
    const hidden = toggleHidden(openTab(EMPTY, thread("a")));
    expect(hidden.hidden).toBe(true);
    expect(openTab(hidden, thread("b"), { minimized: true }).hidden).toBe(true);
    expect(openTab(hidden, thread("b")).hidden).toBe(false);
  });

  it("closes the oldest past the limit, never the one showing", () => {
    let state = openTab(EMPTY, thread("0"));
    for (let index = 1; index <= MAX_TABS; index += 1) state = openTab(state, thread(String(index)), { minimized: true });
    expect(state.tabs).toHaveLength(MAX_TABS);
    expect(state.active).toBe("thread:0");
    expect(keys(state)).not.toContain("thread:1");
  });
});

describe("closeTab", () => {
  it("shows the next tab, else the previous, when the one showing closes", () => {
    let state = openTab(openTab(openTab(EMPTY, thread("a")), thread("b")), thread("c"));
    state = closeTab(selectTab(state, "thread:b"), "thread:b");
    expect(state.active).toBe("thread:c");
    state = closeTab(state, "thread:c");
    expect(state.active).toBe("thread:a");
  });

  it("empties the stack but keeps its place", () => {
    const free = placeAt(openTab(EMPTY, thread("a")), { kind: "free", left: 20, bottom: 200 });
    expect(closeTab(free, "thread:a")).toEqual({ ...EMPTY, place: free.place });
    expect(closeAll(free).place).toEqual(free.place);
  });
});

it("moves a tab within the strip", () => {
  const state = openTab(openTab(openTab(EMPTY, thread("a")), thread("b")), thread("c"));
  expect(keys(moveTab(state, "thread:c", 0))).toEqual(["thread:c", "thread:a", "thread:b"]);
  expect(keys(moveTab(state, "thread:a", 9))).toEqual(["thread:b", "thread:c", "thread:a"]);
  expect(moveTab(state, "thread:b", 1)).toBe(state);
});

it("parses saved state, dropping bad entries and duplicates", () => {
  const state = parseState({
    hidden: true,
    active: "thread:gone",
    place: { kind: "free", left: 10, bottom: 300 },
    size: { width: 520, height: 640 },
    tabs: [
      { target: thread("a"), tag: "item" },
      { target: thread("a") },
      { target: { kind: "path", path: "relative" } },
      { target: { kind: "nope" } },
      null,
    ],
  });
  expect(state).toEqual({
    tabs: [{ key: "thread:a", target: thread("a"), tag: "item" }],
    active: "thread:a",
    collapsed: false,
    hidden: true,
    place: { kind: "free", left: 10, bottom: 300 },
    size: { width: 520, height: 640 },
  });
  expect(parseState({ size: { width: 500 } }).size).toBeNull();
  expect(parseState({ place: { kind: "free", left: "x" } }).place).toEqual({ kind: "dock" });
  expect(parseState("garbage")).toBe(EMPTY);
});

describe("dropPlace", () => {
  const panel = { width: 400, height: 560 };
  const screen = { width: 1400, height: 900 };

  it("docks when dropped near the bottom", () => {
    expect(dropPlace(300, 20, panel, screen)).toEqual({ kind: "dock" });
  });

  it("keeps a free panel on screen", () => {
    expect(dropPlace(-50, 200, panel, screen)).toEqual({ kind: "free", left: 8, bottom: 200 });
    expect(dropPlace(1300, 800, panel, screen)).toEqual({ kind: "free", left: 992, bottom: 332 });
  });
});

describe("resizing", () => {
  const screen = { width: 1400, height: 900 };
  const rect = { left: 600, top: 300, width: 400, height: 500 };

  it("moves only the dragged sides", () => {
    expect(resizeRect(rect, "nw", -100, -50, screen)).toEqual({ left: 500, top: 250, width: 500, height: 550 });
    expect(resizeRect(rect, "e", 60, 999, screen)).toEqual({ ...rect, width: 460 });
    expect(resizeRect(rect, "s", 0, 40, screen)).toEqual({ ...rect, height: 540 });
  });

  it("stays at least the minimum size and on the screen", () => {
    expect(resizeRect(rect, "w", 300, 0, screen)).toEqual({ ...rect, left: 700, width: 300 });
    expect(resizeRect(rect, "n", 0, -999, screen)).toEqual({ ...rect, top: 8, height: 792 });
    expect(resizeRect(rect, "se", 999, 999, screen)).toEqual({ ...rect, width: 792, height: 600 });
  });

  it("uses its own size, capped by the screen, or the default", () => {
    expect(panelSize(null, screen)).toEqual({ width: 400, height: 560 });
    expect(panelSize({ width: 2000, height: 700 }, screen)).toEqual({ width: 1384, height: 700 });
    const resized = resizeTo(openTab(EMPTY, thread("a")), { width: 500, height: 600 });
    expect(closeAll(resized).size).toEqual({ width: 500, height: 600 });
    expect(resizeTo(resized, null).size).toBeNull();
  });
});

describe("stripLayout", () => {
  it("labels every tab while they fit", () => {
    expect(stripLayout(3, 0, LABELED_TAB_WIDTH * 3)).toEqual({ labeled: true, start: 0, end: 3 });
  });

  it("shows icons around the active tab when they don't", () => {
    // 140 for the active tab, then 32 per icon: 5 tabs in 268px.
    expect(stripLayout(12, 6, 140 + ICON_TAB_WIDTH * 4)).toEqual({ labeled: false, start: 4, end: 9 });
    expect(stripLayout(12, 0, 140 + ICON_TAB_WIDTH * 4)).toEqual({ labeled: false, start: 0, end: 5 });
    expect(stripLayout(12, 11, 140 + ICON_TAB_WIDTH * 4)).toEqual({ labeled: false, start: 7, end: 12 });
  });
});

describe("links inside a tab", () => {
  const path = (p: string) => ({ kind: "path" as const, path: p });
  it("follows a link in place and goes back", () => {
    const state = openTab(openTab(EMPTY, path("/plugins/pages/pages/a")), thread("t"));
    const moved = navigateTab(selectTab(state, "path:/plugins/pages/pages/a"), "path:/plugins/pages/pages/a", path("/plugins/pages/pages/b"));
    expect(moved.tabs.map((tab) => tab.key)).toEqual(["path:/plugins/pages/pages/b", "thread:t"]);
    expect(moved.active).toBe("path:/plugins/pages/pages/b");
    const back = goBack(moved, "path:/plugins/pages/pages/b");
    expect(back.tabs.map((tab) => tab.key)).toEqual(["path:/plugins/pages/pages/a", "thread:t"]);
    expect(back.tabs[0]!.back).toEqual([]);
    expect(goBack(back, "path:/plugins/pages/pages/a")).toBe(back);
  });

  it("shows a tab already open instead of opening it twice", () => {
    const state = openTab(openTab(EMPTY, path("/plugins/pages/pages/a")), path("/plugins/pages/pages/b"));
    const moved = navigateTab(state, "path:/plugins/pages/pages/b", path("/plugins/pages/pages/a"));
    expect(moved.tabs.map((tab) => tab.key)).toEqual(["path:/plugins/pages/pages/a"]);
    expect(moved.active).toBe("path:/plugins/pages/pages/a");
  });

  it("swaps a tab's content for the main view's", () => {
    const state = openTab(EMPTY, path("/plugins/pages/pages/a"));
    expect(replaceTab(state, "path:/plugins/pages/pages/a", path("/plugins/pages/pages/m")).tabs).toEqual([{ key: "path:/plugins/pages/pages/m", target: path("/plugins/pages/pages/m") }]);
  });
});
