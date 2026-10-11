// Running applets: their windows, shortcuts and tray icons, and which
// renderer belongs to which applet. An applet runs only once every capability
// its manifest asks for is approved; until then it's listed as waiting.
import { BrowserWindow, globalShortcut, nativeImage, screen, Tray, type WebContents } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Applet } from "./registry";
import { logsDir } from "./paths";

type WindowSpec = Applet["manifest"]["windows"][string];

export type Running = {
  applet: Applet;
  windows: Map<string, BrowserWindow>;
  shortcuts: string[];
  tray: Tray | null;
  /** A hidden page for applets with no windows, so their script still runs. */
  background: BrowserWindow | null;
};

const MAX_LOG_LINE = 4000;

export class Runtime {
  readonly running = new Map<string, Running>();
  private readonly owners = new Map<number, { id: string; window: string | null }>();

  constructor(
    private readonly preload: string,
    private readonly onEvent: (id: string, event: string, payload?: unknown) => void,
  ) {}

  ownerOf(contents: WebContents): { id: string; window: string | null } | null {
    return this.owners.get(contents.id) ?? null;
  }

  log(id: string, level: string, ...args: unknown[]): void {
    const text = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ").slice(0, MAX_LOG_LINE);
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${text}\n`;
    void mkdir(logsDir, { recursive: true }).then(() => appendFile(join(logsDir, `${id}.log`), line)).catch(() => {});
  }

  start(applet: Applet): void {
    if (this.running.has(applet.id)) return;
    const run: Running = { applet, windows: new Map(), shortcuts: [], tray: null, background: null };
    this.running.set(applet.id, run);
    this.log(applet.id, "info", `started ${applet.manifest.name} ${applet.manifest.version}`);

    for (const [name, accelerator] of Object.entries(applet.manifest.shortcuts)) {
      try {
        if (globalShortcut.register(accelerator, () => this.onEvent(applet.id, `shortcut:${name}`))) run.shortcuts.push(accelerator);
        else this.log(applet.id, "warn", `shortcut ${accelerator} is taken by another app`);
      } catch (error) {
        this.log(applet.id, "error", `shortcut ${accelerator}: ${String(error)}`);
      }
    }

    const names = Object.keys(applet.manifest.windows);
    // The first window opens on start; the applet opens the others itself.
    if (names[0]) this.openWindow(applet.id, names[0]);
    else run.background = this.createWindow(applet, null, { show: false, width: 400, height: 300 });
  }

  stop(id: string): void {
    const run = this.running.get(id);
    if (!run) return;
    this.running.delete(id);
    for (const accelerator of run.shortcuts) globalShortcut.unregister(accelerator);
    for (const window of run.windows.values()) if (!window.isDestroyed()) window.destroy();
    if (run.background && !run.background.isDestroyed()) run.background.destroy();
    run.tray?.destroy();
    this.log(id, "info", "stopped");
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }

  openWindow(id: string, name: string): BrowserWindow {
    const run = this.running.get(id);
    if (!run) throw new Error(`Applet "${id}" isn't running`);
    const spec = run.applet.manifest.windows[name];
    if (!spec) throw new Error(`Applet "${id}" has no window "${name}"`);
    const existing = run.windows.get(name);
    if (existing && !existing.isDestroyed()) {
      if (spec.kind === "popover") this.positionPopover(run, existing);
      existing.show();
      return existing;
    }
    const window = this.createWindow(run.applet, name, windowOptions(spec));
    run.windows.set(name, window);
    if (spec.kind === "overlay") {
      window.setAlwaysOnTop(true, "floating");
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    if (spec.kind === "popover") {
      this.ensureTray(run, name);
      window.on("blur", () => window.hide());
      return window;
    }
    placeWindow(window, spec);
    // An overlay appears without taking focus from what you're doing.
    window.once("ready-to-show", () => (spec.kind === "overlay" ? window.showInactive() : window.show()));
    return window;
  }

  closeWindow(id: string, name: string): void {
    const window = this.running.get(id)?.windows.get(name);
    if (window && !window.isDestroyed()) window.close();
  }

  window(id: string, name: string): BrowserWindow {
    const window = this.running.get(id)?.windows.get(name);
    if (!window || window.isDestroyed()) throw new Error(`Window "${name}" isn't open`);
    return window;
  }

  setTray(id: string, options: { title?: string; tooltip?: string }): void {
    const run = this.running.get(id);
    if (!run) return;
    const popover = Object.entries(run.applet.manifest.windows).find(([, spec]) => spec.kind === "popover")?.[0] ?? null;
    const tray = this.ensureTray(run, popover);
    if (options.title !== undefined) tray.setTitle(options.title.slice(0, 40));
    if (options.tooltip !== undefined) tray.setToolTip(options.tooltip.slice(0, 120));
  }

  private ensureTray(run: Running, popover: string | null): Tray {
    if (run.tray) return run.tray;
    const tray = new Tray(nativeImage.createEmpty());
    tray.setTitle(run.applet.manifest.name.slice(0, 20));
    tray.setToolTip(run.applet.manifest.name);
    tray.on("click", () => {
      if (!popover) return this.onEvent(run.applet.id, "tray:click");
      const window = run.windows.get(popover);
      if (window && !window.isDestroyed() && window.isVisible()) window.hide();
      else this.openWindow(run.applet.id, popover);
    });
    run.tray = tray;
    return tray;
  }

  private positionPopover(run: Running, window: BrowserWindow): void {
    const bounds = run.tray?.getBounds();
    if (!bounds) return;
    const { width } = window.getBounds();
    window.setPosition(Math.round(bounds.x + bounds.width / 2 - width / 2), Math.round(bounds.y + bounds.height + 4));
  }

  private createWindow(applet: Applet, name: string | null, options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    const window = new BrowserWindow({
      ...options,
      title: applet.manifest.name,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        additionalArguments: [`--studio-applet=${applet.id}`],
      },
    });
    const contents = window.webContents;
    const contentsId = contents.id;
    this.owners.set(contentsId, { id: applet.id, window: name });
    window.on("closed", () => {
      this.owners.delete(contentsId);
      const run = this.running.get(applet.id);
      if (name && run?.windows.get(name) === window) run.windows.delete(name);
    });
    if (name) {
      window.on("show", () => this.onEvent(applet.id, "window:shown", { name }));
      window.on("hide", () => this.onEvent(applet.id, "window:hidden", { name }));
      window.on("focus", () => this.onEvent(applet.id, "window:focus", { name }));
    }
    // Stay on the applet's own pages; links open nowhere unless studio.open allows them.
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!url.startsWith(`applet://${applet.id}/`)) event.preventDefault();
    });
    contents.on("console-message", (event) => this.log(applet.id, event.level, event.message));
    contents.on("render-process-gone", (_event, details) => this.log(applet.id, "error", `renderer gone: ${details.reason}`));
    contents.on("did-fail-load", (_event, code, description, url) => this.log(applet.id, "error", `failed to load ${url}: ${description} (${code})`));
    void window.loadURL(`applet://${applet.id}/${applet.manifest.entry}${name ? `?window=${encodeURIComponent(name)}` : ""}`);
    return window;
  }
}

