// @vitest-environment jsdom

import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forkFixedPanelTabs } from "./fixed-panel-tabs";
import {
  globalPanelOpenAtom,
  globalPanelTabSelectionsAtom,
  globalPanelTabsAtom,
} from "./fork-global-panel-tabs";
import { closePluginFixedTab } from "./fork-plugin-global-tabs";
import { createTerminalFixedPanelTab } from "./fixed-panel-tabs-state";
import { createPluginPanelController } from "./plugin-panel-controller";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "./plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const TAB = {
  id: "item",
  context: { kind: "thread" },
  availability: "action",
} as const;

function register() {
  setPluginSlotRegistrations(
    "alpha",
    makePluginRegistrationSet({
      tabs: [
        {
          ...TAB,
          title: "Item",
          icon: "FileText",
          component: () => null,
        },
      ],
    }),
  );
}

function controller(accepts: boolean) {
  const openTab = vi.fn(() => accepts);
  const panel = createPluginPanelController("alpha", () => ({
    openTab,
    toggleTab: () => false,
    getTabs: () => ({ open: false, selectedKey: null, tabs: [] }),
    selectTab: () => false,
    closeTab: () => false,
    close: () => false,
    renderTabIcon: () => null,
    subscribeTabs: () => () => {},
    publishTabs: () => {},
  }));
  return { panel, openTab };
}

afterEach(() => {
  getDefaultStore().set(globalPanelTabsAtom, []);
  getDefaultStore().set(globalPanelOpenAtom, true);
  getDefaultStore().set(globalPanelTabSelectionsAtom, {});
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
});

describe("opening a plugin tab as a fixed tab", () => {
  it("keeps the panel open across threads while fixed tabs exist, and closed once the user closes it", () => {
    register();
    const store = getDefaultStore();
    controller(true).panel.openTab({
      tab: TAB,
      params: { id: "pg_1" },
      experimental_global: true,
    });
    const first = forkFixedPanelTabs.merged("thr_first");
    const second = forkFixedPanelTabs.merged("thr_second");
    expect(store.get(first).secondary.isOpen).toBe(true);
    expect(store.get(second).secondary.tabs).toHaveLength(1);
    expect(store.get(second).secondary.isOpen).toBe(true);

    const current = store.get(first);
    store.set(first, {
      ...current,
      secondary: { ...current.secondary, isOpen: false },
    });
    expect(store.get(second).secondary.isOpen).toBe(false);
  });

  it("lists the fixed tab once, then opens it in the surface", () => {
    register();
    const { panel, openTab } = controller(true);
    const options = {
      tab: TAB,
      params: { id: "pg_1" },
      title: "Launch plan",
      experimental_global: true,
    };
    expect(panel.openTab(options)).toBe(true);
    expect(panel.openTab(options)).toBe(true);
    expect(getDefaultStore().get(globalPanelTabsAtom)).toMatchObject([
      {
        pluginId: "alpha",
        actionId: "item",
        title: "Launch plan",
        paramsJson: '{"id":"pg_1"}',
      },
    ]);
    expect(openTab).toHaveBeenCalledTimes(2);
  });

  it("adds no fixed tab for an ordinary open and for a tab the plugin never registered", () => {
    register();
    const { panel } = controller(true);
    panel.openTab({ tab: TAB, params: { id: "pg_1" } });
    panel.openTab({
      tab: { ...TAB, id: "unknown" },
      experimental_global: true,
    });
    expect(getDefaultStore().get(globalPanelTabsAtom)).toEqual([]);
  });

  it("declines without a side panel and adds nothing", () => {
    register();
    const panel = createPluginPanelController("alpha", () => null);
    expect(panel.openTab({ tab: TAB, experimental_global: true })).toBe(false);
    expect(getDefaultStore().get(globalPanelTabsAtom)).toEqual([]);
  });

  it("draws the fixed tab first in every thread, keeps it when a thread closes it, and selects it per thread", () => {
    register();
    const store = getDefaultStore();
    const terminal = createTerminalFixedPanelTab({ terminalId: "term_1" });
    const first = forkFixedPanelTabs.merged("thr_first");
    const second = forkFixedPanelTabs.merged("thr_second");
    const empty = store.get(first);
    store.set(first, {
      ...empty,
      secondary: {
        ...empty.secondary,
        tabs: [terminal],
        activeTabId: terminal.id,
        isOpen: true,
      },
    });
    controller(true).panel.openTab({
      tab: TAB,
      params: { id: "pg_1" },
      experimental_global: true,
    });
    const fixedId = store.get(globalPanelTabsAtom)[0]?.id ?? "";
    expect(store.get(first).secondary.tabs.map((tab) => tab.id)).toEqual([
      fixedId,
      terminal.id,
    ]);

    const shown = store.get(first);
    store.set(first, {
      ...shown,
      secondary: { ...shown.secondary, activeTabId: fixedId },
    });
    expect(store.get(first).secondary.activeTabId).toBe(fixedId);
    expect(store.get(second).secondary.activeTabId).not.toBe(fixedId);

    const selected = store.get(first);
    store.set(first, {
      ...selected,
      secondary: {
        ...selected.secondary,
        tabs: [terminal],
        activeTabId: terminal.id,
      },
    });
    expect(store.get(first).secondary).toMatchObject({
      activeTabId: fixedId,
      tabs: [{ id: fixedId }, { id: terminal.id }],
    });
    expect(store.get(second).secondary.tabs).toHaveLength(1);
  });

  it("lets only the plugin that owns a fixed tab close it, by registration and params", () => {
    register();
    const store = getDefaultStore();
    const { panel } = controller(true);
    panel.openTab({
      tab: TAB,
      params: { id: "pg_1" },
      experimental_global: true,
    });
    panel.openTab({
      tab: TAB,
      params: { id: "pg_2" },
      experimental_global: true,
    });
    const first = forkFixedPanelTabs.merged("thr_closing");
    const [one, two] = store.get(globalPanelTabsAtom);
    const shown = store.get(first);
    store.set(first, {
      ...shown,
      secondary: { ...shown.secondary, activeTabId: one?.id ?? null },
    });

    expect(
      closePluginFixedTab("beta", { tabId: "item", params: { id: "pg_1" } }),
    ).toBe(false);
    expect(
      closePluginFixedTab("alpha", { tabId: "item", params: { id: "nope" } }),
    ).toBe(false);
    expect(store.get(globalPanelTabsAtom)).toHaveLength(2);

    expect(
      closePluginFixedTab("alpha", { tabId: "item", params: { id: "pg_1" } }),
    ).toBe(true);
    expect(store.get(globalPanelTabsAtom)).toEqual([two]);
    expect(store.get(globalPanelTabSelectionsAtom)).toEqual({});
    expect(store.get(first).secondary.tabs.map((tab) => tab.id)).toEqual([
      two?.id,
    ]);
  });
});
