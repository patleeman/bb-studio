import { join } from "node:path";
import {
  app,
  BrowserWindow,
  globalShortcut,
  nativeImage,
  screen,
  Tray,
  type BrowserWindowConstructorOptions,
  type IpcMain,
  type IpcMainInvokeEvent,
} from "electron";
import {
  placeForkWindow,
  readForkWindowBounds,
  writeForkWindowBounds,
  type ForkDisplayArea,
  type ForkWindowBounds,
} from "./fork-window-bounds.js";
import {
  BB_DESKTOP_FORK_WINDOW_CHANNEL,
  FORK_BARE_QUERY_KEY,
  FORK_WINDOW_CLICK_THROUGH_EVENT,
  FORK_WINDOW_PATH_PREFIX,
  type ForkWindowOptions,
  type ForkWindowRequest,
} from "./fork-windows-ipc.js";

interface Registered {
  url: string;
  preload: string | undefined;
  options: ForkWindowOptions;
  window: BrowserWindow | null;
  hotkey: string | null;
  tray: Tray | null;
  clickThrough: boolean;
}

const MIN_SIZE = 120;
const MAX_SIZE = 4000;
const registered = new Map<string, Registered>();

function size(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)))
    : fallback;
}

export function forkWindowOptions(
  options: ForkWindowOptions,
  preload: string | undefined,
): BrowserWindowConstructorOptions {
  const transparent = options.transparent === true;
  const position =
    typeof options.x === "number" && typeof options.y === "number"
      ? { x: Math.round(options.x), y: Math.round(options.y) }
      : {};
  return {
    ...position,
    width: size(options.width, 480),
    height: size(options.height, 360),
    title: typeof options.title === "string" ? options.title : "bb",
    transparent,
    frame: transparent ? false : options.frame !== false,
    hasShadow: !transparent,
    backgroundColor: transparent ? "#00000000" : undefined,
    alwaysOnTop: options.alwaysOnTop === true,
    resizable: options.resizable !== false,
    minWidth: size(options.minWidth, MIN_SIZE),
    minHeight: size(options.minHeight, MIN_SIZE),
    ...(options.titleBar === "hiddenInset" && !transparent
      ? { titleBarStyle: "hiddenInset" as const }
      : {}),
    ...(options.center === true ? { center: true } : {}),
    skipTaskbar: transparent || options.hideOnBlur === true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload,
    },
  };
}

export function forkWindowUrl(senderUrl: string, path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  if (path.startsWith("//") || path.includes("\\")) return null;
  try {
    const origin = new URL(senderUrl).origin;
    const url = new URL(path, origin);
    if (url.origin !== origin) return null;
    return url.pathname.startsWith(FORK_WINDOW_PATH_PREFIX) ||
      url.searchParams.get(FORK_BARE_QUERY_KEY) === "1"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

let storedBounds: Record<string, ForkWindowBounds> | null = null;

function boundsFilePath(): string {
  return join(app.getPath("userData"), "fork-window-bounds.json");
}

function allStoredBounds(): Record<string, ForkWindowBounds> {
  storedBounds ??= readForkWindowBounds(boundsFilePath());
  return storedBounds;
}

function area(display: Electron.Display): ForkDisplayArea {
  return { id: display.id, ...display.workArea };
}

function rememberBounds(key: string, window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const bounds = window.getBounds();
  allStoredBounds()[key] = {
    ...bounds,
    displayId: screen.getDisplayMatching(bounds).id,
  };
  writeForkWindowBounds(boundsFilePath(), allStoredBounds());
}

function setClickThrough(entry: Registered, on: boolean): void {
  entry.clickThrough = on;
  const window = entry.window;
  if (window === null || window.isDestroyed()) return;
  window.setIgnoreMouseEvents(on, { forward: true });
  void window.webContents
    .executeJavaScript(
      `window.dispatchEvent(new CustomEvent(${JSON.stringify(FORK_WINDOW_CLICK_THROUGH_EVENT)},{detail:{on:${on ? "true" : "false"}}}))`,
    )
    .catch(() => undefined);
}

function show(entry: Registered, key: string): void {
  if (entry.window !== null && !entry.window.isDestroyed()) {
    entry.window.show();
    entry.window.focus();
    return;
  }
  const options = forkWindowOptions(entry.options, entry.preload);
  const stored =
    entry.options.rememberBounds === true ? allStoredBounds()[key] : undefined;
  const window = new BrowserWindow(
    stored === undefined
      ? options
      : {
          ...options,
          ...placeForkWindow(
            stored,
            screen.getAllDisplays().map(area),
            area(screen.getPrimaryDisplay()),
            {
              width: options.minWidth ?? MIN_SIZE,
              height: options.minHeight ?? MIN_SIZE,
            },
          ),
        },
  );
  entry.window = window;
  if (entry.options.rememberBounds === true) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => rememberBounds(key, window), 300);
    };
    window.on("moved", later);
    window.on("resized", later);
    window.on("close", () => {
      if (timer !== null) clearTimeout(timer);
      rememberBounds(key, window);
    });
  }
  if (entry.options.alwaysOnTop === true) {
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  if (entry.options.hideOnBlur === true) {
    window.on("blur", () => {
      if (entry.window === window) hide(entry);
    });
  }
  entry.clickThrough = entry.options.clickThrough === true;
  if (entry.clickThrough) {
    window.setIgnoreMouseEvents(true, { forward: true });
  }
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (entry.window === window) entry.window = null;
  });
  void window.loadURL(entry.url);
}

