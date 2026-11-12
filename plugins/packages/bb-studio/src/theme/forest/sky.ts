import { z } from "zod";

export const WEATHER_KINDS = ["clear", "cloud", "fog", "rain", "snow"] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];
export type DayPhase = "dawn" | "day" | "dusk" | "night";

const unit = z.number().min(0).max(1);

export const placeSchema = z.object({
  name: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  source: z.enum(["city", "time zone"]),
});
export type Place = z.infer<typeof placeSchema>;

export const weatherSchema = z.object({
  kind: z.enum(WEATHER_KINDS),
  code: z.number().int(),
  cloud: unit,
  rain: unit,
  snow: unit,
  fog: unit,
  temperature: z.number().nullable(),
  observedAt: z.number(),
});
export type Weather = z.infer<typeof weatherSchema>;

export const skySchema = z.object({ place: placeSchema.nullable(), weather: weatherSchema.nullable() });
export type Sky = z.infer<typeof skySchema>;

const RAIN: Record<number, number> = { 51: 0.3, 53: 0.4, 55: 0.5, 56: 0.35, 57: 0.5, 61: 0.5, 63: 0.75, 65: 1, 66: 0.55, 67: 0.85, 80: 0.5, 81: 0.75, 82: 1, 95: 0.9, 96: 1, 99: 1 };
const SNOW: Record<number, number> = { 71: 0.4, 73: 0.7, 75: 1, 77: 0.3, 85: 0.6, 86: 1 };
const FOG: Record<number, number> = { 45: 0.75, 48: 0.9 };
const CLOUD: Record<number, number> = { 0: 0, 1: 0.2, 2: 0.5, 3: 0.95 };

export function weatherFromCode(code: number, cloudCover: number | null, temperature: number | null, observedAt: number): Weather {
  const rain = RAIN[code] ?? 0;
  const snow = SNOW[code] ?? 0;
  const fog = FOG[code] ?? 0;
  const byCode = CLOUD[code] ?? (rain || snow ? 0.85 : fog ? 0.7 : 0.5);
  const cloud = cloudCover === null ? byCode : Math.min(1, Math.max(0, cloudCover / 100));
  const kind: WeatherKind = snow ? "snow" : rain ? "rain" : fog ? "fog" : cloud >= 0.6 ? "cloud" : "clear";
  return { kind, code, cloud: Math.round(cloud * 100) / 100, rain, snow, fog, temperature, observedAt };
}

const RAD = Math.PI / 180;

export function sunElevation(at: Date, latitude: number, longitude: number): number {
  const days = at.getTime() / 86_400_000 - 10_957.5;
  const meanLongitude = (280.46 + 0.9856474 * days) % 360;
  const anomaly = ((357.528 + 0.9856003 * days) % 360) * RAD;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * days) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const siderealHours = (18.697374558 + 24.06570982441908 * days) % 24;
  const hourAngle = (siderealHours * 15 + longitude) * RAD - rightAscension;
  const lat = latitude * RAD;
  const sine = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sine))) / RAD;
}

export function clockElevation(at: Date): number {
  const hours = at.getHours() + at.getMinutes() / 60;
  return 50 * Math.sin((2 * Math.PI * (hours - 6.5)) / 24);
}

export function elevationAt(at: Date, place: Pick<Place, "latitude" | "longitude"> | null): number {
  return place ? sunElevation(at, place.latitude, place.longitude) : clockElevation(at);
}

export function dayPhase(elevation: number, rising: boolean): DayPhase {
  if (elevation >= 6) return "day";
  if (elevation < -6) return "night";
  return rising ? "dawn" : "dusk";
}

export interface SkyReading { phase: DayPhase; elevation: number; weather: WeatherKind }

export function readSky(at: Date, sky: Sky | null): SkyReading {
  const place = sky?.place ?? null;
  const elevation = elevationAt(at, place);
  const later = elevationAt(new Date(at.getTime() + 600_000), place);
  return { phase: dayPhase(elevation, later > elevation), elevation: Math.round(elevation * 10) / 10, weather: sky?.weather?.kind ?? "clear" };
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const round = (value: number) => Math.round(value * 1000) / 1000;

export interface ForestUniforms {
  u_daylight: number;
  u_twilight: number;
  u_sunHeight: number;
  u_cloud: number;
  u_rain: number;
  u_snow: number;
  u_fog: number;
}

export function forestUniforms(at: Date, sky: Sky | null): ForestUniforms {
  const elevation = elevationAt(at, sky?.place ?? null);
  const weather = sky?.weather ?? null;
  return {
    u_daylight: round(smooth(-6, 10, elevation)),
    u_twilight: round(Math.exp(-(((elevation + 1) / 7) ** 2))),
    u_sunHeight: round(Math.max(-1, Math.min(1, elevation / 60))),
    u_cloud: weather ? weather.cloud : 0.25,
    u_rain: weather ? weather.rain : 0,
    u_snow: weather ? weather.snow : 0,
    u_fog: weather ? weather.fog : 0,
  };
}
