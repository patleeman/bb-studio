// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createStore } from "jotai";
import type {
  ExperimentalDragItem,
  ExperimentalPanelTab,
  ExperimentalPanelTabs,
} from "@get-bb/plugin-sdk";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { SecondaryPanelRenderableTab } from "@/components/secondary-panel/secondaryPanelTab";
import { SecondaryPanelTabStrip } from "@/components/secondary-panel/SecondaryPanelTabStrip";
import { SidebarSplitContainer } from "@/components/secondary-panel/SidebarSplitContainer";
import { WorkbenchPanelScope } from "@/components/secondary-panel/workbenchFork";
import { workbenchSplitsFor } from "@/components/secondary-panel/workbenchSplits.fork";
import type { AppPanelController } from "./app-fixed-tab-navigation";
import type { AppTabOpenIntent } from "./app-navigation-host";
import {
  createPluginPanelFixedPanelTab,
  type SecondaryFileFixedPanelTab,
} from "./fixed-panel-tabs-state";
import {
  installItemDropHost,
  ITEM_DRAG_LOCAL_TYPE,
  ITEM_DRAG_TYPE,
  setCurrentDragItem,
  type ItemDropEnvironment,
} from "./fork-item-drag";
import {
  getPanelTabDragSource,
  openTabSpecIn,
  resetPanelTabDragForTest,
  tabDropOutcome,
} from "./fork-tab-move";
import {
  registerWorkbenchSurface,
  resetWorkbenchSurfacesForTest,
} from "./fork-workbench";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "./plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const PANEL_STATE_ID = "thr_1";
const pages = ["A", "B", "C"].map((page) =>
  createPluginPanelFixedPanelTab({
    pluginId: "studio",
    actionId: "page",
    paramsJson: JSON.stringify({ page }),
    title: `Page ${page}`,
  }),
);
const closed: string[] = [];

function renderable(
  tab: SecondaryFileFixedPanelTab,
): SecondaryPanelRenderableTab {
  const label = tab.kind === "plugin-panel" ? tab.title : tab.id;
  return {
    label,
    isPinned: false,
    leadingVisual: null,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: () => closed.push(label),
    renderContent: () => null,
    tab,
  };
}

function Workbench({ threadId = PANEL_STATE_ID }: { threadId?: string }) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <aside>
          <SidebarSplitContainer
            activeTabId={pages[0]!.id}
            isFullScreen={false}
            onActivateTab={vi.fn()}
            onGlobalTabReorder={vi.fn()}
            onToggleFullScreen={vi.fn()}
            panelStateId={threadId}
            tabs={pages.map((tab) => ({
              id: tab.id,
              label: tab.title,
              restoresPlacementAfterRemoval: true,
            }))}
            renderPane={({ group, paneId }) => (
              <div data-testid={`pane:${paneId}`}>
                <div data-testid="thread-secondary-panel-top-chrome">
                  <div data-sidebar-split-tab-group={paneId}>
                    <WorkbenchPanelScope panelStateId={threadId}>
                      <SecondaryPanelTabStrip
                        activeTabId={group.activeTabId}
                        tabs={group.tabIds.flatMap((id) => {
                          const tab = pages.find(
                            (candidate) => candidate.id === id,
                          );
                          return tab === undefined ? [] : [renderable(tab)];
                        })}
                        onReorderTab={vi.fn()}
                        usesDesktopChrome={false}
                        isPanelOpen
                      />
                    </WorkbenchPanelScope>
                  </div>
                </div>
              </div>
            )}
          />
        </aside>
      </TooltipProvider>
    </SidebarProvider>
  );
}

function paneLabels(): string[][] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-testid^='pane:']"),
    (pane) =>
      Array.from(
        pane.querySelectorAll("[data-tab-pill]"),
        (pill) => pill.querySelector("button")?.textContent ?? "",
      ),
  );
}

class TestDataTransfer {
  dropEffect = "none";
  effectAllowed = "uninitialized";
  private readonly data = new Map<string, string>();

  get types(): string[] {
    return [...this.data.keys()];
  }

