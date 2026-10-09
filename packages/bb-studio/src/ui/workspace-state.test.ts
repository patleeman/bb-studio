import { describe, expect, it } from "vitest";
import { BROWSE, closeTab, emptyWorkspace, openItem, panes, parseWorkspace } from "./workspace-state";
const page = { href: "/plugins/pages/pages/pg_one", title: "Notes" };
const recording = { href: "/plugins/talk/recordings/rec_one", title: "Interview" };
const drawing = { href: "/plugins/excalidraw/drawings/draw_one", title: "Diagram" };
describe("Studio workspace", () => {
  it("focuses an existing tab without reordering or duplicating it", () => {
    let state = openItem(emptyWorkspace(), page);
    state = openItem(state, recording);
    state = openItem(state, page);
    expect(panes(state.layout)[0]!.tabs).toEqual([page, recording]);
    expect(panes(state.layout)[0]!.active).toBe(page.href);
  });
  it("moves a live tab into a split and merges the emptied pane on moving back", () => {
    let state = openItem(openItem(emptyWorkspace(), page), recording);
    const first = state.focused;
    state = openItem(state, recording, "right", first);
    expect(panes(state.layout).map(p => p.tabs)).toEqual([[page], [recording]]);
    state = openItem(state, recording, "tab", first);
    expect(panes(state.layout).map(p => p.tabs)).toEqual([[page, recording]]);
    expect(state.focused).toBe(first);
  });
  it("reorders tabs and closes just the view, choosing a surviving neighbor", () => {
    let state = openItem(openItem(openItem(emptyWorkspace(), page), recording), drawing);
    state = openItem(state, drawing, "tab", state.focused, page.href);
    expect(panes(state.layout)[0]!.tabs).toEqual([drawing, page, recording]);
    state = closeTab(state, drawing.href);
    expect(panes(state.layout)[0]!.active).toBe(page.href);
    state = closeTab(closeTab(state, page.href), recording.href);
    expect(panes(state.layout)).toHaveLength(1);
    // Nothing left: the new tab page.
    expect(panes(state.layout)[0]!.tabs).toEqual([BROWSE]);
  });
  it("restores splits, tab order and active selection; rejects corrupt storage", () => {
    const state = openItem(openItem(emptyWorkspace(), page), recording, "bottom");
    expect(parseWorkspace(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(panes(parseWorkspace({ layout: { kind: "split" } }).layout)[0]!.tabs).toEqual([BROWSE]);
    expect(openItem(state, { href: "https://elsewhere.test", title: "Bad" })).toBe(state);
  });
  it("opens on the new tab page, and an item opened from it takes its place", () => {
    let state = emptyWorkspace();
    expect(panes(state.layout)[0]!.tabs).toEqual([BROWSE]);
    state = openItem(state, page);
    expect(panes(state.layout)[0]!.tabs).toEqual([page]);
    // "+" opens it again beside the open items; the next item replaces it.
    state = openItem(state, BROWSE, "tab", state.focused);
    expect(panes(state.layout)[0]!.tabs).toEqual([page, BROWSE]);
    state = openItem(state, recording);
    expect(panes(state.layout)[0]!.tabs).toEqual([page, recording]);
    // Away from it, items open as new tabs and it stays.
    state = openItem(openItem(state, BROWSE, "tab", state.focused), page);
    expect(panes(state.layout)[0]!.tabs).toEqual([page, recording, BROWSE]);
    expect(panes(state.layout)[0]!.active).toBe(page.href);
  });
});

it("restores the maximum nested eight-pane arrangement", () => {
  // The first page takes the new tab page's place; the rest split.
  let state = openItem(emptyWorkspace(), { href: "/plugins/pages/pages/page_0", title: "Page 0" });
  for (let index = 1; index < 8; index++) state = openItem(state, { href: `/plugins/pages/pages/page_${index}`, title: `Page ${index}` }, "right");
  expect(panes(state.layout)).toHaveLength(8);
  expect(parseWorkspace(JSON.parse(JSON.stringify(state)))).toEqual(state);
});
