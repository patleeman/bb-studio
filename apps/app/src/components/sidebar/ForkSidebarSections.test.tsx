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
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
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

function Notice({ placement }: ExperimentalSidebarSectionProps) {
  return <p>Notice in {placement}</p>;
}

function renderSections(
  onNavigate: () => void,
  placement?: "list" | "footer",
) {
  return render(
    <MemoryRouter initialEntries={["/projects/proj_1/threads/thr_1"]}>
      <SidebarProvider>
        <PluginSidebarSections onNavigate={onNavigate} placement={placement} />
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

  it("draws a footer section only where the footer sections go, and tells it so", () => {
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        sidebarSections: [
          { id: "bots", title: "Bots", component: Bots },
          {
            id: "notice",
            title: "Notice",
            placement: "footer",
            component: Notice,
          },
        ],
      }),
    );
    const list = renderSections(() => {});
    expect(screen.getByText("Bots for thr_1")).toBeTruthy();
    expect(screen.queryByText(/Notice in/)).toBeNull();
    list.unmount();
    renderSections(() => {}, "footer");
    expect(screen.getByText("Notice in footer")).toBeTruthy();
    expect(screen.queryByText("Bots for thr_1")).toBeNull();
  });

  it("collects a section's placement and refuses an unknown one", () => {
    const collected = collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_sidebarSection({
          id: "notice",
          title: "Notice",
          placement: "footer",
          component: Notice,
        });
        app.slots.experimental_sidebarSection({
          id: "bots",
          title: "Bots",
          component: Bots,
        });
      }),
    );
    expect(
      collected.sidebarSections?.map((section) => [
        section.id,
        section.placement,
      ]),
    ).toEqual([
      ["notice", "footer"],
      ["bots", undefined],
    ]);
    expect(() =>
      collectPluginAppRegistrations(
        definePluginApp((app) => {
          app.slots.experimental_sidebarSection({
            id: "odd",
            title: "Odd",
            placement: "header" as "footer",
            component: Notice,
          });
        }),
      ),
    ).toThrow('placement must be "list" or "footer"');
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
