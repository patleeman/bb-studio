// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import type {
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { SidebarAnchors } from "@bb-studio/kit/app";
import { useSidebarReorderDnd } from "../ui/useSidebarReorderDnd.js";

vi.mock("../ui/useSidebarReorderDnd.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ui/useSidebarReorderDnd.js")>();
  return {
    ...actual,
    useSidebarReorderDnd: vi.fn(actual.useSidebarReorderDnd),
  };
});

const app = await loadPluginApp(() => import("../../app"));
const registration = app.experimentalSidebarNavigations[0];
if (!registration) throw new Error("navigation slot not registered");

function item(
  id: string,
  label: string,
  overrides: Partial<ExperimentalSidebarNavigationItem> = {},
): ExperimentalSidebarNavigationItem {
  const [pluginId, panelId] = id.split("/") as [string, string];
  const host = pluginId === "__bb__";
  return {
    id,
    label,
    icon: host
      ? { kind: "host", name: "new-thread" }
      : { kind: "plugin", pluginId, icon: "BookOpen" },
    action: host
      ? { kind: "new-thread" }
      : { kind: "open-plugin-panel", pluginId, panelId },
    isDisabled: false,
    isVisible: true,
    isLoading: false,
    pluginId: host ? null : pluginId,
    shortcut: null,
    experimental_Accessory: null,
    ...overrides,
  };
}

const STUDIO = item("studio/studio", "Studio");
const ITEMS = [
  item("__bb__/new-thread", "New thread"),
  STUDIO,
  item("pages/pages", "Pages"),
  item("bot-teams/bots", "Teams"),
  item("excalidraw/drawings", "Drawings"),
  item("bot-teams/channels", "New channel"),
  item("weather/forecast", "Forecast"),
  item("artifacts/artifacts", "Artifacts"),
  item("talk/recordings", "Recordings"),
  item("studio-tasks/tasks", "Tasks"),
  item("studio-tables/tables", "Tables"),
  item("__bb__/skills", "Skills"),
];

const PROPS: ExperimentalSidebarNavigationProps = {
  isCompactViewport: false,
  experimental_Original: () => null,
};

function renderNavigation(items = ITEMS) {
  return renderSlot(registration!, PROPS, {
    sidebarNavigation: { items, activeItemId: null },
  });
}

function rowOrder(): string[] {
  return Array.from(
    document.querySelectorAll("[data-sidebar-navigation-item]"),
    (row) => row.getAttribute("data-sidebar-navigation-item") ?? "",
  );
}

afterEach(cleanup);

describe("Studio Navigation", () => {
  it("leaves out add-on panels the Studio hub opens and keeps every other row", () => {
    renderNavigation();

    expect(rowOrder()).toEqual([
      "__bb__/new-thread",
      "studio/studio",
      "bot-teams/bots",
      "bot-teams/channels",
      "weather/forecast",
      "__bb__/skills",
    ]);
  });

  it("keeps add-on panels while the Studio hub can't open them", () => {
    renderNavigation(ITEMS.filter((entry) => entry !== STUDIO));
    expect(rowOrder()).toContain("pages/pages");
    cleanup();

    renderNavigation(
      ITEMS.map((entry) =>
        entry === STUDIO ? { ...entry, isLoading: true } : entry,
      ),
    );
    expect(rowOrder()).toContain("pages/pages");
  });

  it("leaves out New channel while Studio Sidebar shows the Channels section", () => {
    render(<SidebarAnchors onNavigate={() => {}} />);
    renderNavigation();

    expect(rowOrder()).not.toContain("bot-teams/channels");
    expect(rowOrder()).toContain("bot-teams/bots");
  });

  it("keeps rows it leaves out in place when reordering", () => {
    const view = renderNavigation();
    const options = vi.mocked(useSidebarReorderDnd).mock.lastCall?.[0];
    if (!options) throw new Error("reorder handler is not mounted");

    act(() =>
      options.onDragEnd({
        active: { id: "weather/forecast" },
        over: { id: "studio/studio" },
      } as DragEndEvent),
    );

    expect(view.inspection.sidebarNavigationCalls).toEqual([
      {
        method: "setOrder",
        itemIds: [
          "__bb__/new-thread",
          "weather/forecast",
          "pages/pages",
          "studio/studio",
          "excalidraw/drawings",
          "bot-teams/bots",
          "bot-teams/channels",
          "artifacts/artifacts",
          "talk/recordings",
          "studio-tasks/tasks",
          "studio-tables/tables",
          "__bb__/skills",
        ],
      },
    ]);
  });
});