function hide(entry: Registered): void {
  if (entry.window !== null && !entry.window.isDestroyed()) {
    entry.window.close();
  }
  entry.window = null;
}

function isShown(entry: Registered): boolean {
  return (
    entry.window !== null &&
    !entry.window.isDestroyed() &&
    entry.window.isVisible()
  );
}

function toggle(entry: Registered, key: string): void {
  if (isShown(entry)) {
    hide(entry);
  } else {
    show(entry, key);
  }
}

function summon(entry: Registered, key: string): void {
  if (isShown(entry) && entry.clickThrough) {
    setClickThrough(entry, false);
    entry.window?.focus();
    return;
  }
  toggle(entry, key);
}

function release(entry: Registered): void {
  if (entry.hotkey !== null) globalShortcut.unregister(entry.hotkey);
  entry.tray?.destroy();
  entry.hotkey = null;
  entry.tray = null;
}

function register(
  key: string,
  url: string,
  preload: string | undefined,
  options: ForkWindowOptions,
): Registered {
  const existing = registered.get(key);
  if (existing !== undefined) release(existing);
  const entry: Registered = {
    url,
    preload,
    options,
    window: existing?.window ?? null,
    hotkey: null,
    tray: null,
    clickThrough: existing?.clickThrough ?? false,
  };
  if (typeof options.hotkey === "string" && options.hotkey.length > 0) {
    try {
      if (globalShortcut.register(options.hotkey, () => summon(entry, key))) {
        entry.hotkey = options.hotkey;
      }
    } catch {
      entry.hotkey = null;
    }
  }
  if (
    typeof options.menuBarTitle === "string" &&
    options.menuBarTitle.length > 0
  ) {
    const tray = new Tray(nativeImage.createEmpty());
    tray.setTitle(options.menuBarTitle.slice(0, 12));
    tray.setToolTip(
      typeof options.hotkey === "string" &&
        options.hotkey.length > 0 &&
        entry.hotkey === null
        ? `${options.title ?? options.menuBarTitle}: the shortcut ${options.hotkey} is taken by another app`
        : (options.title ?? options.menuBarTitle),
    );
    tray.on("click", () => summon(entry, key));
    entry.tray = tray;
  }
  registered.set(key, entry);
  return entry;
}

function handle(event: IpcMainInvokeEvent, request: unknown): boolean {
  if (typeof request !== "object" || request === null) return false;
  const { op, key, path, options, on, hold } =
    request as Partial<ForkWindowRequest>;
  if (typeof key !== "string" || key.length === 0 || key.length > 200) {
    return false;
  }
  if (op === "hotkey") {
    const entry = registered.get(key);
    return entry !== undefined && entry.hotkey !== null;
  }
  if (op === "clickThrough") {
    const entry = registered.get(key);
    if (entry === undefined || !isShown(entry)) return false;
    if (hold === true) {
      if (!entry.clickThrough) return false;
      entry.window?.setIgnoreMouseEvents(on === true, { forward: true });
      return true;
    }
    setClickThrough(entry, on === true);
    return true;
  }
  if (op === "close") {
    const entry = registered.get(key);
    if (entry === undefined) return false;
    hide(entry);
    return true;
  }
  if (op === "unregister") {
    const entry = registered.get(key);
    if (entry === undefined) return false;
    hide(entry);
    release(entry);
    registered.delete(key);
    return true;
  }
  const url = forkWindowUrl(event.senderFrame?.url ?? "", path);
  if (url === null) return false;
  const preload = join(app.getAppPath(), "dist", "preload.cjs");
  const entry = register(
    key,
    url,
    preload,
    typeof options === "object" && options !== null ? options : {},
  );
  if (op === "open") show(entry, key);
  if (op === "toggle") toggle(entry, key);
  return op === "register" || op === "open" || op === "toggle";
}

export function registerForkWindowIpc(ipcMain: IpcMain): void {
  ipcMain.handle(BB_DESKTOP_FORK_WINDOW_CHANNEL, handle);
}
