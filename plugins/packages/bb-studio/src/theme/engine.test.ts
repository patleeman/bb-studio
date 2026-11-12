// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeWebGl, type FakeGl } from "../test/fake-webgl";
import { defaultAppearance } from "./appearance";
import { DRACULA, NORD } from "./builtin/classic";
import { GRID } from "./builtin/grid";
import { ThemeEngine, type EngineDeps } from "./engine";
import { FRONT_ENVIRONMENT } from "./guards";
import type { ResolvedLook } from "./look";
import { LAYOUT_SETTLE_MS, type LayoutSample, type SceneInputs, type SceneLayout } from "./scene/layout";
import type { SceneSignals } from "./signals";

let clock = 0;
let queue: ((time: number) => void)[] = [];
let fake: FakeGl;
let engine: ThemeEngine;
let scene: HTMLDivElement;
let published: (ResolvedLook | null)[] = [];

function deps(over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    root: document.documentElement,
    host: scene,
    createContext: () => fake.gl,
    requestFrame: (callback) => { queue.push(callback); return queue.length; },
    cancelFrame: () => { queue = []; },
    now: () => clock,
    size: () => ({ width: 800, height: 500 }),
    publish: (look) => { published.push(look); },
    ...over,
  };
}
function advance(ms: number, step = 16): void {
  for (let spent = 0; spent < ms; spent += step) {
    clock += step;
    const due = queue;
    queue = [];
    for (const callback of due) callback(clock);
  }
}
const grid = (key = "cos") => ({ key: `${key}:grid`, theme: GRID, appearance: defaultAppearance(GRID) });
const signals = (over: Partial<SceneSignals>): SceneSignals => ({ botId: "cos", workers: [], conversations: [], ...over });
const root = () => document.documentElement;
const token = (name: string) => engine.snapshot().tokens[name];

beforeEach(() => {
  clock = 0;
  queue = [];
  fake = fakeWebGl();
  published = [];
  scene = document.createElement("div");
  document.body.append(scene);
  engine = new ThemeEngine(deps());
  engine.setEnvironment(FRONT_ENVIRONMENT);
});
afterEach(() => {
  engine.dispose();
  scene.remove();
  document.documentElement.removeAttribute("style");
});

