// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ spaces: null as unknown }));
vi.mock("../ui/live", () => ({
  useLive: (method: string) => ({ data: method === "bot_spaces" ? state.spaces : method === "themes_list" ? { themes: [] } : null, error: null, loading: false, refresh: () => {} }),
  useCall: () => async () => ({}),
}));
vi.mock("./ui/GpuBridge", () => ({ ThemeGpuBridge: () => null }));

import type { HostAppAppearance } from "../kit/app/host-sdk";
import { resetSidebarState, setCurrentBot } from "../ui/conversations/state";
import { defaultAppearance } from "./appearance";
import { registerThemeBackdrop, StudioScene, studioAppearance, useStudioAppearance } from "./backdrop";
import { BB_DEFAULT, NORD } from "./builtin/classic";
import { GRID } from "./builtin/grid";
import { MIAMI } from "./builtin/miami";
import { resolveLook } from "./look";
import { ThemeLayer } from "./ui/ThemeLayer";

let clock = 0;
let frames: FrameRequestCallback[] = [];
let root: Root;
let host: HTMLDivElement;
let seen: HostAppAppearance | null = null;
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
function Probe() {
  seen = useStudioAppearance();
  return null;
}
const canvas = () => seen?.tokens?.["--canvas"];

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
  html().classList.remove("dark");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clock = 0;
  frames = [];
  seen = null;
});

