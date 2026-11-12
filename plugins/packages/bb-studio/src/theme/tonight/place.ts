import type { SkyPlace } from "./ephemeris";

export const FALLBACK_LATITUDE = 40;

export function fallbackPlace(zoneOffsetMinutes: number): SkyPlace {
  return { latitude: FALLBACK_LATITUDE, longitude: Math.max(-180, Math.min(180, zoneOffsetMinutes / 4)) };
}
