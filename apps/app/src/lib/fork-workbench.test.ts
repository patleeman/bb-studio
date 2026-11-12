// @vitest-environment jsdom

import { createStore } from "jotai";
import type {
  ExperimentalPanelTab,
  ExperimentalPanelTabs,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  getThreadConversationCollapsedAtom,
  getThreadSecondaryPanelWidthPercentAtom,
} from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import type { AppPanelController } from "./app-fixed-tab-navigation";
import type { AppTabOpenIntent } from "./app-navigation-host";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "./plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  isTypingInSidePanel,
  pageWorkbenchKey,
  registerWorkbenchSurface,
  resetWorkbenchSurfacesForTest,
  workbenchFor,
  type WorkbenchSurface,
} from "./fork-workbench";

const INFO: ExperimentalPanelTab = {
  key: "info",
  title: "Info",
  status: null,
  closable: false,
  detail: { kind: "info" },
};

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

function fakePanel(initial: ExperimentalPanelTabs) {
  let state = initial;
  const listeners = new Set<() => void>();
  const opened: AppTabOpenIntent[] = [];
  const publish = (next: ExperimentalPanelTabs) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const select = (key: string) => {
    if (!state.tabs.some((tab) => tab.key === key)) return false;
    publish({ ...state, open: true, selectedKey: key });
    return true;
  };
  const panel: AppPanelController = {
    getTabs: () => state,
    subscribeTabs: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publishTabs: () => undefined,
    renderTabIcon: () => null,
    selectTab: select,
    closeTab: (key) => {
      const tab = state.tabs.find((candidate) => candidate.key === key);
      if (tab === undefined || !tab.closable) return false;
      publish({ ...state, tabs: state.tabs.filter((t) => t !== tab) });
      return true;
    },
    close: () => {
      publish({ ...state, open: false });
      return true;
    },
    toggleTab: () => false,
    openTab: (intent) => {
      if (intent.tab.tabId !== "page") return false;
      opened.push(intent);
      const tab = pageTab(String((intent.params as { page: string }).page));
      setTimeout(() => {
        publish({
          open: true,
          selectedKey: tab.key,
          tabs: state.tabs.some((t) => t.key === tab.key)
            ? state.tabs
            : [...state.tabs, tab],
        });
      }, 5);
      return true;
    },
  };
  return { panel, opened, state: () => state };
}

function surface(
  panel: AppPanelController,
  threadId = "thr_1",
): WorkbenchSurface {
  return {
    threadId,
    panelStateId: threadId,
    panel,
    openFilePreview: () => false,
    openTerminal: () => false,
    openInAppBrowser: null,
    store: createStore(),
  };
}

afterEach(() => {
  resetWorkbenchSurfacesForTest();
  resetPluginSlotStoreForTest();
  document.body.innerHTML = "";
});

