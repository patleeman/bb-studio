// Windows of a plugin's own, on a BB that has them (the BB Studio fork):
// `slots.experimental_window` offers a component BB shows in a window with no
// BB chrome, at /fork-window/<pluginId>/<windowId>?<params>, and
// `experimental_useWindows()` opens, closes and styles such windows. Both are
// read by name (host-sdk.ts), so stable BB lacks them and every caller keeps
// today's behaviour as its fallback.
import type { ReactNode } from "react";
import * as sdkApp from "@get-bb/plugin-sdk/app";
import { member } from "./host-sdk";

export interface HostWindowOptions {
  title?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  /** Frameless and see-through; the component draws its own background. */
  transparent?: boolean;
  frame?: boolean;
  /** Floats over other apps and every Space. */
  alwaysOnTop?: boolean;
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  /** `"hiddenInset"`: no title bar; the traffic lights sit inside the content. */
  titleBar?: "hiddenInset";
  /** Reopens where it was last shown or hidden, at that size, per display, across restarts. */
  rememberBounds?: boolean;
  /** Opens in the middle of the screen. */
  center?: boolean;
  /** Closes when the window loses focus (a launcher). */
  hideOnBlur?: boolean;
  /** A system-wide shortcut in Electron's form, such as `Alt+Space`, that shows or hides the window. */
  hotkey?: string;
  /** The window's query string. */
  params?: Record<string, string>;
}

export interface HostWindows {
  /** True in the desktop app. In a browser a window is a plain popup, and styling and hotkey are ignored. */
  native: boolean;
  /** Sets up the hotkey without showing the window. */
  register(windowId: string, options?: HostWindowOptions): Promise<boolean>;
  open(windowId: string, options?: HostWindowOptions): Promise<boolean>;
  toggle(windowId: string, options?: HostWindowOptions): Promise<boolean>;
  close(windowId: string): Promise<boolean>;
  /** Whether the window's hotkey took; false when another app holds it. Newer BBs only (src/windows/hotkey.ts reads it by name). */
  hotkeyRegistered?(windowId: string): Promise<boolean>;
}

export interface HostWindowRegistration {
  id: string;
  title: string;
  /** Gets no props; its params are in the address (windowParams). */
  component: () => ReactNode;
}

const never = () => Promise.resolve(false);
/** What a BB without windows answers: nothing opens. */
export const NO_HOST_WINDOWS: HostWindows = { native: false, register: never, open: never, toggle: never, close: never };

/** `experimental_useWindows` off an SDK module, or null where it has none. */
export function windowsHookOf(sdk: object): (() => HostWindows) | null {
  const hook = member(sdk, "experimental_useWindows");
  return typeof hook === "function" ? (hook as () => HostWindows) : null;
}

const hostHook = windowsHookOf(sdkApp);

/** Whether this BB can show a plugin's component in a window of its own. */
export const hasHostWindows = hostHook !== null;

const noWindows = () => NO_HOST_WINDOWS;
/** BB's windows; on a BB without them, every call answers false. */
export const useHostWindows: () => HostWindows = hostHook ?? noWindows;

/** Offers a component as a window (`slots.experimental_window`); false on a BB without the slot. */
export function registerHostWindow(slots: object, registration: HostWindowRegistration): boolean {
  const slot = member(slots, "experimental_window");
  if (typeof slot !== "function") return false;
  (slot as (registration: HostWindowRegistration) => void).call(slots, registration);
  return true;
}

/** The address every plugin window loads under. */
export const HOST_WINDOW_PREFIX = "/fork-window/";

/** Whether this page is a plugin window, not BB's main window. */
export function inHostWindow(pathname: string = typeof window === "undefined" ? "" : window.location.pathname): boolean {
  return pathname.startsWith(HOST_WINDOW_PREFIX);
}

/** The window id this page shows, or null in BB's main window. */
export function hostWindowId(pathname: string = typeof window === "undefined" ? "" : window.location.pathname): string | null {
  if (!inHostWindow(pathname)) return null;
  const id = pathname.slice(HOST_WINDOW_PREFIX.length).split("/")[1];
  try { return id ? decodeURIComponent(id) : null; } catch { return null; }
}

/** A window's params, from its address. BB's own `bb…` flags are left out. */
export function windowParams(search: string = typeof window === "undefined" ? "" : window.location.search): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) if (!key.startsWith("bb")) params[key] = value;
  return params;
}
