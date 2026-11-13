import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  screen,
  shell,
  systemPreferences,
  type IpcMain,
  type IpcMainInvokeEvent,
} from "electron";
import { STUDIO_BUILD } from "./studio-release.fork.js";
import {
  startAgentSocket,
  type AgentRequest,
  type AgentResponse,
} from "./fork-desktop-agent-socket.js";
import {
  FORK_DESKTOP_CONTROL_CHANNEL,
  FORK_DESKTOP_CONTROL_EVENT_CHANNEL,
  type DesktopActivity,
  type DesktopControlRequest,
  type DesktopControlState,
  type DesktopPermissionName,
  type DesktopPin,
  type DesktopRect,
} from "./fork-desktop-control-ipc.js";
import {
  desktopControlDir,
  DesktopDriver,
  DRIVER_BINARY,
  HELPER_BINARY,
} from "./fork-desktop-driver.js";
import {
  DesktopGrants,
  judgePointer,
  pausePhase,
  type PointerSample,
} from "./fork-desktop-grants.js";
import { DesktopHelper, type HelperEvent } from "./fork-desktop-helper.js";
import {
  allPermissionsGranted,
  DESKTOP_PERMISSION_NAMES,
  desktopSettingsUrl,
  NO_PERMISSIONS,
  readPermissions,
  screenRecordingNeedsRestart,
} from "./fork-desktop-permissions.js";
import {
  EMPTY_TARGET,
  PinBoard,
  pinAgentText,
  targetFromInspect,
  type InspectResult,
} from "./fork-desktop-pins.js";
import {
  defaultCaption,
  DESKTOP_ACTION_TOOLS,
  driverToolFor,
  isDesktopAgentTool,
  isKeyboardTool,
  needsForeground,
  readSnapshot,
  sanitizeArgs,
  screenPoint,
  secureRefusal,
  SnapshotCache,
  type DesktopAgentTool,
} from "./fork-desktop-policy.js";

export const OVERLAY_PATH = "/fork-window/_bb/desktop-overlay";
export const DEFAULT_TALK_KEY = "fn";
const TALK_KEYS = new Set(["fn", "AltRight", "MetaRight", "ControlRight"]);
const ASK_TIMEOUT_MS = 120_000;
const PAUSE_WAIT_MS = 20_000;
const IDLE_AFTER_MS = 6_000;
const WATCH_MS = 60;
const SOCKET_PATH_MAX = 100;

function unsupportedState(): DesktopControlState {
  return {
    supported: false,
    driver: { status: "unavailable", version: null, error: null },
    helper: false,
    permissions: NO_PERMISSIONS,
    restartAdvised: false,
    hud: { shown: false, threadId: null },
    pointing: false,
    talkKey: DEFAULT_TALK_KEY,
    talking: false,
    hover: null,
    pins: [],
    activity: null,
    grant: { kind: "none", threadId: null },
    ask: null,
  };
}

