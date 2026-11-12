// BB Studio Visual Chat's BB settings: the optional shortcut of its window, on a BB
// that opens plugins in windows (src/window-app.tsx), and the Exa API key
// canvas_image searches with. A BB secret (kept in BB's secret store, never sent to a browser);
// the server reads it only to call Exa, and never logs it or puts it in an
// answer or an error. Without it, canvas_image takes a page's main picture.
export const EXA_KEY_SETTING = "exaApiKey";

/**
 * The window's system-wide shortcut, in Electron's form. Unset by default: BB Studio's launcher (Option+Space)
 * opens Visual Chat, so it takes no global key unless the user assigns one here.
 */
export const WINDOW_HOTKEY_SETTING = "windowHotkey";
export const DEFAULT_WINDOW_HOTKEY = "";
/** The default until the launcher replaced it. A stored value equal to it was never the user's choice. */
export const LEGACY_WINDOW_HOTKEY = "Alt+Shift+V";

/**
 * The shortcut the user assigned, or "" for none. A value equal to the old default reads as none: it was
 * stored for users who never chose it. (To use that key on purpose, write it another way, such as `Shift+Alt+V`.)
 */
export function assignedWindowHotkey(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_WINDOW_HOTKEY;
  const key = value.trim();
  return key.replace(/\s+/g, "").toLowerCase() === LEGACY_WINDOW_HOTKEY.toLowerCase() ? DEFAULT_WINDOW_HOTKEY : key;
}

export const CANVAS_KEY_SETTINGS = {
  [WINDOW_HOTKEY_SETTING]: { type: "string", label: "Window shortcut", description: "Shows and hides the Visual Chat window, written like Control+Alt+V. Empty for none. Only in a BB that opens plugins in windows.", default: DEFAULT_WINDOW_HOTKEY },
  [EXA_KEY_SETTING]: { type: "string", label: "Exa API key", description: "Enables picture search.", secret: true, default: "" },
} as const;

/** The key, or "" when none is set. */
export function exaKey(settings: Record<string, unknown> = {}): string {
  const value = settings[EXA_KEY_SETTING];
  return typeof value === "string" ? value.trim() : "";
}
