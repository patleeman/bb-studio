// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveSecondaryPanelTab } from "@bb/client-core";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import type {
  PluginPanelFixedPanelTab,
  SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { resetBrowserViewPersistence } from "./browserViewVisibilityCoordinator";
import {
  resetRecentlyClosedPanelTabsForTest,
  useThreadFileTabs,
} from "./useThreadFileTabs";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const syncMocks = vi.hoisted(() => ({
  scheduleLocalThreadTabsMigration: vi.fn(),
  scheduleThreadTabsPersistence: vi.fn(),
  useThreadTabs: vi.fn(() => ({ data: undefined })),
}));

vi.mock("@/hooks/queries/thread-tabs-query", () => ({
  useThreadTabs: syncMocks.useThreadTabs,
}));

vi.mock("@/lib/thread-tabs-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/thread-tabs-sync")>();
  return {
    ...actual,
    hasPendingThreadTabsWrite: () => false,
    scheduleLocalThreadTabsMigration:
      syncMocks.scheduleLocalThreadTabsMigration,
    scheduleThreadTabsPersistence: syncMocks.scheduleThreadTabsPersistence,
  };
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function QueryWrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function requirePluginPanelTab(
  tab: SecondaryFixedPanelTab | null,
): PluginPanelFixedPanelTab {
  if (tab?.kind !== "plugin-panel") {
    throw new Error(
      `Expected an active plugin panel tab, got ${tab?.kind ?? "none"}`,
    );
  }
  return tab;
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  window.localStorage.clear();
  resetRecentlyClosedPanelTabsForTest();
  resetBrowserViewPersistence();
  resetPluginSlotStoreForTest();
  syncMocks.scheduleLocalThreadTabsMigration.mockClear();
  syncMocks.scheduleThreadTabsPersistence.mockClear();
  syncMocks.useThreadTabs.mockClear();
});

function NotesEditor() {
  return null;
}

function registerHandlingOpener(
  handleOpen: (args: unknown) => boolean | Promise<boolean>,
) {
  setPluginSlotRegistrations(
    "notes",
    makePluginRegistrationSet({
      fileOpeners: [
        {
          id: "editor",
          title: "Notes editor",
          extensions: ["md"],
          component: NotesEditor,
          experimental_handleOpen: handleOpen,
        },
      ],
    }),
  );
}

const HANDLED_REQUEST = {
  kind: "workspace-file-preview",
  tab: {
    lineRange: { startLineNumber: 3, endLineNumber: 4 },
    path: "notes/todo.md",
    source: { kind: "working-tree" },
    statusLabel: null,
  },
} as const;

function renderHandledHook(id: string) {
  return renderHook(
    () => {
      const params = {
        panelStateId: id,
        syncThreadId: id,
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      };
      return {
        ...useThreadFileTabs(params),
        activeTab: getActiveSecondaryPanelTab(
          useFixedPanelTabsState(params.panelStateId, params.syncThreadId),
        ),
      };
    },
    { wrapper: QueryWrapper },
  );
}

describe("useThreadFileTabs file opener experimental_handleOpen", () => {
  it("opens no tab when the opener handles the open itself", async () => {
    const handleOpen = vi.fn(() => Promise.resolve(true));
    registerHandlingOpener(handleOpen);
    const { result } = renderHandledHook("opener-handled");

    await act(async () => {
      result.current.openTab(HANDLED_REQUEST);
      await Promise.resolve();
    });

    expect(handleOpen).toHaveBeenCalledWith({
      path: "notes/todo.md",
      source: {
        kind: "workspace",
        environmentId: "env_1",
        projectId: null,
        threadId: "opener-handled",
      },
      lineRange: { startLineNumber: 3, endLineNumber: 4 },
    });
    expect(result.current.orderedSecondaryFileTabs).toEqual([]);
  });

  it.each([
    ["declines", () => false],
    [
      "throws",
      () => {
        throw new Error("boom");
      },
    ],
  ])("opens the opener tab when the handler %s", async (_label, impl) => {
    registerHandlingOpener(impl);
    const { result } = renderHandledHook("opener-declined");

    await act(async () => {
      result.current.openTab(HANDLED_REQUEST);
      await Promise.resolve();
    });

    expect(requirePluginPanelTab(result.current.activeTab)).toMatchObject({
      actionId: "file-opener:editor",
      pluginId: "notes",
    });
  });

  it("skips the handler for an explicit Open with choice", () => {
    const handleOpen = vi.fn(() => true);
    registerHandlingOpener(handleOpen);
    const { result } = renderHandledHook("opener-explicit");

    act(() => {
      result.current.openTab(HANDLED_REQUEST, {
        viewer: { pluginId: "notes", openerId: "editor" },
      });
    });

    expect(handleOpen).not.toHaveBeenCalled();
    expect(requirePluginPanelTab(result.current.activeTab).actionId).toBe(
      "file-opener:editor",
    );
  });
});
