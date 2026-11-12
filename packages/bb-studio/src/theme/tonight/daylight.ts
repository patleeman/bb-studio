import type { Mode } from "../schema";

export type SkyPhase = "night" | "astronomical twilight" | "nautical twilight" | "civil twilight" | "golden hour" | "day";

export const ASTRONOMICAL_DUSK = -18;
export const NAUTICAL_DUSK = -12;
export const CIVIL_DUSK = -6;
export const SUN_ON_HORIZON = -0.833;
export const GOLDEN_HOUR_TOP = 6;

export function skyPhase(sunAltitude: number): SkyPhase {
  if (sunAltitude < ASTRONOMICAL_DUSK) return "night";
  if (sunAltitude < NAUTICAL_DUSK) return "astronomical twilight";
  if (sunAltitude < CIVIL_DUSK) return "nautical twilight";
  if (sunAltitude < SUN_ON_HORIZON) return "civil twilight";
  if (sunAltitude < GOLDEN_HOUR_TOP) return "golden hour";
  return "day";
}

export const DARK_BELOW = -4.5;
export const LIGHT_ABOVE = -3.5;

export function skyVariant(sunAltitude: number, previous: Mode | null): Mode {
  if (previous === "light") return sunAltitude < DARK_BELOW ? "dark" : "light";
  if (previous === "dark") return sunAltitude > LIGHT_ABOVE ? "light" : "dark";
  return sunAltitude >= (DARK_BELOW + LIGHT_ABOVE) / 2 ? "light" : "dark";
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const round = (value: number) => Math.round(value * 1000) / 1000;

export interface SkyLight { day: number; glow: number; lit: number; daylight: number }

export function skyLight(sunAltitude: number): SkyLight {
  return {
    day: round(smooth(-7, 9, sunAltitude)),
    glow: round(smooth(-14, -5, sunAltitude) * (1 - 0.88 * smooth(1, 16, sunAltitude))),
    lit: round(smooth(-16, -5, sunAltitude)),
    daylight: round(smooth(-9, 1, sunAltitude)),
  };
}

export interface SkyInk { line: number; lineWidth: number; star: number; glow: number; label: number; faintest: number; white: number }

export const NIGHT_INK: SkyInk = { line: 0.3, lineWidth: 1, star: 1, glow: 1, label: 0.52, faintest: 7, white: 0 };
export const DAY_INK: SkyInk = { line: 0.2, lineWidth: 0.75, star: 0.5, glow: 0.12, label: 0.34, faintest: 3.8, white: 1 };

export function skyInk(daylight: number): SkyInk {
  const t = Math.min(1, Math.max(0, daylight));
  const mix = (key: keyof SkyInk) => round(NIGHT_INK[key] + (DAY_INK[key] - NIGHT_INK[key]) * t);
  return { line: mix("line"), lineWidth: mix("lineWidth"), star: mix("star"), glow: mix("glow"), label: mix("label"), faintest: mix("faintest"), white: mix("white") };
}