function isRect(value: DesktopRect | null): value is DesktopRect {
  return value !== null && value.width > 0 && value.height > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DesktopControl {
  private readonly dir: string | null;
  private readonly grants = new DesktopGrants(() => this.changed());
  private readonly pins = new PinBoard();
  private readonly snapshots = new SnapshotCache();
  private readonly overlays = new Map<number, BrowserWindow>();
  private readonly hiddenMain = new Set<BrowserWindow>();
  private driver: DesktopDriver | null = null;
  private helper: DesktopHelper | null = null;
  private hudWindow: BrowserWindow | null = null;
  private origin: string | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPointer: PointerSample | null = null;
  private suppressedUntil = 0;
  private pausedUntil = 0;
  private screenRecordingAtLaunch: boolean | null = null;
  private broadcastQueued = false;
  private hoverBusy = false;
  private hoverNext: { x: number; y: number } | null = null;
  private talkPin: string | null = null;
  private escapeFor: "pointing" | "activity" | null = null;
  private pinCounter = 0;
  readonly state: DesktopControlState;

  constructor() {
    this.dir = desktopControlDir({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      env: process.env,
    });
    this.state = {
      ...unsupportedState(),
      supported: this.dir !== null,
      driver: {
        status: this.dir === null ? "unavailable" : "stopped",
        version: null,
        error: null,
      },
      helper: this.dir !== null,
    };
  }

  private get stateDir(): string {
    return join(app.getPath("userData"), "desktop-control");
  }

  private log(message: string): void {
    try {
      process.stderr.write(`[desktop-control] ${message}\n`);
    } catch {}
  }

  private ensureHelper(): DesktopHelper | null {
    if (this.dir === null) return null;
    this.helper ??= new DesktopHelper({
      binary: join(this.dir, HELPER_BINARY),
      log: (message) => this.log(message),
      onEvent: (event) => this.onHelperEvent(event),
    });
    return this.helper;
  }

  private ensureDriver(): DesktopDriver | null {
    if (this.dir === null) return null;
    if (this.driver !== null) return this.driver;
    const short = join(this.stateDir, "d.sock");
    const socketPath =
      short.length <= SOCKET_PATH_MAX
        ? short
        : join(mkdtempSync(join(tmpdir(), "bbsdd-")), "d.sock");
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    this.driver = new DesktopDriver({
      binary: join(this.dir, DRIVER_BINARY),
      stateDir: this.stateDir,
      socketPath,
      hostBundleId: process.env.__CFBundleIdentifier ?? "bb-studio",
      env: process.env,
      log: (message) => this.log(message),
      onExit: () => {
        this.state.driver = {
          status: "failed",
          version: null,
          error: this.driver?.lastError ?? null,
        };
        this.changed();
      },
    });
    return this.driver;
  }

  private async startDriver(): Promise<DesktopDriver | null> {
    const driver = this.ensureDriver();
    if (driver === null) return null;
    if (driver.running) return driver;
    this.state.driver = { status: "starting", version: null, error: null };
    this.changed();
    try {
      await driver.start();
      this.state.driver = {
        status: "ready",
        version: driver.version,
        error: null,
      };
      this.changed();
      return driver;
    } catch (error) {
      this.state.driver = {
        status: "failed",
        version: null,
        error: error instanceof Error ? error.message : String(error),
      };
      this.changed();
      return null;
    }
  }

  private get previewAllowed(): boolean {
    return STUDIO_BUILD?.test !== null && STUDIO_BUILD?.test !== undefined;
  }

  changed(): void {
    const grant = this.grants.snapshot();
    this.state.grant = { kind: grant.kind, threadId: grant.threadId };
    this.state.ask = grant.ask;
    this.state.pins = this.pins.list();
    this.syncEscape();
    if (this.broadcastQueued) return;
    this.broadcastQueued = true;
    setImmediate(() => {
      this.broadcastQueued = false;
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed())
          window.webContents.send(
            FORK_DESKTOP_CONTROL_EVENT_CHANNEL,
            this.state,
          );
      }
    });
  }

  async refreshPermissions(): Promise<void> {
    if (!this.state.supported) return;
    let probe: Record<string, unknown> | null = null;
    try {
      probe = (await this.ensureHelper()?.request("status")) ?? null;
      this.state.helper = probe !== null;
    } catch (error) {
      this.state.helper = false;
      this.log(`permission check failed: ${String(error)}`);
    }
    const permissions = readPermissions(probe, {
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording:
        systemPreferences.getMediaAccessStatus("screen") === "granted",
    });
    this.screenRecordingAtLaunch ??= permissions.screenRecording;
    this.state.permissions = permissions;
    this.state.restartAdvised = screenRecordingNeedsRestart(
      this.screenRecordingAtLaunch,
      permissions,
    );
    this.changed();
  }

  private async requestPermission(
    permission: DesktopPermissionName,
  ): Promise<void> {
    try {
      if (permission === "accessibility")
        systemPreferences.isTrustedAccessibilityClient(true);
      if (permission === "screenRecording")
        await this.ensureHelper()?.request(
          "requestScreenRecording",
          {},
          60_000,
        );
      if (permission === "inputMonitoring")
        await this.ensureHelper()?.request(
          "requestInputMonitoring",
          {},
          60_000,
        );
    } catch (error) {
      this.log(`permission request failed: ${String(error)}`);
    }
    await this.refreshPermissions();
  }

  async handle(
    event: IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<DesktopControlState> {
    const request = raw as DesktopControlRequest;
    switch (request?.op) {
      case "state":
        if (!this.state.permissions.checked) await this.refreshPermissions();
        break;
      case "refreshPermissions":
        await this.refreshPermissions();
        break;
      case "requestPermission":
        if (DESKTOP_PERMISSION_NAMES.includes(request.permission))
          await this.requestPermission(request.permission);
        break;
      case "openSettings":
        if (DESKTOP_PERMISSION_NAMES.includes(request.permission))
          await shell.openExternal(desktopSettingsUrl(request.permission));
        break;
      case "relaunch":
        app.relaunch();
        app.quit();
        break;
      case "hud":
        if (request.shown)
          this.showHud(
            event,
            typeof request.threadId === "string" ? request.threadId : null,
          );
        else this.hideHud();
        break;
      case "pointing":
        this.setPointing(request.on === true);
        break;
      case "talkKey":
        if (TALK_KEYS.has(request.key)) {
          this.state.talkKey = request.key;
          this.watchTalkKey();
          this.changed();
        }
        break;
      case "talk":
        await this.onTalk(request.down === true);
        break;
      case "point":
        if (typeof request.x === "number" && typeof request.y === "number") {
          if (request.click === true)
            await this.pinAt(request.x, request.y, true);
          else this.hoverAt(request.x, request.y);
        }
        break;
      case "pinsTaken":
        if (Array.isArray(request.ids)) {
          this.pins.take(
            request.ids.filter((id): id is string => typeof id === "string"),
          );
          this.changed();
        }
        break;
      case "clearPins":
        this.pins.clear();
        this.changed();
        break;
      case "answer":
        if (
          typeof request.id === "string" &&
          ["session", "once", "no"].includes(request.answer)
        ) {
          this.grants.answer(request.id, request.answer);
        }
        break;
      case "stop":
        this.stopActivity();
        break;
      case "preview":
        if (
          this.previewAllowed &&
          typeof request.state === "object" &&
          request.state !== null
        ) {
          Object.assign(this.state, request.state);
          if (Array.isArray(request.state.pins)) {
            this.pins.clear();
            for (const pin of request.state.pins)
              this.pins.add({
                id: pin.id,
                threadId: pin.threadId,
                x: pin.x,
                y: pin.y,
                at: pin.createdAt,
                target: pin,
                placed: pin.placed,
              });
            for (const pin of request.state.pins)
              this.pins.update(pin.id, {
                imagePath: pin.imagePath,
                thumbnail: pin.thumbnail,
                taken: pin.taken,
              });
          }
          const ask = request.state.ask;
          if (ask)
            void this.grants.askForeground({
              threadId: ask.threadId,
              agent: ask.agent,
              reason: ask.reason,
              app: ask.app,
            });
          this.changed();
        }
        break;
      case "resume":
        this.grants.resume(this.state.hud.threadId);
        if (this.state.activity?.phase === "stopped")
          this.state.activity = null;
        this.changed();
        break;
      default:
        break;
    }
    return this.state;
  }

  private mainWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter((window) => {
      if (window.isDestroyed() || window === this.hudWindow) return false;
      if ([...this.overlays.values()].includes(window)) return false;
      const url = window.webContents.getURL();
      return !url.includes("/fork-window/") && !url.includes("bbBare=1");
    });
  }

  private showHud(event: IpcMainInvokeEvent, threadId: string | null): void {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) return;
    try {
      this.origin = new URL(
        event.senderFrame?.url ?? event.sender.getURL(),
      ).origin;
    } catch {
      this.origin = null;
    }
    const first = this.hudWindow !== window;
    this.hudWindow = window;
    this.state.hud = { shown: true, threadId };
    if (first) {
      window.setAlwaysOnTop(true, "status");
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.once("closed", () => {
        if (this.hudWindow === window) this.hideHud();
      });
      for (const main of this.mainWindows()) {
        if (main.isVisible()) {
          this.hiddenMain.add(main);
          main.hide();
        }
      }
      window.focus();
      this.showOverlays();
      this.startWatch();
      this.watchTalkKey();
      void this.refreshPermissions();
      void this.startDriver();
    }
    this.changed();
  }

  private hideHud(): void {
    const hud = this.hudWindow;
    this.hudWindow = null;
    this.state.hud = { shown: false, threadId: null };
    this.state.pointing = false;
    this.state.hover = null;
    this.state.talking = false;
    this.talkPin = null;
    this.pins.clear();
    this.grants.endSession();
    this.state.activity = null;
    this.stopWatch();
    void this.ensureHelper()
      ?.request("unwatchKey")
      .catch(() => {});
    for (const overlay of this.overlays.values())
      if (!overlay.isDestroyed()) overlay.destroy();
    this.overlays.clear();
    if (hud !== null && !hud.isDestroyed()) hud.close();
    const restore = [...this.hiddenMain].filter(
      (window) => !window.isDestroyed(),
    );
    this.hiddenMain.clear();
    for (const window of restore) window.show();
    restore[0]?.focus();
    this.changed();
  }

  private showOverlays(): void {
    if (this.origin === null) return;
    const preload = join(app.getAppPath(), "dist", "preload.cjs");
    for (const display of screen.getAllDisplays()) {
      if (this.overlays.has(display.id)) continue;
      const overlay = new BrowserWindow({
        ...display.bounds,
        transparent: true,
        backgroundColor: "#00000000",
        frame: false,
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: true,
        enableLargerThanScreen: true,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload,
        },
      });
      overlay.setIgnoreMouseEvents(true, { forward: true });
      overlay.setAlwaysOnTop(true, "floating");
      overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      overlay.setContentProtection(true);
      overlay.once("ready-to-show", () => overlay.showInactive());
      void overlay.loadURL(
        `${this.origin}${OVERLAY_PATH}?bbTransparent=1&display=${String(display.id)}&x=${String(display.bounds.x)}&y=${String(display.bounds.y)}`,
      );
      this.overlays.set(display.id, overlay);
    }
  }

  private setPointing(on: boolean): void {
    if (!this.state.hud.shown || !allPermissionsGranted(this.state.permissions))
      on = false;
    this.state.pointing = on;
    if (!on) this.state.hover = null;
    for (const overlay of this.overlays.values()) {
      if (overlay.isDestroyed()) continue;
      overlay.setIgnoreMouseEvents(!on, { forward: true });
    }
    if (on) {
      const display = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      );
      this.overlays.get(display.id)?.focus();
    } else {
      this.hudWindow?.focus();
    }
    this.changed();
  }

  private syncEscape(): void {
    const want =
      this.state.activity !== null && this.state.activity.phase !== "stopped"
        ? "activity"
        : this.state.pointing
          ? "pointing"
          : null;
    if (want === this.escapeFor) return;
    if (this.escapeFor !== null) globalShortcut.unregister("Escape");
    this.escapeFor = null;
    if (want === null) return;
    try {
      if (globalShortcut.register("Escape", () => this.onEscape()))
        this.escapeFor = want;
    } catch {
      this.escapeFor = null;
    }
  }

  private onEscape(): void {
    if (
      this.state.activity !== null &&
      this.state.activity.phase !== "stopped"
    ) {
      this.stopActivity();
      return;
    }
    if (this.state.pointing) this.hideHud();
  }

  private stopActivity(): void {
    const threadId = this.state.activity?.threadId ?? this.state.hud.threadId;
    this.grants.stop(threadId);
    if (this.state.activity !== null) {
      this.state.activity = {
        ...this.state.activity,
        phase: "stopped",
        updatedAt: Date.now(),
      };
    }
    this.changed();
  }

  private watchTalkKey(): void {
    if (!this.state.hud.shown || !this.state.permissions.inputMonitoring)
      return;
    void this.ensureHelper()
      ?.request("watchKey", { key: this.state.talkKey })
      .catch((error) => this.log(`talk key: ${String(error)}`));
  }

  private onHelperEvent(event: HelperEvent): void {
    if (event.event === "key" && event.key === this.state.talkKey)
      void this.onTalk(event.down);
  }

  private async onTalk(down: boolean): Promise<void> {
    if (!this.state.hud.shown) return;
    if (down) {
      if (this.state.talking) return;
      this.state.talking = true;
      this.changed();
      const point = screen.getCursorScreenPoint();
      const pin = await this.pinAt(point.x, point.y, false);
      this.talkPin = pin?.id ?? null;
      return;
    }
    if (!this.state.talking) return;
    this.state.talking = false;
    if (this.talkPin !== null) this.pins.update(this.talkPin, { placed: true });
    this.talkPin = null;
    this.changed();
  }

  private async inspect(x: number, y: number): Promise<InspectResult | null> {
    try {
      return (
        (await this.ensureHelper()?.request("inspect", {
          x,
          y,
          excludePids: [process.pid],
        })) ?? null
      );
    } catch {
      return null;
    }
  }

  private hoverAt(x: number, y: number): void {
    if (!this.state.pointing) return;
    if (this.hoverBusy) {
      this.hoverNext = { x, y };
      return;
    }
    this.hoverBusy = true;
    void this.inspect(x, y)
      .then((result) => {
        const target = targetFromInspect(result);
        this.state.hover =
          target.windowId === null
            ? null
            : {
                ...target,
                id: "hover",
                number: 0,
                threadId: null,
                createdAt: Date.now(),
                x,
                y,
                imagePath: null,
                thumbnail: null,
                placed: false,
                taken: false,
              };
        this.changed();
      })
      .finally(() => {
        this.hoverBusy = false;
        const next = this.hoverNext;
        this.hoverNext = null;
        if (next !== null) this.hoverAt(next.x, next.y);
      });
  }

  private async pinAt(
    x: number,
    y: number,
    placed: boolean,
  ): Promise<DesktopPin | null> {
    if (!this.state.hud.shown) return null;
    const result = await this.inspect(x, y);
    this.pinCounter += 1;
    const pin = this.pins.add({
      id: `pin-${String(Date.now())}-${String(this.pinCounter)}`,
      threadId: this.state.hud.threadId,
      x,
      y,
      at: Date.now(),
      target: result === null ? EMPTY_TARGET : targetFromInspect(result),
      placed,
    });
    this.changed();
    void this.capture(pin).then((image) => {
      if (image === null) return;
      this.pins.update(pin.id, image);
      this.changed();
    });
    return pin;
  }

  private async capture(
    pin: DesktopPin,
  ): Promise<{ imagePath: string; thumbnail: string } | null> {
    if (!this.state.permissions.screenRecording) return null;
    try {
      const display = screen.getDisplayNearestPoint({
        x: Math.round(pin.x),
        y: Math.round(pin.y),
      });
      const scale = display.scaleFactor;
      let image: Electron.NativeImage | null = null;
      if (pin.windowId !== null && isRect(pin.windowBounds)) {
        const sources = await desktopCapturer.getSources({
          types: ["window"],
          thumbnailSize: {
            width: Math.ceil(pin.windowBounds.width * scale),
            height: Math.ceil(pin.windowBounds.height * scale),
          },
          fetchWindowIcons: false,
        });
        const source = sources.find((candidate) =>
          candidate.id.startsWith(`window:${String(pin.windowId)}:`),
        );
        if (source !== undefined && !source.thumbnail.isEmpty())
          image = source.thumbnail;
      }
      if (image === null) {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: {
            width: Math.ceil(display.bounds.width * scale),
            height: Math.ceil(display.bounds.height * scale),
          },
        });
        const source =
          sources.find(
            (candidate) => candidate.display_id === String(display.id),
          ) ?? sources[0];
        if (source === undefined || source.thumbnail.isEmpty()) return null;
        const size = source.thumbnail.getSize();
        const ratio = size.width / display.bounds.width;
        const width = Math.min(size.width, Math.round(640 * ratio));
        const height = Math.min(size.height, Math.round(420 * ratio));
        const left = Math.max(
          0,
          Math.min(
            size.width - width,
            Math.round((pin.x - display.bounds.x) * ratio - width / 2),
          ),
        );
        const top = Math.max(
          0,
          Math.min(
            size.height - height,
            Math.round((pin.y - display.bounds.y) * ratio - height / 2),
          ),
        );
        image = source.thumbnail.crop({ x: left, y: top, width, height });
      }
      const dir = join(app.getPath("userData"), "desktop-pins");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const imagePath = join(dir, `${pin.id}.png`);
      writeFileSync(imagePath, image.toPNG());
      const thumbnail = image
        .resize({ width: 112, quality: "good" })
        .toDataURL();
      return { imagePath, thumbnail };
    } catch (error) {
      this.log(`capture failed: ${String(error)}`);
      return null;
    }
  }

  private startWatch(): void {
    if (this.watchTimer !== null) return;
    this.lastPointer = null;
    this.watchTimer = setInterval(() => this.tick(), WATCH_MS);
  }

  private stopWatch(): void {
    if (this.watchTimer !== null) clearInterval(this.watchTimer);
    this.watchTimer = null;
  }

  private tick(): void {
    const point = screen.getCursorScreenPoint();
    const sample: PointerSample = { x: point.x, y: point.y, at: Date.now() };
    const activity = this.state.activity;
    const target = activity === null ? null : this.activityBounds(activity);
    const verdict = judgePointer(
      this.lastPointer,
      sample,
      target,
      this.suppressedUntil,
    );
    this.lastPointer = sample;
    if (verdict.moved && this.grants.userMoved()) this.changed();
    if (activity === null || activity.phase === "stopped") return;
    const next = pausePhase({
      phase: activity.phase,
      verdict,
      now: sample.at,
      pausedUntil: this.pausedUntil,
    });
    this.pausedUntil = next.pausedUntil;
    if (next.phase !== activity.phase) {
      this.state.activity = {
        ...activity,
        phase: next.phase,
        updatedAt: sample.at,
      };
      this.changed();
    }
  }

  private activityBounds(activity: DesktopActivity): DesktopRect | null {
    return this.activityWindow?.threadId === activity.threadId
      ? this.activityWindow.bounds
      : null;
  }

  private activityWindow: {
    threadId: string;
    bounds: DesktopRect | null;
  } | null = null;

  private scheduleIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (
        this.state.activity !== null &&
        this.state.activity.phase === "acting"
      ) {
        this.state.activity = null;
        this.changed();
      }
    }, IDLE_AFTER_MS);
  }

  private async waitWhilePaused(threadId: string): Promise<string | null> {
    const deadline = Date.now() + PAUSE_WAIT_MS;
    while (
      this.state.activity?.phase === "paused" &&
      this.state.activity.threadId === threadId
    ) {
      if (Date.now() > deadline)
        return `Paused: the user is using ${this.state.activity.app ?? "that window"}. Try again in a moment.`;
      await sleep(120);
    }
    return this.grants.isStopped(threadId)
      ? "Stopped: the user stopped desktop control."
      : null;
  }

  private async askForeground(
    request: AgentRequest,
    reason: string,
    appName: string | null,
  ): Promise<string | null> {
    const ask = this.grants.askForeground({
      threadId: request.threadId,
      agent: request.agent,
      reason,
      app: appName,
    });
    const pending = this.grants.snapshot().ask;
    const timer =
      pending === null
        ? null
        : setTimeout(() => this.grants.expireAsk(pending.id), ASK_TIMEOUT_MS);
    this.hudWindow?.showInactive();
    const decision = await ask;
    if (timer !== null) clearTimeout(timer);
    if (decision === "granted") return null;
    if (decision === "stopped")
      return "Stopped: the user stopped desktop control.";
    if (decision === "busy")
      return "Another conversation is asking to drive right now.";
    return "The user said no to giving you their cursor and keyboard. Stay in the background, or ask them to do this step.";
  }

  private statusText(threadId: string): string {
    const s = this.state;
    const lines = [
      `HUD: ${s.hud.shown ? (s.hud.threadId === threadId ? "open on this conversation" : "open on another conversation") : "closed"}`,
      `Permissions: Accessibility ${s.permissions.accessibility ? "on" : "off"}, Screen Recording ${s.permissions.screenRecording ? "on" : "off"}, Input Monitoring ${s.permissions.inputMonitoring ? "on" : "off"}`,
      `Driver: ${s.driver.status}${s.driver.version === null ? "" : ` ${s.driver.version}`}`,
      `Cursor and keyboard: ${s.grant.kind === "none" || s.grant.threadId !== threadId ? "not yours (background only)" : s.grant.kind === "session" ? "yours for this session" : "yours for one action"}`,
      `Pins: ${String(s.pins.filter((pin) => pin.threadId === threadId).length)}`,
    ];
    if (this.grants.isStopped(threadId)) lines.push("Stopped by the user.");
    return lines.join("\n");
  }

  async agent(request: AgentRequest): Promise<AgentResponse> {
    if (!isDesktopAgentTool(request.tool))
      return { ok: false, error: `unknown desktop tool ${request.tool}` };
    const tool: DesktopAgentTool = request.tool;
    if (!this.state.supported)
      return {
        ok: false,
        error: "Desktop control is not available in this build.",
      };
    if (tool === "status")
      return { ok: true, text: this.statusText(request.threadId) };
    if (!this.state.hud.shown || this.state.hud.threadId !== request.threadId) {
      return {
        ok: false,
        error:
          "Desktop control works only for the conversation open in the HUD. Ask the user to open the HUD on this conversation.",
      };
    }
    if (tool === "pins") {
      const pins = this.pins
        .list()
        .filter((pin) => pin.threadId === request.threadId && pin.placed);
      return {
        ok: true,
        text:
          pins.length === 0 ? "No pins." : pins.map(pinAgentText).join("\n\n"),
      };
    }
    if (!this.state.permissions.accessibility) {
      return {
        ok: false,
        error:
          "BB Studio does not have Accessibility permission. Ask the user to allow it in the HUD's permission check.",
      };
    }
    if (this.grants.isStopped(request.threadId)) {
      return {
        ok: false,
        error:
          "Stopped: the user stopped desktop control. Wait until they resume it.",
      };
    }
    if (tool === "request_control") {
      const raw = (request.args ?? {}) as Record<string, unknown>;
      const reason =
        typeof raw.reason === "string" && raw.reason.trim().length > 0
          ? raw.reason.trim().slice(0, 300)
          : "This step needs your cursor and keyboard.";
      const refusal = await this.askForeground(
        request,
        reason,
        typeof raw.app === "string" ? raw.app.slice(0, 80) : null,
      );
      return refusal === null
        ? {
            ok: true,
            text: `Granted (${this.state.grant.kind === "session" ? "for this session" : "for one action"}). Moving the mouse takes it back.`,
          }
        : { ok: false, error: refusal };
    }
    const driver = await this.startDriver();
    if (driver === null)
      return {
        ok: false,
        error: `The desktop driver is not running: ${this.state.driver.error ?? "unknown error"}`,
      };
    const driverTool = driverToolFor(tool);
    if (driverTool === null)
      return { ok: false, error: `unknown desktop tool ${tool}` };
    const args = sanitizeArgs(tool, request.args);
    if (tool === "windows") {
      const result = await driver.call(driverTool, {
        ...args,
        on_screen_only: true,
      });
      return result.isError
        ? { ok: false, error: result.text }
        : { ok: true, text: result.text };
    }
    if (tool === "look") {
      if (typeof args.pid !== "number" || typeof args.window_id !== "number")
        return {
          ok: false,
          error: "look needs pid and window_id (see desktop_windows).",
        };
      this.setActivity(request, {
        caption: request.caption ?? "looking",
        app: null,
        point: null,
        foreground: false,
        window: null,
      });
      const result = await driver.call(driverTool, {
        ...args,
        tree_format: "both",
        max_image_dimension: 1280,
      });
      const snapshot = readSnapshot(result.structured, {
        pid: args.pid,
        windowId: args.window_id,
      });
      if (snapshot !== null) this.snapshots.remember(snapshot);
      this.scheduleIdle();
      return result.isError
        ? { ok: false, error: result.text }
        : { ok: true, text: result.text, images: result.images.slice(0, 1) };
    }
    if (!DESKTOP_ACTION_TOOLS.has(tool))
      return { ok: false, error: `unknown desktop tool ${tool}` };
    const token = this.snapshots.forToken(args.element_token);
    const window =
      this.snapshots.forWindow(args.pid, args.window_id) ??
      token?.snapshot ??
      null;
    const targetPid =
      typeof args.pid === "number" ? args.pid : (token?.snapshot.pid ?? null);
    const point = screenPoint(args, token, window);
    const usesToken = typeof args.element_token === "string";
    const pointElement =
      !usesToken && point !== null && typeof args.x === "number"
        ? (((await this.inspect(point.x, point.y))?.element ?? null) as {
            secure?: unknown;
          } | null)
        : null;
    let focused: Record<string, unknown> | null = null;
    if (isKeyboardTool(tool) && !usesToken) {
      try {
        focused = (await this.ensureHelper()?.request("focused")) ?? null;
      } catch {
        focused = null;
      }
    }
    const refusal = secureRefusal({
      tool,
      element: token?.element ?? null,
      pointElement,
      focused,
      targetPid,
      usesElementToken: usesToken,
    });
    if (refusal !== null) return { ok: false, error: refusal };
    const foreground = needsForeground(args);
    const appName = window?.app ?? null;
    if (foreground && !this.grants.allowsForeground(request.threadId)) {
      const denied = await this.askForeground(
        request,
        request.caption ?? "This step needs your cursor and keyboard.",
        appName,
      );
      if (denied !== null) return { ok: false, error: denied };
    }
    const paused = await this.waitWhilePaused(request.threadId);
    if (paused !== null) return { ok: false, error: paused };
    this.setActivity(request, {
      caption:
        request.caption ?? defaultCaption(tool, args, token?.element ?? null),
      app: appName,
      point,
      foreground,
      window: window?.bounds ?? null,
    });
    if (foreground) this.suppressedUntil = Number.MAX_SAFE_INTEGER;
    try {
      const result = await driver.call(driverTool, args);
      if (this.state.activity !== null && tool === "click") {
        this.state.activity = {
          ...this.state.activity,
          clickAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.changed();
      }
      return result.isError
        ? { ok: false, error: result.text }
        : { ok: true, text: result.text };
    } finally {
      if (foreground) {
        this.suppressedUntil = Date.now() + 400;
        this.grants.usedForeground(request.threadId);
      }
      this.scheduleIdle();
    }
  }

  private setActivity(
    request: AgentRequest,
    details: {
      caption: string;
      app: string | null;
      point: { x: number; y: number } | null;
      foreground: boolean;
      window: DesktopRect | null;
    },
  ): void {
    const previous =
      this.state.activity?.threadId === request.threadId
        ? this.state.activity
        : null;
    this.activityWindow = {
      threadId: request.threadId,
      bounds: details.window,
    };
    this.state.activity = {
      threadId: request.threadId,
      agent: request.agent,
      caption: details.caption,
      app: details.app ?? previous?.app ?? null,
      phase: previous?.phase === "paused" ? "paused" : "acting",
      x: details.point?.x ?? previous?.x ?? null,
      y: details.point?.y ?? previous?.y ?? null,
      clickAt: null,
      foreground: details.foreground,
      updatedAt: Date.now(),
    };
    for (const overlay of this.overlays.values())
      if (!overlay.isDestroyed() && !overlay.isVisible())
        overlay.showInactive();
    this.changed();
  }

  dispose(): void {
    this.driver?.stop();
    this.helper?.stop();
    this.stopWatch();
  }
}

