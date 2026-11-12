// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => null),
  client: null as unknown,
  realtime: new Map<string, (payload: unknown) => void>(),
  windows: { native: true, register: vi.fn(async (_id: string, _options?: { hotkey?: string }) => true), open: vi.fn(async () => true), toggle: vi.fn(async () => true), close: vi.fn(async (_id: string) => true), setClickThrough: vi.fn(async (_id: string, _on: boolean) => true) } as { native: boolean; register: ReturnType<typeof vi.fn<(id: string, options?: { hotkey?: string }) => Promise<boolean>>>; open: ReturnType<typeof vi.fn<() => Promise<boolean>>>; toggle: ReturnType<typeof vi.fn<() => Promise<boolean>>>; close: ReturnType<typeof vi.fn<(id: string) => Promise<boolean>>>; hotkeyRegistered?: (id: string) => Promise<boolean>; setClickThrough?: ReturnType<typeof vi.fn<(id: string, on: boolean) => Promise<boolean>>> },
  settings: { hudEnabled: true, hudHotkey: "", launcherHotkey: "Alt+Space" } as { hudEnabled: boolean; hudHotkey: string; launcherHotkey: string } | null,
  setClickThrough: null as unknown,
  openAppPath: vi.fn(),
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => (state.client ??= { call: (method: string, input: unknown) => state.rpc(method, input) }),
  useRealtime: (channel: string, handler: (payload: unknown) => void) => { state.realtime.set(channel, handler); },
  useBbNavigate: () => ({ openUrl: () => false }),
  experimental_Icon: () => null,
  // BB's chat, which the HUD only places: the thread and the variant are what matter here.
  ThreadChat: ({ threadId, variant }: { threadId: string; variant?: string }) => <div data-chat={threadId} data-variant={variant} />,
}));
vi.mock("../../kit/app/windows", async (original) => ({
  ...(await original<typeof import("../../kit/app/windows")>()),
  hasHostWindows: true,
  useHostWindows: () => state.windows,
}));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: state.settings }) }));
vi.mock("../../ui/studio-open", () => ({ openFrom: (_container: unknown, ref: { href: string }, options: { target?: string }) => state.openAppPath(ref.href, options.target) }));
vi.mock("../../kit/app/index", () => ({ ICON_BUTTON: "icon-button", OUTLINE_BUTTON: "outline-button" }));
vi.mock("../../theme/ui/ThemeLayer", () => ({ HudTheme: () => null }));
vi.mock("../../presence/ui/HudPresence", () => ({ HudPresence: () => null }));

import { CLICK_THROUGH_EVENT } from "../../kit/app/windows";
import { onMainWindowPath } from "../../launcher/main-actions";
import { LAUNCHER_WINDOW_ID } from "../../launcher/shared";
import { noteWindowHotkey } from "../hotkey";
import { HUD_WINDOW_ID, LEGACY_HUD_DISPLAY_WINDOW_ID, MAIN_WINDOW_CHANNEL } from "../shared";
import { HudWindow, hudThreadParam } from "./Hud";
import { applyHudSettings, HudBridge } from "./HudBridge";
import { ShowHudButton } from "./ShowHudButton";

let root: Root;
let host: HTMLDivElement;
const bot = { id: "bot_1", name: "Dot", threadId: "thr_bot" };
let answer: unknown;
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const calls = (method: string) => state.rpc.mock.calls.filter(([name]) => name === method).map(([, input]) => input);

