// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BotThreadInfo } from "../../bot-threads-contract";

const state = vi.hoisted(() => ({
  showHud: vi.fn(async (_threadId?: string) => true),
  settings: { hudEnabled: true } as { hudEnabled: boolean } | null,
  hostWindows: true,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null }));
vi.mock("./HudBridge", () => ({ showHud: state.showHud }));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: state.settings }) }));
vi.mock("../../ui/live", () => ({ useCall: () => vi.fn() }));
vi.mock("../../ui/thread-header", () => ({ useThreadLookup: () => new Map() }));
vi.mock("../../kit/app/windows", async (original) => ({
  ...(await original<typeof import("../../kit/app/windows")>()),
  get hasHostWindows() { return state.hostWindows; },
}));

import { canPopOut, PopOutHudButton, popOutHudThreadAction, useCanPopOutToHud } from "./pop-out";

let root: Root;
let host: HTMLDivElement;
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.showHud.mockClear();
  state.settings = { hudEnabled: true };
  state.hostWindows = true;
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

const info = (kind: BotThreadInfo["kind"]) => ({ kind }) as BotThreadInfo;
const item = (threadId: string, infos: Map<string, BotThreadInfo | null>, enabled = true) =>
  popOutHudThreadAction.item({ thread: { id: threadId } as never, data: { enabled, infos }, sdk: null as never, navigate: null as never, experimental_panel: null as never });

it("offers Pop out to HUD in a conversation's thread menus, which opens the HUD on that conversation", async () => {
  expect(popOutHudThreadAction.placement ?? "menu").toBe("menu");
  const infos = new Map<string, BotThreadInfo | null>([["conv", info("conversation")], ["plain", null], ["w1", info("worker")]]);
  const action = item("conv", infos)!;
  expect(action).toMatchObject({ label: "Pop out to HUD", icon: "AppWindow" });
  await action.run({} as never);
  expect(state.showHud).toHaveBeenCalledWith("conv");
  // A thread no Bot has is a conversation too; a worker is not, and a thread still loading shows nothing yet.
  expect(item("plain", infos)).not.toBeNull();
  expect(item("w1", infos)).toBeNull();
  expect(item("unknown", infos)).toBeNull();
  // With the HUD off or no plugin windows, no row.
  expect(item("conv", infos, false)).toBeNull();
  expect(canPopOut(undefined)).toBe(false);
});

it("the header icon opens the HUD on its thread", async () => {
  await act(async () => { root.render(<PopOutHudButton threadId="thr_conv" />); });
  const button = $('[data-testid="hud-pop-out"]')!;
  expect(button.getAttribute("aria-label")).toBe("Pop out to HUD");
  expect(button.className).toContain("text-muted-foreground");
  await act(async () => { button.click(); });
  expect(state.showHud).toHaveBeenCalledWith("thr_conv");
});

function Probe() {
  return <span data-testid="can">{String(useCanPopOutToHud())}</span>;
}

it("pops out only from BB's main window, on a BB with plugin windows, with the HUD on", async () => {
  const can = async () => { await act(async () => { root.render(<Probe />); }); return $('[data-testid="can"]')?.textContent; };
  window.history.replaceState({}, "", "/threads/thr_conv");
  expect(await can()).toBe("true");
  state.settings = { hudEnabled: false };
  expect(await can()).toBe("false");
  state.settings = null;
  expect(await can()).toBe("false");
  state.settings = { hudEnabled: true };
  window.history.replaceState({}, "", "/fork-window/studio/hud");
  expect(await can()).toBe("false");
  window.history.replaceState({}, "", "/threads/thr_conv");
  state.hostWindows = false;
  expect(await can()).toBe("false");
});