let control: DesktopControl | null = null;
let agentSocket: { close(): void } | null = null;

export function registerForkDesktopControlIpc(ipcMain: IpcMain): void {
  try {
    registerDesktopControl(ipcMain);
  } catch (error) {
    process.stderr.write(`[desktop-control] not available: ${String(error)}\n`);
  }
}

export const DESKTOP_HUD_ENV = "BB_STUDIO_DESKTOP_HUD";

export function desktopHudEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[DESKTOP_HUD_ENV] === "1";
}

function registerDesktopControl(ipcMain: IpcMain): void {
  if (process.platform !== "darwin" || !desktopHudEnabled(process.env)) {
    ipcMain.handle(FORK_DESKTOP_CONTROL_CHANNEL, () => unsupportedState());
    return;
  }
  const instance = new DesktopControl();
  app.on("will-quit", () => {
    control?.dispose();
    agentSocket?.close();
  });
  app.on("browser-window-focus", () => {
    if (control?.state.supported) void control.refreshPermissions();
  });
  control = instance;
  ipcMain.handle(FORK_DESKTOP_CONTROL_CHANNEL, (event, request: unknown) =>
    instance.handle(event, request),
  );
  if (instance.state.supported) {
    agentSocket = startAgentSocket(process.env, (request) =>
      instance.agent(request),
    );
  }
}
