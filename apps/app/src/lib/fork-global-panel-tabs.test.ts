// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
  EMPTY_FIXED_PANEL_TABS_STATE,
  type FixedPanelTab,
  type FixedPanelTabsState,
} from "./fixed-panel-tabs-state";
import {
  dropsSelectedGlobalPanelTab,
  globalPanelTabAppliesTo,
  mergeGlobalPanelTabs,
  splitGlobalPanelTabs,
  type GlobalPanelTab,
} from "./fork-global-panel-tabs";

function pageTab(id: string): GlobalPanelTab {
  return createPluginPanelFixedPanelTab({
    pluginId: "alpha",
    actionId: "item",
    paramsJson: JSON.stringify({ id }),
    title: `Page ${id}`,
  });
}

function state(
  tabs: readonly FixedPanelTab[],
  activeTabId: string | null = null,
): FixedPanelTabsState {
  return {
    ...EMPTY_FIXED_PANEL_TABS_STATE,
    lastUsedAt: Date.now(),
    secondary: {
      ...EMPTY_FIXED_PANEL_TABS_STATE.secondary,
      tabs,
      activeTabId,
      isOpen: activeTabId !== null,
    },
  };
}

const terminal = createTerminalFixedPanelTab({ terminalId: "term_1" });
const everywhere = () => true;
const nowhere = () => false;

afterEach(() => {
  window.localStorage.clear();
});

describe("fixed plugin tabs in a workbench", () => {
  it("leaves a workbench untouched when there is nothing global to show", () => {
    const local = state([terminal]);
    expect(mergeGlobalPanelTabs(local, [], everywhere, null)).toBe(local);
    expect(mergeGlobalPanelTabs(local, [pageTab("a")], nowhere, null)).toBe(
      local,
    );
  });

  it("shows fixed plugin tabs after bb's own pinned tabs and before the workbench's own, once each", () => {
    const a = pageTab("a");
    const info = { id: "thread-info", kind: "thread-info" } as FixedPanelTab;
    const merged = mergeGlobalPanelTabs(
      state([info, a, terminal]),
      [a],
      everywhere,
      null,
    );
    expect(merged.secondary.tabs.map((tab) => tab.id)).toEqual([
      info.id,
      a.id,
      terminal.id,
    ]);
  });

  it("writes own tabs back to the workbench and keeps global tabs global", () => {
    const a = pageTab("a");
    const b = pageTab("b");
    const split = splitGlobalPanelTabs(
      state([terminal, a, b], a.id),
      [a],
      everywhere,
      state([terminal, b], terminal.id),
    );
    expect(split.local.secondary.tabs.map((tab) => tab.id)).toEqual([
      terminal.id,
      b.id,
    ]);
    expect(split.local.secondary.activeTabId).toBe(terminal.id);
    expect(split.selection).toEqual({ tabId: a.id, isOpen: true });
    expect(split.globalTabs).toEqual([a]);
    const merged = mergeGlobalPanelTabs(
      split.local,
      split.globalTabs,
      everywhere,
      split.selection,
    );
    expect(merged.secondary).toMatchObject({ activeTabId: a.id, isOpen: true });
    const reselected = splitGlobalPanelTabs(
      state([terminal, b, a], b.id),
      [a],
      everywhere,
      split.local,
    );
    expect(reselected.selection).toBeNull();
    expect(reselected.local.secondary.activeTabId).toBe(b.id);
  });

  it("keeps a fixed tab for every workbench when a workbench that showed it drops it", () => {
    const a = pageTab("a");
    const b = pageTab("b");
    const globalTabs = [a, b];
    const split = splitGlobalPanelTabs(
      state([terminal]),
      globalTabs,
      everywhere,
      state([terminal]),
    );
    expect(split.globalTabs).toBe(globalTabs);
    expect(
      mergeGlobalPanelTabs(
        split.local,
        split.globalTabs,
        everywhere,
        null,
      ).secondary.tabs.map((tab) => tab.id),
    ).toEqual([a.id, b.id, terminal.id]);
  });

  it("treats a write that drops the selected fixed tab as a close attempt, and no other write", () => {
    const a = pageTab("a");
    const selected = { tabId: a.id, isOpen: true };
    expect(
      dropsSelectedGlobalPanelTab(state([terminal]), [a], everywhere, selected),
    ).toBe(true);
    expect(
      dropsSelectedGlobalPanelTab(
        state([a, terminal]),
        [a],
        everywhere,
        selected,
      ),
    ).toBe(false);
    expect(
      dropsSelectedGlobalPanelTab(state([terminal]), [a], nowhere, selected),
    ).toBe(false);
    expect(
      dropsSelectedGlobalPanelTab(state([terminal]), [a], everywhere, null),
    ).toBe(false);
  });

  it("keeps a global tab that this workbench could not show", () => {
    const a = pageTab("a");
    const globalTabs = [a];
    const split = splitGlobalPanelTabs(
      state([terminal]),
      globalTabs,
      nowhere,
      state([terminal]),
    );
    expect(split.globalTabs).toBe(globalTabs);
    expect(split.local.secondary.tabs).toEqual([terminal]);
  });

  it("shows a plugin's tab only where that plugin registered it", () => {
    const tab = pageTab("a");
    const threadSlot = {
      pluginId: "alpha",
      id: "item",
      availability: "action",
      context: { kind: "thread" },
    };
    const navSlot = {
      ...threadSlot,
      context: { kind: "nav-panel", panelId: "home" },
    };
    const navPanels = [{ pluginId: "alpha", id: "home", path: "start" }];
    const slots = (tabs: readonly object[]) => ({ tabs, navPanels }) as never;
    expect(globalPanelTabAppliesTo("thr_1", slots([threadSlot]))(tab)).toBe(
      true,
    );
    expect(globalPanelTabAppliesTo("thr_1", slots([navSlot]))(tab)).toBe(false);
    expect(
      globalPanelTabAppliesTo(
        "plugin-panel:alpha:start:standalone",
        slots([navSlot]),
      )(tab),
    ).toBe(true);
    expect(
      globalPanelTabAppliesTo(
        "plugin-panel:beta:start:standalone",
        slots([navSlot]),
      )(tab),
    ).toBe(false);
    expect(
      globalPanelTabAppliesTo("root-compose", slots([threadSlot]))(tab),
    ).toBe(false);
  });
});
