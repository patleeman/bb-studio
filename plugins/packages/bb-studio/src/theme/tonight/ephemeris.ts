import { Body, EclipseKind, Equator, Illumination, MoonPhase, Observer, Rotation_EQJ_HOR, SearchLocalSolarEclipse, SearchLunarEclipse, SearchSunLongitude, SunPosition, type LunarEclipseInfo } from "astronomy-engine";
import { equatorialVector, type Vec3 } from "./catalog";
import { ACTIVE_RATE, longitudeGap, meteorLevel, showerRate, SHOWERS, type Shower } from "./showers";

const RAD = Math.PI / 180;
const MINUTE = 60_000;
const DAY = 86_400_000;

export const PRECESSION_PER_YEAR = 0.013969;

export interface SkyPlace { latitude: number; longitude: number }

export type BodyId = "moon" | "mercury" | "venus" | "mars" | "jupiter" | "saturn";
export interface SkyBody {
  id: BodyId;
  name: string;
  vector: Vec3;
  altitude: number;
  azimuth: number;
  magnitude: number;
}

export type EclipsePhase = "penumbral" | "partial" | "total";
export interface MoonState extends SkyBody {
  phase: number;
  phaseName: string;
  illuminated: number;
  phaseAngle: number;
  eclipse: { phase: EclipsePhase; kind: EclipsePhase; level: number; peak: number } | null;
}

export interface ShowerActivity {
  shower: Shower;
  rate: number;
  visible: number;
  radiant: Vec3;
  radiantAltitude: number;
  peak: number | null;
}

export interface Conjunction { a: SkyBody; b: SkyBody; separation: number }

export interface NightSky {
  at: number;
  place: SkyPlace;
  rotation: readonly number[];
  sun: { vector: Vec3; altitude: number; azimuth: number };
  moon: MoonState;
  planets: SkyBody[];
  showers: ShowerActivity[];
  meteorLevel: number;
  conjunctions: Conjunction[];
}

const PLANETS: readonly { id: BodyId; name: string; body: Body }[] = [
  { id: "mercury", name: "Mercury", body: Body.Mercury },
  { id: "venus", name: "Venus", body: Body.Venus },
  { id: "mars", name: "Mars", body: Body.Mars },
  { id: "jupiter", name: "Jupiter", body: Body.Jupiter },
  { id: "saturn", name: "Saturn", body: Body.Saturn },
];

export function rotate(rotation: readonly number[], vector: Vec3): Vec3 {
  return [
    rotation[0]! * vector[0] + rotation[1]! * vector[1] + rotation[2]! * vector[2],
    rotation[3]! * vector[0] + rotation[4]! * vector[1] + rotation[5]! * vector[2],
    rotation[6]! * vector[0] + rotation[7]! * vector[1] + rotation[8]! * vector[2],
  ];
}

export function altitudeOf(horizontal: Vec3): number {
  return Math.asin(Math.max(-1, Math.min(1, horizontal[2]))) / RAD;
}

export function azimuthOf(horizontal: Vec3): number {
  return (Math.atan2(-horizontal[1], horizontal[0]) / RAD + 360) % 360;
}

export function separation(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / RAD;
}

function observerOf(place: SkyPlace): Observer {
  return new Observer(place.latitude, place.longitude, 0);
}

export function horizonRotation(at: Date, place: SkyPlace): number[] {
  const { rot } = Rotation_EQJ_HOR(at, observerOf(place));
  return [rot[0]![0]!, rot[1]![0]!, rot[2]![0]!, rot[0]![1]!, rot[1]![1]!, rot[2]![1]!, rot[0]![2]!, rot[1]![2]!, rot[2]![2]!];
}

function bodyVector(body: Body, at: Date, observer: Observer, rotation: readonly number[]): Vec3 {
  const { vec } = Equator(body, at, observer, false, true);
  const length = Math.hypot(vec.x, vec.y, vec.z);
  return rotate(rotation, [vec.x / length, vec.y / length, vec.z / length]);
}

export function moonPhaseName(phase: number): string {
  const angle = ((phase % 360) + 360) % 360;
  if (angle < 7 || angle >= 353) return "new moon";
  if (angle < 83) return "waxing crescent";
  if (angle < 97) return "first quarter";
  if (angle < 173) return "waxing gibbous";
  if (angle < 187) return "full moon";
  if (angle < 263) return "waning gibbous";
  if (angle < 277) return "last quarter";
  return "waning crescent";
}

let lunarCache: { from: number; info: LunarEclipseInfo } | null = null;

function lunarEclipseAfter(from: number): LunarEclipseInfo {
  if (lunarCache && from >= lunarCache.from && from <= lunarCache.info.peak.date.getTime() - DAY / 2) return lunarCache.info;
  const info = SearchLunarEclipse(new Date(from));
  lunarCache = { from, info };
  return info;
}

function eclipsePhase(kind: EclipseKind): EclipsePhase {
  return kind === EclipseKind.Total ? "total" : kind === EclipseKind.Partial ? "partial" : "penumbral";
}

export function lunarEclipseAt(at: number): MoonState["eclipse"] {
  const info = lunarEclipseAfter(at - DAY / 2);
  const peak = info.peak.date.getTime();
  const away = Math.abs(at - peak) / MINUTE;
  if (away > info.sd_penum) return null;
  const kind = eclipsePhase(info.kind);
  if (info.sd_total > 0 && away <= info.sd_total) return { phase: "total", kind, level: 1, peak };
  if (info.sd_partial > 0 && away <= info.sd_partial) {
    const depth = (info.sd_partial - away) / Math.max(1, info.sd_partial - info.sd_total);
    return { phase: "partial", kind, level: Math.round((0.2 + 0.7 * Math.min(1, depth) * (info.sd_total > 0 ? 1 : info.obscuration)) * 1000) / 1000, peak };
  }
  return { phase: "penumbral", kind, level: 0.1, peak };
}

