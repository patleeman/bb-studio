import { describe, expect, it } from "vitest";
import { dayPhase, forestUniforms, readSky, sunElevation, weatherFromCode, type Sky } from "./sky";

const NEW_YORK = { name: "New York", latitude: 40.7, longitude: -74, source: "time zone" as const };
const utc = (iso: string) => new Date(`${iso}Z`);
const sky = (code: number, cloud: number | null = null): Sky => ({ place: NEW_YORK, weather: weatherFromCode(code, cloud, 12, 0) });

describe("the sun's elevation", () => {
  it("is 90° minus latitude plus declination at solar noon on the June solstice, and its mirror at midnight in December", () => {
    expect(sunElevation(utc("2026-06-21T16:57:00"), 40.7, -74)).toBeCloseTo(72.7, 0);
    expect(sunElevation(utc("2026-12-21T04:54:00"), 40.7, -74)).toBeCloseTo(-72.7, 0);
    expect(sunElevation(utc("2026-03-20T12:07:00"), 0, 0)).toBeGreaterThan(89);
  });

  it("crosses the horizon at sunrise and sunset", () => {
    expect(sunElevation(utc("2026-06-21T09:25:00"), 40.7, -74)).toBeGreaterThan(-2);
    expect(sunElevation(utc("2026-06-21T09:25:00"), 40.7, -74)).toBeLessThan(1);
    expect(sunElevation(utc("2026-06-22T00:31:00"), 40.7, -74)).toBeGreaterThan(-2);
    expect(sunElevation(utc("2026-06-22T00:31:00"), 40.7, -74)).toBeLessThan(1);
  });
});

describe("the time of day", () => {
  it("is dawn while the sun rises through the horizon band, dusk while it sets, day above it and night below", () => {
    expect(dayPhase(10, true)).toBe("day");
    expect(dayPhase(2, true)).toBe("dawn");
    expect(dayPhase(2, false)).toBe("dusk");
    expect(dayPhase(-12, false)).toBe("night");
  });

  it("follows the place's sun when there is one", () => {
    expect(readSky(utc("2026-06-21T09:30:00"), sky(0))).toMatchObject({ phase: "dawn", weather: "clear" });
    expect(readSky(utc("2026-06-21T16:57:00"), sky(0))).toMatchObject({ phase: "day" });
    expect(readSky(utc("2026-06-22T00:40:00"), sky(0))).toMatchObject({ phase: "dusk" });
    expect(readSky(utc("2026-06-22T05:00:00"), sky(0))).toMatchObject({ phase: "night" });
  });

  it("follows the computer's clock, with sunrise at 6:30 and sunset at 18:30, when there is no place", () => {
    const local = (hours: number, minutes = 0) => new Date(2026, 5, 21, hours, minutes);
    expect(readSky(local(6, 40), null).phase).toBe("dawn");
    expect(readSky(local(12, 30), null).phase).toBe("day");
    expect(readSky(local(18, 40), null).phase).toBe("dusk");
    expect(readSky(local(2), null).phase).toBe("night");
  });
});

describe("the weather", () => {
  it("maps Open-Meteo's WMO weather codes to clear, cloud, fog, rain and snow with an amount", () => {
    expect(weatherFromCode(0, 5, 20, 1)).toEqual({ kind: "clear", code: 0, cloud: 0.05, rain: 0, snow: 0, fog: 0, temperature: 20, observedAt: 1 });
    expect(weatherFromCode(3, null, null, 1)).toMatchObject({ kind: "cloud", cloud: 0.95 });
    expect(weatherFromCode(2, 80, null, 1)).toMatchObject({ kind: "cloud", cloud: 0.8 });
    expect(weatherFromCode(45, null, null, 1)).toMatchObject({ kind: "fog", fog: 0.75 });
    expect(weatherFromCode(53, null, null, 1)).toMatchObject({ kind: "rain", rain: 0.4, cloud: 0.85 });
    expect(weatherFromCode(65, 100, null, 1)).toMatchObject({ kind: "rain", rain: 1, cloud: 1 });
    expect(weatherFromCode(95, null, null, 1)).toMatchObject({ kind: "rain", rain: 0.9 });
    expect(weatherFromCode(75, null, -3, 1)).toMatchObject({ kind: "snow", snow: 1, rain: 0 });
    expect(weatherFromCode(86, null, null, 1)).toMatchObject({ kind: "snow", snow: 1 });
  });
});

describe("the Forest scene's uniforms", () => {
  it("light the scene at noon, warm it at sunset and darken it at night", () => {
    const noon = forestUniforms(utc("2026-06-21T16:57:00"), sky(0, 0));
    expect(noon).toMatchObject({ u_daylight: 1, u_cloud: 0, u_rain: 0, u_snow: 0, u_fog: 0 });
    expect(noon.u_twilight).toBeLessThan(0.01);
    expect(noon.u_sunHeight).toBeGreaterThan(0.9);
    const sunset = forestUniforms(utc("2026-06-22T00:31:00"), sky(0, 0));
    expect(sunset.u_twilight).toBeGreaterThan(0.9);
    expect(sunset.u_daylight).toBeGreaterThan(0.2);
    expect(sunset.u_daylight).toBeLessThan(0.6);
    const night = forestUniforms(utc("2026-06-22T05:00:00"), sky(0, 0));
    expect(night).toMatchObject({ u_daylight: 0 });
    expect(night.u_twilight).toBeLessThan(0.05);
  });

  it("carry the weather's amounts, and a light default cloud with no weather", () => {
    expect(forestUniforms(utc("2026-06-21T16:57:00"), sky(63))).toMatchObject({ u_rain: 0.75, u_cloud: 0.85, u_snow: 0 });
    expect(forestUniforms(utc("2026-06-21T16:57:00"), sky(73))).toMatchObject({ u_snow: 0.7, u_rain: 0 });
    expect(forestUniforms(utc("2026-06-21T16:57:00"), sky(48))).toMatchObject({ u_fog: 0.9 });
    expect(forestUniforms(utc("2026-06-21T16:57:00"), { place: NEW_YORK, weather: null })).toMatchObject({ u_cloud: 0.25, u_rain: 0, u_snow: 0, u_fog: 0 });
  });
});