export function windowOptions(spec: WindowSpec): Electron.BrowserWindowConstructorOptions {
  const size = { width: spec.width ?? 480, height: spec.height ?? 360 };
  switch (spec.kind) {
    case "overlay":
      return { ...size, show: false, frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true, focusable: true, backgroundColor: "#00000000" };
    case "popover":
      return { ...size, show: false, frame: false, resizable: false, skipTaskbar: true, fullscreenable: false, vibrancy: "popover", visualEffectState: "active" };
    case "panel":
      return { ...size, show: false, type: "panel", titleBarStyle: "hiddenInset", fullscreenable: false };
    default:
      return { ...size, show: false, titleBarStyle: "hiddenInset" };
  }
}

function placeWindow(window: BrowserWindow, spec: WindowSpec): void {
  const area = screen.getPrimaryDisplay().workArea;
  const { width, height } = window.getBounds();
  const margin = 16;
  const left = area.x + margin;
  const right = area.x + area.width - width - margin;
  const top = area.y + margin;
  const bottom = area.y + area.height - height - margin;
  const at: Record<string, [number, number]> = {
    "top-left": [left, top],
    "top-right": [right, top],
    "bottom-left": [left, bottom],
    "bottom-right": [right, bottom],
  };
  const position = spec.position ? at[spec.position] : undefined;
  if (position) window.setPosition(Math.round(position[0]), Math.round(position[1]));
  else window.center();
}