export function solarLongitude(at: Date): number {
  const years = 2000 + (at.getTime() - 946_728_000_000) / (365.25 * DAY);
  return (((SunPosition(at).elon - PRECESSION_PER_YEAR * (years - 2000)) % 360) + 360) % 360;
}

export function showerPeak(shower: Shower, near: Date): number | null {
  const years = 2000 + (near.getTime() - 946_728_000_000) / (365.25 * DAY);
  const target = (shower.solarLongitude + PRECESSION_PER_YEAR * (years - 2000)) % 360;
  const guess = near.getTime() + (longitudeGap(shower.solarLongitude, solarLongitude(near)) / 0.9856) * DAY;
  const found = SearchSunLongitude(target, new Date(guess - 6 * DAY), 12);
  return found ? found.date.getTime() : null;
}

export function showerActivity(at: Date, rotation: readonly number[]): ShowerActivity[] {
  const longitude = solarLongitude(at);
  const active: ShowerActivity[] = [];
  for (const shower of SHOWERS) {
    const rate = showerRate(shower, longitude);
    if (rate < ACTIVE_RATE) continue;
    const radiant = rotate(rotation, equatorialVector(shower.ra, shower.dec));
    active.push({ shower, rate, visible: rate * Math.max(0, radiant[2]), radiant, radiantAltitude: altitudeOf(radiant), peak: showerPeak(shower, at) });
  }
  return active.sort((a, b) => b.visible - a.visible || b.rate - a.rate);
}

export const CONJUNCTION_DEGREES = { moon: 6, planets: 4 } as const;

export function nightSky(at: Date, place: SkyPlace): NightSky {
  const observer = observerOf(place);
  const rotation = horizonRotation(at, place);
  const body = (id: BodyId, name: string, which: Body): SkyBody => {
    const vector = bodyVector(which, at, observer, rotation);
    return { id, name, vector, altitude: altitudeOf(vector), azimuth: azimuthOf(vector), magnitude: Illumination(which, at).mag };
  };
  const sunVector = bodyVector(Body.Sun, at, observer, rotation);
  const light = Illumination(Body.Moon, at);
  const phase = MoonPhase(at);
  const moon: MoonState = {
    ...body("moon", "Moon", Body.Moon),
    phase,
    phaseName: moonPhaseName(phase),
    illuminated: light.phase_fraction,
    phaseAngle: light.phase_angle,
    eclipse: lunarEclipseAt(at.getTime()),
  };
  const planets = PLANETS.map((planet) => body(planet.id, planet.name, planet.body));
  const showers = showerActivity(at, rotation);
  const conjunctions: Conjunction[] = [];
  const bodies: SkyBody[] = [moon, ...planets];
  for (let first = 0; first < bodies.length; first += 1) {
    for (let second = first + 1; second < bodies.length; second += 1) {
      const a = bodies[first]!, b = bodies[second]!;
      if (a.altitude <= 0 || b.altitude <= 0) continue;
      const apart = separation(a.vector, b.vector);
      if (apart <= (a.id === "moon" ? CONJUNCTION_DEGREES.moon : CONJUNCTION_DEGREES.planets)) conjunctions.push({ a, b, separation: Math.round(apart * 10) / 10 });
    }
  }
  return {
    at: at.getTime(),
    place,
    rotation,
    sun: { vector: sunVector, altitude: altitudeOf(sunVector), azimuth: azimuthOf(sunVector) },
    moon,
    planets,
    showers,
    meteorLevel: meteorLevel(showers.reduce((sum, each) => sum + each.visible, 0)),
    conjunctions: conjunctions.sort((a, b) => a.separation - b.separation),
  };
}

export interface SkyEvent { kind: "lunar eclipse" | "solar eclipse" | "conjunction"; text: string; at: number | null }

export function eventsNear(sky: NightSky, clock: (at: number) => string): SkyEvent[] {
  const events: SkyEvent[] = [];
  const from = sky.at - DAY / 2;
  const until = sky.at + DAY / 2;
  const place = sky.place;
  const lunar = lunarEclipseAfter(from);
  const lunarPeak = lunar.peak.date.getTime();
  if (lunarPeak <= until) {
    const up = altitudeOf(bodyVector(Body.Moon, lunar.peak.date, observerOf(place), horizonRotation(lunar.peak.date, place))) > 0;
    events.push({ kind: "lunar eclipse", at: lunarPeak, text: `${capital(eclipsePhase(lunar.kind))} lunar eclipse, greatest at ${clock(lunarPeak)}${up ? "" : ", Moon below the horizon here"}` });
  }
  const solar = SearchLocalSolarEclipse(new Date(from), observerOf(place));
  const solarPeak = solar.peak.time.date.getTime();
  if (solarPeak <= until && solar.peak.altitude > 0) {
    events.push({ kind: "solar eclipse", at: solarPeak, text: `${capital(solar.kind)} solar eclipse, greatest at ${clock(solarPeak)}, ${Math.round(solar.obscuration * 100)}% of the Sun covered` });
  }
  for (const pair of sky.conjunctions) events.push({ kind: "conjunction", at: null, text: `${pair.a.name} ${pair.separation.toFixed(1)}° from ${pair.b.name}` });
  return events;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;

export function compass(azimuth: number): string {
  return COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 22.5) % 16]!;
}
