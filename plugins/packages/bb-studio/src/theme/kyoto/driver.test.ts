import { describe, expect, it } from "vitest";
import { weatherFromCode, type Sky } from "../forest/sky";
import type { LiveUniforms } from "../scene/live";
import type { Mode } from "../schema";
import { FADE_STEP_MS, FADE_STEPS, GARDEN_PREVIEW_MS, GARDEN_TICK_MS, GARDEN_WEATHER_MS, kyotoDriver, mixUniforms, uniformGap } from "./driver";
import { LIGHT_MIN_DAY, readGarden } from "./scene";

const KYOTO = { name: "Kyoto, Japan", latitude: 35, longitude: 135.8, source: "city" as const };

function harness(options: { at: string; sky?: Sky; preview?: number | null }) {
  let clock = Date.parse(options.at);
  let preview = options.preview ?? null;
  let sky = options.sky ?? { place: KYOTO, weather: null };
  const timers = new Map<number, () => void>();
  const published: { uniforms: LiveUniforms; mode: Mode | undefined }[] = [];
  const driver = kyotoDriver({
    createCanvas: () => null,
    loadSky: async () => sky,
    loadPreview: async () => preview,
    now: () => clock,
    timeZone: () => "Asia/Tokyo",
    every: (ms, run) => { timers.set(ms, run); return () => timers.delete(ms); },
  });
  const stop = driver((uniforms, _layer, mode) => published.push({ uniforms, mode }));
  return {
    published, timers, stop,
    setClock: (iso: string) => { clock = Date.parse(iso); },
    advance: (ms: number) => { clock += ms; },
    setPreview: (at: number | null) => { preview = at; },
    setSky: (next: Sky) => { sky = next; },
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
    fade: () => { for (let step = 0; step < FADE_STEPS; step += 1) timers.get(FADE_STEP_MS)?.(); },
  };
}

