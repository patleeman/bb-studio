import { describe, expect, it } from "vitest";
import { weatherFromCode, type Sky } from "../forest/sky";
import { DARK_BELOW, DARK_MAX_DAY, gardenHour, LIGHT_ABOVE, LIGHT_MIN_DAY, moonPhase, readGarden, sceneVariant, seasonOf, seasonWeights } from "./scene";

const KYOTO = { name: "Kyoto, Japan", latitude: 35, longitude: 135.8, source: "city" as const };
const SYDNEY = { name: "Sydney, Australia", latitude: -33.9, longitude: 151.2, source: "city" as const };
const fair = (place: Sky["place"]): Sky => ({ place, weather: null });

describe("the garden's season", () => {
  it("comes from the date: spring from March, summer from June, autumn from September, winter from December", () => {
    expect(seasonOf(seasonWeights(new Date(2026, 3, 3, 12), 35))).toBe("spring");
    expect(seasonOf(seasonWeights(new Date(2026, 6, 11, 12), 35))).toBe("summer");
    expect(seasonOf(seasonWeights(new Date(2026, 10, 11, 12), 35))).toBe("autumn");
    expect(seasonOf(seasonWeights(new Date(2026, 0, 20, 12), 35))).toBe("winter");
    expect(seasonWeights(new Date(2026, 10, 11, 12), 35)).toEqual({ spring: 0, summer: 0, autumn: 1, winter: 0 });
  });

  it("is half a year ahead below the equator, and northern with no place", () => {
    expect(seasonOf(seasonWeights(new Date(2026, 3, 3, 12), -33.9))).toBe("autumn");
    expect(seasonOf(seasonWeights(new Date(2026, 0, 20, 12), -33.9))).toBe("summer");
    expect(seasonOf(seasonWeights(new Date(2026, 0, 20, 12), null))).toBe("winter");
    expect(readGarden(new Date("2026-04-03T03:00:00Z"), fair(SYDNEY)).season).toBe("autumn");
    expect(readGarden(new Date("2026-04-03T03:00:00Z"), fair(KYOTO)).season).toBe("spring");
  });

  it("blends over 20 days across a boundary, and its shares always add up to 1", () => {
    const before = seasonWeights(new Date(2026, 4, 18, 12), 35);
    const early = seasonWeights(new Date(2026, 4, 26, 12), 35);
    const turn = seasonWeights(new Date(2026, 4, 31, 12), 35);
    const late = seasonWeights(new Date(2026, 5, 5, 12), 35);
    const after = seasonWeights(new Date(2026, 5, 14, 12), 35);
    expect(before).toEqual({ spring: 1, summer: 0, autumn: 0, winter: 0 });
    expect(after).toEqual({ spring: 0, summer: 1, autumn: 0, winter: 0 });
    expect(early.summer).toBeGreaterThan(0.05);
    expect(early.summer).toBeLessThan(0.3);
    expect(turn.summer).toBeGreaterThan(0.4);
    expect(turn.summer).toBeLessThan(0.6);
    expect(late.summer).toBeGreaterThan(early.spring - 0.25);
    expect(late.spring).toBeLessThan(0.3);
    for (let day = 0; day < 366; day += 3) {
      const weights = seasonWeights(new Date(2026, 0, 1 + day, 9), day % 2 ? 35 : -35);
      expect(weights.spring + weights.summer + weights.autumn + weights.winter).toBeCloseTo(1, 2);
    }
    const yearEnd = seasonWeights(new Date(2026, 11, 31, 23, 59), 35);
    const yearStart = seasonWeights(new Date(2027, 0, 1, 0, 1), 35);
    expect(yearEnd).toEqual(yearStart);
  });
});

