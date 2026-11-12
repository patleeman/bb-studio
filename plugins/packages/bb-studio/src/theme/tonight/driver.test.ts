import { describe, expect, it } from "vitest";
import { TONIGHTS_SKY } from "../builtin/tonights-sky";
import type { SceneLayout } from "../scene/layout";
import type { LiveUniforms, SceneLayer } from "../scene/live";
import type { TonightSettings } from "./settings";
import type { Mode } from "../schema";
import { LAPSE_SECONDS, lapseStart, MAX_LAYER_EDGE, MOTION_STEP_MS, SETTINGS_POLL_MS, SKY_TICK_MS, tonightDriver, type SkyCanvas } from "./driver";
import type { SkyContext } from "./paint";

const WHITE_PLAINS = { name: "White Plains", latitude: 41.03, longitude: -73.76, source: "city" as const };

function fakeCanvas() {
  const drawn = { arcs: 0, strokes: 0, clears: 0, texts: [] as string[] };
  const context: SkyContext = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "", font: "", textAlign: "", textBaseline: "",
    clearRect: () => { drawn.clears += 1; drawn.arcs = 0; drawn.strokes = 0; drawn.texts = []; },
    beginPath: () => {},
    arc: () => { drawn.arcs += 1; },
    fill: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => { drawn.strokes += 1; },
    fillText: (text) => { drawn.texts.push(text); },
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  const canvas: SkyCanvas = { width: 0, height: 0, getContext: () => context };
  return { canvas, drawn };
}

const at = (previewAt: number | null, view: TonightSettings["view"] = "follow") => async (): Promise<TonightSettings> => ({ place: WHITE_PLAINS, previewAt, view });