describe("the Kyoto Garden scene's driver", () => {
  it("publishes the season, the light and its variant at once, then follows the clock", async () => {
    const run = harness({ at: "2026-11-11T03:00:00Z" });
    expect(run.published).toHaveLength(1);
    expect(Object.keys(run.published[0]!.uniforms).sort()).toEqual(["u_season", "u_sky", "u_weather"]);
    expect(["light", "dark"]).toContain(run.published[0]!.mode);
    await run.settle();
    run.fade();
    expect(run.published.at(-1)).toMatchObject({ mode: "light", uniforms: { u_season: [0, 0, 1, 0], u_weather: [0.25, 0, 0] } });
    const before = run.published.length;
    run.timers.get(GARDEN_TICK_MS)!();
    expect(run.published).toHaveLength(before);
    run.setClock("2026-11-11T03:40:00Z");
    run.timers.get(GARDEN_TICK_MS)!();
    expect(run.published.length).toBeGreaterThan(before);
    expect([...run.timers.keys()].sort((a, b) => a - b)).toEqual([GARDEN_PREVIEW_MS, GARDEN_TICK_MS, GARDEN_WEATHER_MS]);
    run.stop();
    expect(run.timers.size).toBe(0);
  });

  it("turns dark once at dusk, halfway through the fade of the scene's light", async () => {
    const run = harness({ at: "2026-11-11T07:30:00Z" });
    await run.settle();
    run.fade();
    expect(run.published.at(-1)!.mode).toBe("light");
    run.setClock("2026-11-11T08:01:00Z");
    run.timers.get(GARDEN_TICK_MS)!();
    run.fade();
    expect(run.published.at(-1)).toMatchObject({ mode: "light", uniforms: { u_sky: [LIGHT_MIN_DAY, expect.any(Number), 0, expect.any(Number)] } });
    run.setClock("2026-11-11T08:08:00Z");
    run.timers.get(GARDEN_TICK_MS)!();
    const first = run.published.length - 1;
    const turned = run.published.at(-1)!;
    expect(turned.mode).toBe("light");
    expect((turned.uniforms.u_sky as number[])[0]).toBe(LIGHT_MIN_DAY);
    expect(run.timers.has(FADE_STEP_MS)).toBe(true);
    for (let step = 0; step < FADE_STEPS / 2 - 1; step += 1) run.timers.get(FADE_STEP_MS)!();
    expect(run.published.at(-1)!.mode).toBe("light");
    run.timers.get(FADE_STEP_MS)!();
    expect(run.published.at(-1)!.mode).toBe("dark");
    const mid = (run.published.at(-1)!.uniforms.u_sky as number[])[0]!;
    run.fade();
    const settled = (run.published.at(-1)!.uniforms.u_sky as number[])[0]!;
    expect(mid).toBeLessThan(LIGHT_MIN_DAY);
    expect(mid).toBeGreaterThan(settled);
    expect(settled).toBeLessThan(0.45);
    expect(run.timers.has(FADE_STEP_MS)).toBe(false);
    expect(run.published.every((each, index) => index === 0 || each.mode !== undefined)).toBe(true);
    const modes = run.published.slice(first).map((each) => each.mode);
    expect(modes.indexOf("dark")).toBe(FADE_STEPS / 2);
    expect(modes.slice(FADE_STEPS / 2).every((each) => each === "dark")).toBe(true);
    run.setClock("2026-11-11T08:09:00Z");
    run.timers.get(GARDEN_TICK_MS)!();
    expect(run.published.at(-1)!.mode).toBe("dark");
    run.stop();
  });

  it("finishes the fade by the clock when its timer is throttled, the variant with it", async () => {
    const run = harness({ at: "2026-11-11T07:30:00Z" });
    await run.settle();
    run.fade();
    run.setClock("2026-11-11T08:08:00Z");
    run.timers.get(GARDEN_TICK_MS)!();
    expect(run.published.at(-1)!.mode).toBe("light");
    run.advance(1000);
    run.timers.get(FADE_STEP_MS)!();
    expect(run.published.at(-1)!.mode).toBe("dark");
    expect((run.published.at(-1)!.uniforms.u_sky as number[])[0]).toBeLessThan(LIGHT_MIN_DAY);
    expect(run.timers.has(FADE_STEP_MS)).toBe(true);
    run.advance(1000);
    run.timers.get(FADE_STEP_MS)!();
    expect(run.timers.has(FADE_STEP_MS)).toBe(false);
    expect(run.published.at(-1)!.uniforms).toEqual(readGarden(new Date("2026-11-11T08:08:00Z"), { place: KYOTO, weather: null }, { liveWeather: true, previous: "dark" }).uniforms);
    run.stop();
  });

  it("shows a previewed date and time with fair weather, and returns to the clock and the live weather", async () => {
    const rain: Sky = { place: KYOTO, weather: weatherFromCode(63, 100, 14, 0) };
    const run = harness({ at: "2026-11-11T03:00:00Z", sky: rain });
    await run.settle();
    run.fade();
    expect(run.published.at(-1)!.uniforms).toMatchObject({ u_season: [0, 0, 1, 0], u_weather: [1, 0.75, 0] });
    run.setPreview(Date.parse("2026-01-20T12:30:00Z"));
    run.timers.get(GARDEN_PREVIEW_MS)!();
    await run.settle();
    expect(run.published.at(-1)!.mode).toBe("light");
    run.fade();
    expect(run.published.at(-1)).toMatchObject({ mode: "dark", uniforms: { u_season: [0, 0, 0, 1], u_weather: [0.25, 0, 0] } });
    expect(run.published.at(-1)!.uniforms).toEqual(readGarden(new Date("2026-01-20T12:30:00Z"), rain, { liveWeather: false, previous: "dark" }).uniforms);
    run.setPreview(null);
    run.timers.get(GARDEN_PREVIEW_MS)!();
    await run.settle();
    run.fade();
    expect(run.published.at(-1)).toMatchObject({ mode: "light", uniforms: { u_season: [0, 0, 1, 0], u_weather: [1, 0.75, 0] } });
    run.stop();
  });

  it("publishes nothing after it stops, and keeps running when the weather can't be read", async () => {
    let clock = Date.parse("2026-11-11T03:00:00Z");
    const timers = new Map<number, () => void>();
    const published: LiveUniforms[] = [];
    const stop = kyotoDriver({
      createCanvas: () => null,
      loadSky: async () => { throw new Error("offline"); },
      loadPreview: async () => { throw new Error("offline"); },
      now: () => clock,
      timeZone: () => null,
      every: (ms, run) => { timers.set(ms, run); return () => timers.delete(ms); },
    })((uniforms) => published.push(uniforms));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(published).toHaveLength(1);
    const tick = timers.get(GARDEN_TICK_MS)!;
    stop();
    clock = Date.parse("2026-11-11T12:00:00Z");
    tick();
    expect(published).toHaveLength(1);
  });

  it("mixes two readings component by component", () => {
    const from = readGarden(new Date("2026-11-11T03:00:00Z"), null).uniforms;
    const to = readGarden(new Date("2026-01-20T12:30:00Z"), null).uniforms;
    expect(uniformGap(from, from)).toBe(0);
    expect(uniformGap(from, to)).toBe(1);
    expect(mixUniforms(from, to, 0)).toEqual(from);
    expect(mixUniforms(from, to, 1)).toEqual(to);
    expect(mixUniforms(from, to, 0.5).u_season).toEqual([0, 0, 0.5, 0.5]);
  });
});
