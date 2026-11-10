// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import type { ExperimentalSidebarStyle } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  cleanSidebarCssValue,
  ForkSidebarStyleHost,
  forkSidebarProps,
  useForkSidebarStyle,
} from "./ForkSidebarStyle";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

function createStyleStore(initial: ExperimentalSidebarStyle | null) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    set(next: ExperimentalSidebarStyle | null) {
      value = next;
      for (const listener of listeners) listener();
    },
    useSidebarStyle() {
      return useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => value,
      );
    },
  };
}

function registerThreadList(
  useSidebarStyle?: () => ExperimentalSidebarStyle | null,
) {
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      threadLists: [
        {
          id: "bots",
          title: "Bots",
          component: () => null,
          ...(useSidebarStyle === undefined
            ? {}
            : { experimental_useSidebarStyle: useSidebarStyle }),
        },
      ],
    }),
  );
}

function AppSidebarStandIn() {
  return (
    <Sidebar {...useForkSidebarStyle()}>
      <div data-sidebar="collapsible-body" />
    </Sidebar>
  );
}

async function renderSidebar() {
  await act(async () => {
    render(
      <SidebarProvider>
        <ForkSidebarStyleHost />
        <AppSidebarStandIn />
      </SidebarProvider>,
    );
  });
}

function panel(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-sidebar="panel"]');
  if (element === null) throw new Error("Expected the sidebar panel");
  return element;
}

describe("a thread list's sidebar style", () => {
  it("puts the background and accent on bb's sidebar panel and follows the hook", async () => {
    const store = createStyleStore({
      background: "linear-gradient(red, blue)",
      accent: "rebeccapurple",
    });
    registerThreadList(store.useSidebarStyle);
    await renderSidebar();
    expect(panel().hasAttribute("data-fork-sidebar-background")).toBe(true);
    expect(panel().hasAttribute("data-fork-sidebar-accent")).toBe(true);
    expect(panel().style.getPropertyValue("--fork-sidebar-background")).toBe(
      "linear-gradient(red, blue)",
    );
    expect(panel().style.getPropertyValue("--fork-sidebar-accent")).toBe(
      "rebeccapurple",
    );
    expect(panel().style.getPropertyValue("--sidebar-width")).not.toBe("");

    await act(async () => store.set({ accent: "teal" }));
    expect(panel().hasAttribute("data-fork-sidebar-background")).toBe(false);
    expect(panel().style.getPropertyValue("--fork-sidebar-background")).toBe(
      "",
    );
    expect(panel().style.getPropertyValue("--fork-sidebar-accent")).toBe(
      "teal",
    );

    await act(async () => store.set(null));
    expect(panel().hasAttribute("data-fork-sidebar-accent")).toBe(false);
    expect(panel().style.getPropertyValue("--fork-sidebar-accent")).toBe("");
  });

  it("clears the style when the thread list goes away", async () => {
    registerThreadList(() => ({ background: "pink" }));
    await renderSidebar();
    expect(panel().hasAttribute("data-fork-sidebar-background")).toBe(true);
    await act(async () => registerThreadList());
    expect(panel().hasAttribute("data-fork-sidebar-background")).toBe(false);
    expect(panel().getAttribute("style") ?? "").not.toContain("--fork-sidebar");
  });

  it("applies nothing when the hook throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerThreadList(() => {
      throw new Error("boom");
    });
    await renderSidebar();
    expect(panel().hasAttribute("data-fork-sidebar-background")).toBe(false);
    expect(panel().getAttribute("style") ?? "").not.toContain("--fork-sidebar");
  });
});

describe("forkSidebarProps", () => {
  it("adds only the fields the plugin set", () => {
    expect(forkSidebarProps(null)).toEqual({});
    expect(
      forkSidebarProps({ key: "k", background: null, accent: null }),
    ).toEqual({});
    expect(
      forkSidebarProps({ key: "k", background: "red", accent: null }),
    ).toEqual({
      style: { "--fork-sidebar-background": "red" },
      "data-fork-sidebar-background": "",
    });
  });

  it("drops values that are not usable CSS", () => {
    expect(cleanSidebarCssValue("background", 3)).toBeNull();
    expect(cleanSidebarCssValue("background", "   ")).toBeNull();
    expect(cleanSidebarCssValue("background", "x".repeat(2001))).toBeNull();
    expect(cleanSidebarCssValue("color", "  teal ")).toBe("teal");
    vi.stubGlobal("CSS", { supports: () => false });
    try {
      expect(cleanSidebarCssValue("color", "not-a-color")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
