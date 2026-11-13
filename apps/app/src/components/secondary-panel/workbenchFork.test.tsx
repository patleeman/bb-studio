// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  ITEM_DRAG_LOCAL_TYPE,
  ITEM_DRAG_TYPE,
  setCurrentDragItem,
} from "@/lib/fork-item-drag";
import {
  getPanelTabDragSource,
  resetPanelTabDragForTest,
} from "@/lib/fork-tab-move";
import { globalPanelTabsAtom } from "@/lib/fork-global-panel-tabs";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import type { SecondaryPanelRenderableTab } from "./secondaryPanelTab";
import { SecondaryPanelTabStrip } from "./SecondaryPanelTabStrip";
import { usePinnedFixedPanelTabs, WorkbenchPanelScope } from "./workbenchFork";

const bot = createPluginPanelFixedPanelTab({
  pluginId: "studio",
  actionId: "bot",
  paramsJson: null,
  title: "Bot",
});
const page = createPluginPanelFixedPanelTab({
  pluginId: "studio",
  actionId: "page",
  paramsJson: '{"page":"p1"}',
  title: "Launch plan",
});
const terminal = createTerminalFixedPanelTab({ terminalId: "term_1" });

function renderable(
  tab: SecondaryPanelRenderableTab["tab"],
  label: string,
): SecondaryPanelRenderableTab {
  return {
    label,
    isPinned: false,
    leadingVisual: <span data-testid={`icon-${label}`} />,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    renderContent: () => null,
    tab,
  };
}

function register() {
  const tab = {
    context: { kind: "thread" },
    availability: "action",
    icon: "FileText",
    component: () => null,
  } as const;
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      tabs: [
        { ...tab, id: "bot", title: "Bot" },
        { ...tab, id: "page", title: "Page" },
      ],
    }),
  );
}

function Strip({
  panelStateId,
  tabs,
}: {
  panelStateId: string;
  tabs: readonly SecondaryPanelRenderableTab[];
}) {
  const pinned = usePinnedFixedPanelTabs(tabs, panelStateId);
  return (
    <WorkbenchPanelScope panelStateId={panelStateId}>
      <SecondaryPanelTabStrip
        activeTabId={terminal.id}
        tabs={pinned}
        onReorderTab={vi.fn()}
        usesDesktopChrome={false}
        isPanelOpen
      />
    </WorkbenchPanelScope>
  );
}

function pillLabels(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-tab-pill]")].map(
    (pill) => pill.querySelector("button")?.textContent ?? null,
  );
}

afterEach(() => {
  cleanup();
  getDefaultStore().set(globalPanelTabsAtom, []);
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
});

