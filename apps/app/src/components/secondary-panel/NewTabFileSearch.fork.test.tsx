// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type {
  ExperimentalNewTabItemsRegistration,
  ExperimentalTabRegistration,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePluginPanelActions } from "@/components/plugin/PluginPanelActions";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import type { AppPanelController } from "@/lib/app-fixed-tab-navigation";
import {
  isThreadTab,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  usePluginSlots,
  type PluginThreadTabSlot,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { NewTabFileSearch } from "./NewTabFileSearch";
import { NewTabPage } from "./NewTabPage";

const NOW = Date.now();

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/hooks/useFileSearchSuggestions", () => ({
  useFileSearchSuggestions: () => ({
    suggestions: [],
    isLoading: false,
    fileSearchError: false,
    isDebouncing: false,
    isUnavailable: false,
  }),
}));

vi.mock("./threadRecentItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./threadRecentItems")>();
  return {
    ...actual,
    useThreadRecentItems: () => [
      { source: "workspace", path: "src/app.ts", openedAt: NOW - 60_000 },
    ],
  };
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function register(registration: ExperimentalNewTabItemsRegistration) {
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({ newTabItems: [registration] }),
  );
}

function renderNewTab() {
  render(
    <NewTabFileSearch
      autoFocus={false}
      projectId="proj_1"
      environmentId="env_1"
      currentThreadId="thr_1"
      actions={[]}
      onAutoFocusHandled={() => {}}
      onSelect={() => {}}
    />,
  );
}

function recentTitles(): string[] {
  return within(screen.getByRole("group", { name: "Recent" }))
    .getAllByRole("option")
    .map((row) => row.textContent ?? "");
}

describe("plugin items on the New Tab page", () => {
  it("merges a plugin's recent items into Recent, newest first, and opens them", () => {
    const open = vi.fn();
    const threadIds: (string | null)[] = [];
    register({
      id: "recent-pages",
      title: "Pages",
      useRecents: ({ threadId }) => {
        threadIds.push(threadId);
        return [
          {
            id: "plan",
            title: "Launch plan",
            kind: "Page",
            updatedAt: NOW - 1_000,
            open,
          },
          {
            id: "old",
            title: "Old board",
            kind: "Whiteboard",
            updatedAt: NOW - 3_600_000,
            open() {},
          },
          { id: "broken", title: "No time", kind: "Page", open() {} } as never,
        ];
      },
    });

    renderNewTab();

    const titles = recentTitles();
    expect(titles).toHaveLength(3);
    expect(titles[0]).toContain("Launch plan");
    expect(titles[0]).toContain("Page");
    expect(titles[1]).toContain("app.ts");
    expect(titles[2]).toContain("Old board");
    expect(threadIds).toContain("thr_1");
    fireEvent.click(screen.getByRole("option", { name: /Launch plan/ }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("lists search results under the registration's title and opens the first with Enter", async () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const search = vi.fn(async (query: string) => [
      {
        id: "hit",
        title: `Notes on ${query}`,
        kind: "Page",
        updatedAt: NOW,
        open,
      },
    ]);
    register({ id: "search-pages", title: "Pages", search });
    renderNewTab();

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "  roadmap " } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(search).toHaveBeenCalledWith(
      "roadmap",
      expect.objectContaining({ threadId: "thr_1" }),
    );
    const group = screen.getByRole("group", { name: "Pages" });
    expect(within(group).getByRole("option").textContent).toContain(
      "Notes on roadmap",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("draggable New Tab rows", () => {
  function dataTransfer() {
    const data = new Map<string, string>();
    return {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      get types() {
        return [...data.keys()];
      },
      data,
    };
  }

  const dragItem = {
    kind: "doc",
    id: "plan",
    title: "Launch plan",
    pluginId: "studio",
  } as const;

  it("writes a Recent row's experimental_dragItem as the item drag payload and leaves other rows undraggable", () => {
    register({
      id: "recent-pages",
      title: "Pages",
      useRecents: () => [
        {
          id: "plan",
          title: "Launch plan",
          kind: "Page",
          updatedAt: NOW - 1_000,
          open() {},
          experimental_dragItem: dragItem,
        },
        {
          id: "bad",
          title: "Bad drag",
          kind: "Page",
          updatedAt: NOW - 2_000,
          open() {},
          experimental_dragItem: { kind: "nope" } as never,
        },
      ],
    });
    renderNewTab();

    const row = screen.getByRole("option", { name: /Launch plan/ });
    expect(row.getAttribute("draggable")).toBe("true");
    expect(
      screen
        .getByRole("option", { name: /Bad drag/ })
        .getAttribute("draggable"),
    ).toBe("false");
    expect(
      screen.getByRole("option", { name: /app\.ts/ }).getAttribute("draggable"),
    ).toBeNull();

    const transfer = dataTransfer();
    fireEvent.dragStart(row, { dataTransfer: transfer });
    expect(
      JSON.parse(transfer.data.get("application/x-bb-item") ?? ""),
    ).toEqual(dragItem);
  });

  it("makes a search result with experimental_dragItem draggable", async () => {
    vi.useFakeTimers();
    register({
      id: "search-pages",
      title: "Pages",
      search: async () => [
        {
          id: "hit",
          title: "Roadmap",
          kind: "Page",
          updatedAt: NOW,
          open() {},
          experimental_dragItem: { ...dragItem, id: "hit", title: "Roadmap" },
        },
      ],
    });
    renderNewTab();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "road" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const row = within(screen.getByRole("group", { name: "Pages" })).getByRole(
      "option",
    );
    const transfer = dataTransfer();
    fireEvent.dragStart(row, { dataTransfer: transfer });
    expect(
      JSON.parse(transfer.data.get("application/x-bb-item") ?? ""),
    ).toMatchObject({ id: "hit", title: "Roadmap" });
  });
});

describe("action tabs kept off the New Tab page", () => {
  const panel = {} as AppPanelController;
  const tab = {
    icon: "Bot",
    component: () => null,
    context: { kind: "thread" },
    availability: "action",
  } as const;
  const tabs: ExperimentalTabRegistration[] = [
    { ...tab, id: "thread", title: "Thread" },
    { ...tab, id: "bot", title: "Bot", experimental_showInNewTab: false },
  ];
  let offered: string[] = [];

  function ThreadNewTab() {
    const pluginActions = usePluginPanelActions({
      panel,
      threadId: "thr_1",
      environmentId: "env_1",
      actions: usePluginSlots().tabs.filter(
        (
          slot,
        ): slot is Extract<PluginThreadTabSlot, { availability: "action" }> =>
          isThreadTab(slot) && slot.availability === "action",
      ),
    });
    offered = pluginActions.map((action) => action.title);
    return (
      <NewTabPage
        autoFocus={false}
        projectId="proj_1"
        environmentId="env_1"
        currentThreadId="thr_1"
        onAutoFocusHandled={() => {}}
        onSelect={() => {}}
        pluginActions={pluginActions}
      />
    );
  }

  function actionLabels(): string[] {
    const list = screen.queryByTestId("new-tab-actions");
    return list === null
      ? []
      : within(list)
          .getAllByRole("button")
          .map((row) => row.textContent ?? "")
          .filter((text) => text.length > 0);
  }

  it("leaves a tab with experimental_showInNewTab: false out of Actions and the action search, and keeps it registered", () => {
    setPluginSlotRegistrations("studio", makePluginRegistrationSet({ tabs }));
    render(<ThreadNewTab />);

    expect(offered).toEqual(["Thread", "Bot"]);
    expect(actionLabels().join(" ")).toContain("Thread");
    expect(actionLabels().join(" ")).not.toContain("Bot");

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "bot" } });
    expect(screen.queryByRole("option", { name: /Bot/ })).toBeNull();
    fireEvent.change(input, { target: { value: "thread" } });
    expect(screen.getByRole("option", { name: /Thread/ })).toBeTruthy();
  });

  it("lists every action tab when no registration opts out", () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        tabs: tabs.map(({ experimental_showInNewTab: _, ...rest }) => rest),
      }),
    );
    render(<ThreadNewTab />);

    expect(actionLabels().join(" ")).toContain("Bot");
  });
});