async function mount(node: React.ReactNode, path = `/fork-window/studio/${HUD_WINDOW_ID}`) {
  window.history.replaceState({}, "", path);
  await act(async () => { root.render(node); });
  await act(async () => {});
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  answer = { bot, working: false };
  state.rpc.mockReset().mockImplementation(async (method: string) => (method === "hud.get" ? answer : method === "hud.send" ? { threadId: "thr_bot" } : { ok: true }));
  state.settings = { hudEnabled: true, hudHotkey: "", launcherHotkey: "Alt+Space" };
  state.windows.native = true;
  state.windows.setClickThrough = vi.fn(async (_id: string, _on: boolean) => true);
  state.openAppPath.mockReset();
  for (const each of [state.windows.register, state.windows.open, state.windows.close]) each.mockClear();
  delete state.windows.hotkeyRegistered;
  localStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

/** BB telling the page its click-through changed. */
const hostSays = (on: boolean) => act(async () => { window.dispatchEvent(new CustomEvent(CLICK_THROUGH_EVENT, { detail: { on } })); });
const move = (altKey: boolean) => act(async () => { window.dispatchEvent(new MouseEvent("mousemove", { altKey, bubbles: true })); });
const key = (type: "keydown" | "keyup", name: string) => act(async () => { window.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true })); });
const banner = () => $('[data-testid="hud-click-through-banner"]');
const eye = () => $('[data-testid="hud-click-through"]');
const asked = () => state.windows.setClickThrough!.mock.calls.map(([id, on]) => [id, on]);

