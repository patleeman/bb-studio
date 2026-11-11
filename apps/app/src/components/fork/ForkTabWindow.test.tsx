// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createPortal } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginTabWindow } from "@/lib/fork-tab-window";
import {
  ITEM_DRAG_TYPE,
  PANEL_TAB_STRIP_SELECTOR,
  setCurrentDragItem,
} from "@/lib/fork-item-drag";
import { tabWindowPath, WINDOW_INSTANCE_ID } from "@/lib/fork-tab-popout";
import { resetPanelTabDragForTest } from "@/lib/fork-tab-move";
import { tabWindowPanelStateId } from "@/lib/fork-tab-window-panel";
import { resetWorkbenchSurfacesForTest } from "@/lib/fork-workbench";
import { getFixedPanelTabsStateStorageKey } from "@/lib/fixed-panel-tabs-state";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ForkTabWindow } from "./ForkTabWindow";

const returned = vi.hoisted(() => ({ requests: [] as unknown[] }));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({
    data: { id: "thr_1", projectId: "proj_1", environmentId: null },
  }),
}));

vi.mock("@/lib/bb-desktop", async (original) => ({
  ...(await original<typeof import("@/lib/bb-desktop")>()),
  getBbDesktopInfo: () => null,
}));

vi.mock("@/lib/fork-tab-return", () => ({
  requestTabReturn: (request: unknown) => {
    returned.requests.push(request);
    return Promise.resolve(true);
  },
}));

vi.mock("@/components/plugin/PluginPanelActions", async (original) => ({
  ...(await original<
    typeof import("@/components/plugin/PluginPanelActions")
  >()),
  PluginPanelTabContent: ({
    tab,
  }: {
    tab: { actionId: string; title: string };
  }) => <TabProbe name={tab.actionId} />,
}));

function TabProbe({ name }: { name: string }) {
  const tabWindow = usePluginTabWindow();
  return (
    <>
      <p data-testid={`probe-${name}`}>{tabWindow?.title ?? "no window"}</p>
      {tabWindow?.toolbar
        ? createPortal(
            <button type="button">New {name}</button>,
            tabWindow.toolbar,
          )
        : null}
    </>
  );
}

const WINDOW_ID = "win_1";
const PANEL_STATE_ID = tabWindowPanelStateId("thr_1", WINDOW_ID);

function registerStudioTabs() {
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
        { ...tab, id: "memory", title: "Memory" },
        { ...tab, id: "page", title: "Page" },
      ],
    }),
  );
}

