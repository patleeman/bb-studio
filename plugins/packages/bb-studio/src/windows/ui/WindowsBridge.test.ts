import { beforeEach, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@get-bb/plugin-sdk/app", () => ({}));
vi.mock("../../kit/app/index", () => ({}));
vi.mock("../../links/open", () => ({ inMainWindow: () => true, useOpenLink: () => () => Promise.resolve({ via: "none", reason: "" }) }));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: undefined }) }));

import { retireOldWindows, runRelayed } from "./WindowsBridge";

beforeEach(() => { toast.mockClear(); toast.error.mockClear(); });

it("drops the windows older Studios registered: their shortcut, menu bar entry and any open one", async () => {
  const windows = { register: vi.fn(async (_id: string, _options?: object) => true), close: vi.fn(async (_id: string) => true) };
  await retireOldWindows(windows);
  expect(windows.register.mock.calls).toEqual([["hud", {}], ["hud-display", {}]]);
  expect(windows.close.mock.calls.map(([id]) => id).sort()).toEqual(["hud", "hud-display"]);
  await expect(retireOldWindows({ register: async () => { throw new Error("gone"); }, close: async () => true })).resolves.toBeUndefined();
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
