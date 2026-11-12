import { expect, it, vi } from "vitest";
import { hudHandlers, type HudDeps } from "./server";
import { clearOldHudHotkey, HUD_HOTKEY_MIGRATED_KEY } from "./migrate";
import { hotkeyHint, HUD_HEIGHT, HUD_MARGIN, HUD_WIDTH, hudPosition, hudWindowOptions, MAIN_WINDOW_CHANNEL, wayBack } from "./shared";

it("puts the HUD at the bottom right of the screen's usable area", () => {
  expect(hudPosition({ availWidth: 1728, availHeight: 1080 })).toEqual({ x: 1728 - HUD_WIDTH - HUD_MARGIN, y: 1080 - HUD_HEIGHT - HUD_MARGIN });
  // A second display to the right, below a menu bar.
  expect(hudPosition({ availWidth: 1000, availHeight: 800, availLeft: 1728, availTop: 25 })).toEqual({ x: 1728 + 1000 - HUD_WIDTH - HUD_MARGIN, y: 25 + 800 - HUD_HEIGHT - HUD_MARGIN });
  expect(hudPosition({ availWidth: 200, availHeight: 100 })).toEqual({ x: 0, y: 0 });
});

it("registers a see-through, resizable window over every app that remembers where it was, with the menu bar entry", () => {
  const options = hudWindowOptions({ hotkey: " Control+Shift+H ", screen: { availWidth: 1440, availHeight: 900 } });
  expect(options).toMatchObject({
    width: HUD_WIDTH, height: HUD_HEIGHT, x: 1440 - HUD_WIDTH - HUD_MARGIN, y: 900 - HUD_HEIGHT - HUD_MARGIN, transparent: true, frame: false, alwaysOnTop: true,
    resizable: true, minWidth: 320, minHeight: 240, rememberBounds: true, hotkey: "Control+Shift+H", menuBarTitle: "bb",
  });
  // Never click-through when it opens, and on the primary Bot's chat unless a conversation is named.
  expect(options.clickThrough).toBeUndefined();
  expect(options.params).toBeUndefined();
  expect(hudWindowOptions({ hotkey: "", screen: { availWidth: 1440, availHeight: 900 }, threadId: "thr_conv" }).params).toEqual({ threadId: "thr_conv" });
  // No hotkey unless the user set one: the menu bar entry is still there.
  const bare = hudWindowOptions({ hotkey: "", screen: { availWidth: 1440, availHeight: 900 } });
  expect("hotkey" in bare).toBe(false);
  expect(bare.menuBarTitle).toBe("bb");
});

it("writes a hotkey the way a Mac shows it, and falls back to the menu bar for the way back", () => {
  expect(hotkeyHint("Alt+Space")).toBe("⌥Space");
  expect(hotkeyHint("Control+Shift+H")).toBe("⌃⇧H");
  expect(hotkeyHint("CommandOrControl+J")).toBe("⌘J");
  expect(hotkeyHint("")).toBe("");
  expect(wayBack("Control+Shift+H")).toBe("⌃⇧H or “bb” in the menu bar");
  expect(wayBack("")).toBe("“bb” in the menu bar");
});

function deps(bot: ReturnType<HudDeps["bot"]>, patch: Partial<HudDeps> = {}): HudDeps {
  return { bot: () => bot, working: async () => false, send: vi.fn(async () => {}), publish: vi.fn(), ...patch };
}

it("answers with no Bot before one is made, and sends nothing", async () => {
  const none = deps(null);
  const handlers = hudHandlers(none);
  expect(await handlers["hud.get"]()).toEqual({ bot: null, working: false });
  await expect(handlers["hud.send"]({ text: "Hi" })).rejects.toThrow("Make your Bot first.");
  expect(none.send).not.toHaveBeenCalled();
});

