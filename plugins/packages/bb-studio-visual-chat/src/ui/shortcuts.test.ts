// The window's shortcuts as a pure key → action map, and the Esc rule for search fields.
import { expect, it, vi } from "vitest";
import { escapeStep, handleSearchEscape, isMac, shortcutRows, windowAction, type KeyLike } from "./shortcuts";

const key = (name: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike => ({ key: name, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

it("maps Cmd keys on a Mac and Ctrl keys elsewhere to the window's actions", () => {
  for (const [mac, mod] of [[true, { metaKey: true }], [false, { ctrlKey: true }]] as const) {
    expect(windowAction(key("n", mod), mac)).toBe("new-chat");
    expect(windowAction(key("k", mod), mac)).toBe("switch-chat");
    expect(windowAction(key("l", mod), mac)).toBe("focus-input");
    expect(windowAction(key("w", mod), mac)).toBe("close-window");
    // Shift makes the key upper case.
    expect(windowAction(key("O", { ...mod, shiftKey: true }), mac)).toBe("open-thread");
  }
});

it("leaves every other key alone", () => {
  expect(windowAction(key("n"), true)).toBeNull();
  expect(windowAction(key("n", { ctrlKey: true }), true)).toBeNull();
  expect(windowAction(key("n", { metaKey: true }), false)).toBeNull();
  expect(windowAction(key("n", { metaKey: true, ctrlKey: true }), true)).toBeNull();
  expect(windowAction(key("k", { metaKey: true, altKey: true }), true)).toBeNull();
  // Cmd+Shift+N, K, L, W and plain Cmd+O are not the window's.
  expect(windowAction(key("N", { metaKey: true, shiftKey: true }), true)).toBeNull();
  expect(windowAction(key("K", { metaKey: true, shiftKey: true }), true)).toBeNull();
  expect(windowAction(key("o", { metaKey: true }), true)).toBeNull();
  expect(windowAction(key("Escape", { metaKey: true }), true)).toBeNull();
});

it("lists the shortcuts with the platform's symbols", () => {
  const keys = (mac: boolean) => Object.fromEntries(shortcutRows(mac).map((row) => [row.id, row.keys]));
  expect(keys(true)).toMatchObject({ "new-chat": "⌘N", "switch-chat": "⌘K", "focus-input": "⌘L", "open-thread": "⇧⌘O", "close-window": "⌘W", escape: "Esc" });
  expect(keys(false)).toMatchObject({ "new-chat": "Ctrl+N", "switch-chat": "Ctrl+K", "focus-input": "Ctrl+L", "open-thread": "Ctrl+Shift+O", "close-window": "Ctrl+W", escape: "Esc" });
  expect(isMac("MacIntel")).toBe(true);
  expect(isMac("Win32 Mozilla/5.0 (Windows NT 10.0)")).toBe(false);
});

it("clears a search field on the first Esc and closes on the second, taking the key both times", () => {
  expect(escapeStep("rome")).toBe("clear");
  expect(escapeStep("")).toBe("close");
  const event = (name: string, isComposing = false) => ({ key: name, nativeEvent: { isComposing }, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  const clear = vi.fn();
  const close = vi.fn();
  const first = event("Escape");
  expect(handleSearchEscape(first, "rome", clear, close)).toBe(true);
  expect([clear.mock.calls.length, close.mock.calls.length]).toEqual([1, 0]);
  expect(first.preventDefault).toHaveBeenCalled();
  expect(first.stopPropagation).toHaveBeenCalled();
  expect(handleSearchEscape(event("Escape"), "", clear, close)).toBe(true);
  expect([clear.mock.calls.length, close.mock.calls.length]).toEqual([1, 1]);
  // Other keys, and Esc that ends an IME composition, are not taken.
  const other = event("Enter");
  expect(handleSearchEscape(other, "rome", clear, close)).toBe(false);
  expect(other.preventDefault).not.toHaveBeenCalled();
  expect(handleSearchEscape(event("Escape", true), "rome", clear, close)).toBe(false);
  expect([clear.mock.calls.length, close.mock.calls.length]).toEqual([1, 1]);
});
