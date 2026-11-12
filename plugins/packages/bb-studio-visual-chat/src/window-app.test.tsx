// @vitest-environment jsdom
// On a BB with plugin windows, Visual Chat is its rail page and also an app window.
import { act, type ComponentType } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  log: [] as string[],
  settings: { windowHotkey: "" } as Record<string, unknown> | undefined,
  windows: null as unknown,
}));
vi.mock("@get-bb/plugin-sdk/app", () => {
  const call = (op: string) => async (id: string, options?: { hotkey?: string; params?: Record<string, string> }) => {
    state.log.push([op, id, options?.hotkey ?? "", new URLSearchParams(options?.params).toString()].filter(Boolean).join(" "));
    return true;
  };
  const windows = { native: true, register: call("register"), open: call("open"), toggle: call("toggle"), close: call("close") };
  return {
    definePluginApp: (setup: unknown) => ({ setup }),
    useSdk: () => ({}),
    useSettings: () => ({ values: state.settings }),
    experimental_useWindows: () => windows,
  };
});

// This package has no types for react-dom; the test needs only a root.
interface Root { render(node: unknown): void; unmount(): void }
const reactDom = "react-dom/client";
const { createRoot } = (await import(/* @vite-ignore */ reactDom)) as { createRoot(host: Element): Root };
const { default: plugin } = await import("../app");
const { hasHostWindows } = await import("./host-windows");
const { canvasWindowOptions, windowHotkey, WINDOW_ID, WINDOW_OPEN_CHANNEL } = await import("./window-app");

interface Registered {
  panels: { id: string; title: string; icon: string; path: string; headerContent?: ComponentType<{ subPath: string }>; experimental_hideFromNavigation?: boolean }[];
  windows: { id: string; title: string }[];
  overlays: Map<string, ComponentType>;
  launcherItems: { id: string; title: string; icon: string; section: string; keywords?: readonly string[]; run(): void }[];
  commands: { id: string; title: string; run(context: unknown): void }[];
}

function windowsApp({ launcher = true }: { launcher?: boolean } = {}): Registered {
  const registered: Registered = { panels: [], windows: [], overlays: new Map(), launcherItems: [], commands: [] };
  (plugin as unknown as { setup(app: unknown): void }).setup({
    slots: {
      navPanel: (panel: Registered["panels"][number]) => { registered.panels.push(panel); },
      experimental_window: (window: { id: string; title: string }) => { registered.windows.push(window); },
      experimental_appOverlay: (overlay: { id: string; component: ComponentType }) => { registered.overlays.set(overlay.id, overlay.component); },
      ...(launcher ? { experimental_launcherItem: (item: Registered["launcherItems"][number]) => { registered.launcherItems.push(item); } } : {}),
    },
    commands: { register: (command: Registered["commands"][number]) => { registered.commands.push(command); } },
  });
  return registered;
}

let root: Root;
let host: HTMLDivElement;
async function mountBridge(registered: Registered, path: string) {
  window.history.replaceState({}, "", path);
  const Bridge = registered.overlays.get("window-bridge")!;
  await act(async () => { root.render(<Bridge />); });
}
const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
  state.log.length = 0;
  state.settings = { windowHotkey: "" };
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("registers its page off the rail, a window and a command", () => {
  expect(hasHostWindows).toBe(true);
  const registered = windowsApp();
  expect(registered.panels.map(({ id, title, icon, path, experimental_hideFromNavigation }) => ({ id, title, icon, path, experimental_hideFromNavigation }))).toEqual([{ id: "canvas", title: "Visual Chat", icon: "studio-visual-chat/visual-chat", path: "canvas", experimental_hideFromNavigation: true }]);
  expect(registered.windows.map(({ id, title }) => ({ id, title }))).toEqual([{ id: "canvas", title: "Visual Chat" }]);
  expect(registered.commands.map((command) => command.id)).toEqual(["window", "ask"]);
  expect([...registered.overlays.keys()]).toEqual(["window-bridge", "quick-card"]);
});

it("the page's Open in window shows the chat on screen in the window: the last one at the page's root", async () => {
  const registered = windowsApp();
  await mountBridge(registered, "/plugins/studio-visual-chat/canvas");
  const Header = registered.panels[0]!.headerContent!;
  const header = document.createElement("div");
  const headerRoot = createRoot(header);
  const press = async (subPath: string) => {
    await act(async () => { headerRoot.render(<Header subPath={subPath} />); });
    state.log.length = 0;
    await act(async () => { header.querySelector<HTMLButtonElement>("button")!.click(); });
    await settle();
    return [...state.log];
  };
  expect(await press("")).toEqual([`open ${WINDOW_ID}`]);
  expect(header.querySelector("button")!.textContent).toBe("Open in window");
  expect(await press("thr_9")).toEqual([`close ${WINDOW_ID}`, `open ${WINDOW_ID} chat=thr_9`, `register ${WINDOW_ID}`]);
  expect(await press("new")).toEqual([`close ${WINDOW_ID}`, `open ${WINDOW_ID} chat=new`, `register ${WINDOW_ID}`]);
  act(() => headerRoot.unmount());
});

it("keeps its launchers on a BB with windows but no launcher slot", () => {
  const registered = windowsApp({ launcher: false });
  expect(registered.launcherItems).toEqual([]);
  expect(registered.commands.map((command) => command.id)).toEqual(["window", "ask"]);
});

