// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  GLOBAL_PANEL_TABS_STORAGE_KEY,
  globalPanelTabsAtom,
  type GlobalPanelTab,
} from "./fork-global-panel-tabs";

function tab(id: string, paramsJson: string | null = null): GlobalPanelTab {
  return {
    id,
    actionId: "item",
    pluginId: "studio",
    title: id,
    paramsJson,
    kind: "plugin-panel",
  };
}

afterEach(() => localStorage.clear());

describe("Global tabs storage", () => {
  it("round-trips tabs through the synced preference and keeps a browser copy", () => {
    const store = createStore();
    store.set(globalPanelTabsAtom, [tab("a", '{"page":"p1"}'), tab("b")]);

    expect(store.get(globalPanelTabsAtom).map((each) => each.id)).toEqual([
      "a",
      "b",
    ]);
    expect(
      (
        JSON.parse(
          localStorage.getItem(GLOBAL_PANEL_TABS_STORAGE_KEY) ?? "[]",
        ) as GlobalPanelTab[]
      ).map((each) => each.paramsJson),
    ).toEqual(['{"page":"p1"}', null]);
  });

  it("leaves out a tab too large for a preference item instead of failing the whole write", () => {
    const store = createStore();
    store.set(globalPanelTabsAtom, [
      tab("big", JSON.stringify({ blob: "x".repeat(2000) })),
      tab("small"),
    ]);

    expect(store.get(globalPanelTabsAtom).map((each) => each.id)).toEqual([
      "small",
    ]);
  });

  it("applies an updater to the current tabs", () => {
    const store = createStore();
    store.set(globalPanelTabsAtom, [tab("a")]);
    store.set(globalPanelTabsAtom, (current) => [...current, tab("b")]);

    expect(store.get(globalPanelTabsAtom).map((each) => each.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
