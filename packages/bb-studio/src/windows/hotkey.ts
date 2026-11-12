// A window's system-wide shortcut as BB actually holds it, for the launcher
// (src/launcher). A system-wide shortcut belongs to one app at a
// time, and Option+Space is often taken (ChatGPT and Claude use it), so after
// registering a window Studio asks BB whether the shortcut took
// (`hotkeyRegistered`). When it didn't, the launcher tries one alternate; a
// window with neither keeps its other ways in. The setting keeps what the
// user chose: the alternate is a fallback, never written to it.
//
// The main window registers and writes the outcome to localStorage, which
// every Studio window reads, so every place that names a shortcut names the
// one in use.
import { useSyncExternalStore } from "react";
import type { HostWindowOptions, HostWindows } from "../kit/app/windows";

/** Tried when another app holds the launcher's shortcut. */
export const ALTERNATE_HOTKEY = "Control+Alt+Space";
/** What settings offer in one click when a shortcut is taken: ⌃⌥Space, ⌥⇧Space, ⌘⇧Space. */
export const HOTKEY_ALTERNATIVES: readonly string[] = [ALTERNATE_HOTKEY, "Alt+Shift+Space", "Command+Shift+Space"];
export interface WindowHotkey {
  /** The shortcut in Studio's settings; empty for none. */
  wanted: string;
  /** The shortcut BB holds for the window; empty for none. */
  inUse: string;
  /** "alternate": the wanted one is taken and the alternate works. "taken": neither works. */
  status: "ok" | "alternate" | "taken" | "none";
}

/**
 * BB's check that a window's shortcut took, or null where there is nothing to
 * ask: a BB without the check, and a browser, which has no system shortcuts
 * and answers false for every window. A check that fails is no news: the
 * shortcut is taken as held.
 */
function registeredCheck(windows: HostWindows): ((windowId: string) => Promise<boolean>) | null {
  if (!windows.native || typeof windows.hotkeyRegistered !== "function") return null;
  return async (windowId) => { try { return (await windows.hotkeyRegistered!(windowId)) !== false; } catch { return true; } };
}

const KEY_NAMES: Record<string, string> = {
  alt: "alt", option: "alt", control: "control", ctrl: "control", command: "command", cmd: "command", meta: "command", super: "command", commandorcontrol: "command", cmdorctrl: "command",
};
/** Whether two spellings name one shortcut: `Option+Space` is `Alt+Space`. */
export const sameHotkey = (a: string, b: string) => {
  const parts = (hotkey: string) => hotkey.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean).map((part) => KEY_NAMES[part] ?? part).sort().join("+");
  return parts(a) === parts(b);
};

const KEY_WORDS: Record<string, string> = { alt: "Option", control: "Control", command: "Command", shift: "Shift" };

const KEY_SIGNS: Record<string, string> = {
  alt: "⌥", option: "⌥", shift: "⇧", control: "⌃", ctrl: "⌃", command: "⌘", cmd: "⌘", meta: "⌘", super: "⌘", commandorcontrol: "⌘", cmdorctrl: "⌘",
};

/** A hotkey as a Mac shows it: `Alt+Space` is ⌥Space. Empty for no hotkey. */
export function hotkeyHint(hotkey: string): string {
  return hotkey.split("+").map((part) => part.trim()).filter(Boolean).map((part) => KEY_SIGNS[part.toLowerCase()] ?? part).join("");
}

/** A hotkey in words, as a Mac names the keys: `Alt+Space` is Option+Space. */
export function hotkeyWords(hotkey: string): string {
  return hotkey.split("+").map((part) => part.trim()).filter(Boolean).map((part) => KEY_WORDS[KEY_NAMES[part.toLowerCase()] ?? part.toLowerCase()] ?? part).join("+");
}

/**
 * Registers `windowId` with the hotkey `options(hotkey)` asks for and checks
 * that it took; falls back to the alternate (null: there is none), then to no
 * hotkey. A BB without the check is taken at its word.
 */
export async function registerWithHotkey(windows: HostWindows, windowId: string, wanted: string, options: (hotkey: string) => HostWindowOptions, alternate: string | null = ALTERNATE_HOTKEY): Promise<WindowHotkey> {
  const key = wanted.trim();
  await windows.register(windowId, options(key));
  if (!key) return { wanted: key, inUse: "", status: "none" };
  const check = registeredCheck(windows);
  if (!check || await check(windowId)) return { wanted: key, inUse: key, status: "ok" };
  if (alternate && !sameHotkey(key, alternate)) {
    await windows.register(windowId, options(alternate));
    if (await check(windowId)) return { wanted: key, inUse: alternate, status: "alternate" };
  }
  // Nothing took: the window stays registered, with no shortcut.
  await windows.register(windowId, options(""));
  return { wanted: key, inUse: "", status: "taken" };
}

/** What to tell the user when their shortcut isn't the one in use; null when it is. */
export function hotkeyNote(hotkey: WindowHotkey | null): string | null {
  if (hotkey?.status === "alternate") return `${hotkeyWords(hotkey.wanted)} is taken by another app. Using ${hotkeyWords(hotkey.inUse)}.`;
  if (hotkey?.status === "taken") return `${hotkeyWords(hotkey.wanted)} is taken by another app. Pick another shortcut.`;
  return null;
}

/** The windows whose shortcut Studio tracks. */
export type HotkeyWindow = "launcher";
const STORE_KEYS: Record<HotkeyWindow, string> = { launcher: "studio.launcher.hotkey" };
const listeners = new Set<() => void>();
const cached: Partial<Record<HotkeyWindow, { raw: string | null; value: WindowHotkey | null }>> = {};

function read(name: HotkeyWindow): WindowHotkey | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORE_KEYS[name]); } catch { /* private mode */ }
  const last = cached[name];
  if (last && raw === last.raw) return last.value;
  let value: WindowHotkey | null = null;
  try {
    const parsed = raw ? JSON.parse(raw) as Partial<WindowHotkey> | null : null;
    if (parsed && typeof parsed.wanted === "string" && typeof parsed.inUse === "string" && (parsed.status === "ok" || parsed.status === "alternate" || parsed.status === "taken" || parsed.status === "none")) value = { wanted: parsed.wanted, inUse: parsed.inUse, status: parsed.status };
  } catch { /* not ours */ }
  cached[name] = { raw, value };
  return value;
}

/** Notes what registering `name` came to (null: the window is off), for every window. */
export function noteWindowHotkey(name: HotkeyWindow, hotkey: WindowHotkey | null): void {
  try {
    if (hotkey) localStorage.setItem(STORE_KEYS[name], JSON.stringify(hotkey));
    else localStorage.removeItem(STORE_KEYS[name]);
  } catch { /* private mode */ }
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  const keys = Object.values(STORE_KEYS);
  const stored = (event: StorageEvent) => { if (event.key === null || keys.includes(event.key)) notify(); };
  window.addEventListener("storage", stored);
  return () => { listeners.delete(notify); window.removeEventListener("storage", stored); };
}

export interface HotkeyInUse {
  inUse: string;
  note: string | null;
  /** Null until BB has answered for `wanted`. */
  status: WindowHotkey["status"] | null;
}

/** The shortcut in use for `name` and what to say about it. Until BB has answered for `wanted`, that is `wanted` itself. */
export function useWindowHotkey(name: HotkeyWindow, wanted: string): HotkeyInUse {
  const known = useSyncExternalStore(subscribe, () => read(name), () => null);
  const key = wanted.trim();
  return known && known.wanted === key ? { inUse: known.inUse, note: hotkeyNote(known), status: known.status } : { inUse: key, note: null, status: null };
}