it("opens with no title bar of its own, where it was, and with a shortcut only when one is assigned", () => {
  const options = canvasWindowOptions("") as Record<string, unknown>;
  expect(options).toEqual({ title: "Visual Chat", width: 1280, height: 860, minWidth: 560, minHeight: 420, titleBar: "hiddenInset", rememberBounds: true });
  expect(options.transparent).toBeUndefined();
  expect(options.alwaysOnTop).toBeUndefined();
  expect("hotkey" in canvasWindowOptions("  ")).toBe(false);
  expect(canvasWindowOptions(" Control+Alt+V ").hotkey).toBe("Control+Alt+V");
});

it("has no shortcut by default, and reads a stored old default as none", () => {
  expect(windowHotkey(undefined)).toBeUndefined();
  expect(windowHotkey({})).toBe("");
  expect(windowHotkey({ windowHotkey: "" })).toBe("");
  expect(windowHotkey({ windowHotkey: 7 })).toBe("");
  // The old default was stored for users who never chose it.
  expect(windowHotkey({ windowHotkey: "Alt+Shift+V" })).toBe("");
  expect(windowHotkey({ windowHotkey: " alt + shift + v " })).toBe("");
  // A key the user assigned stays, the old one written another way included.
  expect(windowHotkey({ windowHotkey: " Control+Alt+V " })).toBe("Control+Alt+V");
  expect(windowHotkey({ windowHotkey: "Shift+Alt+V" })).toBe("Shift+Alt+V");
});

it("registers no system-wide shortcut by default or for a stored old default, and the launchers open the window", async () => {
  const registered = windowsApp();
  await mountBridge(registered, "/threads/thr_1");
  expect(state.log).toEqual([`register ${WINDOW_ID}`]);
  state.settings = { windowHotkey: "Alt+Shift+V" };
  await mountBridge(registered, "/threads/thr_1");
  expect(state.log).toEqual([`register ${WINDOW_ID}`]);
  registered.commands.find((command) => command.id === "window")!.run({});
  await settle();
  expect(state.log.slice(1)).toEqual([`open ${WINDOW_ID}`]);
});

it("follows the shortcut setting when the user assigns one", async () => {
  const registered = windowsApp();
  state.settings = { windowHotkey: "Control+Alt+V" };
  await mountBridge(registered, "/");
  state.settings = { windowHotkey: "" };
  await mountBridge(registered, "/");
  expect(state.log).toEqual([`register ${WINDOW_ID} Control+Alt+V`, `register ${WINDOW_ID}`]);
});

it("offers Visual Chat to the launcher as an app that opens the window", async () => {
  const registered = windowsApp();
  expect(registered.launcherItems.map(({ run: _run, ...item }) => item)).toEqual([
    { id: "visual-chat", title: "Visual Chat", icon: "studio-visual-chat/visual-chat", section: "apps", keywords: ["visual", "chat", "canvas", "board", "whiteboard", "charts", "ask"], order: 10 },
  ]);
  await mountBridge(registered, "/threads/thr_1");
  state.log.length = 0;
  registered.launcherItems[0]!.run();
  await settle();
  expect(state.log).toEqual([`open ${WINDOW_ID}`]);
});

it("opens the window from the launcher's own window, by asking BB's main window", async () => {
  // Two documents: each loads the plugin, only BB's main window mounts the bridge.
  const main = windowsApp();
  await mountBridge(main, "/threads/thr_1");
  state.log.length = 0;
  const posted: string[] = [];
  const Real = globalThis.BroadcastChannel;
  vi.stubGlobal("BroadcastChannel", class extends Real { postMessage(message: unknown) { posted.push(this.name); super.postMessage(message); } });
  const { registerWindowApp } = await import("./window-app");
  vi.resetModules();
  const elsewhere = await import("./window-app");
  expect(elsewhere.registerWindowApp).not.toBe(registerWindowApp);
  const items: { run(): void }[] = [];
  elsewhere.registerWindowApp({ slots: { experimental_window() {}, experimental_appOverlay() {}, experimental_launcherItem: (item: { run(): void }) => { items.push(item); } }, commands: { register() {} } } as never);
  items[0]!.run();
  expect(posted).toEqual([WINDOW_OPEN_CHANNEL]);
  await act(async () => { await new Promise((done) => setTimeout(done, 30)); });
  expect(state.log).toEqual([`open ${WINDOW_ID}`]);
});

it("registers no launcher item on a BB without the slot", () => {
  const registered = windowsApp({ launcher: false });
  expect(registered.launcherItems).toEqual([]);
});

it("does not register itself from inside the window", async () => {
  const registered = windowsApp();
  await mountBridge(registered, `/fork-window/studio-visual-chat/${WINDOW_ID}`);
  expect(state.log).toEqual([]);
});

it("shows a chat from the quick card by reopening the window on it, then puts the shortcut back to the last chat", async () => {
  const { registerWindowApp } = await import("./window-app");
  const overlays = new Map<string, ComponentType>();
  const windowApp = registerWindowApp({
    slots: { experimental_window() {}, experimental_appOverlay: (overlay: { id: string; component: ComponentType }) => { overlays.set(overlay.id, overlay.component); } },
    commands: { register() {} },
  } as never)!;
  await mountBridge({ overlays } as Registered, "/");
  state.log.length = 0;
  windowApp.openChat("thr_9");
  await settle();
  windowApp.openChat(null);
  await settle();
  expect(state.log).toEqual([
    `close ${WINDOW_ID}`, `open ${WINDOW_ID} chat=thr_9`, `register ${WINDOW_ID}`,
    `close ${WINDOW_ID}`, `open ${WINDOW_ID} chat=new`, `register ${WINDOW_ID}`,
  ]);
});