describe("grouped New Tab actions", () => {
  const panel = {} as AppPanelController;
  const base = {
    icon: "Bot",
    component: () => null,
    context: { kind: "thread" },
    availability: "action",
  } as const;

  function ThreadNewTab() {
    const pluginActions = usePluginPanelActions({
      panel,
      threadId: "thr_1",
      environmentId: "env_1",
      actions: usePluginSlots().tabs.filter(
        (
          slot,
        ): slot is Extract<PluginThreadTabSlot, { availability: "action" }> =>
          isThreadTab(slot) && slot.availability === "action",
      ),
    });
    return (
      <NewTabPage
        autoFocus={false}
        projectId="proj_1"
        environmentId="env_1"
        currentThreadId="thr_1"
        onAutoFocusHandled={() => {}}
        onSelect={() => {}}
        pluginActions={pluginActions}
      />
    );
  }

  function actionSections(): { heading: string; titles: string[] }[] {
    return screen.getAllByTestId("new-tab-actions").map((list) => ({
      heading:
        list.querySelector("section")?.firstElementChild?.textContent ?? "",
      titles: within(list)
        .getAllByRole("button")
        .map((row) => row.getAttribute("title"))
        .filter((title): title is string => title !== null),
    }));
  }

  it("lists grouped actions under their headings, in order of first registration, after bb's Actions", () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        tabs: [
          {
            ...base,
            id: "page",
            title: "Page",
            experimental_newTabGroup: "New",
          },
          { ...base, id: "plain", title: "Plain" },
          {
            ...base,
            id: "board",
            title: "Board",
            experimental_newTabGroup: "Open",
          },
          { ...base, id: "doc", title: "Doc", experimental_newTabGroup: "New" },
        ],
      }),
    );
    render(<ThreadNewTab />);

    expect(actionSections()).toEqual([
      { heading: "Actions", titles: ["Plain"] },
      { heading: "New", titles: ["Page", "Doc"] },
      { heading: "Open", titles: ["Board"] },
    ]);
  });

  it("drops the empty Actions section and lists a grouped action under Actions in search", () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        tabs: [
          {
            ...base,
            id: "page",
            title: "Page",
            experimental_newTabGroup: "New",
          },
        ],
      }),
    );
    render(<ThreadNewTab />);

    expect(actionSections()).toEqual([{ heading: "New", titles: ["Page"] }]);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "page" },
    });
    expect(
      within(screen.getByRole("group", { name: "Actions" })).getByRole(
        "option",
        { name: /Page/ },
      ),
    ).toBeTruthy();
  });
});