describe("a fixed tab in the side panel tab strip", () => {
  it("is drawn first with no close button, then a divider", () => {
    register();
    getDefaultStore().set(globalPanelTabsAtom, [bot]);
    const { container } = render(
      <Strip
        panelStateId="thr_1"
        tabs={[
          renderable(terminal, "Terminal"),
          renderable(page, "Launch plan"),
          renderable(bot, "Bot"),
        ]}
      />,
    );

    expect(pillLabels(container)).toEqual(["Bot", "Terminal", "Launch plan"]);
    const [botPill, terminalPill] =
      container.querySelectorAll("[data-tab-pill]");
    expect(botPill?.querySelector("[data-tab-pill-close]")).toBeNull();
    expect(terminalPill?.querySelector("[data-tab-pill-close]")).not.toBeNull();
    expect(
      botPill?.parentElement?.nextElementSibling?.getAttribute(
        "data-panel-tabs-divider",
      ),
    ).toBe("fixed");
    expect(
      container.querySelectorAll("[data-panel-tabs-divider]"),
    ).toHaveLength(1);
  });

  it("is an ordinary closable tab where the fixed tab does not apply", () => {
    register();
    getDefaultStore().set(globalPanelTabsAtom, [bot]);
    const { container } = render(
      <Strip
        panelStateId="root-compose"
        tabs={[renderable(terminal, "Terminal"), renderable(bot, "Bot")]}
      />,
    );
    expect(pillLabels(container)).toEqual(["Terminal", "Bot"]);
    expect(container.querySelectorAll("[data-tab-pill-close]")).toHaveLength(2);
    expect(container.querySelector("[data-panel-tabs-divider]")).toBeNull();
  });

  it("keeps a fixed tab out of Close other tabs", () => {
    register();
    getDefaultStore().set(globalPanelTabsAtom, [bot]);
    const tabs = [
      renderable(bot, "Bot"),
      renderable(terminal, "Terminal"),
      renderable(page, "Launch plan"),
    ];
    render(<Strip panelStateId="thr_1" tabs={tabs} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Terminal" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }));
    expect(tabs[0]?.onClose).not.toHaveBeenCalled();
    expect(tabs[2]?.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("dragging a side panel tab", () => {
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

  afterEach(() => {
    resetPanelTabDragForTest();
    setCurrentDragItem(null);
  });

  function renderStrip(): HTMLElement {
    register();
    getDefaultStore().set(globalPanelTabsAtom, [bot]);
    const { container } = render(
      <Strip
        panelStateId="thr_1"
        tabs={[
          renderable(terminal, "Terminal"),
          renderable(page, "Launch plan"),
          renderable(bot, "Bot"),
        ]}
      />,
    );
    return container;
  }

  function dragHandleOf(tabName: string): HTMLElement {
    const pill = screen
      .getByRole("button", { name: tabName })
      .closest("[data-tab-pill]");
    const handle = pill?.parentElement;
    if (!(handle instanceof HTMLElement)) throw new Error("no tab handle");
    return handle;
  }

  function startDrag(tabName: string): TestDataTransfer {
    const dataTransfer = new TestDataTransfer();
    fireEvent.dragStart(dragHandleOf(tabName), { dataTransfer });
    return dataTransfer;
  }

  it("makes a plugin action tab a native drag source with the shared item payload and its open spec", () => {
    renderStrip();
    const handle = dragHandleOf("Launch plan");
    expect(handle.getAttribute("draggable")).toBe("true");
    const dataTransfer = startDrag("Launch plan");
    expect(dataTransfer.effectAllowed).toBe("all");
    expect(dataTransfer.types).toEqual([ITEM_DRAG_TYPE]);
    expect(JSON.parse(dataTransfer.getData(ITEM_DRAG_TYPE))).toEqual({
      kind: "tab",
      id: page.id,
      title: "Launch plan",
      pluginId: "studio",
      tab: {
        pluginId: "studio",
        tabId: "page",
        params: { page: "p1" },
        threadId: "thr_1",
      },
      open: {
        kind: "tab",
        tab: { id: "page", pluginId: "studio" },
        params: { page: "p1" },
        title: "Launch plan",
      },
    });
    expect(getPanelTabDragSource()).toMatchObject({
      panelStateId: "thr_1",
      key: page.id,
    });
  });

  it("marks bb's own tabs that cannot leave the window, and does not drag fixed tabs at all", () => {
    renderStrip();
    const dataTransfer = startDrag("Terminal");
    expect(dataTransfer.types).toEqual([ITEM_DRAG_TYPE, ITEM_DRAG_LOCAL_TYPE]);
    expect(JSON.parse(dataTransfer.getData(ITEM_DRAG_TYPE))).toEqual({
      kind: "tab",
      id: terminal.id,
      title: "Terminal",
    });
    const fixed = screen
      .getByRole("button", { name: "Bot" })
      .closest("[data-tab-pill]")?.parentElement;
    expect(fixed?.getAttribute("draggable")).not.toBe("true");
  });

  it("closes the tab when its drag ended as a move somewhere else, and keeps it otherwise", () => {
    const tabs = [
      renderable(terminal, "Terminal"),
      renderable(page, "Launch plan"),
    ];
    register();
    render(<Strip panelStateId="thr_1" tabs={tabs} />);
    const handle = dragHandleOf("Launch plan");
    const moved = new TestDataTransfer();
    fireEvent.dragStart(handle, { dataTransfer: moved });
    moved.dropEffect = "move";
    fireEvent.dragEnd(handle, { dataTransfer: moved });
    expect(tabs[1]?.onClose).toHaveBeenCalledTimes(1);

    const kept = new TestDataTransfer();
    fireEvent.dragStart(handle, { dataTransfer: kept });
    kept.dropEffect = "none";
    fireEvent.dragEnd(handle, { dataTransfer: kept });
    expect(tabs[1]?.onClose).toHaveBeenCalledTimes(1);
  });
});
