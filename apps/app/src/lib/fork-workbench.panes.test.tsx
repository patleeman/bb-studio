// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { createStore } from "jotai";
import { useMemo, useSyncExternalStore } from "react";
import type {
  ExperimentalPanelTab,
  ExperimentalPanelTabs,
  ExperimentalWorkbench,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarSplitContainer } from "@/components/secondary-panel/SidebarSplitContainer";
import type { AppPanelController } from "./app-fixed-tab-navigation";
import {
  registerWorkbenchSurface,
  resetWorkbenchSurfacesForTest,
  workbenchFor,
} from "./fork-workbench";

const THREAD_ID = "thr_panes";
const INFO: ExperimentalPanelTab = {
  key: "info",
  title: "Info",
  status: null,
  closable: false,
  detail: { kind: "info" },
};

function pageTab(page: string): ExperimentalPanelTab {
  return {
    key: `page-${page}`,
    title: page,
    status: null,
    closable: true,
    detail: {
      kind: "plugin",
      pluginId: "studio",
      tab: { id: "page", context: { kind: "thread" }, availability: "action" },
      params: { page },
    },
  };
}

function fakePanel(initial: ExperimentalPanelTabs) {
  let state = initial;
  const listeners = new Set<() => void>();
  const opened: string[] = [];
  const publish = (next: ExperimentalPanelTabs) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const panel: AppPanelController = {
    getTabs: () => state,
    subscribeTabs: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publishTabs: () => undefined,
    renderTabIcon: () => null,
    selectTab: (key) => {
      if (!state.tabs.some((tab) => tab.key === key)) return false;
      if (state.selectedKey !== key) {
        publish({ ...state, open: true, selectedKey: key });
      }
      return true;
    },
    closeTab: () => false,
    close: () => false,
    toggleTab: () => false,
    openTab: (intent) => {
      const page = String((intent.params as { page: string }).page);
      opened.push(page);
      const tab = pageTab(page);
      setTimeout(() => {
        publish({
          open: true,
          selectedKey: tab.key,
          tabs: state.tabs.some((t) => t.key === tab.key)
            ? state.tabs
            : [...state.tabs, tab],
        });
      }, 1);
      return true;
    },
  };
  return { panel, opened };
}

function Panel({ panel }: { panel: AppPanelController }) {
  const tabs = useSyncExternalStore(panel.subscribeTabs, panel.getTabs);
  const descriptors = useMemo(
    () =>
      tabs.tabs.map((tab) => ({
        id: tab.key,
        label: tab.title,
        restoresPlacementAfterRemoval: true,
      })),
    [tabs],
  );
  return (
    <SidebarSplitContainer
      activeTabId={tabs.selectedKey ?? INFO.key}
      fixedTabIds={[INFO.key]}
      isFullScreen={false}
      onActivateTab={(key) => panel.selectTab(key)}
      onGlobalTabReorder={vi.fn()}
      onToggleFullScreen={vi.fn()}
      panelStateId={THREAD_ID}
      tabs={descriptors}
      renderPane={() => null}
    />
  );
}

function mount(pages: string[]): {
  workbench: ExperimentalWorkbench;
  opened: string[];
} {
  const fake = fakePanel({
    open: true,
    selectedKey: INFO.key,
    tabs: [INFO, ...pages.map(pageTab)],
  });
  registerWorkbenchSurface(() => ({
    threadId: THREAD_ID,
    panel: fake.panel,
    openFilePreview: () => false,
    openTerminal: () => false,
    openInAppBrowser: null,
    store: createStore(),
  }));
  render(<Panel panel={fake.panel} />);
  const workbench = workbenchFor("studio", THREAD_ID);
  if (workbench === null) throw new Error("no workbench");
  return { workbench, opened: fake.opened };
}

const page = (name: string) => ({
  kind: "tab" as const,
  tab: { id: "page" },
  params: { page: name },
});

function paneTabs(workbench: ExperimentalWorkbench): string[][] {
  return workbench.layout().panes.map((pane) => pane.tabs);
}

afterEach(() => {
  cleanup();
  resetWorkbenchSurfacesForTest();
  window.localStorage.clear();
});

describe("workbench panes through the plugin API", () => {
  it("opens into a new pane, then into pane 1 at an index, and reports both panes", async () => {
    const { workbench } = mount(["a", "b"]);
    expect(workbench.layout().panes).toEqual([
      { tabs: ["info", "page-a", "page-b"], widthPercent: 100 },
    ]);

    await act(async () => {
      await expect(workbench.open(page("c"), { pane: "new" })).resolves.toBe(
        "page-c",
      );
    });
    expect(workbench.layout().panes).toEqual([
      { tabs: ["info", "page-a", "page-b"], widthPercent: 50 },
      { tabs: ["page-c"], widthPercent: 50 },
    ]);

    await act(async () => {
      await workbench.open(page("d"), { pane: 1, index: 1 });
    });
    await act(async () => {
      await workbench.open(page("b"), { pane: 2, index: 0 });
    });
    expect(paneTabs(workbench)).toEqual([
      ["info", "page-d", "page-a"],
      ["page-b", "page-c"],
    ]);
  });

  it("declines a pane that is not there and opens nothing", async () => {
    const { workbench, opened } = mount(["a"]);
    await expect(workbench.open(page("x"), { pane: 2 })).resolves.toBeNull();
    await expect(
      workbench.open(page("x"), { pane: 1, index: -1 }),
    ).resolves.toBeNull();
    await act(async () => {
      await workbench.open(page("b"), { pane: "new" });
    });
    await expect(
      workbench.open(page("y"), { pane: "new" }),
    ).resolves.toBeNull();
    expect(opened).toEqual(["b"]);
  });

  it("arranges two panes with their widths, and back to one", () => {
    const { workbench } = mount(["a", "b"]);
    expect(workbench.arrange({ paneWidths: [1, 1] })).toBe(false);
    act(() => {
      expect(workbench.arrange({ panes: 2, paneWidths: [3, 1] })).toBe(true);
    });
    expect(workbench.layout().panes).toEqual([
      { tabs: ["page-a", "page-b"], widthPercent: 75 },
      { tabs: ["info"], widthPercent: 25 },
    ]);
    expect(workbench.arrange({ paneWidths: [0, 1] })).toBe(false);
    act(() => {
      expect(workbench.arrange({ panes: 1 })).toBe(true);
    });
    expect(paneTabs(workbench)).toEqual([["info", "page-a", "page-b"]]);
  });
});
