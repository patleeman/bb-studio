// Studio's semantic-zoom commands (⌃⌘− / ⌃⌘=, registered through
// app.commands) against bb's own shortcut matcher, with the key and code a Mac
// keyboard really reports. bb matches by physical key, so Option's "–" and
// "≠" still reach a Minus or Equal shortcut.
import { describe, expect, it } from "vitest";
import { matchesAppShortcut, type AppShortcut } from "@bb/domain";

const shortcut = (key: string, over: Partial<AppShortcut> = {}): AppShortcut => ({
  key,
  mod: false,
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...over,
});
const ZOOM_OUT = shortcut("-", { mod: true, control: true });
const ZOOM_IN = shortcut("=", { mod: true, control: true });
const press = (key: string, code: string, modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }) => ({
  key,
  code,
  metaKey: modifiers.meta ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
  shiftKey: modifiers.shift ?? false,
});

describe("the zoom commands' shortcuts", () => {
  it("match ⌃⌘− and ⌃⌘= as a Mac reports them", () => {
    expect(matchesAppShortcut(press("-", "Minus", { meta: true, ctrl: true }), ZOOM_OUT, true)).toBe(true);
    expect(matchesAppShortcut(press("=", "Equal", { meta: true, ctrl: true }), ZOOM_IN, true)).toBe(true);
    // Not plain ⌘− / ⌘=, which stay page zoom.
    expect(matchesAppShortcut(press("-", "Minus", { meta: true }), ZOOM_OUT, true)).toBe(false);
    expect(matchesAppShortcut(press("=", "Equal", { meta: true }), ZOOM_IN, true)).toBe(false);
  });

  it("match by physical key with Option, though a Mac reports – and ≠", () => {
    const optionOut = shortcut("-", { mod: true, alt: true });
    const optionIn = shortcut("=", { mod: true, alt: true });
    expect(matchesAppShortcut(press("–", "Minus", { meta: true, alt: true }), optionOut, true)).toBe(true);
    expect(matchesAppShortcut(press("≠", "Equal", { meta: true, alt: true }), optionIn, true)).toBe(true);
  });

  it("are Ctrl+− and Ctrl+= elsewhere", () => {
    expect(matchesAppShortcut(press("-", "Minus", { ctrl: true }), ZOOM_OUT, false)).toBe(true);
    expect(matchesAppShortcut(press("=", "Equal", { ctrl: true }), ZOOM_IN, false)).toBe(true);
  });
});
