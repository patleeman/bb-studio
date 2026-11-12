import { describe, expect, it } from "vitest";
import { constellationCatalog, starCatalog } from "./catalog";
import { STAR_COUNT, STAR_MAG_LIMIT } from "./catalog-data";
import { separation } from "./ephemeris";

describe("the bundled star catalog", () => {
  it("decodes every star to a unit vector, brightest first, within the magnitude limit", () => {
    const catalog = starCatalog();
    expect(catalog.count).toBe(STAR_COUNT);
    expect(catalog.count).toBeGreaterThan(2500);
    expect(catalog.count).toBeLessThan(3200);
    for (let index = 0; index < catalog.count; index += 1) {
      expect(Math.hypot(catalog.vectors[index * 3]!, catalog.vectors[index * 3 + 1]!, catalog.vectors[index * 3 + 2]!)).toBeCloseTo(1, 5);
      expect(catalog.magnitudes[index]!).toBeLessThanOrEqual(STAR_MAG_LIMIT + 0.02);
      expect(catalog.dec[index]!).toBeGreaterThanOrEqual(-90);
      expect(catalog.dec[index]!).toBeLessThanOrEqual(90);
      if (index > 0) expect(catalog.magnitudes[index]!).toBeGreaterThanOrEqual(catalog.magnitudes[index - 1]!);
    }
  });

  it("has Sirius first, Polaris at the pole and Betelgeuse red", () => {
    const catalog = starCatalog();
    expect(catalog.ra[0]).toBeCloseTo(101.29, 1);
    expect(catalog.dec[0]).toBeCloseTo(-16.72, 1);
    expect(catalog.magnitudes[0]).toBeCloseTo(-1.46, 1);
    const near = (ra: number, dec: number) => {
      for (let index = 0; index < catalog.count; index += 1) if (Math.abs(catalog.ra[index]! - ra) < 0.2 && Math.abs(catalog.dec[index]! - dec) < 0.2) return index;
      return -1;
    };
    const betelgeuse = near(88.79, 7.41);
    expect(betelgeuse).toBeGreaterThanOrEqual(0);
    expect(betelgeuse).toBeLessThan(15);
    expect(catalog.colors[betelgeuse]!).toBeGreaterThan(1.5);
    expect(catalog.colors[near(78.63, -8.2)]!).toBeLessThan(0.1);
    expect([...catalog.dec].filter((dec) => dec > 89)).toHaveLength(1);
  });

  it("has 89 constellation figures (Serpens in two parts), each named, with lines that end on catalog stars", () => {
    const catalog = starCatalog();
    const figures = constellationCatalog();
    expect(figures).toHaveLength(89);
    expect(new Set(figures.map((figure) => figure.id)).size).toBe(89);
    expect(figures.find((figure) => figure.id === "Ori")).toMatchObject({ name: "Orion", rank: 1 });
    expect(figures.find((figure) => figure.id === "UMa")?.name).toBe("Ursa Major");
    expect(figures.filter((figure) => figure.id.startsWith("Ser")).map((figure) => [figure.id, figure.name])).toEqual([["Ser1", "Serpens Caput"], ["Ser2", "Serpens Cauda"]]);
    expect(new Set(figures.map((figure) => figure.name)).size).toBe(89);
    let vertices = 0, onStar = 0;
    for (const figure of figures) {
      expect(figure.name.length, figure.id).toBeGreaterThan(2);
      expect(figure.lines.length, figure.id).toBeGreaterThan(0);
      for (const line of figure.lines) {
        expect(line.length, figure.id).toBeGreaterThanOrEqual(2);
        for (const vertex of line) {
          vertices += 1;
          expect(Math.hypot(vertex[0], vertex[1], vertex[2])).toBeCloseTo(1, 5);
          for (let index = 0; index < catalog.count; index += 1) {
            if (separation(vertex, [catalog.vectors[index * 3]!, catalog.vectors[index * 3 + 1]!, catalog.vectors[index * 3 + 2]!]) < 0.25) { onStar += 1; break; }
          }
        }
      }
    }
    expect(onStar / vertices).toBeGreaterThan(0.9);
  });
});