  setData(type: string, value: string): void {
    this.data.set(type, value);
  }

  getData(type: string): string {
    return this.data.get(type) ?? "";
  }
}

function handleOf(label: string): HTMLElement {
  const handle = screen
    .getByRole("button", { name: label })
    .closest("[data-tab-pill]")?.parentElement;
  if (!(handle instanceof HTMLElement)) throw new Error("no tab handle");
  return handle;
}

function stripOfPane(index: number): HTMLElement {
  const groups = document.querySelectorAll<HTMLElement>(
    "[data-sidebar-split-tab-group]",
  );
  const group = groups[index];
  if (group === undefined) throw new Error("no pane");
  return group;
}

function dragEvent(
  type: string,
  dataTransfer: TestDataTransfer,
  x: number,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer, clientX: x, clientY: 5 });
  return event;
}

function startDrag(label: string): TestDataTransfer {
  const dataTransfer = new TestDataTransfer();
  fireEvent.dragStart(handleOf(label), { dataTransfer });
  return dataTransfer;
}

async function dropOn(
  target: HTMLElement,
  dataTransfer: TestDataTransfer,
  x: number,
): Promise<{ over: Event; drop: Event }> {
  const over = dragEvent("dragover", dataTransfer, x);
  target.dispatchEvent(over);
  const drop = dragEvent("drop", dataTransfer, x);
  await act(async () => {
    target.dispatchEvent(drop);
  });
  return { over, drop };
}

const environment = (
  overrides: Partial<ItemDropEnvironment> = {},
): ItemDropEnvironment => ({
  handlers: () => [],
  threadIdOf: () => PANEL_STATE_ID,
  openInPanel: (_element, pluginId, spec, options) =>
    openTabSpecIn(pluginId, PANEL_STATE_ID, spec, options),
  tabDrop: (item, zone, commit) =>
    tabDropOutcome(item, zone, commit, () => PANEL_STATE_ID),
  insertText: () => true,
  insertMention: () => true,
  insertThreadMention: () => true,
  ...overrides,
});

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  cleanup();
  closed.length = 0;
  resetPanelTabDragForTest();
  setCurrentDragItem(null);
  resetWorkbenchSurfacesForTest();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
});

