// @vitest-environment jsdom

import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { globalPanelTabsAtom, type GlobalPanelTab } from "./fork-global-panel-tabs";
import { renamePluginTabs } from "./fork-tab-titles";

function tab(id: string, paramsJson: string | null): GlobalPanelTab {
  return {
    id,
    actionId: "item",
    pluginId: "studio",
    title: "Old title",
    paramsJson,
    kind: "plugin-panel",
  };
}

afterEach(() => {
  getDefaultStore().set(globalPanelTabsAtom, []);
  localStorage.clear();
});

describe("renaming an open plugin tab", () => {
  it("renames only the tab with the same plugin, registration and params", () => {
    const store = getDefaultStore();
    store.set(globalPanelTabsAtom, [
      tab("a", '{"page":"p1"}'),
      tab("b", '{"page":"p2"}'),
    ]);

    const renamed = renamePluginTabs("studio", {
      tabId: "item",
      params: { page: "p1" },
      title: "  New title ",
    });

    expect(renamed).toBe(true);
    expect(store.get(globalPanelTabsAtom).map((each) => each.title)).toEqual([
      "New title",
      "Old title",
    ]);
  });

  it("reports false for another plugin's tab, an unknown tab or an empty title", () => {
    getDefaultStore().set(globalPanelTabsAtom, [tab("a", '{"page":"p1"}')]);

    expect(
      renamePluginTabs("other", {
        tabId: "item",
        params: { page: "p1" },
        title: "X",
      }),
    ).toBe(false);
    expect(
      renamePluginTabs("studio", {
        tabId: "item",
        params: { page: "missing" },
        title: "X",
      }),
    ).toBe(false);
    expect(
      renamePluginTabs("studio", {
        tabId: "item",
        params: { page: "p1" },
        title: "   ",
      }),
    ).toBe(false);
  });
});
