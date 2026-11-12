import { describe, expect, it } from "vitest";
import { starCatalog } from "./catalog";
import { altitudeOf, azimuthOf, compass, eventsNear, horizonRotation, lunarEclipseAt, nightSky, rotate, showerPeak } from "./ephemeris";
import { meteorLevel, SHOWERS, showerRate } from "./showers";

const WHITE_PLAINS = { latitude: 41.03, longitude: -73.76 };
const HONOLULU = { latitude: 21.3, longitude: -157.86 };
const at = (iso: string) => new Date(iso);

function polaris(): [number, number, number] {
  const catalog = starCatalog();
  for (let index = 0; index < catalog.count; index += 1) {
    if (catalog.dec[index]! > 89) return [catalog.vectors[index * 3]!, catalog.vectors[index * 3 + 1]!, catalog.vectors[index * 3 + 2]!];
  }
  throw new Error("Polaris is missing");
}

describe("tonight's sky, computed", () => {
  it("holds Polaris due north at the place's latitude all night and all year", () => {
    for (const iso of ["2026-11-12T02:00:00Z", "2026-11-12T08:00:00Z", "2026-05-01T03:00:00Z"]) {
      const seen = rotate(horizonRotation(at(iso), WHITE_PLAINS), polaris());
      expect(Math.abs(altitudeOf(seen) - WHITE_PLAINS.latitude), iso).toBeLessThan(0.8);
      expect(Math.min(azimuthOf(seen), 360 - azimuthOf(seen)), iso).toBeLessThan(1.2);
    }
    const south = rotate(horizonRotation(at("2026-11-12T02:00:00Z"), { latitude: -33.9, longitude: 151.2 }), polaris());
    expect(altitudeOf(south)).toBeLessThan(-30);
  });

  it("turns the sky 15° an hour: a star on the meridian is 15° of hour angle west an hour later", () => {
    const sirius: [number, number, number] = [starCatalog().vectors[0]!, starCatalog().vectors[1]!, starCatalog().vectors[2]!];
    const first = rotate(horizonRotation(at("2026-01-15T04:00:00Z"), WHITE_PLAINS), sirius);
    const later = rotate(horizonRotation(at("2026-01-15T05:00:00Z"), WHITE_PLAINS), sirius);
    expect(azimuthOf(later)).toBeGreaterThan(azimuthOf(first) + 10);
    expect(Math.max(altitudeOf(first), altitudeOf(later))).toBeLessThan(90 - WHITE_PLAINS.latitude - 16.7 + 0.5);
  });

  it("knows the full moon of 2026-11-24 14:53 UTC and the new moon of 2026-11-09 07:02 UTC", () => {
    const full = nightSky(at("2026-11-24T14:53:00Z"), WHITE_PLAINS).moon;
    expect(full.phaseName).toBe("full moon");
    expect(Math.abs(full.phase - 180)).toBeLessThan(0.5);
    expect(full.illuminated).toBeGreaterThan(0.99);
    const fresh = nightSky(at("2026-11-09T07:02:00Z"), WHITE_PLAINS).moon;
    expect(fresh.phaseName).toBe("new moon");
    expect(fresh.illuminated).toBeLessThan(0.01);
    expect(nightSky(at("2026-11-17T07:00:00Z"), WHITE_PLAINS).moon.phaseName).toBe("first quarter");
  });

  it("puts Saturn high in the south on 2026-11-11 at 21:00 in White Plains, the only planet up", () => {
    const sky = nightSky(at("2026-11-12T02:00:00Z"), WHITE_PLAINS);
    const up = sky.planets.filter((planet) => planet.altitude > 0);
    expect(up.map((planet) => planet.name)).toEqual(["Saturn"]);
    expect(up[0]!.altitude).toBeGreaterThan(45);
    expect(up[0]!.altitude).toBeLessThan(55);
    expect(compass(up[0]!.azimuth)).toBe("S");
    expect(sky.moon.altitude).toBeLessThan(0);
    expect(sky.sun.altitude).toBeLessThan(-18);
  });

  it("raises the meteor rate at the Leonid peak of 2026-11-17 over the nights around it", () => {
    const leonids = SHOWERS.find((shower) => shower.id === "LEO")!;
    const peak = showerPeak(leonids, at("2026-11-17T07:00:00Z"))!;
    expect(new Date(peak).toISOString().slice(0, 10)).toBe("2026-11-17");
    const level = (iso: string) => nightSky(at(iso), WHITE_PLAINS).meteorLevel;
    const peakNight = nightSky(at("2026-11-18T07:00:00Z"), WHITE_PLAINS);
    expect(peakNight.showers[0]!.shower.name).toBe("Leonids");
    expect(peakNight.showers[0]!.radiantAltitude).toBeGreaterThan(20);
    expect(level("2026-11-17T07:00:00Z")).toBeGreaterThan(level("2026-11-10T07:00:00Z"));
    expect(level("2026-11-18T07:00:00Z")).toBeGreaterThan(level("2026-11-17T07:00:00Z"));
    expect(level("2026-11-27T07:00:00Z")).toBe(1);
    expect(level("2026-09-20T07:00:00Z")).toBe(1);
    expect(nightSky(at("2026-09-20T07:00:00Z"), WHITE_PLAINS).showers).toEqual([]);
    expect(level("2026-08-13T07:00:00Z")).toBe(6);
    expect(showerRate(leonids, leonids.solarLongitude)).toBe(15);
    expect(showerRate(leonids, leonids.solarLongitude + 5)).toBeLessThan(1);
    expect([meteorLevel(0), meteorLevel(4), meteorLevel(500)]).toEqual([1, 2, 6]);
  });

  it("counts no meteors from a radiant below the horizon", () => {
    const evening = nightSky(at("2026-11-17T23:30:00Z"), WHITE_PLAINS);
    const leonids = evening.showers.find((each) => each.shower.id === "LEO")!;
    expect(leonids.radiantAltitude).toBeLessThan(0);
    expect(leonids.visible).toBe(0);
  });

  it("reddens the Moon through the total lunar eclipse of 2026-03-03 and not the night before", () => {
    expect(lunarEclipseAt(Date.parse("2026-03-03T11:33:00Z"))).toMatchObject({ phase: "total", level: 1 });
    const partial = lunarEclipseAt(Date.parse("2026-03-03T10:20:00Z"))!;
    expect(partial.phase).toBe("partial");
    expect(partial.level).toBeGreaterThan(0.2);
    expect(partial.level).toBeLessThan(1);
    expect(lunarEclipseAt(Date.parse("2026-03-02T11:33:00Z"))).toBeNull();
    expect(lunarEclipseAt(Date.parse("2026-08-28T04:13:00Z"))).toMatchObject({ phase: "partial", kind: "partial" });
    const sky = nightSky(at("2026-03-03T11:33:00Z"), HONOLULU);
    expect(sky.moon.altitude).toBeGreaterThan(60);
    expect(eventsNear(sky, (time) => new Date(time).toISOString().slice(0, 16))[0]).toEqual({ kind: "lunar eclipse", at: sky.moon.eclipse!.peak, text: "Total lunar eclipse, greatest at 2026-03-03T11:33" });
  });

  it("finds Mars 1.3° from Jupiter before dawn on 2026-11-17", () => {
    const sky = nightSky(at("2026-11-17T07:00:00Z"), WHITE_PLAINS);
    expect(sky.conjunctions.map((pair) => [pair.a.name, pair.b.name, pair.separation])).toEqual([["Mars", "Jupiter", 1.3]]);
    expect(eventsNear(sky, String).map((event) => event.text)).toEqual(["Mars 1.3° from Jupiter"]);
  });

  it("places the Sun over White Plains on 2026-11-12: 31° up in the south at noon, 4° up in the WSW at 16:10, 6° down at 17:10, far below at midnight", () => {
    const sun = (iso: string) => nightSky(at(iso), WHITE_PLAINS).sun;
    const noon = sun("2026-11-12T17:00:00Z");
    expect(noon.altitude).toBeCloseTo(30.9, 1);
    expect(noon.azimuth).toBeCloseTo(185.8, 1);
    expect(altitudeOf(noon.vector)).toBe(noon.altitude);
    const golden = sun("2026-11-12T21:10:00Z");
    expect(golden.altitude).toBeCloseTo(4.1, 1);
    expect(compass(golden.azimuth)).toBe("WSW");
    const dusk = sun("2026-11-12T22:10:00Z");
    expect(dusk.altitude).toBeCloseTo(-6.3, 1);
    expect(dusk.azimuth).toBeCloseTo(251.8, 1);
    expect(sun("2026-11-12T05:00:00Z").altitude).toBeCloseTo(-66.2, 1);
  });
});