function harness(options: { settings?: (() => Promise<TonightSettings>)[]; canvas?: SkyCanvas | null; size?: { width: number; height: number; ratio: number }; reducedMotion?: boolean; layout?: SceneLayout | null } = {}) {
  let layout = options.layout ?? null;
  const layoutRuns = new Set<() => void>();
  let clock = Date.parse("2026-11-12T02:00:00Z");
  let visible = true;
  let resize = () => {};
  const timers: { ms: number; run: () => void }[] = [];
  const published: { uniforms: LiveUniforms; layer: SceneLayer | undefined; mode: Mode | undefined }[] = [];
  const zones: (string | null)[] = [];
  const fake = fakeCanvas();
  const answers = options.settings ?? [at(null)];
  let calls = 0;
  const driver = tonightDriver({
    loadSettings: (timeZone) => { zones.push(timeZone); return answers[Math.min(calls++, answers.length - 1)]!(); },
    now: () => clock,
    timeZone: () => "America/New_York",
    zoneOffsetMinutes: () => -300,
    every: (ms, run) => { const timer = { ms, run }; timers.push(timer); return () => { timers.splice(timers.indexOf(timer), 1); }; },
    size: () => options.size ?? { width: 1600, height: 1000, ratio: 2 },
    onResize: (run) => { resize = run; return () => { resize = () => {}; }; },
    visible: () => visible,
    reducedMotion: () => options.reducedMotion ?? false,
    createCanvas: () => (options.canvas === undefined ? fake.canvas : options.canvas),
  });
  const stop = driver((uniforms, layer, mode) => published.push({ uniforms, layer, mode }), { layout: () => layout, onLayout: (run) => { layoutRuns.add(run); return () => { layoutRuns.delete(run); }; } });
  return {
    published, zones, timers, stop, fake,
    tick: () => timers[0]!.run(),
    poll: () => timers[1]!.run(),
    animate: () => {
      const from = published.length;
      for (let step = 0; step < 400 && timers[2]; step += 1) timers[2].run();
      return published.slice(from);
    },
    resize: () => resize(),
    setLayout: (next: SceneLayout | null) => { layout = next; for (const run of [...layoutRuns]) run(); },
    layoutRuns,
    setClock: (iso: string) => { clock = Date.parse(iso); },
    setVisible: (next: boolean) => { visible = next; },
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

describe("the Tonight's Sky scene's driver", () => {
  it("publishes every uniform the theme declares, and a picture of the stars sized to the window", async () => {
    const run = harness();
    expect(run.published).toHaveLength(1);
    if (TONIGHTS_SKY.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    expect(Object.keys(run.published[0]!.uniforms).sort()).toEqual(Object.keys(TONIGHTS_SKY.scene.uniforms).sort());
    for (const [name, value] of Object.entries(TONIGHTS_SKY.scene.uniforms)) {
      const live = run.published[0]!.uniforms[name]!;
      expect(Array.isArray(live) ? live.length : 1, name).toBe(Array.isArray(value) ? value.length : 1);
    }
    expect(run.published[0]!.layer).toEqual({ source: run.fake.canvas, version: 1 });
    expect([run.fake.canvas.width, run.fake.canvas.height]).toEqual([3200, 2000]);
    expect(run.fake.drawn.arcs).toBeGreaterThan(300);
    expect(run.fake.drawn.strokes).toBeGreaterThan(40);
    expect(run.zones).toEqual(["America/New_York"]);
    expect(run.timers.map((timer) => timer.ms)).toEqual([SKY_TICK_MS, SETTINGS_POLL_MS]);
  });

  it("draws the place's sky once the settings arrive: Saturn labelled, constellation names in capitals", async () => {
    const run = harness();
    await run.settle();
    expect(run.published).toHaveLength(2);
    expect(run.published[1]!.layer!.version).toBe(2);
    expect(run.fake.drawn.texts).toContain("Saturn");
    expect(run.fake.drawn.texts).toContain("PERSEUS");
    expect(run.published[1]!.uniforms.u_meteors).toBe(3);
    expect((run.published[1]!.uniforms.u_moon as number[])[3]).toBe(0);
  });

  it("turns the sky with the clock, and goes to a preview time and back", async () => {
    const preview = Date.parse("2026-11-18T07:00:00Z");
    const run = harness({ settings: [at(null), at(preview), at(null)] });
    await run.settle();
    const first = run.published.at(-1)!.uniforms;
    run.setClock("2026-11-12T02:00:15Z");
    run.tick();
    const later = run.published.at(-1)!.uniforms;
    expect(later.u_galPole).not.toEqual(first.u_galPole);
    expect(run.published.at(-1)!.layer!.version).toBe(3);
    expect(run.timers).toHaveLength(2);

    run.poll();
    await run.settle();
    run.animate();
    expect(run.published.at(-1)!.uniforms.u_meteors).toBe(5);
    expect(run.fake.drawn.texts.some((text) => /^Mars · Jupiter 1\.\d°$/.test(text))).toBe(true);
    run.poll();
    await run.settle();
    run.animate();
    expect(run.published.at(-1)!.uniforms.u_meteors).toBe(3);
    const count = run.published.length;
    run.poll();
    await run.settle();
    expect(run.published).toHaveLength(count);
  });

  it("uses the time zone's longitude when no place is known or the settings fail", async () => {
    const run = harness({ settings: [async () => { throw new Error("offline"); }] });
    await run.settle();
    expect(run.published).toHaveLength(1);
    expect(run.published[0]!.layer!.version).toBe(1);
    expect(run.fake.drawn.arcs).toBeGreaterThan(300);
  });

  it("stops drawing while the window is hidden, redraws on a resize, and stops for good when the scene goes", async () => {
    const run = harness();
    await run.settle();
    const count = run.published.length;
    run.setVisible(false);
    run.tick();
    run.poll();
    await run.settle();
    expect(run.published).toHaveLength(count);
    expect(run.zones).toHaveLength(1);
    run.setVisible(true);
    run.resize();
    expect(run.published).toHaveLength(count + 1);
    run.stop();
    expect(run.timers).toEqual([]);
    run.resize();
    expect(run.published).toHaveLength(count + 1);
  });

  it("caps the picture's size on a very large window, and publishes uniforms alone without a canvas", () => {
    const big = harness({ size: { width: 5120, height: 2880, ratio: 2 } });
    expect(big.fake.canvas.width).toBe(MAX_LAYER_EDGE);
    expect(big.fake.canvas.height).toBe(2304);
    const bare = harness({ canvas: null });
    expect(bare.published).toHaveLength(1);
    expect(bare.published[0]!.layer).toBeUndefined();
    expect(bare.published[0]!.uniforms.u_view).toHaveLength(4);
  });

  it("publishes the variant: dark at night, light by day, and the Sun and daylight as uniforms", async () => {
    const night = harness();
    expect(night.published[0]!.mode).toBe("dark");
    expect(night.published[0]!.uniforms.u_light).toEqual([0, 0, 0]);
    const noon = harness({ settings: [at(Date.parse("2026-11-12T17:00:00Z"))] });
    await noon.settle();
    expect(noon.published).toHaveLength(2);
    expect(noon.published[1]!.mode).toBe("light");
    expect((noon.published[1]!.uniforms.u_light as number[])[0]).toBe(1);
    expect(noon.fake.drawn.texts).toContain("OPHIUCHUS");
    expect(noon.timers).toHaveLength(2);
  });

  it("goes to a preview time as a two-second time-lapse: the camera eases, the light changes a little each step, the variant switches once", async () => {
    const noon = Date.parse("2026-11-12T17:00:00Z");
    const run = harness({ settings: [at(null), at(noon)] });
    await run.settle();
    const before = run.published.at(-1)!;
    run.poll();
    await run.settle();
    expect(run.timers.map((timer) => timer.ms)).toEqual([SKY_TICK_MS, SETTINGS_POLL_MS, MOTION_STEP_MS]);
    expect(run.published.at(-1)!.mode).toBe("dark");
    const steps = [run.published.at(-1)!, ...run.animate()];
    expect(run.timers).toHaveLength(2);
    expect(steps.length).toBeGreaterThanOrEqual(Math.ceil((LAPSE_SECONDS * 1000) / MOTION_STEP_MS));
    expect(steps.length).toBeLessThan(200);
    const day = steps.map((step) => (step.uniforms.u_light as number[])[0]!);
    const view = steps.map((step) => step.uniforms.u_view as number[]);
    const center = steps.map((step) => step.uniforms.u_center as number);
    const pole = steps.map((step) => step.uniforms.u_galPole as number[]);
    for (let index = 1; index < steps.length; index += 1) {
      expect(day[index]! - day[index - 1]!, String(index)).toBeGreaterThanOrEqual(0);
      expect(day[index]! - day[index - 1]!, String(index)).toBeLessThan(0.25);
      expect(Math.abs(view[index]![0]! - view[index - 1]![0]!), String(index)).toBeLessThan(0.01);
      expect(Math.abs(center[index]! - center[index - 1]!), String(index)).toBeLessThan(0.02);
      expect(Math.hypot(pole[index]![0]! - pole[index - 1]![0]!, pole[index]![1]! - pole[index - 1]![1]!, pole[index]![2]! - pole[index - 1]![2]!), String(index)).toBeLessThan(0.16);
    }
    const modes = steps.map((step) => step.mode);
    expect(modes[0]).toBe("dark");
    expect(modes.at(-1)).toBe("light");
    expect(modes.filter((mode, index) => index > 0 && mode !== modes[index - 1])).toHaveLength(1);
    expect(before.uniforms.u_light).toEqual([0, 0, 0]);

    const direct = harness({ settings: [at(noon)] });
    await direct.settle();
    expect(run.published.at(-1)!.uniforms).toEqual(direct.published.at(-1)!.uniforms);
  });

  it("starts a time-lapse to another day at the same hour of the night before or after, never more than twelve hours away", () => {
    const hour = 3_600_000;
    const now = Date.parse("2026-11-12T02:00:00Z");
    expect(lapseStart(now, now + 15 * hour)).toBe(now + 24 * hour);
    expect(lapseStart(now, now + 5 * hour)).toBe(now);
    expect(lapseStart(now, now + 6 * 24 * hour + 4 * hour)).toBe(now + 6 * 24 * hour);
    expect(lapseStart(now, now - 30 * 24 * hour - 11 * hour)).toBe(now - 30 * 24 * hour);
  });

  it("eases the camera when the view setting changes, and shows the same sky as a window that started there", async () => {
    const run = harness({ settings: [at(null), at(null, "west")] });
    await run.settle();
    run.poll();
    await run.settle();
    expect(run.timers).toHaveLength(3);
    const steps = [run.published.at(-2)!, run.published.at(-1)!, ...run.animate()];
    expect(steps.length).toBeGreaterThan(30);
    for (let index = 1; index < steps.length; index += 1) {
      const a = steps[index - 1]!.uniforms.u_sun as number[], b = steps[index]!.uniforms.u_sun as number[];
      expect(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!), String(index)).toBeLessThan(0.08);
    }
    const direct = harness({ settings: [at(null, "west")] });
    await direct.settle();
    expect(run.published.at(-1)!.uniforms).toEqual(direct.published.at(-1)!.uniforms);
    expect(run.published.at(-1)!.uniforms).not.toEqual(steps[0]!.uniforms);
  });

  it("moves the Sun into the open area when the side panel opens: the camera eases over about two seconds from where it was, with no jump, and ends where a window that started there shows it", async () => {
    const afternoon = Date.parse("2026-11-12T20:30:00Z");
    const closed: SceneLayout = { width: 1600, height: 1000, sidebar: 318, panel: null };
    const open: SceneLayout = { ...closed, panel: { left: 1086, top: 10, right: 1590, bottom: 988 } };
    const run = harness({ settings: [at(afternoon)], layout: closed });
    await run.settle();
    expect(run.timers).toHaveLength(2);
    const before = run.published.at(-1)!;
    const count = run.published.length;
    run.tick();
    run.resize();
    expect(run.published.slice(count).map((step) => step.uniforms)).toEqual([before.uniforms, before.uniforms]);

    run.setLayout(open);
    expect(run.published.at(-1)!.uniforms).toEqual(before.uniforms);
    expect(run.timers.map((timer) => timer.ms)).toEqual([SKY_TICK_MS, SETTINGS_POLL_MS, MOTION_STEP_MS]);
    const steps = [run.published.at(-1)!, ...run.animate()];
    expect(run.timers).toHaveLength(2);
    const seconds = ((steps.length - 1) * MOTION_STEP_MS) / 1000;
    expect(seconds).toBeGreaterThan(1.2);
    expect(seconds).toBeLessThan(3.2);
    for (let index = 1; index < steps.length; index += 1) {
      const a = steps[index - 1]!.uniforms.u_sun as number[], b = steps[index]!.uniforms.u_sun as number[];
      expect(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!), String(index)).toBeLessThan(0.04);
      expect(Math.abs((steps[index]!.uniforms.u_center as number) - (steps[index - 1]!.uniforms.u_center as number)), String(index)).toBeLessThan(0.02);
    }
    const direct = harness({ settings: [at(afternoon)], layout: open });
    await direct.settle();
    expect(run.published.at(-1)!.uniforms).toEqual(direct.published.at(-1)!.uniforms);
    expect(run.published.at(-1)!.uniforms).not.toEqual(before.uniforms);
    run.stop();
    expect(run.layoutRuns.size).toBe(0);
  });

  it("shows a preview time at once under reduced motion", async () => {
    const run = harness({ settings: [at(null), at(Date.parse("2026-11-12T17:00:00Z"), "east")], reducedMotion: true });
    await run.settle();
    const count = run.published.length;
    run.poll();
    await run.settle();
    expect(run.published).toHaveLength(count + 1);
    expect(run.published.at(-1)!.mode).toBe("light");
    expect(run.timers).toHaveLength(2);
  });
});