describe("the theme backdrop", () => {
  it("registers the scene and its appearance where bb has the slot", () => {
    const registered: unknown[] = [];
    expect(registerThemeBackdrop({ experimental_appBackdrop: (registration: unknown) => { registered.push(registration); } })).toBe(true);
    expect(registered).toEqual([{ id: "theme", component: StudioScene, useAppearance: useStudioAppearance }]);
  });

  it("lays bb out as floating glass cards for a scene theme: one gap and one radius, no edge on any surface, clear blurred glass on the sidebar, the thread's card and the header, and the densest glass on the composer and side panel", () => {
    const appearance = studioAppearance(resolveLook(GRID, defaultAppearance(GRID), "light"))!;
    expect(appearance.mode).toBe("dark");
    expect(appearance.tokens?.["--canvas"]).toMatch(/^oklch\(/);
    expect(appearance.tokens?.["--studio-glass-main"]).toBe("color-mix(in oklab, var(--canvas) 3%, transparent)");
    expect(appearance.tokens?.["--studio-blur-main"]).toBe("0px");
    expect(appearance.tokens?.["--studio-glass-transcript"]).toBe("color-mix(in oklab, var(--canvas) 16%, transparent)");
    expect(appearance.tokens?.["--studio-blur-transcript"]).toBe("6px");
    expect(appearance.tokens?.["--studio-glass-composer"]).toBe("color-mix(in oklab, var(--canvas) 48%, transparent)");
    expect(appearance.layout).toEqual({ cards: { gap: 10, radius: 8 } });
    expect(studioAppearance(resolveLook(MIAMI, defaultAppearance(MIAMI), "dark"))!.layout).toEqual(appearance.layout);
    expect(appearance.surfaces).toEqual({
      sidebar: { background: "var(--studio-glass-sidebar)", backdropFilter: "blur(var(--studio-blur-sidebar)) saturate(var(--studio-glass-saturate))" },
      main: { background: "var(--studio-glass-transcript)", backdropFilter: "blur(var(--studio-blur-transcript)) saturate(var(--studio-glass-saturate))" },
      header: { background: "var(--studio-glass-transcript)", backdropFilter: "blur(var(--studio-blur-transcript)) saturate(var(--studio-glass-saturate))" },
      composer: { background: "var(--studio-glass-composer)", backdropFilter: "blur(var(--studio-blur-composer)) saturate(var(--studio-glass-saturate))" },
      secondaryPanel: { background: "var(--studio-glass-composer)", backdropFilter: "blur(var(--studio-blur-composer)) saturate(var(--studio-glass-saturate))" },
      popover: { background: "var(--studio-glass-hud)", backdropFilter: "blur(12px) saturate(var(--studio-glass-saturate))" },
    });
    expect(appearance.tokens?.["--studio-glass-hud"]).toBe("color-mix(in oklab, var(--canvas) 72%, transparent)");
  });

  it("paints a classic theme's surfaces opaque, with bb's own light or dark where the theme has both", () => {
    const nord = studioAppearance(resolveLook(NORD, defaultAppearance(NORD), "light"))!;
    expect(nord.mode).toBe("dark");
    expect(nord.surfaces).toEqual({
      sidebar: { background: "var(--studio-glass-sidebar)" },
      main: { background: "var(--studio-glass-main)" },
      header: { background: "var(--studio-glass-transcript)" },
      composer: { background: "var(--studio-glass-composer)" },
      secondaryPanel: { background: "var(--studio-glass-composer)" },
    });
    expect(nord.layout).toBeUndefined();
    expect(nord.tokens?.["--studio-glass-main"]).toBe("color-mix(in oklab, var(--canvas) 100%, transparent)");
    expect(nord.tokens?.["--studio-glass-sidebar"]).toMatch(/^color-mix\(in oklab, oklch\([\d. ]+\) 100%, transparent\)$/);
    expect(nord.tokens?.["--studio-glass-transcript"]).toBe("color-mix(in oklab, var(--canvas) 100%, transparent)");
    expect(nord.tokens?.["--studio-glass-composer"]).toBe("color-mix(in oklab, var(--canvas) 100%, transparent)");
    const both = studioAppearance(resolveLook(BB_DEFAULT, defaultAppearance(BB_DEFAULT), "light"))!;
    expect(both).not.toHaveProperty("mode");
    expect(both.tokens?.["--canvas"]).not.toBe(studioAppearance(resolveLook(BB_DEFAULT, defaultAppearance(BB_DEFAULT), "dark"))!.tokens?.["--canvas"]);
  });

  it("asks nothing of bb without a theme", () => {
    expect(studioAppearance(null)).toBeNull();
  });

  it("draws the shown Bot's scene in its own layer and hands bb the look, crossfading both on a Bot switch", () => {
    act(() => root.render(<><StudioScene /><Probe /></>));
    const scene = host.querySelector("[data-studio-scene]")!;
    expect(scene.querySelector("[data-studio-scene-layer]")?.getAttribute("data-theme-id")).toBe("grid");
    expect(html().getAttribute("data-studio-theme")).toBe("grid");
    expect(html().getAttribute("style") ?? "").toBe("");
    expect(seen?.mode).toBe("dark");
    const grid = canvas();
    expect(grid).toMatch(/^oklch\(/);

    act(() => setCurrentBot("home"));
    expect(html().getAttribute("data-studio-theme")).toBe("nord");
    expect(html().hasAttribute("data-studio-crossfade")).toBe(true);
    advance(176);
    const middle = canvas();
    expect(middle).not.toBe(grid);
    expect(scene.querySelector("[data-studio-scene-layer]")).not.toBeNull();
    advance(800);
    expect(html().hasAttribute("data-studio-crossfade")).toBe(false);
    expect(canvas()).not.toBe(middle);
    expect(canvas()).toBe(studioAppearance(resolveLook(NORD, defaultAppearance(NORD), "dark"))!.tokens?.["--canvas"]);
    expect(scene.querySelector("[data-studio-scene-layer]")).toBeNull();

    act(() => setCurrentBot("plain"));
    expect(seen).toBeNull();
    expect(html().hasAttribute("data-studio-theme")).toBe(false);

    act(() => setCurrentBot("cos"));
    expect(seen).not.toBeNull();
    act(() => root.render(<Probe />));
    expect(seen).toBeNull();
    expect(html().hasAttribute("data-studio-theme")).toBe(false);
  });

  it("leaves the main window to bb on a bb without the slot", () => {
    expect(registerThemeBackdrop({})).toBe(false);
    act(() => root.render(<><ThemeLayer /><Probe /></>));
    advance(64);
    expect(seen).toBeNull();
    expect(html().hasAttribute("data-studio-theme")).toBe(false);
    expect(html().getAttribute("style") ?? "").toBe("");
    expect(document.querySelector("[data-studio-scene]")).toBeNull();
  });
});
