// @vitest-environment jsdom

import { createStore } from "jotai";
import type {
  ExperimentalPanelTab,
  ExperimentalPanelTabs,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppPanelController } from "./app-fixed-tab-navigation";
import type { AppTabOpenIntent } from "./app-navigation-host";
import { WINDOW_INSTANCE_ID } from "./fork-tab-popout";
import { listenForTabReturns, requestTabReturn } from "./fork-tab-return";
import {
  registerWorkbenchSurface,
  resetWorkbenchSurfacesForTest,
  type WorkbenchSurface,
} from "./fork-workbench";

function pageTab(page: string): ExperimentalPanelTab {
  return {
    key: `studio-page-${page}`,
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

function fakeSurface(threadId: string) {
  let state: ExperimentalPanelTabs = {
    open: false,
    selectedKey: null,
    tabs: [],
  };
  const listeners = new Set<() => void>();
  const opened: AppTabOpenIntent[] = [];
  const panel = {
    getTabs: () => state,
    subscribeTabs: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectTab: () => true,
    closeTab: () => true,
    close: () => true,
    openTab: (intent: AppTabOpenIntent) => {
      opened.push(intent);
      const tab = pageTab(String((intent.params as { page: string }).page));
      state = { open: true, selectedKey: tab.key, tabs: [...state.tabs, tab] };
      for (const listener of listeners) listener();
      return true;
    },
  } as unknown as AppPanelController;
  const surface: WorkbenchSurface = {
    threadId,
    panelStateId: threadId,
    panel,
    openFilePreview: () => false,
    openTerminal: () => false,
    openInAppBrowser: null,
    store: createStore(),
  };
  return { surface, opened };
}

const RETURN = {
  threadId: "thr_1",
  projectId: "proj_1",
  tabs: [
    {
      spec: {
        kind: "tab" as const,
        tab: { id: "page", pluginId: "studio" },
        params: { page: "p1" },
        title: "Launch plan",
      },
      pane: 1 as const,
    },
  ],
};

const stops: (() => void)[] = [];

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  resetWorkbenchSurfacesForTest();
});

describe("returning a popped-out tab to its workbench", () => {
  it("reopens the tab in the window that popped it out", async () => {
    const { surface, opened } = fakeSurface("thr_1");
    registerWorkbenchSurface(() => surface);
    stops.push(listenForTabReturns(() => {}));

    expect(
      await requestTabReturn({ ...RETURN, from: WINDOW_INSTANCE_ID }),
    ).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      tab: { tabId: "page" },
      params: { page: "p1" },
      title: "Launch plan",
    });
  });

  it("shows the conversation first when that window moved on", async () => {
    const { surface, opened } = fakeSurface("thr_1");
    const showThread = vi.fn(() => {
      registerWorkbenchSurface(() => surface);
    });
    stops.push(listenForTabReturns(showThread));

    expect(
      await requestTabReturn({ ...RETURN, from: WINDOW_INSTANCE_ID }),
    ).toBe(true);
    expect(showThread).toHaveBeenCalledWith("thr_1", "proj_1");
    expect(opened).toHaveLength(1);
  });

  it("falls back to a window showing the conversation when the opener is gone", async () => {
    const { surface, opened } = fakeSurface("thr_1");
    registerWorkbenchSurface(() => surface);
    stops.push(listenForTabReturns(() => {}));

    expect(await requestTabReturn({ ...RETURN, from: "closed-window" })).toBe(
      true,
    );
    expect(opened).toHaveLength(1);
  });

  it("fails when no window answers", async () => {
    expect(await requestTabReturn({ ...RETURN, from: "closed-window" })).toBe(
      false,
    );
  });
});