describe("workbench seam", () => {
  it("is null until a thread view is on screen, and finds the thread asked for", () => {
    expect(workbenchFor("studio", undefined)).toBeNull();
    const one = surface(
      fakePanel({ open: false, selectedKey: null, tabs: [] }).panel,
      "thr_1",
    );
    const two = surface(
      fakePanel({ open: false, selectedKey: null, tabs: [] }).panel,
      "thr_2",
    );
    registerWorkbenchSurface(() => one);
    const unregister = registerWorkbenchSurface(() => two);

    expect(workbenchFor("studio", undefined)?.threadId).toBe("thr_2");
    expect(workbenchFor("studio", "thr_1")?.threadId).toBe("thr_1");
    expect(workbenchFor("studio", "thr_9")).toBeNull();
    unregister();
    expect(workbenchFor("studio", undefined)?.threadId).toBe("thr_1");
  });

  it("opens the caller's tab and resolves its key once bb selects it", async () => {
    const fake = fakePanel({ open: true, selectedKey: "info", tabs: [INFO] });
    registerWorkbenchSurface(() => surface(fake.panel));
    const workbench = workbenchFor("studio", undefined);

    const key = await workbench?.open({
      kind: "tab",
      tab: { id: "page" },
      params: { page: "plan" },
      title: "Plan",
    });

    expect(key).toBe("studio-page-plan");
    expect(fake.opened[0]).toMatchObject({
      tab: { ownerId: "plugin-thread:studio", tabId: "page" },
      availability: "action",
      params: { page: "plan" },
      title: "Plan",
    });
    expect(fake.state().selectedKey).toBe("studio-page-plan");
  });

  it("opens behind the selected tab, and leaves a closed panel closed, when focus is false", async () => {
    const fake = fakePanel({ open: true, selectedKey: "info", tabs: [INFO] });
    registerWorkbenchSurface(() => surface(fake.panel));
    const workbench = workbenchFor("studio", undefined);

    await workbench?.open(
      { kind: "tab", tab: { id: "page" }, params: { page: "a" } },
      { focus: false },
    );
    expect(fake.state()).toMatchObject({ open: true, selectedKey: "info" });

    fake.panel.close();
    await workbench?.open(
      { kind: "tab", tab: { id: "page" }, params: { page: "b" } },
      { focus: false },
    );
    expect(fake.state().open).toBe(false);
    expect(fake.state().tabs.map((tab) => tab.key)).toContain("studio-page-b");
  });

  it("resolves null when the side panel declines", async () => {
    const fake = fakePanel({ open: true, selectedKey: "info", tabs: [INFO] });
    registerWorkbenchSurface(() => surface(fake.panel));
    const workbench = workbenchFor("studio", undefined);

    await expect(
      workbench?.open({ kind: "tab", tab: { id: "unknown" } }),
    ).resolves.toBeNull();
    await expect(
      workbench?.open({ kind: "url", url: "https://example.com" }),
    ).resolves.toBeNull();
  });

  it("closes and focuses any tab by key", () => {
    const fake = fakePanel({
      open: false,
      selectedKey: null,
      tabs: [INFO, pageTab("a")],
    });
    registerWorkbenchSurface(() => surface(fake.panel));
    const workbench = workbenchFor("studio", undefined);

    expect(workbench?.focus("studio-page-a")).toBe(true);
    expect(fake.state()).toMatchObject({
      open: true,
      selectedKey: "studio-page-a",
    });
    expect(workbench?.close("info")).toBe(false);
    expect(workbench?.close("studio-page-a")).toBe(true);
    expect(workbench?.list().tabs.map((tab) => tab.key)).toEqual(["info"]);
  });

  it("arranges the thread view's panel width, conversation and visibility", () => {
    const fake = fakePanel({ open: false, selectedKey: null, tabs: [INFO] });
    const thread = surface(fake.panel);
    registerWorkbenchSurface(() => thread);
    const workbench = workbenchFor("studio", undefined);

    expect(
      workbench?.arrange({
        panel: "open",
        widthPercent: 95,
        conversation: "collapsed",
      }),
    ).toBe(true);
    expect(workbench?.layout()).toEqual({
      panel: "open",
      widthPercent: 80,
      conversation: "collapsed",
      panes: [{ tabs: ["info"], widthPercent: 100 }],
    });
    expect(
      thread.store.get(getThreadSecondaryPanelWidthPercentAtom("thr_1")),
    ).toBe(80);
    expect(thread.store.get(getThreadConversationCollapsedAtom("thr_1"))).toBe(
      true,
    );
    expect(workbench?.arrange({ widthPercent: Number.NaN })).toBe(false);
    expect(workbench?.arrange({ panel: "closed", widthPercent: 10 })).toBe(
      true,
    );
    expect(workbench?.layout()).toMatchObject({
      panel: "closed",
      widthPercent: 20,
    });
  });

  it("knows when the user is typing in the side panel", () => {
    document.body.innerHTML = `
      <aside><div data-sidebar-split-tab-group="p1"></div>
        <input id="in-panel" /><button id="button-in-panel">x</button>
        <div id="editor" contenteditable="true"></div>
      </aside>
      <main><textarea id="composer"></textarea></main>`;
    const focus = (id: string) => document.getElementById(id)?.focus();

    focus("in-panel");
    expect(isTypingInSidePanel()).toBe(true);
    focus("editor");
    expect(isTypingInSidePanel()).toBe(true);
    focus("button-in-panel");
    expect(isTypingInSidePanel()).toBe(false);
    focus("composer");
    expect(isTypingInSidePanel()).toBe(false);
  });
});

