// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import type { PaneContent } from "@/lib/split-layout";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { SplitThreadArea } from "./SplitThreadArea";

const viewport = vi.hoisted(() => ({ compact: false }));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewport.compact,
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandContext: () => undefined,
  useAppCommandHandler: () => {},
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
  useIndexedAppCommandHandlers: () => {},
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  useIsSidebarShowing: () => true,
  useOptionalIsSidebarShowing: () => true,
  useSidebarKeepsCollapsedRail: () => false,
  useIsSidebarFramed: () => false,
}));

vi.mock("@/views/RootComposeView", () => ({
  RootComposeView: () => <div data-testid="root-compose-view" />,
}));

vi.mock("@/components/plugin/PluginPanelRightPanelHost", () => ({
  PluginPanelRightPanelHost: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("./LazyThreadDetailView", () => ({
  LazyThreadDetailView: () => <div data-testid="thread-pane" />,
}));

const { queryClient } = createQueryClientTestHarness();

const docsContent: PaneContent = {
  kind: "plugin-panel",
  pluginId: "docs",
  panelPath: "docs",
  subPath: "",
};

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
  window.sessionStorage.clear();
  viewport.compact = false;
});

function renderDocs() {
  setPluginSlotRegistrations(
    "docs",
    makePluginRegistrationSet({
      navPanels: [
        {
          id: "docs",
          title: "Docs",
          icon: "FileText",
          path: "docs",
          component: () => <div>Docs panel</div>,
        },
      ],
    }),
  );
  const store = createStore();
  render(
    <TooltipProvider delayDuration={0}>
      <JotaiProvider store={store}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/plugins/docs/docs"]}>
            <RouteNavigationProvider>
              <SplitThreadArea routeContent={docsContent} />
            </RouteNavigationProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </JotaiProvider>
    </TooltipProvider>,
  );
}

describe("a plugin page alone in the main view", () => {
  it.each([false, true])(
    "has no pane close button (compact: %s)",
    async (compact) => {
      viewport.compact = compact;
      renderDocs();
      await screen.findByText("Docs panel");
      expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
    },
  );
});