describe("a side panel tab dropped on a tab row of its own window", () => {
  it("reorders within its pane and does not close when the drag ends as a move", async () => {
    render(<Workbench />);
    dispose = installItemDropHost(document, environment());
    expect(paneLabels()).toEqual([["Page A", "Page B", "Page C"]]);

    const dataTransfer = startDrag("Page B");
    expect(getPanelTabDragSource()?.key).toBe(pages[1]!.id);
    const { over, drop } = await dropOn(stripOfPane(0), dataTransfer, -1);
    expect(over.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("move");
    expect(drop.defaultPrevented).toBe(true);
    expect(paneLabels()).toEqual([["Page B", "Page A", "Page C"]]);

    fireEvent.dragEnd(handleOf("Page B"), { dataTransfer });
    expect(closed).toEqual([]);
  });

  it("moves across panes and into a new pane", async () => {
    render(<Workbench />);
    dispose = installItemDropHost(document, environment());
    act(() => {
      workbenchSplitsFor(PANEL_STATE_ID)?.moveToNewPane(pages[2]!.id);
    });
    expect(paneLabels()).toEqual([["Page A", "Page B"], ["Page C"]]);

    const dataTransfer = startDrag("Page A");
    await dropOn(stripOfPane(1), dataTransfer, 500);
    expect(paneLabels()).toEqual([["Page B"], ["Page C", "Page A"]]);
    fireEvent.dragEnd(handleOf("Page A"), { dataTransfer });
    expect(closed).toEqual([]);
  });

  it("is refused for a new pane when two panes are already there", () => {
    render(<Workbench />);
    const zone = {
      zone: "workbench" as const,
      element: document.querySelector("aside") as HTMLElement,
      place: {
        pane: "new" as const,
        box: { left: 0, top: 0, width: 1, height: 1 },
      },
    };
    startDrag("Page A");
    const item: ExperimentalDragItem = {
      kind: "tab",
      id: pages[0]!.id,
      title: "Page A",
    };
    act(() => {
      workbenchSplitsFor(PANEL_STATE_ID)?.moveToNewPane(pages[0]!.id);
    });
    expect(paneLabels()).toEqual([["Page B", "Page C"], ["Page A"]]);
    expect(tabDropOutcome(item, zone, false, () => PANEL_STATE_ID)).toBeNull();
  });
});

describe("a tab from another window dropped on a tab row", () => {
  function registerSurface() {
    const opened: AppTabOpenIntent[] = [];
    let state: ExperimentalPanelTabs = {
      open: true,
      selectedKey: null,
      tabs: [],
    };
    const listeners = new Set<() => void>();
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
        const key = `opened-${opened.length}`;
        state = {
          open: true,
          selectedKey: key,
          tabs: [
            ...state.tabs,
            {
              key,
              title: intent.title ?? key,
              status: null,
              closable: true,
              detail: {
                kind: "plugin",
                pluginId: "studio",
                tab: {
                  id: "page",
                  context: { kind: "thread" },
                  availability: "action",
                },
                params: intent.params ?? null,
              },
            },
          ] satisfies ExperimentalPanelTab[],
        };
        for (const listener of listeners) listener();
        return true;
      },
    } as unknown as AppPanelController;
    registerWorkbenchSurface(() => ({
      threadId: PANEL_STATE_ID,
      panelStateId: PANEL_STATE_ID,
      panel,
      openFilePreview: () => false,
      openTerminal: () => false,
      openInAppBrowser: null,
      store: createStore(),
    }));
    return opened;
  }

  function foreignTab(withOpen: boolean): string {
    return JSON.stringify({
      kind: "tab",
      id: "plugin-panel:far-away",
      title: "Page Z",
      pluginId: "studio",
      tab: {
        pluginId: "studio",
        tabId: "page",
        params: { page: "Z" },
        threadId: PANEL_STATE_ID,
      },
      ...(withOpen
        ? {
            open: {
              kind: "tab",
              tab: { id: "page", pluginId: "studio" },
              params: { page: "Z" },
              title: "Page Z",
            },
          }
        : {}),
    });
  }

  it("opens it in that panel through its open spec and leaves the drop to the source window to close", async () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        tabs: [
          {
            id: "page",
            title: "Page",
            context: { kind: "thread" },
            availability: "action",
            icon: "FileText",
            component: () => null,
          },
        ],
      }),
    );
    const opened = registerSurface();
    render(<Workbench />);
    dispose = installItemDropHost(document, environment());
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(ITEM_DRAG_TYPE, foreignTab(true));
    const strip = stripOfPane(0);
    const sealedData = new TestDataTransfer();
    sealedData.setData(ITEM_DRAG_TYPE, "");
    const sealed = dragEvent("dragover", sealedData, 500);
    strip.dispatchEvent(sealed);
    expect(sealed.defaultPrevented).toBe(true);
    expect(sealedData.dropEffect).toBe("move");
    const { drop } = await dropOn(strip, dataTransfer, 500);
    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatchObject({ params: { page: "Z" }, title: "Page Z" });
    expect(closed).toEqual([]);
  });

  it("refuses a tab that cannot leave its window: no-drop while dragging, nothing on drop", async () => {
    registerSurface();
    render(<Workbench />);
    dispose = installItemDropHost(document, environment());
    const strip = stripOfPane(0);
    const local = new TestDataTransfer();
    local.setData(ITEM_DRAG_TYPE, "");
    local.setData(ITEM_DRAG_LOCAL_TYPE, "1");
    const over = dragEvent("dragover", local, 500);
    strip.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);

    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(ITEM_DRAG_TYPE, foreignTab(false));
    const { drop } = await dropOn(strip, dataTransfer, 500);
    expect(drop.defaultPrevented).toBe(false);
    expect(paneLabels()).toEqual([["Page A", "Page B", "Page C"]]);
  });
});
