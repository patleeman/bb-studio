// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useSyncExternalStore, type ComponentType } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ExperimentalAppAppearance } from "@get-bb/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { initializePreferredTheme, setPreferredTheme } from "@/hooks/useTheme";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { cleanAppearance, ForkAppBackdropHost } from "./ForkAppBackdrop";
import { FORK_WINDOW_ROUTE_PATH, ForkWindowView } from "./ForkWindowView";

const root = document.documentElement;

function Scene() {
  return <canvas data-testid="scene" />;
}

function register(
  pluginId: string,
  backdrop: {
    id?: string;
    component?: ComponentType;
    useAppearance?: () => ExperimentalAppAppearance | null;
  } = {},
) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({
      appBackdrops: [
        {
          id: backdrop.id ?? "scene",
          component: backdrop.component ?? Scene,
          ...(backdrop.useAppearance === undefined
            ? {}
            : { useAppearance: backdrop.useAppearance }),
        },
      ],
    }),
  );
}

function createAppearanceStore(initial: ExperimentalAppAppearance | null) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    set(next: ExperimentalAppAppearance | null) {
      value = next;
      for (const listener of listeners) listener();
    },
    useAppearance() {
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

function backdrop(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-fork-app-backdrop]");
}

beforeEach(() => {
  vi.stubGlobal("CSS", {
    supports: (_property: string, value: string) =>
      !value.includes("}") && !value.includes("not-a-value"),
  });
  initializePreferredTheme();
  setPreferredTheme("light");
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  root.removeAttribute("style");
  window.localStorage.clear();
});

describe("cleanAppearance", () => {
  it("keeps valid tokens and surfaces and drops the rest", () => {
    const appearance = cleanAppearance({
      mode: "dark",
      tokens: {
        "--canvas": "oklch(0.2 0.02 260)",
        "--bad": "red; } body { color: red",
        "not-a-token": "red",
        "--also bad": "red",
        "--empty": "  ",
      },
      surfaces: {
        sidebar: { background: "rgb(0 0 0 / 40%)", edge: "white" },
        composer: { backdropFilter: "blur(20px)", background: 4 },
        main: { background: "not-a-value" },
        toolbar: { background: "red" },
      },
    });
    expect(appearance.mode).toBe("dark");
    expect([...appearance.properties]).toEqual([
      ["--canvas", "oklch(0.2 0.02 260)"],
      ["--fork-surface-sidebar-background", "rgb(0 0 0 / 40%)"],
      ["--fork-surface-sidebar-edge", "white"],
      ["--fork-surface-composer-backdrop-filter", "blur(20px)"],
    ]);
    expect(appearance.edges).toEqual(["sidebar"]);
  });

  it("treats anything but an object as no appearance", () => {
    for (const value of [null, undefined, "dark", [], { mode: "dim" }]) {
      const appearance = cleanAppearance(value);
      expect(appearance.mode).toBeNull();
      expect(appearance.properties.size).toBe(0);
    }
  });
});

