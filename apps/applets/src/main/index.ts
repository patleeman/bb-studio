// Studio Applets shell (experimental). A menu-bar app that runs applets from
// ~/.bb-studio/applets: each applet's pages get only `window.studio`, and
// only for capabilities approved in the applets plugin's settings.
import { app, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError, dispatch, setEmitter } from "./api";
import { appletsRpc } from "./bb";
import { root } from "./paths";
import { handleSchemes, registerSchemes } from "./protocol";
import { loadApplets, watchApplets, type Applet, type Broken } from "./registry";
import { Runtime } from "./runtime";
import { startSocket } from "./socket";

const THREAD_POLL_MS = 3000;

registerSchemes();
if (!app.requestSingleInstanceLock()) app.quit();

let applets: Applet[] = [];
let broken: Broken[] = [];
let shellTray: Tray | null = null;
let bbConnected: boolean | null = null;
let lastThreads = "";
/** Applets stopped from the menu stay stopped until started again. */
const stoppedByUser = new Set<string>();

const runtime = new Runtime(join(__dirname, "preload.js"), emit);
setEmitter(emit);

function emit(id: string, event: string, payload?: unknown): void {
  const run = runtime.running.get(id);
  if (!run) return;
  for (const window of [...run.windows.values(), ...(run.background ? [run.background] : [])])
    if (!window.isDestroyed()) window.webContents.send("studio:event", event, payload ?? null);
}

function emitAll(event: string, payload: unknown, capability: string): void {
  for (const [id, run] of runtime.running) if (run.applet.granted.has(capability)) emit(id, event, payload);
}

function ready(applet: Applet): boolean {
  return applet.pending.length === 0;
}

/** Start, restart or stop applets so the running set matches what's on disk. */
async function reconcile(changed: Set<string> | "all"): Promise<void> {
  ({ applets, broken } = await loadApplets());
  const byId = new Map(applets.map((applet) => [applet.id, applet]));
  for (const [id, run] of runtime.running) {
    const next = byId.get(id);
    const grantsChanged = next && [...next.granted].sort().join() !== [...run.applet.granted].sort().join();
    if (!next || !ready(next) || changed === "all" || changed.has(id) || changed.has("*") && grantsChanged) runtime.stop(id);
  }
  for (const applet of applets) if (ready(applet) && !stoppedByUser.has(applet.id) && !runtime.running.has(applet.id)) runtime.start(applet);
  for (const item of broken) runtime.log(item.id, "error", `not loaded: ${item.errors.join("; ")}`);
  updateMenu();
}

function updateMenu(): void {
  if (!shellTray) return;
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: `Studio Applets — ${bbConnected ? "connected to BB" : bbConnected === false ? "BB not connected" : "checking BB…"}`, enabled: false },
    { type: "separator" },
  ];
  if (!applets.length && !broken.length) items.push({ label: "No applets yet", enabled: false });
  for (const applet of applets) {
    const running = runtime.running.get(applet.id);
    const first = Object.keys(applet.manifest.windows)[0];
    items.push({
      label: ready(applet) ? applet.manifest.name : `${applet.manifest.name} — waiting for approval in BB`,
      type: "checkbox",
      checked: Boolean(running),
      enabled: ready(applet),
      click: () => {
        if (running) {
          stoppedByUser.add(applet.id);
          runtime.stop(applet.id);
        } else {
          stoppedByUser.delete(applet.id);
          runtime.start(applet);
        }
        if (!running && first) runtime.openWindow(applet.id, first);
        updateMenu();
      },
    });
  }
  for (const item of broken) items.push({ label: `${item.id} — has problems (see its log)`, enabled: false });
  items.push(
    { type: "separator" },
    { label: "Reload All Applets", click: () => void reconcile("all") },
    { label: "Open Applets Folder", click: () => void shell.openPath(root) },
    { type: "separator" },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { label: "Quit Studio Applets", role: "quit" },
  );
  shellTray.setContextMenu(Menu.buildFromTemplate(items));
}

