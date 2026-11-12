// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ spaces: null as unknown }));
vi.mock("../../ui/live", () => ({
  useLive: (method: string) => ({ data: method === "bot_spaces" ? state.spaces : method === "themes_list" ? { themes: [] } : null, error: null, loading: false, refresh: () => {} }),
  useCall: () => async () => ({}),
}));
vi.mock("./GpuBridge", () => ({ ThemeGpuBridge: () => null }));

import { resetSidebarState, setCurrentBot } from "../../ui/conversations/state";
import { defaultAppearance } from "../appearance";
import { NORD } from "../builtin/classic";
import { GRID } from "../builtin/grid";
import { setAppearanceDraft } from "./state";
import { ThemeLayer } from "./ThemeLayer";

let clock = 0;
let frames: FrameRequestCallback[] = [];
let root: Root;
let host: HTMLDivElement;
const html = () => document.documentElement;
const bot = (id: string, appearance: unknown) => ({ id, name: id, avatar: "🤖", shape: null, color: null, avatarImageUrl: null, primary: id === "cos", mainThreadId: null, needsYou: false, theme: null, appearance });
function advance(ms: number) {
  for (let spent = 0; spent < ms; spent += 16) {
    clock += 16;
    const due = frames;
    frames = [];
    act(() => { for (const callback of due) callback(clock); });
  }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { frames = []; });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  html().classList.add("dark");
  state.spaces = { currentBotId: "cos", bots: [bot("cos", defaultAppearance(GRID)), bot("home", defaultAppearance(NORD)), bot("plain", null)] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetSidebarState();
  setAppearanceDraft("cos", null, false);
  html().classList.remove("dark");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clock = 0;
  frames = [];
});

it("in the HUD, recolors the window itself from the shown Bot's theme, crossfading on a switch, with no scene", () => {
  act(() => root.render(<ThemeLayer surface="hud" />));
  expect(html().getAttribute("data-studio-theme")).toBe("grid");
  expect(html().style.getPropertyValue("color-scheme")).toBe("dark");
  expect(document.querySelector("[data-studio-scene-layer]")).toBeNull();
  const gridCanvas = html().style.getPropertyValue("--canvas");
  expect(gridCanvas).toMatch(/^oklch\(/);

  act(() => setCurrentBot("home"));
  expect(html().getAttribute("data-studio-theme")).toBe("nord");
  expect(html().hasAttribute("data-studio-crossfade")).toBe(true);
  advance(176);
  const middle = html().style.getPropertyValue("--canvas");
  expect(middle).not.toBe(gridCanvas);
  advance(800);
  expect(html().hasAttribute("data-studio-crossfade")).toBe(false);
  expect(html().style.getPropertyValue("--canvas")).not.toBe(middle);

  act(() => setCurrentBot("plain"));
  expect(html().hasAttribute("data-studio-theme")).toBe(false);
  expect(html().style.getPropertyValue("--canvas")).toBe("");
});

it("in the HUD, previews Edit space's draft for the Bot being edited", () => {
  state.spaces = { currentBotId: "cos", bots: [bot("cos", null)] };
  act(() => root.render(<ThemeLayer surface="hud" />));
  expect(html().hasAttribute("data-studio-theme")).toBe(false);
  act(() => setAppearanceDraft("cos", defaultAppearance(NORD)));
  expect(html().getAttribute("data-studio-theme")).toBe("nord");
  act(() => setAppearanceDraft("cos", null, false));
  expect(html().hasAttribute("data-studio-theme")).toBe(false);
});

it("in the main window, leaves the page alone: the backdrop themes it", () => {
  act(() => root.render(<ThemeLayer />));
  advance(64);
  expect(html().hasAttribute("data-studio-theme")).toBe(false);
  expect(html().getAttribute("style") ?? "").toBe("");
  expect(document.querySelector("[data-studio-scene-layer]")).toBeNull();
});