describe("ForkAppBackdropHost", () => {
  it("draws the first backdrop by plugin id once, full window, behind the layout and without pointer events", async () => {
    register("zeta", { component: () => <div data-testid="zeta" /> });
    register("alpha");
    await act(async () => {
      render(
        <div id="layout">
          <ForkAppBackdropHost />
        </div>,
      );
    });
    const layer = backdrop();
    expect(layer).not.toBeNull();
    expect(document.querySelectorAll("[data-fork-app-backdrop]")).toHaveLength(
      1,
    );
    expect(layer?.getAttribute("data-fork-app-backdrop")).toBe("alpha/scene");
    expect(layer?.parentElement).toBe(document.body);
    expect(document.getElementById("layout")?.contains(layer)).toBe(false);
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(layer?.className.split(" ")).toEqual(
      expect.arrayContaining([
        "pointer-events-none",
        "fixed",
        "inset-0",
        "-z-10",
      ]),
    );
    expect(layer?.getAttribute("data-bb-plugin")).toBe("alpha");
    expect(layer?.querySelector('[data-testid="scene"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="zeta"]')).toBeNull();
    expect(root.getAttribute("data-fork-backdrop")).toBe("alpha/scene");
  });

  it("keeps bb's surfaces opaque while the appearance hook returns null", async () => {
    const store = createAppearanceStore(null);
    register("studio", { useAppearance: store.useAppearance });
    const view = await act(async () => render(<ForkAppBackdropHost />));
    expect(backdrop()?.querySelector('[data-testid="scene"]')).not.toBeNull();
    expect(root.hasAttribute("data-fork-backdrop")).toBe(false);

    await act(async () => store.set({ tokens: { "--canvas": "#000" } }));
    expect(root.getAttribute("data-fork-backdrop")).toBe("studio/scene");

    await act(async () => store.set(null));
    expect(root.hasAttribute("data-fork-backdrop")).toBe(false);
    view.unmount();
  });

  it("overrides this window's light or dark mode and gives it back", async () => {
    const store = createAppearanceStore({ mode: "dark" });
    register("studio", { useAppearance: store.useAppearance });
    expect(root.classList.contains("dark")).toBe(false);
    const view = await act(async () => render(<ForkAppBackdropHost />));
    expect(root.classList.contains("dark")).toBe(true);

    await act(async () => store.set({ mode: "light" }));
    setPreferredTheme("dark");
    expect(root.classList.contains("dark")).toBe(false);

    await act(async () => store.set(null));
    expect(root.classList.contains("dark")).toBe(true);

    await act(async () => store.set({ mode: "light" }));
    view.unmount();
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.hasAttribute("data-fork-backdrop")).toBe(false);
  });

  it("sets tokens and surfaces on <html>, drops invalid ones and restores what was there", async () => {
    root.style.setProperty("--canvas", "white");
    const store = createAppearanceStore({
      tokens: {
        "--canvas": "oklch(0.2 0.02 260)",
        "--ink": "not-a-value",
      },
      surfaces: {
        main: { background: "transparent" },
        sidebar: {
          background: "rgb(0 0 0 / 40%)",
          backdropFilter: "blur(24px)",
          edge: "rgb(255 255 255 / 20%)",
        },
        composer: { edge: "red" },
      },
    });
    register("studio", { useAppearance: store.useAppearance });
    const view = await act(async () => render(<ForkAppBackdropHost />));

    expect(root.style.getPropertyValue("--canvas")).toBe("oklch(0.2 0.02 260)");
    expect(root.style.getPropertyValue("--ink")).toBe("");
    expect(root.style.getPropertyValue("--fork-surface-main-background")).toBe(
      "transparent",
    );
    expect(
      root.style.getPropertyValue("--fork-surface-sidebar-background"),
    ).toBe("rgb(0 0 0 / 40%)");
    expect(
      root.style.getPropertyValue("--fork-surface-sidebar-backdrop-filter"),
    ).toBe("blur(24px)");
    expect(root.style.getPropertyValue("--fork-surface-sidebar-edge")).toBe(
      "rgb(255 255 255 / 20%)",
    );
    expect(root.getAttribute("data-fork-surface-edge")).toBe(
      "sidebar composer",
    );

    await act(async () =>
      store.set({ surfaces: { header: { background: "red" } } }),
    );
    expect(root.style.getPropertyValue("--canvas")).toBe("white");
    expect(
      root.style.getPropertyValue("--fork-surface-sidebar-background"),
    ).toBe("");
    expect(
      root.style.getPropertyValue("--fork-surface-header-background"),
    ).toBe("red");
    expect(root.hasAttribute("data-fork-surface-edge")).toBe(false);

    view.unmount();
    expect(
      root.style.getPropertyValue("--fork-surface-header-background"),
    ).toBe("");
    expect(root.style.getPropertyValue("--canvas")).toBe("white");
  });

  it("falls back to no backdrop and no overrides when the component crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createAppearanceStore({
      mode: "dark",
      tokens: { "--canvas": "black" },
    });
    function FlakyScene() {
      if (store.useAppearance()?.tokens?.["--canvas"] === "#000") {
        throw new Error("WebGL lost");
      }
      return <canvas />;
    }
    register("studio", {
      component: FlakyScene,
      useAppearance: store.useAppearance,
    });
    await act(async () => render(<ForkAppBackdropHost />));
    expect(root.classList.contains("dark")).toBe(true);
    expect(backdrop()).not.toBeNull();

    await act(async () =>
      store.set({ mode: "dark", tokens: { "--canvas": "#000" } }),
    );
    expect(backdrop()).toBeNull();
    expect(root.hasAttribute("data-fork-backdrop")).toBe(false);
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.style.getPropertyValue("--canvas")).toBe("");
  });

  it("falls back to no backdrop and no overrides when the appearance hook throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    register("studio", {
      useAppearance: () => {
        throw new Error("no theme");
      },
    });
    await act(async () => render(<ForkAppBackdropHost />));
    expect(backdrop()).toBeNull();
    expect(root.hasAttribute("data-fork-backdrop")).toBe(false);
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("draws nothing in a plugin window", async () => {
    register("studio", { useAppearance: () => ({ mode: "dark" }) });
    setPluginSlotRegistrations(
      "hud",
      makePluginRegistrationSet({
        windows: [{ id: "hud", title: "HUD", component: () => <p>hud</p> }],
      }),
    );
    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/fork-window/hud/hud"]}>
          <Routes>
            <Route path={FORK_WINDOW_ROUTE_PATH} element={<ForkWindowView />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    expect(document.body.textContent).toContain("hud");
    expect(backdrop()).toBeNull();
    expect(root.hasAttribute("data-fork-backdrop")).toBe(false);
    expect(root.classList.contains("dark")).toBe(false);
  });
});
