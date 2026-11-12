// "Show HUD" from outside the HUD's own places (the Bot sidebar's ··· menu), and "Pop out to HUD" on a conversation.
import { beforeEach, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@get-bb/plugin-sdk/app", () => ({}));
vi.mock("../../kit/app/index", () => ({}));
vi.mock("../../links/open", () => ({ inMainWindow: () => true, useOpenLink: () => () => Promise.resolve({ via: "none", reason: "" }) }));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: undefined }) }));

import { HUD_OFF_MESSAGE, runRelayed, showHud, showHudWindow } from "./HudBridge";
import { HUD_WINDOW_ID } from "../shared";

const screen = { availWidth: 1440, availHeight: 900 } as Screen;

beforeEach(() => { toast.mockClear(); toast.error.mockClear(); });

it("opens the HUD window when the HUD is on", async () => {
  const windows = { open: vi.fn(async (_id: string, _options?: object) => true), close: vi.fn(async () => true) };
  expect(await showHudWindow(windows, { hudEnabled: true, hotkey: "Control+Shift+H" }, screen)).toBe(true);
  expect(windows.open).toHaveBeenCalledWith(HUD_WINDOW_ID, expect.objectContaining({ hotkey: "Control+Shift+H", transparent: true, rememberBounds: true, alwaysOnTop: true }));
  // No conversation named: the primary Bot's chat, and an open HUD is only brought forward.
  expect(windows.open.mock.calls[0]![1]).not.toHaveProperty("params");
  expect(windows.close).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
});

it("pops a conversation out: the open HUD loads it in place, nothing closed first, with blur behind it", async () => {
  const windows = { open: vi.fn(async (_id: string, _options?: object) => true), close: vi.fn(async (_id: string) => true) };
  expect(await showHudWindow(windows, { hudEnabled: true, hotkey: "", threadId: "thr_conv" }, screen)).toBe(true);
  expect(windows.close).not.toHaveBeenCalled();
  expect(windows.open).toHaveBeenCalledTimes(1);
  expect(windows.open).toHaveBeenCalledWith(HUD_WINDOW_ID, expect.objectContaining({ params: { threadId: "thr_conv" }, transparent: true, vibrancy: "hud", rememberBounds: true }));
  windows.open.mockClear();
  expect(await showHudWindow(windows, { hudEnabled: true, hotkey: "", threadId: "thr_other" }, screen)).toBe(true);
  expect(windows.open).toHaveBeenCalledWith(HUD_WINDOW_ID, expect.objectContaining({ params: { threadId: "thr_other" } }));
  expect(windows.close).not.toHaveBeenCalled();
  windows.open.mockClear();
  expect(await showHudWindow(windows, { hudEnabled: false, hotkey: "", threadId: "thr_conv" }, screen)).toBe(false);
  expect(windows.open).not.toHaveBeenCalled();
});

it("with the HUD off, turns nothing on and says where the switch is", async () => {
  const windows = { open: vi.fn(async () => true), close: vi.fn(async () => true) };
  expect(await showHudWindow(windows, { hudEnabled: false, hotkey: "Alt+Space" }, screen)).toBe(false);
  expect(windows.open).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(HUD_OFF_MESSAGE);
  expect(HUD_OFF_MESSAGE).toContain("Settings");
});

it("says so when BB can't open the window", async () => {
  expect(await showHudWindow({ open: vi.fn(async () => false) }, { hudEnabled: true, hotkey: "" }, screen)).toBe(false);
  expect(toast.error).toHaveBeenCalledWith("Couldn't open the HUD.");
});

it("says so when asked before Studio's bridge is up", async () => {
  expect(await showHud()).toBe(false);
  expect(toast.error).toHaveBeenCalledTimes(1);
});

it("runs a BB command, opens a web address or routes a link a plugin window sent to the main window", () => {
  const run = vi.fn();
  const openUrl = vi.fn((_url: string) => true);
  const openLink = vi.fn();
  const commands = [{ id: "app:window.new", title: "New window", group: "Window and layout", run }];
  expect(runRelayed({ command: "app:window.new" }, { commands, openUrl, openLink })).toBe(true);
  expect(run).toHaveBeenCalledTimes(1);
  expect(runRelayed({ command: "app:thread.rename" }, { commands, openUrl, openLink })).toBe(true);
  expect(toast.error).toHaveBeenCalledWith("That command isn't available in this window.");
  expect(runRelayed({ url: "https://example.com/" }, { commands, openUrl, openLink })).toBe(true);
  expect(openUrl).toHaveBeenCalledWith("https://example.com/");
  expect(runRelayed({ url: "javascript:alert(1)" }, { commands, openUrl, openLink })).toBe(false);
  expect(runRelayed({ path: "/threads/thr_1" }, { commands, openUrl, openLink })).toBe(false);
  expect(runRelayed({ link: "bb://page/pg_1", how: "secondPane" }, { commands, openUrl, openLink })).toBe(true);
  expect(openLink).toHaveBeenCalledWith("bb://page/pg_1", "secondPane");
  expect(runRelayed({ link: "bb://page/pg_1", how: "elsewhere" }, { commands, openUrl, openLink })).toBe(false);
});
