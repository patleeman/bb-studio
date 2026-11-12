// Windows of a plugin's own, on a BB that has them (the BB Studio fork):
// `slots.experimental_window` offers a component BB shows in a window with no
// BB chrome, `experimental_useWindows()` opens it,
// `slots.experimental_sidebarNewItem` adds a row to BB's New menu, and
// `slots.experimental_launcherItem` offers an app to a launcher. This
// plugin builds against stable BB's SDK, so each is read by name and is
// missing on stable BB, where Visual Chat is only its page in BB's rail.
// (Studio's copy of this is packages/bb-studio/src/kit/app/windows.ts.)
import type { ReactNode } from "react";
import * as sdkApp from "@get-bb/plugin-sdk/app";

export interface HostWindowOptions {
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  /** `"hiddenInset"`: no title bar; on macOS the traffic lights sit inside the content, top-left. */
  titleBar?: "hiddenInset";
  /** Reopen where, and at the size, it was last shown. */
  rememberBounds?: boolean;
  /** A system-wide shortcut in Electron's form, such as `Alt+Shift+V`, that shows or hides the window. */
  hotkey?: string;
  /** The window's query string. */
  params?: Record<string, string>;
}

export interface HostWindows {
  /** True in the desktop app. In a browser a window is a plain popup and has no hotkey. */
  native: boolean;
  /** Sets up the hotkey without showing the window. */
  register(windowId: string, options?: HostWindowOptions): Promise<boolean>;
  open(windowId: string, options?: HostWindowOptions): Promise<boolean>;
  toggle(windowId: string, options?: HostWindowOptions): Promise<boolean>;
  close(windowId: string): Promise<boolean>;
}

/** A member by name: undefined where this BB, or the SDK this was built with, lacks it. */
function member(source: object, name: string): unknown {
  return Object.entries(source).find(([key]) => key === name)?.[1];
}

const never = () => Promise.resolve(false);
const NO_HOST_WINDOWS: HostWindows = { native: false, register: never, open: never, toggle: never, close: never };
const hostHook = member(sdkApp, "experimental_useWindows");

/** Whether this BB can show a plugin's component in a window of its own. */
export const hasHostWindows = typeof hostHook === "function";

/** BB's windows; on a BB without them, every call answers false. */
export const useHostWindows: () => HostWindows = hasHostWindows ? (hostHook as () => HostWindows) : () => NO_HOST_WINDOWS;

function callSlot<Registration>(slots: object, name: string, registration: Registration): boolean {
  const slot = member(slots, name);
  if (typeof slot !== "function") return false;
  (slot as (registration: Registration) => void).call(slots, registration);
  return true;
}

/** Offers a component as a window; false on a BB without the slot. */
export function registerHostWindow(slots: object, registration: { id: string; title: string; component: () => ReactNode }): boolean {
  return callSlot(slots, "experimental_window", registration);
}

/** Adds a row to BB's sidebar New menu; false on a BB without the slot. */
export function registerNewItem(slots: object, registration: { id: string; title: string; icon: string; group?: string; run(): void | Promise<void> }): boolean {
  return callSlot(slots, "experimental_sidebarNewItem", registration);
}

/**
 * Offers an app to a launcher (a search-and-run window some plugin draws). `run` is called in the launcher's
 * own window, so it must work from any window. False on a BB without the slot.
 */
export function registerLauncherItem(slots: object, registration: { id: string; title: string; icon: string; section: "apps" | "actions"; keywords?: readonly string[]; order?: number; run(): void | Promise<void> }): boolean {
  return callSlot(slots, "experimental_launcherItem", registration);
}

/** Whether this page is a plugin window, not BB's main window. */
export function inHostWindow(pathname: string = typeof window === "undefined" ? "" : window.location.pathname): boolean {
  return pathname.startsWith("/fork-window/");
}