async function pollThreads(): Promise<void> {
  const wanted = [...runtime.running.values()].some((run) => run.applet.granted.has("bb.threads.read"));
  try {
    const threads = wanted ? await appletsRpc("threads.list", null) : await appletsRpc("applets.list", null).then(() => null);
    if (bbConnected !== true) {
      bbConnected = true;
      emitAll("bb:connected", null, "bb.threads.read");
      updateMenu();
    }
    if (threads) {
      const text = JSON.stringify(threads);
      if (text !== lastThreads) {
        lastThreads = text;
        emitAll("bb:threads", threads, "bb.threads.read");
      }
    }
  } catch {
    if (bbConnected !== false) {
      bbConnected = false;
      lastThreads = "";
      emitAll("bb:disconnected", null, "bb.threads.read");
      updateMenu();
    }
  }
}

ipcMain.handle("studio:call", async (event, method: unknown, args: unknown) => {
  const owner = runtime.ownerOf(event.sender);
  const run = owner ? runtime.running.get(owner.id) : undefined;
  if (!owner || !run) return { ok: false, error: { code: "unknown_applet", message: "This page isn't a running applet" } };
  try {
    const result = await dispatch(String(method), Array.isArray(args) ? args : [], { ...owner, granted: run.applet.granted, runtime });
    // A thread list asked for directly also counts as the latest snapshot.
    if (method === "bb.threads.list" && args && Array.isArray(args) && !args[0]) lastThreads = JSON.stringify(result);
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: { code: error.code, message: error.message, ...error.detail } };
    const code = (error as { code?: unknown })?.code;
    return { ok: false, error: { code: typeof code === "string" ? code : "failed", message: error instanceof Error ? error.message : String(error) } };
  }
});

app.on("second-instance", () => shellTray?.popUpContextMenu());
app.on("window-all-closed", () => {
  // A menu-bar app: closing every applet window doesn't quit it.
});
app.on("will-quit", () => runtime.stopAll());

void app.whenReady().then(async () => {
  app.dock?.hide();
  await mkdir(root, { recursive: true });
  handleSchemes(join(__dirname, "kit"));

  const icon = nativeImage.createFromPath(join(__dirname, "trayTemplate.png"));
  shellTray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  if (icon.isEmpty()) shellTray.setTitle("▦");
  shellTray.setToolTip("Studio Applets");

  await startSocket({
    ping: () => ({ version: app.getVersion(), api: 1 }),
    list: () => ({
      applets: applets.map((applet) => ({ id: applet.id, running: runtime.running.has(applet.id), pending: applet.pending })),
      broken,
    }),
    open: ({ id, window }) => {
      const applet = applets.find((item) => item.id === id);
      if (!applet) throw new Error(`No applet "${String(id)}"`);
      if (!ready(applet)) throw new Error(`Applet "${applet.id}" is waiting for approval: ${applet.pending.join(", ")}`);
      stoppedByUser.delete(applet.id);
      runtime.start(applet);
      const name = typeof window === "string" ? window : Object.keys(applet.manifest.windows)[0];
      if (name) runtime.openWindow(applet.id, name);
      updateMenu();
      return null;
    },
    close: ({ id }) => {
      stoppedByUser.add(String(id));
      runtime.stop(String(id));
      updateMenu();
      return null;
    },
    reload: async ({ id }) => (await reconcile(typeof id === "string" ? new Set([id]) : "all"), null),
  }).catch((error) => console.error("socket:", error));

  await reconcile("all");
  watchApplets((ids) => void reconcile(ids));
  void pollThreads();
  setInterval(() => void pollThreads(), THREAD_POLL_MS);
  if (process.env.STUDIO_APPLETS_CAPTURE) void capture(process.env.STUDIO_APPLETS_CAPTURE);
});

/** For screenshots and smoke tests: save the first applet window as a PNG, then quit. */
async function capture(path: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.STUDIO_APPLETS_CAPTURE_DELAY_MS) || 6000));
  const window = [...runtime.running.values()].flatMap((run) => [...run.windows.values()])[0];
  let ok = false;
  try {
    if (window && !window.isDestroyed()) {
      await writeFile(path, (await window.webContents.capturePage()).toPNG());
      ok = true;
    } else console.error("capture: no applet window is open");
  } catch (error) {
    console.error("capture:", error);
  }
  app.exit(ok ? 0 : 1);
}
