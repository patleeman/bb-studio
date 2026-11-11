// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { createPortal } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePluginTabWindow } from "@/lib/fork-tab-window";
import { tabWindowPath, WINDOW_INSTANCE_ID } from "@/lib/fork-tab-popout";
import { ForkTabWindow } from "./ForkTabWindow";

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({ data: undefined }),
}));

vi.mock("@/lib/bb-desktop", async (original) => ({
  ...(await original<typeof import("@/lib/bb-desktop")>()),
  getBbDesktopInfo: () => null,
}));

vi.mock("@/components/plugin/PluginPanelActions", () => ({
  PluginPanelTabContent: () => <TabProbe />,
}));

function TabProbe() {
  const tabWindow = usePluginTabWindow();
  return (
    <>
      <p data-testid="probe">{tabWindow?.title ?? "no window"}</p>
      {tabWindow?.toolbar
        ? createPortal(<button type="button">New</button>, tabWindow.toolbar)
        : null}
    </>
  );
}

function renderWindow() {
  const path = tabWindowPath({
    threadId: "thr_1",
    spec: { kind: "tab", tab: { id: "memory", pluginId: "studio" } },
    pane: 2,
    from: WINDOW_INSTANCE_ID,
    title: "Memory",
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <ForkTabWindow />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("a tab in its own window", () => {
  it("tells the tab its title is in the window bar and takes the tab's controls there", async () => {
    renderWindow();
    expect(screen.getByTestId("probe").textContent).toBe("Memory");
    const header = document.querySelector("[data-fork-tab-window] > header");
    if (!(header instanceof HTMLElement)) throw new Error("no window bar");
    const control = await within(header).findByRole("button", { name: "New" });
    const toolbar = control.parentElement;
    expect(toolbar?.hasAttribute("data-fork-tab-window-toolbar")).toBe(true);
    const buttons = within(header)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons).toEqual(["New", "Return to workbench"]);
  });

  it("reports no tab window outside one", () => {
    render(<TabProbe />);
    expect(screen.getByTestId("probe").textContent).toBe("no window");
  });
});
