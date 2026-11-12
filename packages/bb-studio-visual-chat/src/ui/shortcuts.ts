// The Visual Chat window's keyboard shortcuts, as a pure key → action map,
// and the Esc rule for search fields. The window (a document of its own)
// takes Cmd/Ctrl+N, K, L, W and Cmd/Ctrl+Shift+O; the page in BB's main
// window takes none of them, since they are BB's there. Esc in a search field
// clears it first and closes on the second press, everywhere.

export type WindowAction = "new-chat" | "switch-chat" | "focus-input" | "open-thread" | "close-window";

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Whether this is a Mac: Cmd is the modifier there, Ctrl elsewhere. */
export function isMac(platform: string = typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`): boolean {
  return /mac/i.test(platform);
}

const PLAIN: Record<string, WindowAction> = { n: "new-chat", k: "switch-chat", l: "focus-input", w: "close-window" };
const SHIFTED: Record<string, WindowAction> = { o: "open-thread" };

/** The action a key press asks for in the window, or null when it is not one of its shortcuts. */
export function windowAction(event: KeyLike, mac: boolean): WindowAction | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || event.altKey) return null;
  const key = event.key.toLowerCase();
  return (event.shiftKey ? SHIFTED[key] : PLAIN[key]) ?? null;
}

export interface ShortcutRow {
  /** A window action, or "escape" for the search field rule. */
  id: WindowAction | "escape" | "send" | "versions";
  label: string;
  keys: string;
}

/** The shortcuts the "?" popover lists, with the platform's symbols. */
export function shortcutRows(mac: boolean): ShortcutRow[] {
  const mod = (key: string, shift = false) => (mac ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`);
  return [
    { id: "new-chat", label: "New chat", keys: mod("N") },
    { id: "switch-chat", label: "Switch chat", keys: mod("K") },
    { id: "focus-input", label: "Focus the message box", keys: mod("L") },
    { id: "open-thread", label: "Open thread in BB", keys: mod("O", true) },
    { id: "close-window", label: "Close window", keys: mod("W") },
    { id: "send", label: "Send (new line with Shift)", keys: mac ? "↩" : "Enter" },
    { id: "versions", label: "Previous and next version", keys: "← →" },
    { id: "escape", label: "Clear search, then close it", keys: "Esc" },
  ];
}

/** What Esc does in a search field: clear it while it holds text, else close (or blur). */
export function escapeStep(value: string): "clear" | "close" {
  return value === "" ? "close" : "clear";
}

interface EscapeEvent {
  key: string;
  nativeEvent?: { isComposing?: boolean };
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Esc in a search field: the first press clears the text, the second closes
 * the picker (or blurs). The key is taken either way, so it never reaches
 * BB's own Esc or the quick card's. True when the event was Esc.
 */
export function handleSearchEscape(event: EscapeEvent, value: string, clear: () => void, close: () => void): boolean {
  if (event.key !== "Escape" || event.nativeEvent?.isComposing) return false;
  event.preventDefault();
  event.stopPropagation();
  if (escapeStep(value) === "clear") clear(); else close();
  return true;
}
