// @vitest-environment jsdom

import { createStore } from "jotai";
import type {
  ExperimentalPanelTab,
  ExperimentalPanelTabs,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppPanelController } from "./app-fixed-tab-navigation";
import {
  createAttachmentFilePreviewFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createHostFilePreviewFixedPanelTab,
  createNewTabFixedPanelTab,
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type FixedPanelTab,
} from "./fixed-panel-tabs-state";
import { forkFixedPanelTabs } from "./fixed-panel-tabs";
import {
  parseTabWindowSearch,
  popOutWorkbenchTab,
  tabOpenSpec,
  tabWindowPath,
  WINDOW_INSTANCE_ID,
} from "./fork-tab-popout";
import type { WorkbenchSurface } from "./fork-workbench";

vi.mock("./app-query-client", () => ({
  appQueryClient: {
    fetchQuery: () => Promise.resolve({ id: "env_1", hostId: "host_9" }),
  },
}));

const page = createPluginPanelFixedPanelTab({
  pluginId: "studio",
  actionId: "page",
  paramsJson: '{"page":"p1"}',
  title: "Launch plan",
});
const opener = {
  ...createPluginPanelFixedPanelTab({
    pluginId: "studio",
    actionId: "file-opener:md",
    paramsJson: null,
    title: "README.md",
  }),
  fileOpenerOwner: { kind: "workspace-file-preview" },
} as unknown as FixedPanelTab;
const workspace = createWorkspaceFilePreviewFixedPanelTab({
  environmentId: "env_1",
  projectId: "proj_1",
  tab: {
    path: "src/app.ts",
    lineRange: { startLineNumber: 3, endLineNumber: 9 },
    source: { kind: "head" },
    statusLabel: null,
  },
});
const storage = {
  ...createThreadStorageFilePreviewFixedPanelTab({
    environmentId: null,
    isPinned: false,
    threadId: "thr_0",
    tab: { path: "notes.md", lineRange: null },
  }),
  threadId: null,
};
const scopedHost = createHostFilePreviewFixedPanelTab({
  environmentId: "env_1",
  threadId: "thr_1",
  tab: { path: "/etc/hosts", lineRange: null },
});

function listed(
  key: string,
  title: string,
  closable = true,
): ExperimentalPanelTab {
  return { key, title, status: null, closable, detail: { kind: "new-tab" } };
}

