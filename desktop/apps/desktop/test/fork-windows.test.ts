import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  forkWindowOptions,
  forkWindowUrl,
  registerForkWindowIpc,
} from "../src/fork-windows.js";
import { BB_DESKTOP_FORK_WINDOW_CHANNEL } from "../src/fork-windows-ipc.js";

interface FakeWindow {
  loadURL: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

const created = vi.hoisted(() => [] as FakeWindow[]);

vi.mock("electron", async () => {
  const { vi: mock } = await import("vitest");
  class BrowserWindow {
    loadURL = mock.fn(() => Promise.resolve());
    show = mock.fn();
    focus = mock.fn();
    close = mock.fn();
    constructor() {
      created.push(this);
    }
    on() {}
    once() {}
    isDestroyed() {
      return false;
    }
    isVisible() {
      return true;
    }
  }
  return {
    app: { getAppPath: () => "/app" },
    BrowserWindow,
    globalShortcut: { register: () => true, unregister: () => {} },
    screen: {},
  };
});

function windowIpc() {
  let handler:
    | ((event: IpcMainInvokeEvent, request: unknown) => boolean)
    | undefined;
  registerForkWindowIpc({
    handle: (channel: string, listener: typeof handler) => {
      if (channel === BB_DESKTOP_FORK_WINDOW_CHANNEL) handler = listener;
    },
  } as unknown as IpcMain);
  const sender = {
    senderFrame: { url: "http://127.0.0.1:38986/threads/thr_1" },
  } as unknown as IpcMainInvokeEvent;
  return (op: string, key: string, path: string) =>
    handler?.(sender, { op, key, path, options: {} });
}

describe("plugin windows in the desktop app", () => {
  it("only opens the bare window route on the sender's own origin", () => {
    const sender = "http://127.0.0.1:38986/threads/thr_1";
    expect(forkWindowUrl(sender, "/fork-window/studio/hud?x=1")).toBe(
      "http://127.0.0.1:38986/fork-window/studio/hud?x=1",
    );
    expect(forkWindowUrl(sender, "/settings")).toBeNull();
    expect(
      forkWindowUrl(sender, "https://evil.example/fork-window/a/b"),
    ).toBeNull();
    expect(forkWindowUrl(sender, "/fork-window/../settings")).toBeNull();
    expect(forkWindowUrl("not a url", "/fork-window/studio/hud")).toBeNull();
  });

  it("opens any route of the sender's origin bare, and only bare", () => {
    const sender = "http://127.0.0.1:38986/threads/thr_1";
    expect(forkWindowUrl(sender, "/threads/thr_2?bbBare=1")).toBe(
      "http://127.0.0.1:38986/threads/thr_2?bbBare=1",
    );
    expect(
      forkWindowUrl(sender, "/plugins/studio/library?a=1&bbBare=1#x"),
    ).toBe("http://127.0.0.1:38986/plugins/studio/library?a=1&bbBare=1#x");
    for (const path of [
      "/threads/thr_2",
      "/threads/thr_2?bbBare=0",
      "/threads/thr_2#bbBare=1",
      "threads/thr_2?bbBare=1",
      "//evil.example/threads/thr_2?bbBare=1",
      "/\\evil.example/threads/thr_2?bbBare=1",
      "https://evil.example/?bbBare=1",
      "http://127.0.0.1:38986/threads/thr_2?bbBare=1",
      "javascript:alert(1)//?bbBare=1",
      "file:///etc/passwd?bbBare=1",
      42,
      null,
      undefined,
    ]) {
      expect(forkWindowUrl(sender, path)).toBeNull();
    }
    expect(forkWindowUrl("not a url", "/threads/thr_2?bbBare=1")).toBeNull();
  });

  it("makes a transparent window frameless, and keeps sizes within bounds", () => {
    const hud = forkWindowOptions(
      { transparent: true, alwaysOnTop: true, width: 20, height: 99999 },
      "/app/dist/preload.cjs",
    );
    expect(hud).toMatchObject({
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      width: 120,
      height: 4000,
      show: false,
    });
    expect(hud.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(forkWindowOptions({}, undefined)).toMatchObject({
      transparent: false,
      frame: true,
      width: 480,
      height: 360,
    });
  });
});

describe("a plugin window opened again", () => {
  it("loads new params into the open window instead of making another", () => {
    const invoke = windowIpc();
    const before = created.length;
    invoke("open", "studio/hud", "/fork-window/studio/hud?thread=a");
    expect(created.length).toBe(before + 1);
    const hud = created.at(-1);
    expect(hud?.loadURL).toHaveBeenCalledTimes(1);

    invoke("open", "studio/hud", "/fork-window/studio/hud?thread=a");
    expect(created.length).toBe(before + 1);
    expect(hud?.loadURL).toHaveBeenCalledTimes(1);
    expect(hud?.show).toHaveBeenCalled();

    invoke("open", "studio/hud", "/fork-window/studio/hud?thread=b");
    expect(created.length).toBe(before + 1);
    expect(hud?.loadURL).toHaveBeenCalledTimes(2);
    expect(hud?.loadURL).toHaveBeenLastCalledWith(
      "http://127.0.0.1:38986/fork-window/studio/hud?thread=b",
    );
  });
});

describe("remembered plugin window bounds", () => {
  const main = { id: 1, x: 0, y: 25, width: 1440, height: 875 };
  const side = { id: 2, x: 1440, y: 0, width: 1920, height: 1080 };
  const minimum = { width: 320, height: 240 };

  it("reopens on the display it was on, where it was", async () => {
    const { placeForkWindow } = await import("../src/fork-window-bounds.js");
    expect(
      placeForkWindow(
        { x: 2000, y: 300, width: 500, height: 600, displayId: 2 },
        [main, side],
        main,
        minimum,
      ),
    ).toEqual({ x: 2000, y: 300, width: 500, height: 600 });
  });

  it("moves to the main display, on-screen, when its display is gone", async () => {
    const { placeForkWindow } = await import("../src/fork-window-bounds.js");
    const placed = placeForkWindow(
      { x: 2900, y: 700, width: 500, height: 2000, displayId: 2 },
      [main],
      main,
      minimum,
    );
    expect(placed.width).toBe(500);
    expect(placed.height).toBe(875);
    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.x + placed.width).toBeLessThanOrEqual(1440);
    expect(placed.y).toBe(25);
  });

  it("pulls a window that hangs off its display back inside and enforces the minimum", async () => {
    const { placeForkWindow, parseForkWindowBounds } =
      await import("../src/fork-window-bounds.js");
    expect(
      placeForkWindow(
        { x: -200, y: 5000, width: 10, height: 10, displayId: 1 },
        [main, side],
        main,
        minimum,
      ),
    ).toEqual({ x: 0, y: 660, width: 320, height: 240 });
    expect(parseForkWindowBounds({ x: 1, y: 2, width: "3" })).toBeNull();
  });
});
