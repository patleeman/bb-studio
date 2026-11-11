// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import {
  sidebarNavigationProviderAtom,
  useResolvedSidebarNavigation,
} from "@/components/sidebar/sidebarNavigationProvider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { forkCascade } from "@/test/fork-css-cascade";
import { registerNavigationPlugin } from "@/test/fixtures/navigation-plugin";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: () => {},
  useAppCommandRunner: () => ({
    dispatch: () => {},
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useAppCommandShortcuts: () => [],
  useIndexedAppCommandHandlers: () => {},
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/components/sidebar/PluginThreadList", () => ({
  PluginThreadList: () => <div data-testid="thread-list" />,
}));

vi.mock("@/components/sidebar/SidebarPluginAttentionGlyph", () => ({
  SidebarPluginAttentionGlyph: () => null,
}));

vi.mock("@/components/sidebar/SidebarUpdatesBadge", () => ({
  SidebarUpdatesBadge: () => null,
}));

const root = document.documentElement;

function Harness() {
  const navigation = useResolvedSidebarNavigation();
  return (
    <>
      <AppSidebar
        onResizeMouseDown={() => {}}
        isResizing={false}
        isBodyHidden={false}
        navigation={navigation}
        settingsRoutePath="/settings"
        isSettingsActive={false}
        alternateBody={null}
      />
      <SidebarInset>
        <AppPageHeader
          center={<span>Migrate payments</span>}
          actions={<button type="button">Commit</button>}
        />
      </SidebarInset>
    </>
  );
}

function renderLayout(preference: string, framed: boolean) {
  const store = createStore();
  store.set(sidebarNavigationProviderAtom, preference);
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/"]}>
        <CompactViewportOverrideProvider isCompactViewport={false}>
          <TooltipProvider>
            <SidebarProvider framed={framed}>
              <Harness />
            </SidebarProvider>
          </TooltipProvider>
        </CompactViewportOverrideProvider>
      </MemoryRouter>
    </Provider>,
  );
  root.setAttribute("data-fork-backdrop", "studio/scene");
  root.setAttribute("data-fork-cards", "");
}

function all(selector: string): Element[] {
  const elements = [...document.querySelectorAll(selector)];
  expect(elements.length, selector).toBeGreaterThan(0);
  return elements;
}

const SIDEBAR_PAINT = "var(--fork-surface-sidebar-background, transparent)";

function expectCard(element: Element, surface: string, radius: string) {
  expect(forkCascade(element, "background")).toBe(
    `var(--fork-surface-${surface}-background, transparent)`,
  );
  expect(forkCascade(element, "backdrop-filter")).toBe(
    `var(--fork-surface-${surface}-backdrop-filter, none)`,
  );
  expect(forkCascade(element, "border-radius")).toBe(radius);
  expect(forkCascade(element, "border")).toBe("0");
  expect(forkCascade(element, "box-shadow")).toBe("var(--fork-cards-shadow)");
}

function expectSeeThrough(element: Element) {
  expect(["none", "transparent", null]).toContain(
    forkCascade(element, "background"),
  );
  expect(["none", null]).toContain(forkCascade(element, "backdrop-filter"));
  expect(["none", null]).toContain(forkCascade(element, "clip-path"));
}

function expectBare(element: Element) {
  expectSeeThrough(element);
  expect(["none", null]).toContain(forkCascade(element, "box-shadow"));
  expect([null, "0"]).toContain(forkCascade(element, "border"));
  expect(forkCascade(element, "border-radius")).toBeNull();
}

function railSettingsCell(): Element {
  const cell = screen
    .getByRole("button", { name: "Settings" })
    .closest("nav ~ div");
  if (cell === null) throw new Error("Expected the rail's settings cell");
  return cell;
}

function sidebarGrid(): Element {
  const grid = all('[data-sidebar="collapsible-body"]')[0]?.parentElement;
  if (grid === null || grid === undefined) {
    throw new Error("Expected the sidebar's grid");
  }
  return grid;
}