function fakeSurface(tabs: FixedPanelTab[], panelTabs: ExperimentalPanelTab[]) {
  const store = createStore();
  store.set(
    forkFixedPanelTabs.owned("thr_1"),
    createEmptyFixedPanelTabsState({
      secondary: { tabs, activeTabId: tabs[0]?.id ?? null, isOpen: true },
    }),
  );
  let state: ExperimentalPanelTabs = {
    open: true,
    selectedKey: null,
    tabs: panelTabs,
  };
  const closeTab = vi.fn((key: string) => {
    state = { ...state, tabs: state.tabs.filter((tab) => tab.key !== key) };
    return true;
  });
  const panel = {
    getTabs: () => state,
    closeTab,
  } as unknown as AppPanelController;
  const surface: WorkbenchSurface = {
    threadId: "thr_1",
    panel,
    openFilePreview: () => false,
    openTerminal: () => false,
    openInAppBrowser: null,
    store,
  };
  return { surface, closeTab };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("what a side panel tab pops out as", () => {
  it("turns a plugin action tab into its open spec, params and title included", async () => {
    expect(await tabOpenSpec(page, "thr_1")).toEqual({
      kind: "tab",
      tab: { id: "page", pluginId: "studio" },
      params: { page: "p1" },
      title: "Launch plan",
    });
  });

  it("keeps a workspace file's revision and lines, and a storage file's thread", async () => {
    expect(await tabOpenSpec(workspace, "thr_1")).toEqual({
      kind: "file",
      target: {
        kind: "workspace",
        environmentId: "env_1",
        path: "src/app.ts",
        experimental_ref: "HEAD",
      },
      location: { kind: "range", startLine: 3, endLine: 9 },
    });
    expect(await tabOpenSpec(storage, "thr_1")).toEqual({
      kind: "file",
      target: { kind: "thread-storage", threadId: "thr_1", path: "notes.md" },
      location: null,
    });
  });

  it("finds a thread-scoped host file's machine through its environment", async () => {
    expect(await tabOpenSpec(scopedHost, "thr_1")).toMatchObject({
      kind: "file",
      target: { kind: "host", hostId: "host_9", path: "/etc/hosts" },
    });
  });

  it("has nothing for tabs that cannot be shown alone", async () => {
    for (const tab of [
      opener,
      createTerminalFixedPanelTab({ terminalId: "term_1" }),
      createNewTabFixedPanelTab(),
      createAttachmentFilePreviewFixedPanelTab({
        name: "a.png",
        path: "a.png",
        projectId: "proj_1",
      }),
    ]) {
      expect(await tabOpenSpec(tab, "thr_1")).toBeNull();
    }
  });
});

describe("the tab window's address", () => {
  it("carries the thread, spec, pane, opener window and title, and reads them back", async () => {
    const spec = await tabOpenSpec(workspace, "thr_1");
    if (spec === null) throw new Error("no spec");
    const request = {
      threadId: "thr_1",
      spec,
      pane: 2 as const,
      from: WINDOW_INSTANCE_ID,
      title: "app.ts",
    };
    const path = tabWindowPath(request);
    expect(path.startsWith("/fork-window/_bb/tab?")).toBe(true);
    expect(
      parseTabWindowSearch(new URL(path, "http://x").searchParams),
    ).toEqual(request);
  });

  it("rejects a missing thread, a pane other than 1 or 2 and a spec it cannot show", () => {
    const good = new URLSearchParams({
      thread: "thr_1",
      pane: "1",
      from: "w",
      title: "t",
      spec: JSON.stringify({
        kind: "tab",
        tab: { id: "page", pluginId: "studio" },
      }),
    });
    expect(parseTabWindowSearch(good)).not.toBeNull();
    const without = (name: string, value?: string) => {
      const next = new URLSearchParams(good);
      if (value === undefined) next.delete(name);
      else next.set(name, value);
      return parseTabWindowSearch(next);
    };
    expect(without("thread")).toBeNull();
    expect(without("pane", "3")).toBeNull();
    expect(without("spec", "{")).toBeNull();
    expect(
      without("spec", JSON.stringify({ kind: "diff", path: "a.ts" })),
    ).toBeNull();
    expect(
      without("spec", JSON.stringify({ kind: "tab", tab: { id: "page" } })),
    ).toBeNull();
  });
});

describe("popping a tab out of the side panel", () => {
  it("opens the tab's window and closes the tab in the panel", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const { surface, closeTab } = fakeSurface(
      [page],
      [listed(page.id, "Launch plan")],
    );
    expect(await popOutWorkbenchTab(surface, page.id)).toBe(true);
    expect(closeTab).toHaveBeenCalledWith(page.id);
    const url = new URL(String(open.mock.calls[0]?.[0]), "http://x");
    expect(url.pathname).toBe("/fork-window/_bb/tab");
    expect(parseTabWindowSearch(url.searchParams)).toMatchObject({
      threadId: "thr_1",
      pane: 1,
      title: "Launch plan",
      spec: { kind: "tab", tab: { id: "page", pluginId: "studio" } },
    });
  });

  it("keeps the tab when the window is blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { surface, closeTab } = fakeSurface(
      [workspace],
      [listed(workspace.id, "app.ts")],
    );
    expect(await popOutWorkbenchTab(surface, workspace.id)).toBe(false);
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("refuses unknown keys, tabs without a close button and tabs that cannot be shown alone", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const terminal = createTerminalFixedPanelTab({ terminalId: "term_1" });
    const { surface, closeTab } = fakeSurface(
      [page, terminal],
      [listed(page.id, "Launch plan", false), listed(terminal.id, "Terminal")],
    );
    expect(await popOutWorkbenchTab(surface, "nope")).toBe(false);
    expect(await popOutWorkbenchTab(surface, page.id)).toBe(false);
    expect(await popOutWorkbenchTab(surface, terminal.id)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
  });
});
