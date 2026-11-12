import { expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => ({}) }));

const { hasHostWindows, hostWindowId, inHostWindow, NO_HOST_WINDOWS, registerHostWindow, useHostWindows, windowParams, windowsHookOf } = await import("./windows");

it("on a BB without windows, nothing registers and every call answers false", async () => {
  expect(hasHostWindows).toBe(false);
  expect(windowsHookOf({ useRpc() {} })).toBeNull();
  expect(registerHostWindow({ navPanel() {} }, { id: "launcher", title: "Launcher", component: () => null })).toBe(false);
  const windows = useHostWindows();
  expect(windows).toBe(NO_HOST_WINDOWS);
  expect(windows.native).toBe(false);
  expect(await Promise.all([windows.register("launcher"), windows.open("launcher"), windows.toggle("launcher"), windows.close("launcher")])).toEqual([false, false, false, false]);
});

it("on a BB with windows, reads the hook and registers through the slot", () => {
  const host = { native: true, register: vi.fn(), open: vi.fn(), toggle: vi.fn(), close: vi.fn() };
  expect(windowsHookOf({ experimental_useWindows: () => host })?.()).toBe(host);
  const seen: unknown[] = [];
  const slots = { taken: seen, experimental_window(registration: unknown) { this.taken.push(registration); } };
  const registration = { id: "launcher", title: "Launcher", component: () => null };
  expect(registerHostWindow(slots, registration)).toBe(true);
  expect(seen).toEqual([registration]);
});

it("knows a plugin window by its address and reads its params", () => {
  expect(inHostWindow("/fork-window/studio/launcher")).toBe(true);
  expect(inHostWindow("/plugins/studio/studio")).toBe(false);
  expect(hostWindowId("/fork-window/studio/item-2")).toBe("item-2");
  expect(hostWindowId("/threads/thr_1")).toBeNull();
  expect(windowParams("?kind=page&id=pg_1&bbTransparent=1")).toEqual({ kind: "page", id: "pg_1" });
  expect(windowParams("")).toEqual({});
});