function expectSidebarCard(grid: Element, marginLeft: string) {
  expect(grid.parentElement?.getAttribute("data-sidebar")).toBe("sidebar");
  expect(forkCascade(grid, "background", "::before")).toBe(SIDEBAR_PAINT);
  expect(forkCascade(grid, "backdrop-filter", "::before")).toBe(
    "var(--fork-surface-sidebar-backdrop-filter, none)",
  );
  expect(forkCascade(grid, "border-radius", "::before")).toBe(
    "var(--fork-cards-radius)",
  );
  expect(forkCascade(grid, "border", "::before")).toBe("0");
  expect(forkCascade(grid, "box-shadow", "::before")).toBe(
    "var(--fork-cards-shadow)",
  );
  expect(forkCascade(grid, "grid-column", "::before")).toBe("2");
  expect(forkCascade(grid, "grid-row", "::before")).toBe("1 / span 2");
  expect(forkCascade(grid, "margin-left", "::before")).toBe(marginLeft);
  expect(forkCascade(grid, "padding-block")).toBe("var(--fork-cards-gap)");
  for (const body of grid.querySelectorAll(
    ':scope > [data-sidebar="collapsible-body"]',
  )) {
    expect(body.className).toContain("col-start-2");
  }
}

beforeEach(async () => {
  window.localStorage.clear();
  resetPluginFrontendBootStateForTest();
  markPluginFrontendsSettled();
  await registerNavigationPlugin();
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  window.localStorage.clear();
  root.removeAttribute("data-fork-backdrop");
  root.removeAttribute("data-fork-cards");
});

