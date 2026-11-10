// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  createTerminalFixedPanelTab,
  type SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { ZoneDecision } from "@/lib/split-drag";
import type { SecondaryPanelRenderableTab } from "./secondaryPanelTab";
import { SecondaryPanelTabStrip } from "./SecondaryPanelTabStrip";
import {
  SidebarSplitContainer,
  type SidebarSplitTabDescriptor,
} from "./SidebarSplitContainer";
import {
  createSidebarSplitState,
  moveSidebarTab,
  serializeSidebarSplitState,
  sidebarSplitStorageKey,
} from "./sidebarSplitLayout";
import { WorkbenchPanelScope } from "./workbenchFork";
import {
  limitWorkbenchDrop,
  restoresWorkbenchSplit,
  workbenchSplitsFor,
} from "./workbenchSplits.fork";

const PANEL_STATE_ID = "thr_split";
const tabA = createTerminalFixedPanelTab({ terminalId: "term_a" });
const tabB = createTerminalFixedPanelTab({ terminalId: "term_b" });
const tabC = createTerminalFixedPanelTab({ terminalId: "term_c" });
const LABELS = new Map([
  [tabA.id, "Term A"],
  [tabB.id, "Term B"],
  [tabC.id, "Term C"],
]);
const ALL = [tabA, tabB, tabC];

function descriptor(
  tab: SecondaryFileFixedPanelTab,
): SidebarSplitTabDescriptor {
  return {
    id: tab.id,
    label: LABELS.get(tab.id) ?? tab.id,
    restoresPlacementAfterRemoval: true,
  };
}

function renderable(
  tab: SecondaryFileFixedPanelTab,
): SecondaryPanelRenderableTab {
  return {
    label: LABELS.get(tab.id) ?? tab.id,
    isPinned: false,
    leadingVisual: null,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    renderContent: () => null,
    tab,
  };
}

function Workbench({
  panelStateId = PANEL_STATE_ID,
  tabs = ALL,
}: {
  panelStateId?: string;
  tabs?: readonly SecondaryFileFixedPanelTab[];
}) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <SidebarSplitContainer
          activeTabId={tabA.id}
          isFullScreen={false}
          onActivateTab={vi.fn()}
          onGlobalTabReorder={vi.fn()}
          onToggleFullScreen={vi.fn()}
          panelStateId={panelStateId}
          tabs={tabs.map(descriptor)}
          renderPane={({ group, paneId }) => (
            <div data-testid={`pane:${paneId}`}>
              <WorkbenchPanelScope panelStateId={panelStateId}>
                <SecondaryPanelTabStrip
                  activeTabId={group.activeTabId}
                  tabs={group.tabIds.flatMap((id) => {
                    const tab = tabs.find((candidate) => candidate.id === id);
                    return tab === undefined ? [] : [renderable(tab)];
                  })}
                  onReorderTab={vi.fn()}
                  usesDesktopChrome={false}
                  isPanelOpen
                />
              </WorkbenchPanelScope>
            </div>
          )}
        />
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

function openMenu(label: string): void {
  fireEvent.contextMenu(screen.getByRole("button", { name: label }));
}

