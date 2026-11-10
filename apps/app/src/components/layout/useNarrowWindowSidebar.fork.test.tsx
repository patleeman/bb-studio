// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNarrowWindowSidebar } from "./useNarrowWindowSidebar.fork";

function stubMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => media);
  return {
    set(next: boolean) {
      media.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the sidebar in a narrow window", () => {
  it("collapses without touching the stored choice, and comes back when the window widens", () => {
    const media = stubMedia(false);
    const setStored = vi.fn();
    const { result } = renderHook(() =>
      useNarrowWindowSidebar(true, setStored),
    );
    expect(result.current.open).toBe(true);
    act(() => media.set(true));
    expect(result.current.open).toBe(false);
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    expect(setStored).not.toHaveBeenCalled();
    act(() => media.set(false));
    expect(result.current.open).toBe(true);
    act(() => result.current.setOpen(false));
    expect(setStored).toHaveBeenCalledWith(false);
  });

  it("starts collapsed when the window is already narrow", () => {
    stubMedia(true);
    const { result } = renderHook(() => useNarrowWindowSidebar(true, vi.fn()));
    expect(result.current.open).toBe(false);
  });
});
