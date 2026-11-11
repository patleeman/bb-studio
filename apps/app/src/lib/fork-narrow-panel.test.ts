// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NARROW_WINDOW_PANEL_QUERY,
  useForkPanelDrawer,
} from "./fork-narrow-panel";

const original = window.matchMedia;

function fakeWidth(initial: number) {
  let width = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query === NARROW_WINDOW_PANEL_QUERY && width < 1000;
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return (next: number) => {
    width = next;
    for (const listener of [...listeners]) listener();
  };
}

afterEach(() => {
  window.matchMedia = original;
});

describe("the side panel on a narrow window", () => {
  it("is a drawer below 1000px and inline from 1000px, following resizes", () => {
    const resize = fakeWidth(1200);
    const { result } = renderHook(() => useForkPanelDrawer(false));
    expect(result.current).toBe(false);
    act(() => resize(999));
    expect(result.current).toBe(true);
    act(() => resize(1000));
    expect(result.current).toBe(false);
  });

  it("stays a drawer on a compact viewport whatever the width", () => {
    fakeWidth(1400);
    const { result } = renderHook(() => useForkPanelDrawer(true));
    expect(result.current).toBe(true);
  });
});
