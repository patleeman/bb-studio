// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { ITEM_DRAG_TYPE } from "@/lib/fork-item-drag";
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

function register(run: (tab: unknown) => void = () => {}) {
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
        {
          ...tab,
          id: "bot",
          title: "Bot",
          experimental_compactWhenFixed: true,
        },
        { ...tab, id: "page", title: "Page" },
      ],
      panelTabActions: [
        {
          id: "main",
          title: "Open as main tab",
          isAvailable: (target) => target.tabId === "page",
          run,
        },
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
  it("is drawn first with no close button, icon only when the registration asks, then a divider", () => {
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
    const botButton = screen.getByRole("button", { name: "Bot" });
    expect(botButton.querySelector(".sr-only")?.textContent).toBe("Bot");
    expect(botPill?.parentElement?.getAttribute("title")).toBe("Bot");
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

describe("plugin items in a side panel tab's menu", () => {
  it("offers an available action on a plugin action tab and runs it with the tab and thread", () => {
    const run = vi.fn();
    register(run);
    render(
      <Strip
        panelStateId="thr_1"
        tabs={[
          renderable(terminal, "Terminal"),
          renderable(page, "Launch plan"),
          renderable(bot, "Bot"),
        ]}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Terminal" }));
    expect(
      screen.queryByRole("menuitem", { name: "Open as main tab" }),
    ).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: "Launch plan" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open as main tab" }));
    expect(run).toHaveBeenCalledWith({
      pluginId: "studio",
      tabId: "page",
      params: { page: "p1" },
      title: "Launch plan",
      threadId: "thr_1",
    });
  });
});

describe("dragging a side panel tab", () => {
  class TestDataTransfer {
    dropEffect = "none";
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

  class TestDragEvent extends MouseEvent {
    readonly dataTransfer: TestDataTransfer | null;

    constructor(
      type: string,
      init: MouseEventInit & { dataTransfer?: TestDataTransfer } = {},
    ) {
      super(type, init);
      this.dataTransfer = init.dataTransfer ?? null;
    }
  }

  const view = window as unknown as Record<string, unknown>;

  afterEach(() => {
    delete view.DataTransfer;
    delete view.DragEvent;
    Reflect.deleteProperty(document, "elementsFromPoint");
  });

  function dragOnto(tabName: string, target: Element): string[] {
    const received: string[] = [];
    target.addEventListener("dragover", (event) => event.preventDefault());
    target.addEventListener("drop", (event) => {
      received.push(
        (event as TestDragEvent).dataTransfer?.getData(ITEM_DRAG_TYPE) ?? "",
      );
    });
    view.DataTransfer = TestDataTransfer;
    view.DragEvent = TestDragEvent;
    document.elementsFromPoint = () => [target];
    const tab = screen.getByRole("button", { name: tabName });
    fireEvent.mouseDown(tab, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 60, clientY: 80 });
    fireEvent.mouseMove(document, { clientX: 90, clientY: 120 });
    fireEvent.mouseUp(document, { clientX: 90, clientY: 120 });
    return received;
  }

  function renderWithTarget(): HTMLElement {
    register();
    getDefaultStore().set(globalPanelTabsAtom, [bot]);
    const { container } = render(
      <div>
        <Strip
          panelStateId="thr_1"
          tabs={[
            renderable(terminal, "Terminal"),
            renderable(page, "Launch plan"),
            renderable(bot, "Bot"),
          ]}
        />
        <div data-testid="target" />
      </div>,
    );
    return container.querySelector<HTMLElement>('[data-testid="target"]')!;
  }

  it("carries a plugin action tab as the shared item payload", () => {
    const target = renderWithTarget();
    const received = dragOnto("Launch plan", target);
    expect(received.map((raw) => JSON.parse(raw) as unknown)).toEqual([
      {
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
      },
    ]);
  });

  it("carries nothing for bb's own tabs", () => {
    const target = renderWithTarget();
    expect(dragOnto("Terminal", target)).toEqual([]);
  });
});