describe("a plugin page's workbench", () => {
  const key = pageWorkbenchKey("studio", "library");
  const pageSurface = (panel: AppPanelController): WorkbenchSurface => ({
    ...surface(panel, key),
    panelStateId: "plugin-page:studio:library",
    page: { pluginId: "studio", panelId: "library" },
  });

  it("is found only by its key and only by the page's own plugin", () => {
    const fake = fakePanel({ open: false, selectedKey: null, tabs: [] });
    registerWorkbenchSurface(() => pageSurface(fake.panel));

    expect(workbenchFor("studio", undefined)).toBeNull();
    expect(workbenchFor("studio", key)?.threadId).toBe(key);
    expect(workbenchFor("other", key)).toBeNull();
  });

  it("opens the caller's tab as a tab of that page's panel", async () => {
    const fake = fakePanel({ open: false, selectedKey: null, tabs: [] });
    registerWorkbenchSurface(() => pageSurface(fake.panel));

    const opened = await workbenchFor("studio", key)?.open({
      kind: "tab",
      tab: { id: "page" },
      params: { page: "plan" },
    });

    expect(opened).toBe("studio-page-plan");
    expect(fake.opened[0]).toMatchObject({
      tab: { ownerId: "plugin:studio:library", tabId: "page" },
      availability: "action",
    });
  });

  it("declines a pane it cannot make, the conversation's arrangement and a pop-out", async () => {
    const fake = fakePanel({ open: true, selectedKey: "info", tabs: [INFO] });
    registerWorkbenchSurface(() => pageSurface(fake.panel));
    const workbench = workbenchFor("studio", key);

    expect(
      await workbench?.open(
        { kind: "tab", tab: { id: "page" }, params: { page: "plan" } },
        { pane: 2 },
      ),
    ).toBeNull();
    expect(fake.opened).toEqual([]);
    expect(workbench?.arrange({ widthPercent: 40 })).toBe(false);
    expect(workbench?.arrange({ conversation: "collapsed" })).toBe(false);
    expect(workbench?.arrange({ panel: "closed" })).toBe(true);
    expect(await workbench?.popOut("info")).toBe(false);
  });
});

describe("workbench open of another plugin's tab", () => {
  function runTab(runId: string): ExperimentalPanelTab {
    return {
      key: `workflows-run-${runId}`,
      title: runId,
      status: null,
      closable: true,
      detail: {
        kind: "plugin",
        pluginId: "workflows",
        tab: { id: "run", context: { kind: "thread" }, availability: "action" },
        params: { runId },
      },
    };
  }

  function crossPluginPanel() {
    let state: ExperimentalPanelTabs = {
      open: true,
      selectedKey: "info",
      tabs: [INFO],
    };
    const listeners = new Set<() => void>();
    const opened: AppTabOpenIntent[] = [];
    const panel: AppPanelController = {
      ...fakePanel(state).panel,
      getTabs: () => state,
      subscribeTabs: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      openTab: (intent) => {
        opened.push(intent);
        const tab = runTab(String((intent.params as { runId: string }).runId));
        setTimeout(() => {
          state = { open: true, selectedKey: tab.key, tabs: [INFO, tab] };
          for (const listener of listeners) listener();
        }, 5);
        return true;
      },
    };
    return { panel, opened };
  }

  function registerRunTab(openable: boolean) {
    setPluginSlotRegistrations(
      "workflows",
      makePluginRegistrationSet({
        tabs: [
          {
            id: "run",
            title: "Workflow run",
            icon: "Workflow",
            component: () => null,
            context: { kind: "thread" },
            availability: "action",
            ...(openable ? { experimental_openableByPlugins: true } : {}),
          },
        ],
      }),
    );
  }

  it("opens a tab registered with experimental_openableByPlugins, as its owner with the caller's params", async () => {
    registerRunTab(true);
    const fake = crossPluginPanel();
    registerWorkbenchSurface(() => surface(fake.panel));

    const key = await workbenchFor("studio", undefined)?.open({
      kind: "tab",
      tab: { pluginId: "workflows", id: "run" },
      params: { runId: "run_1" },
      title: "Nightly",
    });

    expect(key).toBe("workflows-run-run_1");
    expect(fake.opened).toEqual([
      expect.objectContaining({
        tab: { ownerId: "plugin-thread:workflows", tabId: "run" },
        availability: "action",
        params: { runId: "run_1" },
        title: "Nightly",
      }),
    ]);
  });

  it("resolves null and opens nothing for a tab not marked openable, an unknown tab or plugin", async () => {
    registerRunTab(false);
    const fake = crossPluginPanel();
    registerWorkbenchSurface(() => surface(fake.panel));
    const workbench = workbenchFor("studio", undefined);

    for (const tab of [
      { pluginId: "workflows", id: "run" },
      { pluginId: "workflows", id: "missing" },
      { pluginId: "nobody", id: "run" },
      { pluginId: "", id: "run" },
    ]) {
      expect(
        await workbench?.open({
          kind: "tab",
          tab,
          params: { runId: "run_1" },
        }),
      ).toBeNull();
    }
    expect(fake.opened).toEqual([]);
  });

  it("treats the caller's own plugin id like leaving it out", async () => {
    registerRunTab(false);
    const fake = crossPluginPanel();
    registerWorkbenchSurface(() => surface(fake.panel));

    const key = await workbenchFor("workflows", undefined)?.open({
      kind: "tab",
      tab: { pluginId: "workflows", id: "run" },
      params: { runId: "run_2" },
    });

    expect(key).toBe("workflows-run-run_2");
    expect(fake.opened[0]?.tab).toEqual({
      ownerId: "plugin-thread:workflows",
      tabId: "run",
    });
  });
});
