// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import type { ExperimentalAppAppearance } from "@get-bb/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  hasLaunchAppearance,
  resetLaunchAppearanceForTest,
  type ForkLaunchAppearance,
} from "@/lib/fork-launch-appearance";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { ForkAppBackdropHost } from "./ForkAppBackdrop";

const root = document.documentElement;
const LAUNCH: ForkLaunchAppearance = {
  version: 1,
  mode: "dark",
  background: "#0b1020",
  properties: [
    ["--canvas", "#0b1020"],
    ["--stale", "1px"],
  ],
  attributes: [["data-fork-backdrop", "studio/theme"]],
};

function store(initial: ExperimentalAppAppearance | null) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    set(next: ExperimentalAppAppearance | null) {
      value = next;
      for (const listener of listeners) listener();
    },
    use() {
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

function paintLaunch() {
  for (const [name, value] of LAUNCH.properties) root.style.setProperty(name, value);
  for (const [name, value] of LAUNCH.attributes) root.setAttribute(name, value);
  root.style.setProperty("background-color", LAUNCH.background);
  resetLaunchAppearanceForTest(LAUNCH);
}

const saved: unknown[] = [];

beforeEach(() => {
  vi.stubGlobal("CSS", { supports: () => true });
  saved.length = 0;
  Object.defineProperty(window, "bbDesktop", {
    configurable: true,
    value: { experimental_saveLaunchAppearance: (value: unknown) => saved.push(value) },
  });
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetLaunchAppearanceForTest(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  root.removeAttribute("style");
  root.removeAttribute("data-fork-backdrop");
  Reflect.deleteProperty(window, "bbDesktop");
});

describe("launch appearance", () => {
  it("keeps the cached colors until the backdrop's appearance arrives, then swaps them in one step and saves the new one", async () => {
    paintLaunch();
    const appearance = store(null);
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        appBackdrops: [{ id: "theme", component: () => null, useAppearance: appearance.use }],
      }),
    );
    await act(async () => {
      render(<ForkAppBackdropHost />);
    });
    expect(root.style.getPropertyValue("--canvas")).toBe("#0b1020");
    expect(root.getAttribute("data-fork-backdrop")).toBe("studio/theme");
    expect(hasLaunchAppearance()).toBe(true);
    await act(async () => {
      appearance.set({ mode: "dark", tokens: { "--canvas": "#101820" } });
    });
    expect(root.style.getPropertyValue("--canvas")).toBe("#101820");
    expect(root.style.getPropertyValue("--stale")).toBe("");
    expect(root.style.getPropertyValue("background-color")).toBe("");
    expect(root.getAttribute("data-fork-backdrop")).toBe("studio/theme");
    expect(hasLaunchAppearance()).toBe(false);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(saved.at(-1)).toMatchObject({
      version: 1,
      mode: "dark",
      properties: [["--canvas", "#101820"]],
      attributes: [["data-fork-backdrop", "studio/theme"]],
    });
  });

  it("clears the cache when the backdrop's appearance goes away during a session", async () => {
    paintLaunch();
    const appearance = store(null);
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        appBackdrops: [{ id: "theme", component: () => null, useAppearance: appearance.use }],
      }),
    );
    await act(async () => {
      render(<ForkAppBackdropHost />);
    });
    expect(saved).toEqual([]);
    await act(async () => {
      appearance.set({ mode: "dark", tokens: { "--canvas": "#101820" } });
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(saved.at(-1)).toMatchObject({ mode: "dark" });
    await act(async () => {
      appearance.set(null);
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(saved.at(-1)).toBeNull();
    expect(root.style.getPropertyValue("--canvas")).toBe("");
  });

  it("drops the cached colors and the cache when no backdrop shows up", async () => {
    vi.useFakeTimers();
    paintLaunch();
    render(<ForkAppBackdropHost />);
    expect(root.style.getPropertyValue("--canvas")).toBe("#0b1020");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(root.style.getPropertyValue("--canvas")).toBe("");
    expect(root.hasAttribute("data-fork-backdrop")).toBe(false);
    expect(saved).toEqual([null]);
  });
});
