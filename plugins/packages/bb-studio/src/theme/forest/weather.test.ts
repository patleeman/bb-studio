import { describe, expect, it } from "vitest";
import { CITY_KEY, ForestWeather, RETRY_MS, STALE_MS, WEATHER_TTL_MS, zonePlace, type GetJson } from "./weather";

const ZONES = [
  "# tz zone descriptions",
  "US\t+404251-0740023\tAmerica/New_York\tEastern (most areas)",
  "GB\t+513030-0000731\tEurope/London",
  "AU\t-3352+15113\tAustralia/Sydney\tNew South Wales (most areas)",
].join("\n");

const forecast = (code: number, cloud = 40) => ({ current: { time: "2026-11-11T16:00", weather_code: code, cloud_cover: cloud, temperature_2m: 9.5 } });

function memoryKv() {
  const rows = new Map<string, unknown>();
  return {
    rows,
    get: async <T,>(key: string) => rows.get(key) as T | undefined,
    set: async (key: string, value: unknown) => { rows.set(key, value); },
    delete: async (key: string) => { rows.delete(key); },
  };
}

function setup(answer: (url: URL) => unknown) {
  let clock = 1_000_000;
  const requests: URL[] = [];
  const getJson: GetJson = async (url) => {
    requests.push(url);
    const value = answer(url);
    if (value instanceof Error) throw value;
    return value;
  };
  const kv = memoryKv();
  const weather = new ForestWeather({ kv, getJson, zoneTable: async () => ZONES, now: () => clock });
  return { weather, requests, kv, advance: (ms: number) => { clock += ms; } };
}

describe("the Forest theme's place", () => {
  it("is the time zone's coordinates from the tz database, rounded to a tenth of a degree", () => {
    expect(zonePlace(ZONES, "America/New_York")).toEqual({ name: "New York", latitude: 40.7, longitude: -74, source: "time zone" });
    expect(zonePlace(ZONES, "Australia/Sydney")).toEqual({ name: "Sydney", latitude: -33.9, longitude: 151.2, source: "time zone" });
    expect(zonePlace(ZONES, "Etc/UTC")).toBeNull();
  });

  it("is a city once one is set, looked up once with Open-Meteo geocoding", async () => {
    const { weather, requests, kv } = setup((url) => (url.host === "geocoding-api.open-meteo.com" ? { results: [{ name: "Kyoto", latitude: 35.0211, longitude: 135.7538, country: "Japan" }] } : forecast(61)));
    const set = await weather.setCity("Kyoto");
    expect(set.place).toEqual({ name: "Kyoto, Japan", latitude: 35, longitude: 135.8, source: "city" });
    expect(requests[0]!.searchParams.get("name")).toBe("Kyoto");
    expect(kv.rows.get(CITY_KEY)).toEqual(set.place);
    const later = await weather.sky("America/New_York");
    expect(later.place?.name).toBe("Kyoto, Japan");
    expect(later.weather?.kind).toBe("rain");
    expect(requests.filter((url) => url.host === "geocoding-api.open-meteo.com")).toHaveLength(1);
    expect((await weather.setCity(null)).place).toBeNull();
    expect((await weather.sky("America/New_York")).place?.name).toBe("New York");
  });

  it("names a city it can't find, and says so when the lookup can't reach Open-Meteo", async () => {
    await expect(setup(() => ({ results: [] })).weather.setCity("Atlantis")).rejects.toThrow("No place named Atlantis.");
    await expect(setup(() => new TypeError("fetch failed")).weather.setCity("Kyoto")).rejects.toThrow("Couldn't look up Kyoto: Open-Meteo didn't answer.");
  });
});

describe("the Forest theme's weather", () => {
  it("asks Open-Meteo for the current weather at the coarse place and maps it", async () => {
    const { weather, requests } = setup(() => forecast(73, 90));
    const sky = await weather.sky("America/New_York");
    expect(sky.weather).toMatchObject({ kind: "snow", code: 73, cloud: 0.9, snow: 0.7, temperature: 9.5 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.origin + requests[0]!.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({ latitude: "40.7", longitude: "-74", current: "weather_code,cloud_cover,temperature_2m" });
  });

  it("keeps an answer for 20 minutes, then asks again", async () => {
    let code = 0;
    const { weather, requests, advance } = setup(() => forecast(code));
    expect((await weather.sky("America/New_York")).weather?.kind).toBe("clear");
    code = 63;
    advance(WEATHER_TTL_MS - 1000);
    expect((await weather.sky("America/New_York")).weather?.kind).toBe("clear");
    expect(requests).toHaveLength(1);
    advance(2000);
    expect((await weather.sky("America/New_York")).weather?.kind).toBe("rain");
    expect(requests).toHaveLength(2);
  });

  it("answers with no weather offline, without throwing, and waits 5 minutes before trying again", async () => {
    const { weather, requests, advance } = setup(() => new TypeError("fetch failed"));
    await expect(weather.sky("America/New_York")).resolves.toEqual({ place: { name: "New York", latitude: 40.7, longitude: -74, source: "time zone" }, weather: null });
    advance(RETRY_MS - 1000);
    await weather.sky("America/New_York");
    expect(requests).toHaveLength(1);
    advance(2000);
    await weather.sky("America/New_York");
    expect(requests).toHaveLength(2);
  });

  it("keeps the last answer through a failure for 3 hours", async () => {
    let online = true;
    const { weather, advance } = setup(() => (online ? forecast(45) : new TypeError("fetch failed")));
    expect((await weather.sky("America/New_York")).weather?.kind).toBe("fog");
    online = false;
    advance(WEATHER_TTL_MS + 1000);
    expect((await weather.sky("America/New_York")).weather?.kind).toBe("fog");
    advance(STALE_MS);
    expect((await weather.sky("America/New_York")).weather).toBeNull();
  });

  it("makes one request for callers that ask at once", async () => {
    const { weather, requests } = setup(() => forecast(2));
    await Promise.all([weather.sky("America/New_York"), weather.sky("America/New_York"), weather.sky("America/New_York")]);
    expect(requests).toHaveLength(1);
  });

  it("makes no request without a place", async () => {
    const { weather, requests } = setup(() => forecast(0));
    expect(await weather.sky("Etc/UTC")).toEqual({ place: null, weather: null });
    expect(await weather.sky(null)).toEqual({ place: null, weather: null });
    expect(requests).toHaveLength(0);
  });

  it("treats an answer without current weather as no answer", async () => {
    const { weather } = setup(() => ({ error: true, reason: "Latitude must be in range of -90 to 90°." }));
    expect((await weather.sky("America/New_York")).weather).toBeNull();
  });
});
