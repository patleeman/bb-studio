import { elevationAt, type Sky } from "../forest/sky";
import type { Mode } from "../schema";

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];
export type SeasonWeights = Readonly<Record<Season, number>>;

export const SEASON_BLEND_DAYS = 20;
export const DARK_BELOW = -2.5;
export const LIGHT_ABOVE = -1;
export const LIGHT_MIN_DAY = 0.85;
export const DARK_MAX_DAY = 0.42;
const YEAR_DAYS = 365.2425;
const SPRING_STARTS = 59;
const SYNODIC_DAYS = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const round = (value: number) => Math.round(value * 1000) / 1000;

export function seasonWeights(at: Date, latitude: number | null): SeasonWeights {
  const dayOfYear = (Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) - Date.UTC(at.getFullYear(), 0, 1)) / 86_400_000 + (at.getHours() + at.getMinutes() / 60) / 24;
  const shifted = dayOfYear - SPRING_STARTS + (latitude !== null && latitude < 0 ? YEAR_DAYS / 2 : 0);
  const quarter = YEAR_DAYS / 4;
  const turn = ((shifted % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS / quarter;
  const index = Math.floor(turn) % 4;
  const into = (turn - Math.floor(turn)) * quarter;
  const half = SEASON_BLEND_DAYS / 2;
  const weights = { spring: 0, summer: 0, autumn: 0, winter: 0 };
  const current = SEASONS[index]!;
  if (into < half) {
    const share = round(smooth(-half, half, into));
    weights[current] = share;
    weights[SEASONS[(index + 3) % 4]!] = round(1 - share);
  } else if (into > quarter - half) {
    const share = round(smooth(-half, half, into - quarter));
    weights[SEASONS[(index + 1) % 4]!] = share;
    weights[current] = round(1 - share);
  } else weights[current] = 1;
  return weights;
}

export function seasonOf(weights: SeasonWeights): Season {
  return SEASONS.reduce((best, each) => (weights[each] > weights[best] ? each : best));
}

export function sceneVariant(elevation: number, previous: Mode | null): Mode {
  if (previous === "light") return elevation < DARK_BELOW ? "dark" : "light";
  if (previous === "dark") return elevation > LIGHT_ABOVE ? "light" : "dark";
  return elevation >= (DARK_BELOW + LIGHT_ABOVE) / 2 ? "light" : "dark";
}

export type GardenHour = "dawn" | "day" | "golden hour" | "dusk" | "night";

export function gardenHour(elevation: number, rising: boolean): GardenHour {
  if (elevation < -6) return "night";
  if (elevation < 0) return rising ? "dawn" : "dusk";
  if (elevation < 8) return rising ? "dawn" : "golden hour";
  return "day";
}

export function moonPhase(at: Date): number {
  const turns = (at.getTime() - NEW_MOON) / 86_400_000 / SYNODIC_DAYS;
  return round(turns - Math.floor(turns));
}

export interface KyotoUniforms {
  u_season: [number, number, number, number];
  u_sky: [number, number, number, number];
  u_weather: [number, number, number];
}

export interface GardenReading { elevation: number; rising: boolean; hour: GardenHour; season: Season; weights: SeasonWeights; mode: Mode; uniforms: KyotoUniforms }
export interface GardenOptions { liveWeather?: boolean; previous?: Mode | null }

export function readGarden(at: Date, sky: Sky | null, options: GardenOptions = {}): GardenReading {
  const place = sky?.place ?? null;
  const elevation = elevationAt(at, place);
  const rising = elevationAt(new Date(at.getTime() + 600_000), place) > elevation;
  const weights = seasonWeights(at, place?.latitude ?? null);
  const weather = options.liveWeather === false ? null : sky?.weather ?? null;
  const mode = sceneVariant(elevation, options.previous ?? null);
  const sunlight = smooth(-6, 2, elevation);
  const day = mode === "light" ? Math.max(sunlight, LIGHT_MIN_DAY) : Math.min(sunlight, DARK_MAX_DAY);
  const gold = Math.exp(-(((elevation - 2) / 6) ** 2));
  const dawnMist = rising ? Math.exp(-(((elevation - 1) / 7) ** 2)) * 0.8 : 0;
  return {
    elevation: Math.round(elevation * 10) / 10,
    rising,
    hour: gardenHour(elevation, rising),
    season: seasonOf(weights),
    weights,
    mode,
    uniforms: {
      u_season: [weights.spring, weights.summer, weights.autumn, weights.winter],
      u_sky: [round(day), round(gold), round(Math.min(1, Math.max(dawnMist, weather?.fog ?? 0))), moonPhase(at)],
      u_weather: [weather ? weather.cloud : 0.25, weather ? weather.rain : 0, weather ? weather.snow : 0],
    },
  };
}
