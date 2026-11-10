// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ExperimentalSidebarSectionProps } from "@get-bb/plugin-sdk";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { PluginSidebarSections } from "./ForkSidebarSections";

function Bots({ activeThreadId, onNavigate }: ExperimentalSidebarSectionProps) {
  return (
    <button type="button" onClick={onNavigate}>
      Bots for {activeThreadId ?? "no thread"}
    </button>
  );
}

function Broken(): never {
  throw new Error("section failed");
}

function renderSections(onNavigate: () => void) {
  return render(
    <MemoryRouter initialEntries={["/projects/proj_1/threads/thr_1"]}>
      <SidebarProvider>
        <PluginSidebarSections onNavigate={onNavigate} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("plugin sidebar sections", () => {
  it("renders nothing when no plugin registers a section", () => {
    const view = renderSections(() => {});
    expect(view.container.querySelector("section")).toBeNull();
  });

  it("gives each section the route's thread and the drawer-closing callback", () => {
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        sidebarSections: [{ id: "bots", title: "Bots", component: Bots }],
      }),
    );
    const onNavigate = vi.fn();
    renderSections(onNavigate);
    expect(screen.getByRole("region", { name: "Bots" })).toBeTruthy();
    fireEvent.click(screen.getByText("Bots for thr_1"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("keeps the other sections when one crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        sidebarSections: [
          { id: "broken", title: "Broken", component: Broken },
          { id: "bots", title: "Bots", component: Bots },
        ],
      }),
    );
    renderSections(() => {});
    expect(screen.getByText("Bots for thr_1")).toBeTruthy();
  });
});
