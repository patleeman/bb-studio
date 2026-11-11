// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { SidebarTopReserveRow } from "./SidebarChrome";

const navigationState = vi.hoisted((): { placement: "rail" | "list" } => ({
  placement: "rail",
}));

vi.mock("./sidebarNavigationProvider", () => ({
  useSidebarNavigationPlacement: () => navigationState.placement,
}));

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  navigationState.placement = "rail";
});

function registerThreadList(hideSidebarHeader: boolean) {
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      threadLists: [
        {
          id: "everything",
          title: "Everything",
          component: () => null,
          ...(hideSidebarHeader
            ? { experimental_hideSidebarHeader: true }
            : {}),
        },
      ],
    }),
  );
}

async function renderChrome({
  framed = false,
  ownsWindowTopLeft = true,
}: { framed?: boolean; ownsWindowTopLeft?: boolean } = {}) {
  await act(async () => {
    render(
      <MemoryRouter>
        <SidebarProvider framed={framed}>
          <SidebarTopReserveRow
            testId="reserve-row"
            headerSlot={<button type="button">New thread</button>}
          />
          <AppPageHeader
            center={<span>Main</span>}
            ownsWindowTopLeft={ownsWindowTopLeft}
          />
        </SidebarProvider>
      </MemoryRouter>,
    );
  });
}

function mainHeader(): HTMLElement {
  return screen.getByTestId("app-page-header-content-row");
}

describe("a thread list that hides the sidebar header", () => {
  it("leaves bb's sidebar header alone when the thread list does not ask", async () => {
    registerThreadList(false);
    await renderChrome();
    const row = screen.getByTestId("reserve-row");
    expect(
      within(row).getByRole("button", { name: "New thread" }),
    ).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Go back" })).toBeTruthy();
    expect(
      within(mainHeader()).queryByRole("button", { name: "Go back" }),
    ).toBeNull();
  });

  it("drops the rail layout's header row and puts back and forward first in the main header", async () => {
    registerThreadList(true);
    await renderChrome();
    expect(screen.queryByTestId("reserve-row")).toBeNull();
    expect(screen.queryByRole("button", { name: "New thread" })).toBeNull();
    const buttons = within(mainHeader()).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Go back",
      "Go forward",
    ]);
    expect(
      buttons[1]!.compareDocumentPosition(screen.getByText("Main")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps an empty header row in the list layout, which reserves room for the sidebar toggle", async () => {
    navigationState.placement = "list";
    registerThreadList(true);
    await renderChrome();
    const row = screen.getByTestId("reserve-row");
    expect(within(row).queryAllByRole("button")).toEqual([]);
    expect(
      within(mainHeader()).getByRole("button", { name: "Go back" }),
    ).toBeTruthy();
  });

  it("adds no back and forward to a header that is not at the window's top left, or in the title bar layout", async () => {
    registerThreadList(true);
    await renderChrome({ ownsWindowTopLeft: false });
    expect(
      within(mainHeader()).queryByRole("button", { name: "Go back" }),
    ).toBeNull();
    cleanup();
    await renderChrome({ framed: true });
    expect(screen.queryByRole("button", { name: "New thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
  });
});