describe("the theme engine", () => {
  it("gives a scene's driver the settled layout: the window, the sidebar's width and the open side panel; a page's own layout never reaches it", () => {
    let sample: LayoutSample = { width: 1600, height: 1000, sidebar: 318, panel: undefined };
    let column: { left: number; top: number; right: number; bottom: number } | null = { left: 556, top: 48, right: 1364, bottom: 988 };
    const timers: { ms: number; run: () => void }[] = [];
    const changes: (SceneLayout | null)[] = [];
    let inputs: SceneInputs | undefined;
    let stopped = 0;
    engine.dispose();
    engine = new ThemeEngine(deps({
      size: () => ({ width: 1600, height: 1000 }),
      column: () => column,
      layout: () => sample,
      every: (ms, run) => { const timer = { ms, run }; timers.push(timer); return () => { timers.splice(timers.indexOf(timer), 1); }; },
      drivers: { grid: (_publish, scene) => { inputs = scene; const stop = scene!.onLayout(() => changes.push(scene!.layout())); return () => { stop(); stopped += 1; }; } },
    }));
    engine.setEnvironment(FRONT_ENVIRONMENT);
    expect(timers).toEqual([]);
    engine.show(grid(), "dark");
    expect(timers.map((timer) => timer.ms)).toEqual([LAYOUT_SETTLE_MS]);
    expect(inputs!.layout()).toEqual({ width: 1600, height: 1000, sidebar: 318, panel: null });
    const poll = (ms: number) => { advance(ms); timers[0]!.run(); };

    for (const next of [{ left: 330, top: 48, right: 1580, bottom: 988 }, null, { left: 700, top: 120, right: 1200, bottom: 700 }]) {
      column = next;
      poll(250);
      poll(250);
    }
    expect(changes).toEqual([]);
    expect(engine.snapshot().layout).toEqual({ width: 1600, height: 1000, sidebar: 318, panel: null });

    for (const left of [1500, 1350, 1200]) { sample = { ...sample, panel: { left, top: 10, right: 1590, bottom: 988 } }; poll(80); }
    expect(changes).toEqual([]);
    sample = { ...sample, panel: { left: 1086, top: 10, right: 1590, bottom: 988 } };
    poll(250);
    expect(changes).toEqual([]);
    poll(250);
    expect(changes).toEqual([{ width: 1600, height: 1000, sidebar: 318, panel: { left: 1086, top: 10, right: 1590, bottom: 988 } }]);

    sample = { ...sample, panel: undefined };
    poll(250);
    poll(250);
    expect(changes).toHaveLength(1);
    sample = { ...sample, sidebar: 0 };
    poll(250);
    poll(250);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({ sidebar: 0, panel: { left: 1086 } });

    engine.show(null, "dark");
    advance(2000);
    expect(stopped).toBe(1);
    expect(timers).toEqual([]);
  });

  it("gives shaders the open area and the cards from the settled layout: the strip right of the column, the gap a side panel leaves, nothing when no area is wide enough", () => {
    let sample: LayoutSample = { width: 1600, height: 1000, sidebar: 320, panel: null };
    let tick: (() => void) | null = null;
    engine.dispose();
    engine = new ThemeEngine(deps({ size: () => ({ width: 1600, height: 1000 }), layout: () => sample, every: (_ms, run) => { tick = run; return () => { tick = null; }; } }));
    engine.setEnvironment(FRONT_ENVIRONMENT);
    engine.show(grid(), "dark");
    advance(32);
    const scale = engine.snapshot().scale;
    const open = () => (fake.uniform("u_open") as number[]).map((value) => Math.round(value / scale));
    const cards = () => [...(fake.uniform("u_cards")![0] as Float32Array)].map((value) => Math.round(value / scale));
    expect(open()).toEqual([1364, 0, 1600, 1000]);
    expect(cards()).toEqual([0, 12, 320, 952, 556, 12, 1364, 952, 0, 0, 0, 0]);
    sample = { ...sample, panel: { left: 1390, top: 48, right: 1590, bottom: 988 } };
    for (let i = 0; i < 3; i += 1) { clock += 250; tick!(); }
    advance(64);
    expect(open()[2]).toBeLessThan(1600);
    expect(open()[2]).toBeGreaterThan(1390);
    advance(3000);
    expect(open()).toEqual([1482, 0, 1482, 1000]);
    expect(cards().slice(8)).toEqual([1390, 12, 1590, 952]);
  });

  it("anchors the scene to the window: u_clear comes from the window's size alone, whatever the page lays out, and eases to a new spot on a resize", () => {
    let column: { left: number; top: number; right: number; bottom: number } | null = { left: 300, top: 30, right: 680, bottom: 440 };
    let size = { width: 800, height: 500 };
    engine.dispose();
    engine = new ThemeEngine(deps({ column: () => column, size: () => size }));
    engine.setEnvironment(FRONT_ENVIRONMENT);
    engine.show(grid(), "dark");
    advance(32);
    const anchored = fake.uniform("u_clear") as number[];
    column = { left: 100, top: 30, right: 480, bottom: 440 };
    advance(600);
    expect(fake.uniform("u_clear")).toEqual(anchored);
    column = null;
    advance(600);
    expect(fake.uniform("u_clear")).toEqual(anchored);
    size = { width: 1600, height: 1000 };
    advance(300);
    const easing = fake.uniform("u_clear") as number[];
    advance(3000);
    const settled = fake.uniform("u_clear") as number[];
    expect(settled).not.toEqual(anchored);
    expect(Math.abs(easing[2]! - settled[2]!)).toBeGreaterThan(0);
  });

  it("draws its scene in the host it is given and hands the look to bb instead of writing it on the page", () => {
    engine.show(grid(), "dark");
    expect(root().getAttribute("data-studio-theme")).toBe("grid");
    expect(root().getAttribute("data-studio-effects")).toBe("workers finished needs-you error");
    expect(root().hasAttribute("data-studio-glass")).toBe(true);
    expect(published.at(-1)?.themeId).toBe("grid");
    expect(token("--canvas")).toMatch(/^oklch\(/);
    expect(token("--studio-glass-sidebar")).toMatch(/^color-mix\(in oklab, oklch\([\d. ]+\) 14%, transparent\)$/);
    expect(root().getAttribute("style") ?? "").toBe("");
    expect(document.getElementById("studio-theme-style")?.textContent).toContain("[data-studio-scene]");
    expect(document.getElementById("studio-theme-style")?.textContent).not.toContain("#root");
    expect(scene.querySelector("[data-studio-scene-layer] canvas")).not.toBeNull();
    advance(48);
    expect(fake.draws()).toBeGreaterThan(0);
    expect(fake.uniform("u_horizon")).toEqual([0.42]);
    expect(fake.uniform("u_resolution")).toEqual([800, 500]);
  });

  it("crossfades the colors and the scene when the shown Bot changes theme", () => {
    engine.show({ key: "home:nord", theme: NORD, appearance: defaultAppearance(NORD) }, "dark");
    const nord = token("--canvas");
    engine.show(grid(), "dark");
    expect(engine.snapshot().crossfading).toBe(true);
    expect(root().hasAttribute("data-studio-crossfade")).toBe(true);
    expect(engine.snapshot().layers).toEqual([{ themeId: "grid", opacity: 0, live: true }]);
    const before = published.length;
    advance(350);
    const middle = token("--canvas");
    expect(middle).not.toBe(nord);
    expect(published.length - before).toBeGreaterThan(10);
    expect(engine.snapshot().layers[0]!.opacity).toBeGreaterThan(0.3);
    expect(engine.snapshot().layers[0]!.opacity).toBeLessThan(0.7);
    advance(500);
    expect(engine.snapshot().crossfading).toBe(false);
    expect(root().hasAttribute("data-studio-crossfade")).toBe(false);
    expect(engine.snapshot().layers).toEqual([{ themeId: "grid", opacity: 1, live: true }]);
    engine.show({ key: "home:dracula", theme: DRACULA, appearance: defaultAppearance(DRACULA) }, "dark");
    advance(800);
    expect(engine.snapshot().layers).toEqual([]);
    expect(scene.childElementCount).toBe(0);
    expect(root().getAttribute("data-studio-theme")).toBe("dracula");
    expect(root().hasAttribute("data-studio-glass")).toBe(false);
    expect(published.at(-1)?.themeId).toBe("dracula");
  });

  it("changes a slider at once, without a crossfade", () => {
    engine.show(grid(), "dark");
    engine.show({ ...grid(), appearance: { ...defaultAppearance(GRID), glass: 0.9 } }, "dark");
    expect(engine.snapshot().crossfading).toBe(false);
    expect(token("--studio-glass-transcript")).toBe("color-mix(in oklab, var(--canvas) 24%, transparent)");
    expect(token("--studio-glass-main")).toBe("color-mix(in oklab, var(--canvas) 4.5%, transparent)");
  });

  it("stops drawing while the window isn't frontmost or is hidden, and picks up where it was", () => {
    engine.show(grid(), "dark");
    advance(160);
    const drawn = fake.draws();
    const time = engine.snapshot().sceneTime;
    expect(time).toBeGreaterThan(0);
    engine.setEnvironment({ ...FRONT_ENVIRONMENT, focused: false });
    advance(500);
    expect(engine.snapshot().mode).toBe("paused");
    expect(fake.draws()).toBe(drawn);
    expect(queue).toHaveLength(0);
    engine.setEnvironment({ ...FRONT_ENVIRONMENT, visible: false });
    advance(200);
    expect(fake.draws()).toBe(drawn);
    engine.setEnvironment(FRONT_ENVIRONMENT);
    advance(64);
    expect(fake.draws()).toBeGreaterThan(drawn);
    expect(engine.snapshot().sceneTime).toBeGreaterThan(time);
  });

  it("draws one still frame for reduced motion, at the theme's still time, and switches without a crossfade", () => {
    engine.setEnvironment({ ...FRONT_ENVIRONMENT, reducedMotion: true });
    engine.show({ key: "home:nord", theme: NORD, appearance: defaultAppearance(NORD) }, "dark");
    engine.show(grid(), "dark");
    expect(engine.snapshot().crossfading).toBe(false);
    expect(engine.snapshot().layers).toEqual([{ themeId: "grid", opacity: 1, live: true }]);
    advance(500);
    expect(engine.snapshot().mode).toBe("still");
    expect(fake.draws()).toBe(1);
    expect(fake.uniform("u_time")).toEqual([12]);
    expect(root().hasAttribute("data-studio-still")).toBe(true);
    expect(queue).toHaveLength(0);
  });

  it("holds a still frame when the motion slider is at 0", () => {
    engine.show({ ...grid(), appearance: { ...defaultAppearance(GRID), motion: 0 } }, "dark");
    advance(300);
    expect(engine.snapshot().mode).toBe("still");
    expect(fake.draws()).toBe(1);
  });

  it("renders at a lower resolution on battery", () => {
    engine.show(grid(), "dark");
    advance(32);
    const canvas = scene.querySelector("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([800, 500]);
    engine.setEnvironment({ ...FRONT_ENVIRONMENT, onBattery: true, batteryLevel: 0.6 });
    advance(32);
    expect([canvas.width, canvas.height]).toEqual([400, 250]);
    expect(engine.snapshot().scale).toBe(0.5);
  });

  it("shows the fallback color where WebGL is missing", () => {
    engine.dispose();
    engine = new ThemeEngine(deps({ createContext: () => null }));
    engine.show(grid(), "dark");
    const layer = document.querySelector<HTMLElement>("[data-studio-scene-layer]")!;
    expect(layer.style.background).toBe("rgb(1, 3, 5)");
    expect(layer.querySelector("canvas")).toBeNull();
    expect(engine.snapshot().layers[0]!.live).toBe(false);
  });

  it("puts running workers in the scene, ripples when one finishes or fails, and glows while one needs you", () => {
    engine.show(grid(), "dark");
    engine.setSignals(signals({ workers: [{ threadId: "w1", status: "running" }, { threadId: "w2", status: "running" }] }));
    advance(32);
    const workers = fake.uniform("u_workers") as [Float32Array];
    expect([Math.round(workers[0][0] * 1000) / 1000, workers[0][2]]).toEqual([0.137, 1]);
    expect(workers[0][1]).toBeGreaterThanOrEqual(0);
    expect(workers[0][6]).toBe(1);
    engine.setSignals(signals({ workers: [{ threadId: "w1", status: "done" }, { threadId: "w2", status: "failed" }] }));
    expect(engine.snapshot().ripples).toBe(2);
    advance(32);
    const ripples = fake.uniform("u_ripples") as [Float32Array];
    expect([ripples[0][3], ripples[0][7]]).toEqual([1, 2]);
    engine.setSignals(signals({ conversations: [{ threadId: "c1", running: false, needsYou: true }] }));
    advance(800);
    expect(engine.snapshot().needsYou).toBe(1);
    advance(8000);
    expect(engine.snapshot().ripples).toBe(0);
  });

  it("leaves the effects out when their switches are off", () => {
    engine.show({ ...grid(), appearance: { ...defaultAppearance(GRID), effects: { workers: false, finished: false, needsYou: false, error: false } } }, "dark");
    expect(root().hasAttribute("data-studio-effects")).toBe(false);
    engine.setSignals(signals({ workers: [{ threadId: "w1", status: "running" }], conversations: [{ threadId: "c1", running: false, needsYou: true }] }));
    advance(32);
    expect((fake.uniform("u_workers") as [Float32Array])[0][2]).toBe(0);
    engine.setSignals(signals({ workers: [{ threadId: "w1", status: "done" }], conversations: [{ threadId: "c1", running: false, needsYou: true }] }));
    advance(400);
    expect(engine.snapshot().ripples).toBe(0);
    expect(engine.snapshot().needsYou).toBe(0);
  });

  it("in a plugin window, recolors the page itself without a scene", () => {
    engine.dispose();
    engine = new ThemeEngine(deps({ scenes: false, publish: undefined }));
    engine.show({ key: "home:dracula", theme: DRACULA, appearance: defaultAppearance(DRACULA) }, "light");
    expect(scene.childElementCount).toBe(0);
    expect(root().style.getPropertyValue("--studio-hud-glass")).toMatch(/%$/);
    expect(root().style.getPropertyValue("--canvas")).toMatch(/^oklch\(/);
    expect(root().style.getPropertyValue("color-scheme")).toBe("dark");
    engine.show(null, "light");
    expect(root().getAttribute("style") ?? "").toBe("");
  });

  it("takes everything off when no theme is shown, and on dispose", () => {
    engine.show(grid(), "dark");
    engine.show(null, "dark");
    expect(root().hasAttribute("data-studio-theme")).toBe(false);
    expect(root().hasAttribute("data-studio-glass")).toBe(false);
    expect(published.at(-1)).toBeNull();
    expect(engine.snapshot().tokens).toEqual({});
    advance(900);
    expect(scene.childElementCount).toBe(0);
    engine.show(grid(), "dark");
    expect(published.at(-1)?.themeId).toBe("grid");
    engine.dispose();
    expect(published.at(-1)).toBeNull();
    expect(root().hasAttribute("data-studio-theme")).toBe(false);
    expect(scene.childElementCount).toBe(0);
  });
});
