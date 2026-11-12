// The HUD: a conversation "popped out" into a small window that floats over
// other apps (the primary Bot's chat when none is named). It is BB's real
// chat (ThreadChat) in a see-through, resizable, frameless window that BB
// reopens where it was last shown, at that size: one bar at the bottom, the
// transcript fading out above it. Only on a BB with plugin windows
// (src/kit/app/windows.ts). This file is what the window, the main window
// and the server share; it is pure, so tests read it.
import type { HostWindowOptions } from "../kit/app/windows";

/** The HUD's window. */
export const HUD_WINDOW_ID = "hud";
/** The "display only" twin older Studios opened; closed when Studio starts (HudBridge). */
export const LEGACY_HUD_DISPLAY_WINDOW_ID = "hud-display";
/** Studio publishes `{ path }` here; BB's main window opens the path and comes to the front. */
export const MAIN_WINDOW_CHANNEL = "studio-main-window";

/** The window param naming the conversation the HUD shows; without it, the primary Bot's chat. */
export const HUD_THREAD_PARAM = "threadId";

export const HUD_WIDTH = 480;
export const HUD_HEIGHT = 600;
export const HUD_MIN_WIDTH = 320;
export const HUD_MIN_HEIGHT = 240;
/** The gap between the HUD and the screen's edges. */
export const HUD_MARGIN = 24;
export const HUD_MENU_BAR_TITLE = "bb";
export const POP_OUT_LABEL = "Pop out to HUD";

export interface ScreenArea { availWidth: number; availHeight: number; availLeft?: number; availTop?: number }

/** The bottom right corner of the screen's usable area: where the HUD opens the first time. */
export function hudPosition(screen: ScreenArea, width = HUD_WIDTH, height = HUD_HEIGHT): { x: number; y: number } {
  return {
    x: Math.max(0, Math.round((screen.availLeft ?? 0) + screen.availWidth - width - HUD_MARGIN)),
    y: Math.max(0, Math.round((screen.availTop ?? 0) + screen.availHeight - height - HUD_MARGIN)),
  };
}

/**
 * The HUD's window: see-through and frameless (the page draws the bar and
 * the gradient), over every app, resizable down to a minimum, and reopened
 * by BB where it last was. Its menu bar entry always; a hotkey only when the
 * user set one. `threadId` names the conversation it shows. Click-through is
 * never asked for here: it starts off with every open.
 */
export function hudWindowOptions({ hotkey, screen, threadId }: { hotkey: string; screen: ScreenArea; threadId?: string }): HostWindowOptions {
  const key = hotkey.trim();
  return {
    title: "Bot HUD",
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    ...hudPosition(screen),
    transparent: true,
    vibrancy: "hud",
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    minWidth: HUD_MIN_WIDTH,
    minHeight: HUD_MIN_HEIGHT,
    rememberBounds: true,
    ...(key ? { hotkey: key } : {}),
    menuBarTitle: HUD_MENU_BAR_TITLE,
    ...(threadId ? { params: { [HUD_THREAD_PARAM]: threadId } } : {}),
  };
}

const KEY_SIGNS: Record<string, string> = {
  alt: "⌥", option: "⌥", shift: "⇧", control: "⌃", ctrl: "⌃", command: "⌘", cmd: "⌘", meta: "⌘", super: "⌘", commandorcontrol: "⌘", cmdorctrl: "⌘",
};

/** A hotkey as a Mac shows it: `Alt+Space` is ⌥Space. Empty for no hotkey. */
export function hotkeyHint(hotkey: string): string {
  return hotkey.split("+").map((part) => part.trim()).filter(Boolean).map((part) => KEY_SIGNS[part.toLowerCase()] ?? part).join("");
}

/** What turns click-through off or brings the HUD back: its hotkey when it has one, and always the menu bar entry. */
export function wayBack(hotkey: string): string {
  const hint = hotkeyHint(hotkey);
  return hint ? `${hint} or “${HUD_MENU_BAR_TITLE}” in the menu bar` : `“${HUD_MENU_BAR_TITLE}” in the menu bar`;
}