describe.each([
  ["a browser window", false],
  ["a framed macOS window", true],
])("bb's sidebar and header as cards in %s", (_name, framed) => {
  it("leaves the rail and its settings cell bare on the scene and draws the sidebar as one card that holds the footer", async () => {
    renderLayout("navigation/rail", framed);
    const rail = document.querySelector(
      'nav[data-sidebar-navigation-placement="rail"]',
    );
    expect(rail).not.toBeNull();
    if (rail === null) return;
    for (const bare of [rail, railSettingsCell()]) {
      expectBare(bare);
      expect(forkCascade(bare, "margin")).toBeNull();
      expect(forkCascade(bare, "filter")).toBe("var(--fork-cards-icon-halo)");
    }
    const grid = sidebarGrid();
    expect(rail.parentElement).toBe(grid);
    expectSidebarCard(grid, "0");
    expect(all('[data-sidebar="collapsible-body"]')).toHaveLength(2);
    const footer = all('[data-sidebar="footer"]');
    expect(footer).toHaveLength(1);
    expect(footer[0]?.closest('[data-sidebar="collapsible-body"]')).toBe(
      grid.lastElementChild,
    );
    expectBare(footer[0] as Element);
    expect(forkCascade(footer[0] as Element, "margin")).toBeNull();
    for (const container of all(
      '[data-sidebar="panel"], [data-sidebar="sidebar"], [data-sidebar="collapsible-body"]',
    )) {
      expectSeeThrough(container);
    }
    for (
      let element = rail.parentElement;
      element !== null;
      element = element.parentElement
    ) {
      expectSeeThrough(element);
    }
  });

  it("draws one card under a list sidebar, with the navigation and the footer inside it", async () => {
    renderLayout("navigation/top-list", framed);
    const grid = sidebarGrid();
    expectSidebarCard(grid, "var(--fork-cards-gap)");
    const bodies = all('[data-sidebar="collapsible-body"]');
    expect(bodies).toHaveLength(1);
    const footer = all('[data-sidebar="footer"]');
    expect(footer).toHaveLength(1);
    expect(bodies[0]?.contains(footer[0] as Element)).toBe(true);
    expectBare(footer[0] as Element);
    const navigation = all('nav[data-sidebar-navigation-placement="list"]')[0];
    expect(bodies[0]?.contains(navigation as Element)).toBe(true);
    expectBare(navigation as Element);
    for (const container of all(
      '[data-sidebar="panel"], [data-sidebar="sidebar"], [data-sidebar="collapsible-body"]',
    )) {
      expectSeeThrough(container);
    }
  });

  it("draws no sidebar card while the sidebar is collapsed to its rail", async () => {
    renderLayout("navigation/rail", framed);
    const grid = sidebarGrid();
    expect(forkCascade(grid, "display", "::before")).toBeNull();
    const group = grid.closest("[data-collapsible]");
    group?.setAttribute("data-collapsible", "rail");
    expect(forkCascade(grid, "display", "::before")).toBe("none");
  });

  it("leaves the header bare and makes its title and actions groups header pills with no outline", async () => {
    renderLayout("navigation/top-list", framed);
    const header = all('[data-sidebar="inset"] header')[0] as Element;
    expectSeeThrough(header);
    expect(forkCascade(header, "border-color")).toBe("transparent");
    const title = screen.getByText("Migrate payments").parentElement;
    expect(title?.getAttribute("data-fork-header-group")).toBe("title");
    const actions = screen.getByRole("button", {
      name: "Commit",
    }).parentElement;
    expect(actions?.getAttribute("data-fork-header-group")).toBe("actions");
    root.setAttribute("data-fork-surface-edge", "header sidebar");
    for (const pill of [title, actions]) {
      if (pill === null) continue;
      expectCard(pill, "header", "var(--fork-cards-control-radius)");
      expect(forkCascade(pill, "border-color")).toBeNull();
    }
    expect(forkCascade(header, "border-color")).toBe("transparent");
    expect(forkCascade(sidebarGrid(), "border-color", "::before")).toBeNull();
    root.removeAttribute("data-fork-surface-edge");
  });

  it("makes the sidebar's back and forward buttons a header pill", async () => {
    renderLayout("navigation/top-list", framed);
    const groups = [
      ...document.querySelectorAll('[data-fork-header-group="history"]'),
    ];
    if (framed) {
      expect(groups).toEqual([]);
      return;
    }
    expect(groups).toHaveLength(1);
    expectCard(
      groups[0] as Element,
      "header",
      "var(--fork-cards-control-radius)",
    );
    expect(
      groups[0]?.closest('[data-testid="app-sidebar-top-reserve-row"]'),
    ).not.toBeNull();
  });

  it("keeps the sidebar one card: its content and a plugin's cards inside it paint nothing", async () => {
    renderLayout("navigation/rail", framed);
    const content = all('[data-sidebar="content"]')[0] as Element;
    expectBare(content);
    expect(forkCascade(content, "margin")).toBeNull();
    const nested = document.createElement("div");
    nested.setAttribute("data-fork-card", "sidebar");
    content.append(nested);
    expect(forkCascade(nested, "background")).toBe("none");
    expect(forkCascade(nested, "backdrop-filter")).toBe("none");
    expect(forkCascade(nested, "box-shadow")).toBe("none");
    const outside = document.createElement("div");
    outside.setAttribute("data-fork-card", "sidebar");
    document.body.append(outside);
    expectCard(outside, "sidebar", "var(--fork-cards-radius)");
    nested.remove();
    outside.remove();
  });

  it("applies none of it without a card layout", async () => {
    renderLayout("navigation/rail", framed);
    root.removeAttribute("data-fork-cards");
    const rail = all('nav[data-sidebar-navigation-placement="rail"]')[0];
    expect(forkCascade(rail as Element, "filter")).toBeNull();
    const grid = sidebarGrid();
    expect(forkCascade(grid, "background", "::before")).toBeNull();
    expect(forkCascade(grid, "content", "::before")).toBeNull();
    expect(forkCascade(grid, "padding-block")).toBeNull();
    expect(
      forkCascade(all('[data-sidebar="panel"]')[0] as Element, "background"),
    ).toBe("var(--fork-surface-sidebar-background, transparent)");
  });
});
