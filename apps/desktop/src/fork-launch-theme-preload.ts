import type { IpcRenderer } from "electron";
import {
  FORK_LAUNCH_THEME_GET_CHANNEL,
  FORK_LAUNCH_THEME_SET_CHANNEL,
  parseLaunchAppearance,
  type LaunchAppearance,
} from "./fork-launch-theme-ipc.js";
import { FORK_BARE_QUERY_KEY, FORK_WINDOW_PATH_PREFIX } from "./fork-windows-ipc.js";

export function isLaunchThemeWindow(location: { pathname: string; search: string }): boolean {
  if (location.pathname.startsWith(FORK_WINDOW_PATH_PREFIX)) return false;
  return !new URLSearchParams(location.search).has(FORK_BARE_QUERY_KEY);
}

export const LAUNCH_THEME_STYLE_ID = "fork-launch-theme";

export function applyLaunchAppearance(
  root: HTMLElement,
  launch: LaunchAppearance,
): void {
  for (const [name, value] of launch.properties) root.style.setProperty(name, value);
  for (const [name, value] of launch.attributes) root.setAttribute(name, value);
  root.style.setProperty("background-color", launch.background);
  if (launch.mode !== null) {
    root.classList.toggle("dark", launch.mode === "dark");
    root.style.setProperty("color-scheme", launch.mode);
  }
  const style = root.ownerDocument.createElement("style");
  style.id = LAUNCH_THEME_STYLE_ID;
  style.textContent = `body{background-color:${launch.background} !important}`;
  root.appendChild(style);
}

export function whenRoot(
  doc: Document,
  paint: (root: HTMLElement) => void,
): void {
  if (doc.documentElement) {
    paint(doc.documentElement);
    return;
  }
  const observer = new MutationObserver(() => {
    if (!doc.documentElement) return;
    observer.disconnect();
    paint(doc.documentElement);
  });
  observer.observe(doc, { childList: true });
}

export function forkLaunchThemeApi(ipcRenderer: IpcRenderer): {
  experimental_launchAppearance: LaunchAppearance | null;
  experimental_saveLaunchAppearance(value: LaunchAppearance | null): void;
} {
  let launch: LaunchAppearance | null = null;
  try {
    if (typeof location !== "undefined" && isLaunchThemeWindow(location)) {
      launch = parseLaunchAppearance(
        ipcRenderer.sendSync(FORK_LAUNCH_THEME_GET_CHANNEL),
      );
      const value = launch;
      if (value !== null && typeof document !== "undefined") {
        whenRoot(document, (root) => applyLaunchAppearance(root, value));
      }
    }
  } catch {
    launch = null;
  }
  return {
    experimental_launchAppearance: launch,
    experimental_saveLaunchAppearance(value) {
      ipcRenderer.send(FORK_LAUNCH_THEME_SET_CHANNEL, value);
    },
  };
}