it("is BB's own chat for the primary Bot's thread, compact, on a see-through page: a tint thickening toward the bar, no title bar", async () => {
  await mount(<HudWindow />);
  const chat = $("[data-chat]");
  expect(chat?.dataset.chat).toBe("thr_bot");
  expect(chat?.dataset.variant).toBe("compact");
  expect($("input")).toBeNull();
  expect($("header")).toBeNull();
  const hud = $("[data-studio-hud]")!;
  expect(hud.dataset.hudThread).toBe("thr_bot");
  // No panel of its own: the page shows through, under a gradient tint.
  expect(hud.className).not.toContain("bg-background");
  expect(hud.className).not.toContain("border");
  expect($("[data-hud-backdrop]")?.className).toContain("pointer-events-none");
  const css = hud.querySelector("style")!.textContent!;
  expect(css).toMatch(/\[data-hud-backdrop\] \{\s*background: linear-gradient\(to bottom,\s*transparent 0%/);
  // BB's surfaces behind the transcript are see-through; the transcript fades out at the top.
  expect(css).toContain("[data-studio-hud] [data-page-scroll-viewport],");
  expect(css).toMatch(/\[data-page-scroll-viewport\] \{\s*-webkit-mask-image: linear-gradient\(to bottom, transparent 0%/);
  expect(css).toContain("text-shadow");
  expect(css).toContain("html, body, #root { background: transparent !important; }");
  // BB's composer is one row, with no chip row under it, and drags the window from its empty parts.
  expect(css).toMatch(/\[data-promptbox-main\] \{\s*display: flex;/);
  expect(css).toContain("[data-follow-up-composer-footer] { display: none !important; }");
  expect(css).toContain("-webkit-app-region: drag;");
  // At the bar's end: the eye and Pop back in; no close button and no Open in BB.
  expect([...$('[data-testid="hud-bar-tools"]')!.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual(["Click-through", "Pop back in"]);
  expect($('[data-testid="hud-close"]')).toBeNull();
});

it("shows the conversation it was popped out on, from its params, not the Bot's chat", async () => {
  await mount(<HudWindow />, `/fork-window/studio/${HUD_WINDOW_ID}?threadId=thr_conv&bbTransparent=1`);
  expect($("[data-chat]")?.dataset.chat).toBe("thr_conv");
  expect(hudThreadParam("?bbTransparent=1")).toBeNull();
  expect(hudThreadParam("?threadId=%20")).toBeNull();
});

it("says so in one line in the bar when there is no Bot, with no chat; its button closes the HUD", async () => {
  answer = { bot: null, working: false };
  await mount(<HudWindow />);
  expect($('[data-testid="hud-empty"]')?.textContent).toBe("No Bot yet. Make one in BB, on the Bot page.");
  expect($("[data-chat]")).toBeNull();
  expect($('[data-testid="hud-pop-in"]')).toBeNull();
  expect($("[data-studio-hud]")?.dataset.hudThread).toBeUndefined();
  await act(async () => { $('[data-testid="hud-close"]')!.click(); });
  expect(state.windows.close).toHaveBeenCalledWith(HUD_WINDOW_ID);
});

it("Pop back in shows the conversation in BB's main window, then closes the HUD", async () => {
  await mount(<HudWindow />, `/fork-window/studio/${HUD_WINDOW_ID}?threadId=thr_conv`);
  await act(async () => { $('[data-testid="hud-pop-in"]')!.click(); });
  expect(calls("window.openInMain")).toEqual([{ path: "/threads/thr_conv" }]);
  expect(state.windows.close).toHaveBeenCalledWith(HUD_WINDOW_ID);
  // When the main window can't be asked, the HUD stays.
  state.windows.close.mockClear();
  state.rpc.mockImplementation(async (method: string) => { if (method === "window.openInMain") throw new Error("offline"); return method === "hud.get" ? answer : null; });
  await act(async () => { $('[data-testid="hud-pop-in"]')!.click(); });
  expect(state.windows.close).not.toHaveBeenCalled();
});

it("opens with click-through off, and the eye turns it on with a clear strip naming the ways back", async () => {
  await mount(<HudWindow />);
  expect(eye()?.getAttribute("aria-pressed")).toBe("false");
  expect(banner()).toBeNull();
  expect(asked()).toEqual([]);
  await act(async () => { eye()!.click(); });
  expect(asked()).toEqual([[HUD_WINDOW_ID, true]]);
  // BB's event is what turns the state on.
  expect(banner()).toBeNull();
  await hostSays(true);
  expect(eye()?.getAttribute("aria-pressed")).toBe("true");
  // No HUD hotkey by default: the menu bar entry is the way named.
  expect(banner()?.textContent).toBe("Click-through on · hold ⌥ to use · “bb” in the menu bar turns it off");
  expect($("[data-studio-hud]")?.dataset.hudClickThrough).toBe("on");
});

it("names the HUD's hotkey as a way back when the user set one", async () => {
  state.settings = { hudEnabled: true, hudHotkey: "Control+Shift+H", launcherHotkey: "Alt+Space" };
  await mount(<HudWindow />);
  await hostSays(true);
  expect(banner()?.textContent).toBe("Click-through on · hold ⌥ to use · ⌃⇧H or “bb” in the menu bar turns it off");
  // Taken by another app: only the menu bar entry is named.
  await act(async () => { noteWindowHotkey("hud", { wanted: "Control+Shift+H", inUse: "", status: "taken" }); });
  expect(banner()?.textContent).toBe("Click-through on · hold ⌥ to use · “bb” in the menu bar turns it off");
});

it("goes off when BB's hotkey or menu bar entry turns it off", async () => {
  await mount(<HudWindow />);
  await hostSays(true);
  await hostSays(false);
  expect(banner()).toBeNull();
  expect(eye()?.getAttribute("aria-pressed")).toBe("false");
});

it("Esc turns click-through off for good, and is left alone when it is off", async () => {
  await mount(<HudWindow />);
  const untouched = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  await act(async () => { window.dispatchEvent(untouched); });
  expect(untouched.defaultPrevented).toBe(false);
  expect(asked()).toEqual([]);
  await hostSays(true);
  await key("keydown", "Escape");
  expect(asked()).toEqual([[HUD_WINDOW_ID, false]]);
  expect(banner()).toBeNull();
  await hostSays(false);
  expect(banner()).toBeNull();
});

it("holding Option over it makes it clickable until Option is let go, still marked as click-through", async () => {
  await mount(<HudWindow />);
  await hostSays(true);
  await move(false);
  expect(asked()).toEqual([]);
  await move(true);
  expect(asked()).toEqual([[HUD_WINDOW_ID, false]]);
  // BB's answer to Studio's own request doesn't end it.
  await hostSays(false);
  expect(banner()?.textContent).toBe("Click-through on · usable while ⌥ is held · Esc or the eye turns it off");
  expect(eye()?.getAttribute("aria-pressed")).toBe("true");
  await key("keyup", "Alt");
  expect(asked()).toEqual([[HUD_WINDOW_ID, false], [HUD_WINDOW_ID, true]]);
  await hostSays(true);
  expect(banner()?.textContent).toContain("hold ⌥ to use");
});

it("goes back to click-through when the pointer leaves or moves without Option, and the eye ends it during a peek", async () => {
  await mount(<HudWindow />);
  await hostSays(true);
  await move(true);
  await act(async () => { document.documentElement.dispatchEvent(new MouseEvent("mouseleave")); });
  expect(asked().at(-1)).toEqual([HUD_WINDOW_ID, true]);
  await move(true);
  await move(false);
  expect(asked().at(-1)).toEqual([HUD_WINDOW_ID, true]);
  await move(true);
  await act(async () => { eye()!.click(); });
  expect(asked().at(-1)).toEqual([HUD_WINDOW_ID, false]);
  expect(banner()).toBeNull();
});

it("on a BB with the hold mode, Option only pauses click-through: it stays on for BB, so the menu bar entry turns it off and never hides the HUD", async () => {
  const calls: unknown[][] = [];
  state.windows.setClickThrough = vi.fn(async (id: string, on: boolean, how?: { hold?: boolean }) => { calls.push(how ? [id, on, how] : [id, on]); return true; }) as never;
  expect((state.windows.setClickThrough as unknown as { length: number }).length).toBe(3);
  await mount(<HudWindow />);
  await hostSays(true);
  await move(true);
  expect(calls).toEqual([[HUD_WINDOW_ID, false, { hold: true }]]);
  expect(banner()?.textContent).toBe("Click-through on · usable while ⌥ is held · Esc or the eye turns it off");
  await key("keyup", "Alt");
  expect(calls).toEqual([[HUD_WINDOW_ID, false, { hold: true }], [HUD_WINDOW_ID, true, { hold: true }]]);
  expect(banner()?.textContent).toContain("hold ⌥ to use");
  // The menu bar entry while Option is held: BB turns click-through off, and the HUD follows.
  await move(true);
  await hostSays(false);
  expect(banner()).toBeNull();
  expect(eye()?.getAttribute("aria-pressed")).toBe("false");
});

it("offers no click-through on a BB that can't switch it, or in a browser", async () => {
  delete state.windows.setClickThrough;
  await mount(<HudWindow />);
  expect(eye()).toBeNull();
  expect($("[data-chat]")).not.toBeNull();
  act(() => root.unmount());
  root = createRoot(host);
  state.windows.setClickThrough = vi.fn(async () => true);
  state.windows.native = false;
  await mount(<HudWindow />);
  expect(eye()).toBeNull();
  // A browser popup isn't see-through: the page keeps BB's background.
  expect($("[data-studio-hud]")?.className).toContain("bg-background");
  expect($("[data-studio-hud] style")?.textContent).not.toContain("html, body");
  await hostSays(true);
  expect(banner()).toBeNull();
});

it("from the main window, registers the launcher on its hotkey and the HUD with its menu bar entry and no hotkey; not from a plugin window", async () => {
  await mount(<HudBridge />, "/threads/thr_1");
  expect(state.windows.register.mock.calls.map(([id]) => id)).toEqual([LAUNCHER_WINDOW_ID, HUD_WINDOW_ID]);
  expect(state.windows.register).toHaveBeenCalledWith(LAUNCHER_WINDOW_ID, expect.objectContaining({ hotkey: "Alt+Space", center: true, hideOnBlur: true, alwaysOnTop: true, frame: false, resizable: false, width: 640, height: 420 }));
  expect(state.windows.register.mock.calls[0]![1]).not.toHaveProperty("menuBarTitle");
  const hud = state.windows.register.mock.calls[1]![1];
  expect(hud).toMatchObject({ menuBarTitle: "bb", transparent: true, alwaysOnTop: true, resizable: true, rememberBounds: true, minWidth: 320, minHeight: 240, width: 480, height: 600 });
  expect(hud).not.toHaveProperty("hotkey");
  expect(hud).not.toHaveProperty("params");
  // The display-only window older Studios left open is closed.
  expect(state.windows.close).toHaveBeenCalledWith(LEGACY_HUD_DISPLAY_WINDOW_ID);
  // What a window asks for opens in the main view, which comes forward.
  const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
  act(() => state.realtime.get(MAIN_WINDOW_CHANNEL)?.({ path: "/threads/thr_bot" }));
  act(() => state.realtime.get(MAIN_WINDOW_CHANNEL)?.({ path: "//evil.example" }));
  expect(state.openAppPath.mock.calls).toEqual([["/threads/thr_bot", "main"]]);
  // A path with an action of the main window's own runs it instead of opening.
  const action = vi.fn();
  onMainWindowPath("/plugins/studio/studio/test-action", action);
  await act(async () => { state.realtime.get(MAIN_WINDOW_CHANNEL)?.({ path: "/plugins/studio/studio/test-action" }); });
  expect(action).toHaveBeenCalledTimes(1);
  expect(state.openAppPath).toHaveBeenCalledTimes(1);
  expect(focus).toHaveBeenCalledTimes(2);
  focus.mockRestore();
  act(() => root.unmount());
  root = createRoot(host);
  state.windows.register.mockClear();
  await mount(<HudBridge />, `/fork-window/studio/${HUD_WINDOW_ID}`);
  expect(state.windows.register).not.toHaveBeenCalled();
});

it("with the HUD off, drops its hotkey and menu bar entry, closes it and hides Show HUD", async () => {
  void applyHudSettings(state.windows, { hudEnabled: false, hudHotkey: "Control+Shift+H" }, { availWidth: 1440, availHeight: 900 } as Screen);
  await act(async () => {});
  expect(state.windows.register).toHaveBeenCalledWith(HUD_WINDOW_ID, {});
  expect(state.windows.close).toHaveBeenCalledWith(HUD_WINDOW_ID);
  state.settings = { hudEnabled: false, hudHotkey: "", launcherHotkey: "Alt+Space" };
  await mount(<ShowHudButton />, "/plugins/studio/studio/bot");
  expect($('[data-testid="bot-show-hud"]')).toBeNull();
  state.settings = { hudEnabled: true, hudHotkey: "", launcherHotkey: "Alt+Space" };
  await mount(<ShowHudButton />, "/plugins/studio/studio/bot");
  await act(async () => { $('[data-testid="bot-show-hud"]')!.click(); });
  const [id, options] = state.windows.open.mock.calls.at(-1) as unknown as [string, object];
  expect(id).toBe(HUD_WINDOW_ID);
  expect(options).toMatchObject({ menuBarTitle: "bb", rememberBounds: true });
  expect(options).not.toHaveProperty("hotkey");
});

it("when another app holds Option+Space, the launcher takes the alternate; the HUD's own shortcut has no alternate", async () => {
  state.settings = { hudEnabled: true, hudHotkey: "Control+Shift+H", launcherHotkey: "Alt+Space" };
  // Other apps hold Alt+Space and Control+Shift+H: a window's hotkey takes unless it is one of them.
  state.windows.hotkeyRegistered = async (id) => { const last = state.windows.register.mock.calls.filter(([each]) => each === id).at(-1)?.[1]?.hotkey; return !!last && last !== "Alt+Space" && last !== "Control+Shift+H"; };
  await mount(<><HudBridge /><ShowHudButton /></>, "/plugins/studio/studio/bot");
  await act(async () => {});
  expect(state.windows.register.mock.calls.map(([id, options]) => [id, options?.hotkey])).toEqual([
    [LAUNCHER_WINDOW_ID, "Alt+Space"], [LAUNCHER_WINDOW_ID, "Control+Alt+Space"], [HUD_WINDOW_ID, "Control+Shift+H"], [HUD_WINDOW_ID, undefined],
  ]);
  expect(JSON.parse(localStorage.getItem("studio.launcher.hotkey")!)).toEqual({ wanted: "Alt+Space", inUse: "Control+Alt+Space", status: "alternate" });
  expect($('[data-testid="bot-hud-note"]')?.textContent).toBe("Control+Shift+H is taken by another app. Pick another shortcut.");
  // Show HUD opens with no shortcut, not the one that is taken; the settings are untouched.
  await act(async () => { $('[data-testid="bot-show-hud"]')!.click(); });
  expect((state.windows.open.mock.calls.at(-1) as unknown as [string, object])[1]).not.toHaveProperty("hotkey");
  expect(state.settings?.hudHotkey).toBe("Control+Shift+H");
});