it("names the primary Bot, says whether it is working, and sends to its thread", async () => {
  const bot = { id: "bot_1", name: "Dot", threadId: "thr_bot" };
  const live = deps(bot, { working: async () => true });
  const handlers = hudHandlers(live);
  expect(await handlers["hud.get"]()).toEqual({ bot, working: true });
  expect(await handlers["hud.send"]({ text: "What's next?" })).toEqual({ threadId: "thr_bot" });
  expect(live.send).toHaveBeenCalledWith("thr_bot", "What's next?");
  // A thread that can't be read still shows the Bot.
  const broken = hudHandlers(deps(bot, { working: async () => { throw new Error("gone"); } }));
  expect(await broken["hud.get"]()).toEqual({ bot, working: false });
  await expect(hudHandlers(deps({ id: "bot_1", name: "Dot", threadId: null }))["hud.send"]({ text: "Hi" })).rejects.toThrow("Dot has no chat.");
});

it("relays a window's Open in BB to the main window", () => {
  const relay = deps(null);
  expect(hudHandlers(relay)["window.openInMain"]({ path: "/threads/thr_bot" })).toEqual({ ok: true });
  expect(relay.publish).toHaveBeenCalledWith(MAIN_WINDOW_CHANNEL, { path: "/threads/thr_bot" });
});

it("relays a window's BB command, web address and link to the main window", () => {
  const relay = deps(null);
  const handlers = hudHandlers(relay);
  expect(handlers["window.runInMain"]({ kind: "command", commandId: "app:window.new" })).toEqual({ ok: true });
  expect(handlers["window.runInMain"]({ kind: "url", url: "https://example.com/" })).toEqual({ ok: true });
  expect(handlers["window.runInMain"]({ kind: "link", link: "bb://page/pg_1", how: "window" })).toEqual({ ok: true });
  expect(vi.mocked(relay.publish).mock.calls).toEqual([[MAIN_WINDOW_CHANNEL, { command: "app:window.new" }], [MAIN_WINDOW_CHANNEL, { url: "https://example.com/" }], [MAIN_WINDOW_CHANNEL, { link: "bb://page/pg_1", how: "window" }]]);
});

function settings(stored: Record<string, string>) {
  const kv = new Map<string, unknown>();
  const store = { explicit: () => stored, set: vi.fn(async (patch: Record<string, string | null>) => { for (const [key, value] of Object.entries(patch)) { if (value === null) delete stored[key]; else stored[key] = value; } return {} as never; }) };
  return { kv: { get: async <T,>(key: string) => kv.get(key) as T | undefined, set: async (key: string, value: unknown) => { kv.set(key, value); } }, store, marked: () => kv.has(HUD_HOTKEY_MIGRATED_KEY) };
}

it("clears a stored HUD shortcut that is the old default or the old alternate, once", async () => {
  for (const old of ["Alt+Space", "Option+Space", "Control+Alt+Space", "Ctrl+Option+Space"]) {
    const { kv, store, marked } = settings({ hudHotkey: old });
    expect(await clearOldHudHotkey(kv, store)).toBe(true);
    expect(store.set).toHaveBeenCalledWith({ hudHotkey: null });
    expect(marked()).toBe(true);
    // Chosen again afterwards, it is the user's: left alone.
    store.set.mockClear();
    store.explicit().hudHotkey = old;
    expect(await clearOldHudHotkey(kv, store)).toBe(false);
    expect(store.set).not.toHaveBeenCalled();
  }
});

it("keeps a HUD shortcut the user picked, and no shortcut at all", async () => {
  const picked = settings({ hudHotkey: "Control+Shift+H" });
  expect(await clearOldHudHotkey(picked.kv, picked.store)).toBe(false);
  expect(picked.store.set).not.toHaveBeenCalled();
  expect(picked.marked()).toBe(true);
  const none = settings({});
  expect(await clearOldHudHotkey(none.kv, none.store)).toBe(false);
  expect(none.store.set).not.toHaveBeenCalled();
});
