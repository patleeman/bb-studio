import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  windows: [] as unknown[],
  shortcuts: new Set<string>(),
  cursor: { x: 0, y: 0 },
}));

vi.mock("electron", async () => {
  const { vi: mock } = await import("vitest");
  class BrowserWindow {
    static getAllWindows() {
      return (electron.windows as BrowserWindow[]).filter(
        (window) => !window.destroyed,
      );
    }
    static fromWebContents(contents: { owner: BrowserWindow }) {
      return contents.owner;
    }
    visible = true;
    destroyed = false;
    level: string | null = null;
    ignoreMouse = true;
    url: string;
    webContents: {
      owner: BrowserWindow;
      getURL: () => string;
      send: ReturnType<typeof mock.fn>;
    };
    constructor(options: { url?: string } = {}) {
      this.url = options.url ?? "";
      this.webContents = {
        owner: this,
        getURL: () => this.url,
        send: mock.fn(),
      };
      electron.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    hide() {
      this.visible = false;
    }
    show() {
      this.visible = true;
    }
    showInactive() {
      this.visible = true;
    }
    focus() {}
    close() {
      this.destroyed = true;
    }
    destroy() {
      this.destroyed = true;
    }
    once() {}
    on() {}
    loadURL(url: string) {
      this.url = url;
      return Promise.resolve();
    }
    setAlwaysOnTop(_flag: boolean, level: string) {
      this.level = level;
    }
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(ignore: boolean) {
      this.ignoreMouse = ignore;
    }
    setContentProtection() {}
  }
  return {
    app: {
      isPackaged: false,
      getPath: () => tmpdir(),
      getAppPath: () => "/app",
      on: mock.fn(),
      relaunch: mock.fn(),
      quit: mock.fn(),
    },
    BrowserWindow,
    desktopCapturer: { getSources: mock.fn(() => Promise.resolve([])) },
    globalShortcut: {
      register: (key: string) => {
        electron.shortcuts.add(key);
        return true;
      },
      unregister: (key: string) => electron.shortcuts.delete(key),
    },
    screen: {
      getAllDisplays: () => [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          scaleFactor: 2,
        },
      ],
      getCursorScreenPoint: () => electron.cursor,
      getDisplayNearestPoint: () => ({
        id: 1,
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        scaleFactor: 2,
      }),
    },
    shell: { openExternal: mock.fn(() => Promise.resolve()) },
    systemPreferences: {
      isTrustedAccessibilityClient: () => false,
      getMediaAccessStatus: () => "denied",
    },
  };
});

type Handler = (
  event: IpcMainInvokeEvent,
  request: unknown,
) => Promise<Record<string, unknown>>;

let dir = "";
let handler: Handler | null = null;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desktop-hud-test-"));
  const helper = join(dir, "bb-studio-desktop-helper");
  writeFileSync(
    helper,
    `#!/usr/bin/env node
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  const all = !require("node:fs").existsSync(__dirname + "/deny");
  const result = request.op === "status" ? { accessibility: all, screenRecording: all, inputMonitoring: all } : request.op === "inspect" ? { found: true, pid: 9, windowId: 3, app: "Fixture", bounds: { x: 0, y: 0, width: 400, height: 300 }, element: { role: "AXButton", label: "Go" } } : {};
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + "\\n");
});
`,
  );
  chmodSync(helper, 0o755);
  process.env.BB_STUDIO_DESKTOP_CONTROL_DIR = dir;
  const { registerForkDesktopControlIpc } =
    await import("../src/fork-desktop-control.js");
  const ipc = {
    handle: (_channel: string, fn: Handler) => (handler = fn),
  } as unknown as IpcMain;
  Object.defineProperty(process, "platform", { value: "darwin" });
  registerForkDesktopControlIpc(ipc);
});

afterAll(() => {
  delete process.env.BB_STUDIO_DESKTOP_CONTROL_DIR;
  delete process.env.BB_STUDIO_DESKTOP_CONTROL;
  rmSync(dir, { recursive: true, force: true });
});

async function windowsOf() {
  const { BrowserWindow } = await import("electron");
  return BrowserWindow as unknown as {
    new (options?: { url?: string }): {
      visible: boolean;
      destroyed: boolean;
      level: string | null;
      ignoreMouse: boolean;
      url: string;
      webContents: unknown;
    };
    getAllWindows(): { url: string; visible: boolean }[];
  };
}

