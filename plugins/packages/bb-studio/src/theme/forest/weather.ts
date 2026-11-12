import { readFile } from "node:fs/promises";
import { guardedFetch } from "../../guarded-fetch";
import { weatherFromCode, type Place, type Sky, type Weather } from "./sky";

export const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const WEATHER_TTL_MS = 20 * 60_000;
export const RETRY_MS = 5 * 60_000;
export const STALE_MS = 3 * 60 * 60_000;
export const CITY_KEY = "theme.forest.city";
const TIMEOUT_MS = 8000;
const ZONE_FILES = ["/usr/share/zoneinfo/zone1970.tab", "/usr/share/zoneinfo/zone.tab"];

export type GetJson = (url: URL) => Promise<unknown>;

export interface WeatherKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ForestWeatherDeps {
  kv: WeatherKv;
  getJson?: GetJson;
  zoneTable?: () => Promise<string | null>;
  now?: () => number;
}

export const getJsonGuarded: GetJson = async (url) => {
  const response = await guardedFetch(url, { method: "GET", headers: { accept: "application/json" }, body: null, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url.host} answered ${response.status}`);
  return response.json();
};

async function readZoneTable(): Promise<string | null> {
  for (const path of ZONE_FILES) {
    try {
      return await readFile(path, "utf8");
    } catch {
      continue;
    }
  }
  return null;
}

function coordinate(text: string, degreeDigits: number): number {
  const sign = text.startsWith("-") ? -1 : 1;
  const digits = text.slice(1);
  const degrees = Number(digits.slice(0, degreeDigits));
  const minutes = Number(digits.slice(degreeDigits, degreeDigits + 2));
  const seconds = digits.length > degreeDigits + 2 ? Number(digits.slice(degreeDigits + 2, degreeDigits + 4)) : 0;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

export function zonePlace(table: string, timeZone: string): Place | null {
  for (const line of table.split("\n")) {
    if (line.startsWith("#")) continue;
    const [, coordinates, zone] = line.split("\t");
    if (zone !== timeZone || !coordinates) continue;
    const match = /^([+-]\d{4,6})([+-]\d{5,7})$/.exec(coordinates);
    if (!match) return null;
    const name = timeZone.split("/").pop()!.replace(/_/g, " ");
    return { name, latitude: coarse(coordinate(match[1]!, 2)), longitude: coarse(coordinate(match[2]!, 3)), source: "time zone" };
  }
  return null;
}

const coarse = (value: number) => Math.round(value * 10) / 10;

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function parseForecast(body: unknown, observedAt: number): Weather | null {
  const current = record(record(body)?.current);
  const code = finite(current?.weather_code);
  if (current === null || code === null) return null;
  return weatherFromCode(Math.round(code), finite(current.cloud_cover), finite(current.temperature_2m), observedAt);
}

export function parseGeocode(body: unknown): Place | null {
  const results = record(body)?.results;
  const first = Array.isArray(results) ? record(results[0]) : null;
  const latitude = finite(first?.latitude);
  const longitude = finite(first?.longitude);
  if (!first || latitude === null || longitude === null || typeof first.name !== "string") return null;
  const country = typeof first.country === "string" ? `, ${first.country}` : "";
  return { name: `${first.name}${country}`, latitude: coarse(latitude), longitude: coarse(longitude), source: "city" };
}

export function forecastUrl(place: Pick<Place, "latitude" | "longitude">): URL {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(coarse(place.latitude)));
  url.searchParams.set("longitude", String(coarse(place.longitude)));
  url.searchParams.set("current", "weather_code,cloud_cover,temperature_2m");
  return url;
}

interface Cached { key: string; weather: Weather | null; fetchedAt: number; failedAt: number | null }

export class ForestWeather {
  private cached: Cached | null = null;
  private pending: { key: string; weather: Promise<Weather | null> } | null = null;
  private zones: Promise<string | null> | null = null;
  private readonly getJson: GetJson;
  private readonly now: () => number;

  constructor(private readonly deps: ForestWeatherDeps) {
    this.getJson = deps.getJson ?? getJsonGuarded;
    this.now = deps.now ?? Date.now;
  }

  async place(timeZone: string | null): Promise<Place | null> {
    const city = await this.deps.kv.get<Place>(CITY_KEY).catch(() => undefined);
    if (city && typeof city.latitude === "number" && typeof city.longitude === "number") return city;
    if (!timeZone) return null;
    this.zones ??= (this.deps.zoneTable ?? readZoneTable)().catch(() => null);
    const table = await this.zones;
    return table ? zonePlace(table, timeZone) : null;
  }

  async sky(timeZone: string | null): Promise<Sky> {
    const place = await this.place(timeZone);
    return { place, weather: place ? await this.weather(place) : null };
  }

  async setCity(city: string | null): Promise<Sky> {
    if (city === null) {
      await this.deps.kv.delete(CITY_KEY);
      this.cached = null;
      return { place: null, weather: null };
    }
    const url = new URL(GEOCODING_URL);
    url.searchParams.set("name", city);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    let body: unknown;
    try {
      body = await this.getJson(url);
    } catch {
      throw new Error(`Couldn't look up ${city}: Open-Meteo didn't answer.`);
    }
    const place = parseGeocode(body);
    if (!place) throw new Error(`No place named ${city}.`);
    await this.deps.kv.set(CITY_KEY, place);
    this.cached = null;
    return { place, weather: await this.weather(place) };
  }

  private weather(place: Place): Promise<Weather | null> {
    const key = `${coarse(place.latitude)},${coarse(place.longitude)}`;
    const now = this.now();
    const cached = this.cached?.key === key ? this.cached : null;
    if (cached?.weather && now - cached.fetchedAt < WEATHER_TTL_MS) return Promise.resolve(cached.weather);
    if (cached?.failedAt != null && now - cached.failedAt < RETRY_MS) return Promise.resolve(this.usable(cached, now));
    if (this.pending?.key === key) return this.pending.weather;
    const pending = { key, weather: this.fetchWeather(key, place, cached).finally(() => { if (this.pending === pending) this.pending = null; }) };
    this.pending = pending;
    return pending.weather;
  }

  private usable(cached: Cached | null, now: number): Weather | null {
    return cached?.weather && now - cached.fetchedAt < STALE_MS ? cached.weather : null;
  }

  private async fetchWeather(key: string, place: Place, previous: Cached | null): Promise<Weather | null> {
    try {
      const weather = parseForecast(await this.getJson(forecastUrl(place)), this.now());
      if (!weather) throw new Error("No current weather");
      this.cached = { key, weather, fetchedAt: this.now(), failedAt: null };
      return weather;
    } catch {
      const now = this.now();
      this.cached = { key, weather: previous?.weather ?? null, fetchedAt: previous?.fetchedAt ?? 0, failedAt: now };
      return this.usable(this.cached, now);
    }
  }
}
