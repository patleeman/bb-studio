import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  appEvents: [] as string[],
  shortcuts: [] as string[],
  windows: 0,
  permissionReads: 0,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    on: (event: string) => electron.appEvents.push(event),
  },
  BrowserWindow: class {
    static getAllWindows() {
      return [];
    }
    constructor() {
      electron.windows += 1;
    }
  },
  globalShortcut: {
    register: (key: string) => {
      electron.shortcuts.push(key);
      return true;
    },
    unregister: () => undefined,
  },
  screen: {
    getAllDisplays: () => [],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
  shell: { openExternal: () => Promise.resolve() },
  systemPreferences: {
    isTrustedAccessibilityClient: () => {
      electron.permissionReads += 1;
      return false;
    },
    getMediaAccessStatus: () => {
      electron.permissionReads += 1;
      return "denied";
    },
  },
}));

type Handler = (
  event: IpcMainInvokeEvent,
  request: unknown,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

const platform = process.platform;
let handler: Handler | null = null;

beforeAll(async () => {
  delete process.env.BB_STUDIO_DESKTOP_HUD;
  delete process.env.BB_STUDIO_DESKTOP_CONTROL;
  Object.defineProperty(process, "platform", { value: "darwin" });
  const { registerForkDesktopControlIpc } =
    await import("../src/fork-desktop-control.js");
  registerForkDesktopControlIpc({
    handle: (_channel: string, fn: Handler) => (handler = fn),
  } as unknown as IpcMain);
});

afterAll(() => {
  Object.defineProperty(process, "platform", { value: platform });
});

describe("desktop control without BB_STUDIO_DESKTOP_HUD=1", () => {
  it("reads the switch as exactly 1", async () => {
    const { desktopHudEnabled } =
      await import("../src/fork-desktop-control.js");
    expect(desktopHudEnabled({})).toBe(false);
    expect(desktopHudEnabled({ BB_STUDIO_DESKTOP_HUD: "0" })).toBe(false);
    expect(desktopHudEnabled({ BB_STUDIO_DESKTOP_HUD: "true" })).toBe(false);
    expect(desktopHudEnabled({ BB_STUDIO_DESKTOP_HUD: "1" })).toBe(true);
  });

  it("answers unsupported and starts nothing: no socket, helper, window, shortcut or permission probe", async () => {
    expect(handler).not.toBeNull();
    const event = {} as IpcMainInvokeEvent;
    const state = await handler!(event, { op: "state" });
    expect(state).toMatchObject({ supported: false });
    for (const op of ["hud", "requestPermission", "relaunch"]) {
      expect(await handler!(event, { op, shown: true })).toMatchObject({
        supported: false,
      });
    }
    expect(process.env.BB_STUDIO_DESKTOP_CONTROL).toBeUndefined();
    expect(electron.appEvents).toEqual([]);
    expect(electron.shortcuts).toEqual([]);
    expect(electron.windows).toBe(0);
    expect(electron.permissionReads).toBe(0);
  });
});