describe("the garden's variant", () => {
  it("is light while the Sun is up or just under the horizon, and dark below", () => {
    expect(sceneVariant(40, null)).toBe("light");
    expect(sceneVariant(0, null)).toBe("light");
    expect(sceneVariant(-1.5, null)).toBe("light");
    expect(sceneVariant(-2, null)).toBe("dark");
    expect(sceneVariant(-30, null)).toBe("dark");
  });

  it("holds its variant inside the band, so it turns once at dusk and once at dawn", () => {
    expect(DARK_BELOW).toBeLessThan(LIGHT_ABOVE);
    expect(sceneVariant(-2, "light")).toBe("light");
    expect(sceneVariant(DARK_BELOW - 0.1, "light")).toBe("dark");
    expect(sceneVariant(-2, "dark")).toBe("dark");
    expect(sceneVariant(LIGHT_ABOVE + 0.1, "dark")).toBe("light");
    let mode = sceneVariant(5, null);
    const turns: string[] = [];
    for (const elevation of [3, 0, -1.2, -2.4, -1.4, -2.4, -2.6, -2.2, -1.2, -2.2, -0.9, -1.4, 2]) {
      const next = sceneVariant(elevation, mode);
      if (next !== mode) turns.push(`${elevation} ${next}`);
      mode = next;
    }
    expect(turns).toEqual(["-2.6 dark", "-0.9 light"]);
  });

  it("keeps the scene bright enough for the light variant and dim enough for the dark one", () => {
    const noon = readGarden(new Date("2026-11-11T03:00:00Z"), fair(KYOTO));
    expect(noon).toMatchObject({ mode: "light", hour: "day", season: "autumn" });
    expect(noon.uniforms.u_sky[0]).toBe(1);
    const night = readGarden(new Date("2026-11-11T12:30:00Z"), fair(KYOTO));
    expect(night).toMatchObject({ mode: "dark", hour: "night" });
    expect(night.uniforms.u_sky[0]).toBe(0);
    const dusk = new Date("2026-11-11T08:01:00Z");
    const stillLight = readGarden(dusk, fair(KYOTO), { previous: "light" });
    const alreadyDark = readGarden(dusk, fair(KYOTO), { previous: "dark" });
    expect(stillLight.elevation).toBeLessThan(LIGHT_ABOVE);
    expect(stillLight.elevation).toBeGreaterThan(DARK_BELOW);
    expect(stillLight.mode).toBe("light");
    expect(stillLight.uniforms.u_sky[0]).toBe(LIGHT_MIN_DAY);
    expect(alreadyDark.mode).toBe("dark");
    expect(alreadyDark.uniforms.u_sky[0]).toBeLessThanOrEqual(DARK_MAX_DAY);
  });
});

describe("the garden's time of day and weather", () => {
  it("names dawn, day, golden hour, dusk and night from the Sun's height and direction", () => {
    expect(gardenHour(30, true)).toBe("day");
    expect(gardenHour(4, true)).toBe("dawn");
    expect(gardenHour(-3, true)).toBe("dawn");
    expect(gardenHour(4, false)).toBe("golden hour");
    expect(gardenHour(-3, false)).toBe("dusk");
    expect(gardenHour(-12, false)).toBe("night");
    expect(readGarden(new Date("2026-11-10T21:45:00Z"), fair(KYOTO))).toMatchObject({ hour: "dawn", rising: true, mode: "light" });
    expect(readGarden(new Date("2026-11-11T07:30:00Z"), fair(KYOTO))).toMatchObject({ hour: "golden hour", rising: false, mode: "light" });
  });

  it("raises mist at dawn and not at dusk, and warms the light when the Sun is low", () => {
    const dawn = readGarden(new Date("2026-11-10T21:45:00Z"), fair(KYOTO)).uniforms.u_sky;
    const evening = readGarden(new Date("2026-11-11T07:30:00Z"), fair(KYOTO)).uniforms.u_sky;
    const noon = readGarden(new Date("2026-11-11T03:00:00Z"), fair(KYOTO)).uniforms.u_sky;
    expect(dawn[2]).toBeGreaterThan(0.5);
    expect(evening[2]).toBe(0);
    expect(evening[1]).toBeGreaterThan(0.6);
    expect(noon[1]).toBeLessThan(0.01);
  });

  it("takes cloud, rain, snow and fog from the live weather, and fair weather for a preview", () => {
    const sky: Sky = { place: KYOTO, weather: { ...weatherFromCode(63, 100, 14, 0), fog: 0.6 } };
    const noon = new Date("2026-07-11T03:00:00Z");
    expect(readGarden(noon, sky).uniforms.u_weather).toEqual([1, 0.75, 0]);
    expect(readGarden(noon, sky).uniforms.u_sky[2]).toBe(0.6);
    expect(readGarden(noon, sky, { liveWeather: false }).uniforms).toMatchObject({ u_weather: [0.25, 0, 0], u_season: [0, 1, 0, 0] });
    expect(readGarden(noon, { place: KYOTO, weather: weatherFromCode(73, 90, -2, 0) }).uniforms.u_weather[2]).toBe(0.7);
  });

  it("follows the Moon through its month", () => {
    expect(moonPhase(new Date("2026-11-24T14:53:00Z"))).toBeGreaterThan(0.47);
    expect(moonPhase(new Date("2026-11-24T14:53:00Z"))).toBeLessThan(0.53);
    expect(Math.min(moonPhase(new Date("2026-11-09T07:02:00Z")), 1 - moonPhase(new Date("2026-11-09T07:02:00Z")))).toBeLessThan(0.03);
  });
});
