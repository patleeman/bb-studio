import { describe, expect, it } from "vitest";
import type { LiveUniforms } from "../scene/live";
import { CLOCK_TICK_MS, forestDriver, WEATHER_POLL_MS } from "./driver";
import { weatherFromCode, type Sky } from "./sky";

const NEW_YORK = { name: "New York", latitude: 40.7, longitude: -74, source: "time zone" as const };

function harness(answers: (() => Promise<Sky>)[]) {
  let clock = Date.parse("2026-06-21T16:57:00Z");
  const timers = new Map<number, () => void>();
  const zones: (string | null)[] = [];
  const published: LiveUniforms[] = [];
  let calls = 0;
  const driver = forestDriver({
    loadSky: (timeZone) => { zones.push(timeZone); return answers[Math.min(calls++, answers.length - 1)]!(); },
    now: () => clock,
    timeZone: () => "America/New_York",
    every: (ms, run) => { timers.set(ms, run); return () => timers.delete(ms); },
  });
  const stop = driver((uniforms) => published.push(uniforms));
  return { published, zones, timers, stop, setClock: (iso: string) => { clock = Date.parse(iso); }, settle: () => new Promise((resolve) => setTimeout(resolve, 0)) };
}

describe("the Forest scene's driver", () => {
  it("publishes the clock's sky at once, then the place's sun and weather when they arrive", async () => {
    const run = harness([async () => ({ place: NEW_YORK, weather: weatherFromCode(63, 100, 14, 0) })]);
    expect(run.published).toHaveLength(1);
    expect(run.zones).toEqual(["America/New_York"]);
    await run.settle();
    expect(run.published).toHaveLength(2);
    expect(run.published[1]).toMatchObject({ u_daylight: 1, u_rain: 0.75, u_cloud: 1 });
    run.stop();
  });

  it("moves with the clock every minute and asks for the weather every 15 minutes", async () => {
    const run = harness([async () => ({ place: NEW_YORK, weather: weatherFromCode(0, 0, 20, 0) }), async () => ({ place: NEW_YORK, weather: weatherFromCode(71, 90, -1, 0) })]);
    await run.settle();
    run.setClock("2026-06-22T05:00:00Z");
    run.timers.get(CLOCK_TICK_MS)!();
    expect(run.published.at(-1)).toMatchObject({ u_daylight: 0, u_snow: 0 });
    run.timers.get(WEATHER_POLL_MS)!();
    await run.settle();
    expect(run.published.at(-1)).toMatchObject({ u_daylight: 0, u_snow: 0.4 });
    const count = run.published.length;
    run.timers.get(CLOCK_TICK_MS)!();
    expect(run.published).toHaveLength(count);
    run.stop();
  });

  it("keeps the clock's sky when the weather can't be read, and stops publishing once stopped", async () => {
    let finish: (sky: Sky) => void = () => {};
    const run = harness([async () => { throw new Error("offline"); }, () => new Promise<Sky>((resolve) => { finish = resolve; })]);
    await run.settle();
    expect(run.published).toHaveLength(1);
    expect(run.published[0]).toMatchObject({ u_rain: 0, u_snow: 0, u_fog: 0 });
    run.timers.get(WEATHER_POLL_MS)!();
    run.stop();
    finish({ place: NEW_YORK, weather: weatherFromCode(65, 100, 10, 0) });
    await run.settle();
    expect(run.published).toHaveLength(1);
    expect(run.timers.size).toBe(0);
  });
});