function chooseFromMenu(label: string, item: string): void {
  openMenu(label);
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("workbench panes", () => {
  it("moves a tab into a new pane on the right and between the two panes from its menu", () => {
    render(<Workbench />);
    expect(paneLabels()).toEqual([["Term A", "Term B", "Term C"]]);

    chooseFromMenu("Term B", "Move to new pane");
    expect(paneLabels()).toEqual([["Term A", "Term C"], ["Term B"]]);
    expect(
      document
        .querySelector("[data-sidebar-split-container]")
        ?.getAttribute("data-sidebar-split-root-direction"),
    ).toBe("row");

    chooseFromMenu("Term C", "Move to other pane");
    expect(paneLabels()).toEqual([["Term A"], ["Term B", "Term C"]]);

    chooseFromMenu("Term A", "Move to other pane");
    expect(paneLabels()).toEqual([["Term B", "Term C", "Term A"]]);
  });

  it("does not offer a new pane for a pane's only tab", () => {
    render(<Workbench tabs={[tabA]} />);
    openMenu("Term A");
    expect(
      screen
        .getByRole("menuitem", { name: "Move to new pane" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("never makes a third pane", () => {
    render(<Workbench />);
    const splits = workbenchSplitsFor(PANEL_STATE_ID);
    act(() => {
      expect(splits?.moveToNewPane(tabB.id)).toBe(true);
    });
    act(() => {
      expect(splits?.moveToNewPane(tabC.id)).toBe(false);
      expect(splits?.setPaneCount(2)).toBe(true);
    });
    expect(paneLabels()).toEqual([["Term A", "Term C"], ["Term B"]]);
    openMenu("Term C");
    expect(
      screen.queryByRole("menuitem", { name: "Move to new pane" }),
    ).toBeNull();
  });

  it("closes a pane that loses its last tab", () => {
    const view = render(<Workbench />);
    chooseFromMenu("Term C", "Move to new pane");
    expect(paneLabels()).toEqual([["Term A", "Term B"], ["Term C"]]);

    view.rerender(<Workbench tabs={[tabA, tabB]} />);
    expect(paneLabels()).toEqual([["Term A", "Term B"]]);
    expect(document.querySelector("[data-split-pane-id]")).toBeNull();
  });

  it("keeps its divider per conversation and restores only side-by-side panes", () => {
    const first = render(<Workbench />);
    act(() => {
      workbenchSplitsFor(PANEL_STATE_ID)?.moveToNewPane(tabC.id);
    });
    act(() => {
      expect(workbenchSplitsFor(PANEL_STATE_ID)?.setPaneWidths([3, 1])).toBe(
        true,
      );
    });
    first.unmount();

    render(<Workbench />);
    expect(
      workbenchSplitsFor(PANEL_STATE_ID)
        ?.panes()
        .map((pane) => pane.widthPercent),
    ).toEqual([75, 25]);
    cleanup();

    render(<Workbench panelStateId="thr_other" />);
    expect(
      workbenchSplitsFor("thr_other")
        ?.panes()
        .map((pane) => pane.widthPercent),
    ).toEqual([100]);
    cleanup();

    const stacked = moveSidebarTab(
      createSidebarSplitState(
        ALL.map((tab) => tab.id),
        tabA.id,
      ),
      "pane-primary",
      tabC.id,
      { paneId: "pane-primary", zone: "bottom" },
      { groupId: "group-c" },
    );
    window.localStorage.setItem(
      sidebarSplitStorageKey(PANEL_STATE_ID),
      serializeSidebarSplitState(stacked),
    );
    render(<Workbench />);
    expect(paneLabels()).toEqual([["Term A", "Term B", "Term C"]]);
  });

  it("places a tab in a pane before another tab, or in a new pane", async () => {
    render(<Workbench />);
    const splits = workbenchSplitsFor(PANEL_STATE_ID);
    await act(async () => {
      await expect(splits?.place(tabC.id, { pane: "new" })).resolves.toBe(true);
    });
    expect(paneLabels()).toEqual([["Term A", "Term B"], ["Term C"]]);

    await act(async () => {
      await expect(
        splits?.place(tabA.id, { pane: 2, before: tabC.id }),
      ).resolves.toBe(true);
    });
    expect(paneLabels()).toEqual([["Term B"], ["Term A", "Term C"]]);

    await act(async () => {
      await expect(splits?.place(tabA.id, { pane: "new" })).resolves.toBe(
        false,
      );
    });
  });
});

describe("workbench split rules", () => {
  const decide = vi.fn(
    (_paneId: string, zone: ZoneDecision["zone"]): ZoneDecision => ({
      zone,
      label: zone,
    }),
  );
  const one = createSidebarSplitState(["a", "b"], "a");
  const two = moveSidebarTab(
    one,
    "pane-primary",
    "b",
    { paneId: "pane-primary", zone: "right" },
    { groupId: "group-b" },
  );

  it("splits only to the right of a single pane", () => {
    const limited = limitWorkbenchDrop(one.layout.root, "pane-primary", decide);
    expect(limited("pane-primary", "right")).toEqual({
      zone: "right",
      label: "right",
    });
    for (const zone of ["left", "top", "bottom", "center"] as const) {
      expect(limited("pane-primary", zone)).toBeNull();
    }
  });

  it("with two panes, drops anywhere on the other pane into its tab row", () => {
    const [, right] =
      two.layout.root.type === "split" ? two.layout.root.children : [];
    const rightPaneId = right?.type === "pane" ? right.paneId : "";
    const limited = limitWorkbenchDrop(two.layout.root, "pane-primary", decide);
    for (const zone of ["left", "right", "top", "bottom", "center"] as const) {
      expect(limited(rightPaneId, zone)?.zone).toBe("center");
      expect(limited("pane-primary", zone)).toBeNull();
    }
  });

  it("restores a stored row of up to two panes and nothing stacked or nested", () => {
    const stacked = moveSidebarTab(
      one,
      "pane-primary",
      "b",
      { paneId: "pane-primary", zone: "bottom" },
      { groupId: "group-b" },
    );
    expect(restoresWorkbenchSplit(null)).toBe(true);
    expect(restoresWorkbenchSplit(serializeSidebarSplitState(one))).toBe(true);
    expect(restoresWorkbenchSplit(serializeSidebarSplitState(two))).toBe(true);
    expect(restoresWorkbenchSplit(serializeSidebarSplitState(stacked))).toBe(
      false,
    );
    const nested = {
      ...two,
      layout: {
        ...two.layout,
        root: {
          type: "split",
          dir: "row",
          sizes: [0.5, 0.5],
          children: [stacked.layout.root, { type: "pane", paneId: "p3" }],
        },
      },
    };
    expect(restoresWorkbenchSplit(JSON.stringify(nested))).toBe(false);
  });
});
