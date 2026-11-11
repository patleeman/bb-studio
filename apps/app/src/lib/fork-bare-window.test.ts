// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPLIT_LAYOUT_STORAGE_KEY } from "./split-layout/persistence";

const ORIGIN = window.location.origin;

async function load(url: string) {
  window.history.replaceState(null, "", url);
  vi.resetModules();
  return import("./fork-bare-window");
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "bbDesktop");
});

describe("the bare window flag", () => {
  it("reads bbBare=1 and nothing else", async () => {
    const { isBareSearch } = await load("/");
    expect(isBareSearch("?bbBare=1")).toBe(true);
    expect(isBareSearch("?a=b&bbBare=1")).toBe(true);
    expect(isBareSearch("")).toBe(false);
    expect(isBareSearch("?bbBare=0")).toBe(false);
    expect(isBareSearch("?bbBare=true")).toBe(false);
    expect(isBareSearch("?xbbBare=1")).toBe(false);
  });

  it("leaves a normal window and its split layout alone", async () => {
    window.sessionStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, "saved");
    const { isBareWindow } = await load("/threads/thr_1");
    expect(isBareWindow()).toBe(false);
    expect(window.sessionStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).toBe(
      "saved",
    );
  });

  it("stays bare for the life of a window opened with the flag, and drops the opener's split layout", async () => {
    window.sessionStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, "saved");
    const { isBareWindow } = await load("/threads/thr_1?bbBare=1");
    expect(isBareWindow()).toBe(true);
    expect(window.sessionStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).toBe("");
    window.history.replaceState(null, "", "/settings");
    expect(isBareWindow()).toBe(true);
  });

  it("keeps the sidebar closed in a bare window whatever is stored or asked", async () => {
    await load("/threads/thr_1?bbBare=1");
    const { useNarrowWindowSidebar } =
      await import("@/components/layout/useNarrowWindowSidebar.fork");
    const setStored = vi.fn();
    const { result } = renderHook(() =>
      useNarrowWindowSidebar(true, setStored),
    );
    expect(result.current.open).toBe(false);
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(false);
    expect(setStored).not.toHaveBeenCalled();
  });
});

describe("popping a route out", () => {
  it("adds the flag to a bb route and refuses everything else", async () => {
    const { barePath } = await load("/");
    expect(barePath("/threads/thr_1", ORIGIN)).toBe("/threads/thr_1?bbBare=1");
    expect(barePath("/settings?tab=general#top", ORIGIN)).toBe(
      "/settings?tab=general&bbBare=1#top",
    );
    expect(barePath("/settings?bbBare=1", ORIGIN)).toBe("/settings?bbBare=1");
    for (const bad of [
      "",
      "threads/thr_1",
      "//evil.example/threads/thr_1",
      "/\\evil.example/threads/thr_1",
      "https://evil.example/threads/thr_1",
      `${ORIGIN}/threads/thr_1`,
      "javascript:alert(1)",
      "/no-such-route",
      42,
      null,
    ]) {
      expect(barePath(bad, ORIGIN)).toBeNull();
    }
  });

  it("opens a browser popup once per path and focuses it after", async () => {
    const { popOutAppPath, popOutKey } = await load("/");
    const popup = { closed: false, focus: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(popup as unknown as Window);
    expect(await popOutAppPath({ path: "/threads/thr_1", width: 800 })).toBe(
      true,
    );
    expect(open).toHaveBeenCalledWith(
      "/threads/thr_1?bbBare=1",
      popOutKey("/threads/thr_1?bbBare=1"),
      "popup,width=800,height=720",
    );
    expect(await popOutAppPath({ path: "/threads/thr_1" })).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalledTimes(1);
    popup.closed = true;
    expect(await popOutAppPath({ path: "/threads/thr_1", width: 1 })).toBe(
      true,
    );
    expect(open).toHaveBeenLastCalledWith(
      "/threads/thr_1?bbBare=1",
      popOutKey("/threads/thr_1?bbBare=1"),
      "popup,width=360,height=720",
    );
    expect(await popOutAppPath({ path: "//evil.example" })).toBe(false);
    open.mockReturnValue(null);
    expect(await popOutAppPath({ path: "/threads/thr_2" })).toBe(false);
  });

  it("opens a native window through the desktop window channel", async () => {
    const { popOutAppPath, popOutKey } = await load("/");
    const desktopWindow = vi.fn(() => Promise.resolve(true));
    Object.assign(window, {
      bbDesktop: { experimental_window: desktopWindow },
    });
    const open = vi.spyOn(window, "open");
    expect(
      await popOutAppPath({ path: "/threads/thr_1", title: " Fix login " }),
    ).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(desktopWindow).toHaveBeenCalledWith({
      op: "open",
      key: popOutKey("/threads/thr_1?bbBare=1"),
      path: "/threads/thr_1?bbBare=1",
      options: {
        title: "Fix login",
        width: 960,
        height: 720,
        minWidth: 360,
        minHeight: 240,
        titleBar: "hiddenInset",
        rememberBounds: true,
      },
    });
    desktopWindow.mockImplementationOnce(() => Promise.reject(new Error("x")));
    expect(await popOutAppPath({ path: "/threads/thr_1" })).toBe(false);
    expect(popOutKey("/a".repeat(400)).length).toBeLessThan(200);
    expect(popOutKey("/threads/a")).not.toBe(popOutKey("/threads/b"));
  });
});