function call(
  sender: { webContents: unknown; url: string } | null,
  request: unknown,
) {
  if (handler === null) throw new Error("not registered");
  const event = {
    sender: sender?.webContents ?? {},
    senderFrame: { url: sender?.url ?? "" },
  } as unknown as IpcMainInvokeEvent;
  return handler(event, request);
}

describe("the HUD", () => {
  it("shows over other apps, hides the main window, and gives it back on the way out", async () => {
    const BrowserWindow = await windowsOf();
    const main = new BrowserWindow({ url: "http://127.0.0.1:1/threads/thr_1" });
    const hud = new BrowserWindow({
      url: "http://127.0.0.1:1/fork-window/studio/desktop-hud?thread=thr_1",
    });
    const shown = await call(hud, {
      op: "hud",
      shown: true,
      threadId: "thr_1",
    });
    expect(shown.hud).toEqual({ shown: true, threadId: "thr_1" });
    expect(main.visible).toBe(false);
    expect(hud.level).toBe("status");
    const overlays = BrowserWindow.getAllWindows().filter((window) =>
      window.url.includes("/fork-window/_bb/desktop-overlay"),
    );
    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.url).toContain("bbTransparent=1");

    await call(hud, { op: "refreshPermissions" });
    const pointing = await call(hud, { op: "pointing", on: true });
    expect(pointing.pointing).toBe(true);
    expect(electron.shortcuts.has("Escape")).toBe(true);

    const pinned = await call(null, {
      op: "point",
      x: 120,
      y: 80,
      click: true,
    });
    expect(
      (pinned.pins as { number: number; app: string; placed: boolean }[])[0],
    ).toMatchObject({ number: 1, app: "Fixture", placed: true });

    const hidden = await call(hud, { op: "hud", shown: false });
    expect(hidden.hud).toEqual({ shown: false, threadId: null });
    expect(hidden.pointing).toBe(false);
    expect(hidden.pins).toEqual([]);
    expect(main.visible).toBe(true);
    expect(hud.destroyed).toBe(true);
    expect(electron.shortcuts.has("Escape")).toBe(false);
  });

  it("keeps pointing off until all three permissions are granted", async () => {
    const BrowserWindow = await windowsOf();
    writeFileSync(join(dir, "deny"), "");
    const hud = new BrowserWindow({
      url: "http://127.0.0.1:1/fork-window/studio/desktop-hud",
    });
    await call(hud, { op: "hud", shown: true, threadId: "thr_2" });
    const state = await call(hud, { op: "refreshPermissions" });
    expect(state.permissions).toEqual({
      accessibility: false,
      screenRecording: false,
      inputMonitoring: false,
      checked: true,
    });
    expect((await call(hud, { op: "pointing", on: true })).pointing).toBe(
      false,
    );
    rmSync(join(dir, "deny"));
    await call(hud, { op: "refreshPermissions" });
    expect((await call(hud, { op: "pointing", on: true })).pointing).toBe(true);
    await call(hud, { op: "hud", shown: false });
  });

  it("refuses agents outside the conversation in the HUD, and answers status anywhere", async () => {
    const BrowserWindow = await windowsOf();
    const endpoint = JSON.parse(
      process.env.BB_STUDIO_DESKTOP_CONTROL ?? "{}",
    ) as { socket: string; token: string };
    const ask = (request: unknown) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const client = createConnection(endpoint.socket);
        client.setEncoding("utf8");
        client.once("connect", () =>
          client.write(
            `${JSON.stringify({ id: 1, token: endpoint.token, request })}\n`,
          ),
        );
        client.once("data", (chunk: string) => {
          client.destroy();
          resolve(
            JSON.parse(chunk.split("\n")[0] ?? "{}") as Record<string, unknown>,
          );
        });
      });
    const closed = await ask({
      threadId: "thr_3",
      tool: "click",
      args: { pid: 1, window_id: 2, x: 1, y: 1 },
    });
    expect(closed).toMatchObject({ ok: false });
    expect(String(closed.error)).toContain("open in the HUD");
    const hud = new BrowserWindow({
      url: "http://127.0.0.1:1/fork-window/studio/desktop-hud",
    });
    await call(hud, { op: "hud", shown: true, threadId: "thr_3" });
    const other = await ask({ threadId: "thr_other", tool: "pins" });
    expect(other).toMatchObject({ ok: false });
    const pins = await ask({ threadId: "thr_3", tool: "pins" });
    expect(pins).toMatchObject({ ok: true, text: "No pins." });
    const status = await ask({ threadId: "thr_other", tool: "status" });
    expect(String(status.text)).toContain("open on another conversation");
    await call(hud, { op: "hud", shown: false });
  });
});
