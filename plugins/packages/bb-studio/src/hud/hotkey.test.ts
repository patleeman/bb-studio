import { expect, it, vi } from "vitest";
import type { HostWindowOptions, HostWindows } from "../kit/app/windows";
import { HOTKEY_ALTERNATIVES, hotkeyNote, hotkeyWords, HUD_ALTERNATE_HOTKEY, registerWithHotkey, sameHotkey } from "./hotkey";

/** A BB where other apps hold `taken`: a window's hotkey takes unless it is one of them. */
function fakeWindows(taken: readonly string[], withCheck = true) {
  const held = new Map<string, string | undefined>();
  const registered: (string | undefined)[] = [];
  const windows: HostWindows = {
    native: true,
    register: vi.fn(async (id: string, options?: HostWindowOptions) => { held.set(id, options?.hotkey); registered.push(options?.hotkey); return true; }),
    open: async () => true, toggle: async () => true, close: async () => true,
    ...(withCheck ? { hotkeyRegistered: vi.fn(async (id: string) => { const hotkey = held.get(id); return !!hotkey && !taken.includes(hotkey); }) } : {}),
  };
  return { windows, registered, menuBar: () => held.get("hud") };
}
const options = (hotkey: string): HostWindowOptions => ({ menuBarTitle: "bb", ...(hotkey ? { hotkey } : {}) });

it("keeps the user's shortcut when it took", async () => {
  const bb = fakeWindows([]);
  expect(await registerWithHotkey(bb.windows, "hud", " Alt+Space ", options)).toEqual({ wanted: "Alt+Space", inUse: "Alt+Space", status: "ok" });
  expect(bb.registered).toEqual(["Alt+Space"]);
  expect(hotkeyNote({ wanted: "Alt+Space", inUse: "Alt+Space", status: "ok" })).toBeNull();
});

it("uses the alternate when another app holds the shortcut, and says so", async () => {
  const bb = fakeWindows(["Alt+Space"]);
  const held = await registerWithHotkey(bb.windows, "hud", "Alt+Space", options);
  expect(held).toEqual({ wanted: "Alt+Space", inUse: HUD_ALTERNATE_HOTKEY, status: "alternate" });
  expect(bb.registered).toEqual(["Alt+Space", "Control+Alt+Space"]);
  // The menu bar entry is registered with the shortcut that works.
  expect(bb.menuBar()).toBe("Control+Alt+Space");
  expect(hotkeyNote(held)).toBe("Option+Space is taken by another app. Using Control+Option+Space.");
});

it("leaves the HUD with no shortcut when the alternate is taken too, and asks for another", async () => {
  const bb = fakeWindows(["Alt+Space", "Control+Alt+Space"]);
  const held = await registerWithHotkey(bb.windows, "hud", "Alt+Space", options);
  expect(held).toEqual({ wanted: "Alt+Space", inUse: "", status: "taken" });
  expect(bb.registered).toEqual(["Alt+Space", "Control+Alt+Space", undefined]);
  expect(hotkeyNote(held)).toBe("Option+Space is taken by another app. Pick another shortcut.");
});

it("does not try the alternate twice when it is the user's own shortcut", async () => {
  const bb = fakeWindows(["Ctrl+Option+Space"]);
  expect((await registerWithHotkey(bb.windows, "hud", "Ctrl+Option+Space", options)).status).toBe("taken");
  expect(bb.registered).toEqual(["Ctrl+Option+Space", undefined]);
});

it("takes a BB without the check at its word, and a check that fails as held", async () => {
  const old = fakeWindows(["Alt+Space"], false);
  expect(await registerWithHotkey(old.windows, "hud", "Alt+Space", options)).toEqual({ wanted: "Alt+Space", inUse: "Alt+Space", status: "ok" });
  expect(old.registered).toEqual(["Alt+Space"]);
  const broken = fakeWindows([]);
  broken.windows.hotkeyRegistered = async () => { throw new Error("no such window"); };
  expect((await registerWithHotkey(broken.windows, "hud", "Alt+Space", options)).status).toBe("ok");
});

it("asks nothing in a browser, which has no system shortcuts and answers false", async () => {
  const bb = fakeWindows(["Alt+Space"]);
  bb.windows.native = false;
  expect((await registerWithHotkey(bb.windows, "hud", "Alt+Space", options)).status).toBe("ok");
  expect(bb.registered).toEqual(["Alt+Space"]);
});

it("checks nothing for no shortcut", async () => {
  const bb = fakeWindows([]);
  expect(await registerWithHotkey(bb.windows, "hud", "", options)).toEqual({ wanted: "", inUse: "", status: "none" });
  expect(bb.windows.hotkeyRegistered).not.toHaveBeenCalled();
  expect(hotkeyNote(null)).toBeNull();
});

it("names the keys in words", () => {
  expect(hotkeyWords("CommandOrControl+Shift+H")).toBe("Command+Shift+H");
});

it("with no alternate (the HUD), a taken shortcut leaves the window with none", async () => {
  const bb = fakeWindows(["Control+Shift+H"]);
  const held = await registerWithHotkey(bb.windows, "hud", "Control+Shift+H", options, null);
  expect(held).toEqual({ wanted: "Control+Shift+H", inUse: "", status: "taken" });
  expect(bb.registered).toEqual(["Control+Shift+H", undefined]);
});

it("offers three other shortcuts, and knows two spellings of one", () => {
  expect(HOTKEY_ALTERNATIVES).toEqual(["Control+Alt+Space", "Alt+Shift+Space", "Command+Shift+Space"]);
  expect(sameHotkey("Option+Ctrl+Space", "Control+Alt+Space")).toBe(true);
  expect(sameHotkey("Alt+Space", "Alt+Shift+Space")).toBe(false);
});