function renderWindow() {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const path = tabWindowPath({
    threadId: "thr_1",
    windowId: WINDOW_ID,
    spec: { kind: "tab", tab: { id: "memory", pluginId: "studio" } },
    pane: 2,
    from: WINDOW_INSTANCE_ID,
    title: "Memory",
  });
  return render(
    <Wrapper>
      <MemoryRouter initialEntries={[path]}>
        <ForkTabWindow />
      </MemoryRouter>
    </Wrapper>,
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

function storedTabIds(panelStateId: string): string[] {
  const raw = window.localStorage.getItem(
    getFixedPanelTabsStateStorageKey({ threadId: panelStateId }),
  );
  if (raw === null) return [];
  const parsed = JSON.parse(raw) as {
    secondary?: { tabs?: { id: string }[] };
  };
  return (parsed.secondary?.tabs ?? []).map((tab) => tab.id);
}

async function dropPageTab(label: string, page: string) {
  const strip = document.querySelector<HTMLElement>(PANEL_TAB_STRIP_SELECTOR);
  if (strip === null) throw new Error("no tab strip");
  const dataTransfer = new TestDataTransfer();
  dataTransfer.setData(
    ITEM_DRAG_TYPE,
    JSON.stringify({
      kind: "tab",
      id: "plugin-panel:elsewhere",
      title: label,
      pluginId: "studio",
      tab: {
        pluginId: "studio",
        tabId: "page",
        params: { page },
        threadId: "thr_1",
      },
      open: {
        kind: "tab",
        tab: { id: "page", pluginId: "studio" },
        params: { page },
        title: label,
      },
    }),
  );
  const over = new Event("dragover", { bubbles: true, cancelable: true });
  Object.assign(over, { dataTransfer, clientX: 40, clientY: 10 });
  strip.dispatchEvent(over);
  expect(over.defaultPrevented).toBe(true);
  expect(dataTransfer.dropEffect).toBe("move");
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.assign(drop, { dataTransfer, clientX: 40, clientY: 10 });
  await act(async () => {
    strip.dispatchEvent(drop);
  });
  expect(drop.defaultPrevented).toBe(true);
  await screen.findByRole("button", { name: label });
}

beforeEach(() => {
  registerStudioTabs();
});

afterEach(() => {
  cleanup();
  resetWorkbenchSurfacesForTest();
  resetPluginSlotStoreForTest();
  resetPanelTabDragForTest();
  setCurrentDragItem(null);
  returned.requests.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("a popped-out tab window", () => {
  it("opens the popped-out tab in its own panel state, tells it the bar's title and takes its controls there", async () => {
    renderWindow();
    expect((await screen.findByTestId("probe-memory")).textContent).toBe(
      "Memory",
    );
    const header = document.querySelector("[data-fork-tab-window] > header");
    if (!(header instanceof HTMLElement)) throw new Error("no window bar");
    const control = await within(header).findByRole("button", {
      name: "New memory",
    });
    expect(
      control.parentElement?.hasAttribute("data-fork-tab-window-toolbar"),
    ).toBe(true);
    expect(document.title).toBe("Memory");
    expect(storedTabIds(PANEL_STATE_ID)).toHaveLength(1);
    expect(storedTabIds("thr_1")).toEqual([]);
  });

  it("adds a tab dropped on its tab strip, follows the selected tab in its title and gives that tab the toolbar", async () => {
    renderWindow();
    await screen.findByTestId("probe-memory");
    await dropPageTab("Roadmap", "p1");
    expect(storedTabIds(PANEL_STATE_ID)).toHaveLength(2);
    expect(document.title).toBe("Roadmap");
    expect(screen.getByTestId("probe-page").textContent).toBe("Roadmap");
    expect(screen.queryByTestId("probe-memory")).toBeNull();
    const header = document.querySelector("[data-fork-tab-window] > header");
    if (!(header instanceof HTMLElement)) throw new Error("no window bar");
    expect(
      within(header)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["New page", "Return to workbench"]);
  });

  it("closes itself when its last tab is dragged out as a move", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    renderWindow();
    await screen.findByTestId("probe-memory");
    const handle = screen
      .getByRole("button", { name: "Memory" })
      .closest("[data-tab-pill]")?.parentElement;
    if (!(handle instanceof HTMLElement)) throw new Error("no tab handle");
    const dataTransfer = new TestDataTransfer();
    fireEvent.dragStart(handle, { dataTransfer });
    expect(JSON.parse(dataTransfer.getData(ITEM_DRAG_TYPE))).toMatchObject({
      kind: "tab",
      tab: { tabId: "memory", threadId: "thr_1" },
      open: { kind: "tab", tab: { id: "memory", pluginId: "studio" } },
    });
    dataTransfer.dropEffect = "move";
    await act(async () => {
      fireEvent.dragEnd(handle, { dataTransfer });
    });
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(storedTabIds(PANEL_STATE_ID)).toEqual([]);
  });

  it("returns every tab to the opener's workbench", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    renderWindow();
    await screen.findByTestId("probe-memory");
    await dropPageTab("Roadmap", "p1");
    fireEvent.click(
      screen.getByRole("button", { name: "Return to workbench" }),
    );
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(returned.requests).toEqual([
      {
        threadId: "thr_1",
        projectId: "proj_1",
        from: WINDOW_INSTANCE_ID,
        tabs: [
          {
            pane: 2,
            spec: {
              kind: "tab",
              tab: { id: "memory", pluginId: "studio" },
              title: "Memory",
            },
          },
          {
            pane: 2,
            spec: {
              kind: "tab",
              tab: { id: "page", pluginId: "studio" },
              params: { page: "p1" },
              title: "Roadmap",
            },
          },
        ],
      },
    ]);
  });

  it("reports no tab window outside one", () => {
    render(<TabProbe name="x" />);
    expect(screen.getByTestId("probe-x").textContent).toBe("no window");
  });
});
