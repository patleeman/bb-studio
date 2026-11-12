// The launcher: a search-and-run window over any app, on Option+Space (the
// only system-wide shortcut Studio takes by default). Only on a BB with
// plugin windows (src/kit/app/windows.ts). This file is what the window and
// the main window share; it is pure, so tests read it.
import type { HostWindowOptions } from "../kit/app/windows";

/** The launcher's window. */
export const LAUNCHER_WINDOW_ID = "launcher";
export const LAUNCHER_WIDTH = 640;
export const LAUNCHER_HEIGHT = 420;

/** The launcher's window: mid-screen, over every app, gone when it loses focus. No hotkey when `hotkey` is empty. */
export function launcherWindowOptions(hotkey: string): HostWindowOptions {
  const key = hotkey.trim();
  return {
    title: "BB Studio Launcher",
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_HEIGHT,
    center: true,
    hideOnBlur: true,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    ...(key ? { hotkey: key } : {}),
  };
}

/** BB's new-thread view. */
export const NEW_THREAD_PATH = "/";
/**
 * Asks the main window for VS Code where it is (src/code/open-vscode.ts,
 * main-actions.ts). A main window that doesn't know the action shows VS
 * Code's nav panel, which this is the address of.
 */
export const VSCODE_MAIN_PATH = "/plugins/studio/vscode?studioRun=vscode";

export const threadPath = (threadId: string) => `/threads/${encodeURIComponent(threadId)}`;
