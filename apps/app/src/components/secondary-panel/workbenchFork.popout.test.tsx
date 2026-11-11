// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore } from "jotai";
import type { ExperimentalPanelTabs } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppPanelController } from "@/lib/app-fixed-tab-navigation";
import { forkFixedPanelTabs } from "@/lib/fixed-panel-tabs";
import {
  createEmptyFixedPanelTabsState,
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  registerWorkbenchSurface,
  resetWorkbenchSurfacesForTest,
} from "@/lib/fork-workbench";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import type { SecondaryPanelRenderableTab } from "./secondaryPanelTab";
import { SecondaryPanelTabStrip } from "./SecondaryPanelTabStrip";
import { WorkbenchPanelScope } from "./workbenchFork";

const page = createPluginPanelFixedPanelTab({
  pluginId: "studio",
  actionId: "page",
  paramsJson: '{"page":"p9"}',
  title: "Roadmap",
});
const terminal = createTerminalFixedPanelTab({ terminalId: "term_1" });

function renderable(
  tab: SecondaryPanelRenderableTab["tab"],
  label: string,
): SecondaryPanelRenderableTab {
  return {
    label,
    isPinned: false,
    leadingVisual: null,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    renderContent: () => null,
    tab,
  };
}

function registerSurface() {
  const store = createStore();
  store.set(
    forkFixedPanelTabs.owned("thr_1"),
    createEmptyFixedPanelTabsState({
      secondary: { tabs: [page, terminal], activeTabId: page.id, isOpen: true },
    }),
  );
  const state: ExperimentalPanelTabs = {
    open: true,
    selectedKey: page.id,
    tabs: [page, terminal].map((tab) => ({
      key: tab.id,
      title: tab.id,
      status: null,
      closable: true,
      detail: { kind: "new-tab" },
    })),
  };
  const closeTab = vi.fn(() => true);
  registerWorkbenchSurface(() => ({
    threadId: "thr_1",
    panelStateId: "thr_1",
    panel: { getTabs: () => state, closeTab } as unknown as AppPanelController,
    openFilePreview: () => false,
    openTerminal: () => false,
    openInAppBrowser: null,
    store,
  }));
  return closeTab;
}

function Strip({ panelStateId }: { panelStateId: string }) {
  return (
    <WorkbenchPanelScope panelStateId={panelStateId}>
      <SecondaryPanelTabStrip
        activeTabId={page.id}
        tabs={[renderable(page, "Roadmap"), renderable(terminal, "Terminal")]}
        onReorderTab={vi.fn()}
        usesDesktopChrome={false}
        isPanelOpen
      />
    </WorkbenchPanelScope>
  );
}

afterEach(() => {
  cleanup();
  resetWorkbenchSurfacesForTest();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("Open in new window in a side panel tab's menu", () => {
  it("pops a plugin tab out of a conversation's panel and closes it there", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const closeTab = registerSurface();
    render(<Strip panelStateId="thr_1" />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "Roadmap" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Open in new window" }),
    );
    await vi.waitFor(() => expect(closeTab).toHaveBeenCalledWith(page.id));
    expect(String(open.mock.calls[0]?.[0])).toContain("/fork-window/_bb/tab?");
  });

  it("is not offered for a terminal or on a plugin page's panel", () => {
    registerSurface();
    const { unmount } = render(<Strip panelStateId="thr_1" />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Terminal" }));
    expect(
      screen.queryByRole("menuitem", { name: "Open in new window" }),
    ).toBeNull();
    unmount();

    render(<Strip panelStateId="plugin-panel:studio/pages" />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Roadmap" }));
    expect(
      screen.queryByRole("menuitem", { name: "Open in new window" }),
    ).toBeNull();
  });
});
