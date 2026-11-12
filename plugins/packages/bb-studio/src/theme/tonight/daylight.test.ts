import { describe, expect, it } from "vitest";
import { TONIGHTS_SKY } from "../builtin/tonights-sky";
import { checkTheme, STATIC_BUDGET, staticCost } from "../checks";
import { glassSurfaceFor, themeModes } from "../schema";
import { composeSky, tonightUniforms } from "./compose";
import { DARK_BELOW, DAY_INK, LIGHT_ABOVE, NIGHT_INK, skyInk, skyLight, skyPhase, skyVariant } from "./daylight";
import { nightSky } from "./ephemeris";
import { paintSky, type SkyContext } from "./paint";
import { aimSky, frameAim } from "./projection";

const WHITE_PLAINS = { latitude: 41.03, longitude: -73.76 };
const VIEW = { width: 1600, height: 1000 };

function recorder() {
  const strokes: { style: string; width: number }[] = [];
  const fills: string[] = [];
  const texts: { text: string; style: string }[] = [];
  const context: SkyContext = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "", font: "", textAlign: "", textBaseline: "",
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => { if (typeof context.fillStyle === "string") fills.push(context.fillStyle); },
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => { strokes.push({ style: String(context.strokeStyle), width: context.lineWidth }); },
    fillText: (text) => { texts.push({ text, style: String(context.fillStyle) }); },
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  return { context, strokes, fills, texts };
}

const alphaOf = (style: string) => Number(/,([\d.]+)\)$/.exec(style)![1]);

describe("the sky by day", () => {
  it("names the phase from the Sun's altitude: night below -18°, the three twilights, golden hour up to 6°, then day", () => {
    const cases: [number, string][] = [
      [-66, "night"], [-18.01, "night"], [-18, "astronomical twilight"], [-12.01, "astronomical twilight"], [-12, "nautical twilight"], [-6.01, "nautical twilight"],
      [-6, "civil twilight"], [-0.84, "civil twilight"], [-0.833, "golden hour"], [5.99, "golden hour"], [6, "day"], [31, "day"],
    ];
    for (const [altitude, phase] of cases) expect(skyPhase(altitude), String(altitude)).toBe(phase);
  });

  it("chooses the light variant by day and the dark one by night, and holds the last choice between -4.5° and -3.5°", () => {
    expect([DARK_BELOW, LIGHT_ABOVE]).toEqual([-4.5, -3.5]);
    expect(skyVariant(31, null)).toBe("light");
    expect(skyVariant(-66, null)).toBe("dark");
    expect(skyVariant(-4, null)).toBe("light");
    expect(skyVariant(-4.01, null)).toBe("dark");
    expect(skyVariant(-4.4, "light")).toBe("light");
    expect(skyVariant(-4.51, "light")).toBe("dark");
    expect(skyVariant(-3.6, "dark")).toBe("dark");
    expect(skyVariant(-3.49, "dark")).toBe("light");
    let mode = skyVariant(4, null);
    const seen: string[] = [];
    for (const altitude of [4, 0, -3.9, -4.2, -3.9, -4.6, -4.2, -3.7, -3.4, -4.2]) { mode = skyVariant(altitude, mode); seen.push(mode); }
    expect(seen).toEqual(["light", "light", "light", "light", "light", "dark", "dark", "dark", "light", "light"]);
  });

  it("lights the sky with the Sun: dark at night, a glow through twilight that fades by day, full blue once the Sun is well up", () => {
    expect(skyLight(-66)).toEqual({ day: 0, glow: 0, lit: 0, daylight: 0 });
    expect(skyLight(31)).toMatchObject({ day: 1, lit: 1, daylight: 1 });
    expect(skyLight(31).glow).toBeLessThan(0.15);
    const dusk = skyLight(-6.3);
    expect(dusk.lit).toBeGreaterThan(0.9);
    expect(dusk.day).toBeLessThan(0.05);
    expect(dusk.glow).toBeGreaterThan(0.8);
    expect(skyLight(4).glow).toBeGreaterThan(0.8);
    let last = skyLight(-20);
    for (let altitude = -19.5; altitude <= 40; altitude += 0.5) {
      const next = skyLight(altitude);
      expect(next.day, String(altitude)).toBeGreaterThanOrEqual(last.day);
      expect(next.lit).toBeGreaterThanOrEqual(last.lit);
      expect(next.daylight).toBeGreaterThanOrEqual(last.daylight);
      expect(Math.abs(next.glow - last.glow)).toBeLessThan(0.1);
      last = next;
    }
  });

  it("keeps the constellations by day as faint thin white lines, dim stars and faint names, at full strength at night", () => {
    expect(skyInk(0)).toEqual(NIGHT_INK);
    expect(skyInk(1)).toEqual(DAY_INK);
    expect(DAY_INK.line).toBeGreaterThanOrEqual(0.15);
    expect(DAY_INK.line).toBeLessThan(NIGHT_INK.line);
    expect(DAY_INK.lineWidth).toBeLessThan(NIGHT_INK.lineWidth);
    expect(DAY_INK.star).toBe(0.5);
    expect(DAY_INK.label).toBeLessThan(NIGHT_INK.label);
    expect(skyInk(0.5).line).toBeCloseTo(0.25, 5);

    const draw = (iso: string) => {
      const sky = nightSky(new Date(iso), WHITE_PLAINS);
      const camera = frameAim(aimSky(sky, "follow"), WHITE_PLAINS.latitude, VIEW);
      const picture = composeSky(sky, camera);
      const drawn = recorder();
      paintSky(drawn.context, 1600, 1000, 1, picture);
      return { picture, ...drawn };
    };
    const noon = draw("2026-11-12T17:00:00Z");
    const night = draw("2026-11-12T05:00:00Z");
    expect(noon.picture.ink).toEqual(DAY_INK);
    expect(night.picture.ink).toEqual(NIGHT_INK);
    expect(noon.strokes.length).toBeGreaterThan(40);
    expect(noon.strokes.every((stroke) => stroke.style.startsWith("rgba(255,255,255,") && stroke.width === 0.75)).toBe(true);
    expect(Math.max(...noon.strokes.map((stroke) => alphaOf(stroke.style)))).toBeCloseTo(0.2, 2);
    expect(Math.max(...night.strokes.map((stroke) => alphaOf(stroke.style)))).toBeCloseTo(0.3, 2);
    expect(night.strokes.every((stroke) => stroke.style.startsWith("rgba(150,178,238,") && stroke.width === 1)).toBe(true);
    const name = (drawn: typeof noon) => drawn.texts.find((text) => text.text === text.text.toUpperCase() && /^[A-Z ]+$/.test(text.text))!;
    expect(name(noon).style).toBe("rgba(255,255,255,0.34)");
    expect(name(night).style).toBe("rgba(168,190,238,0.52)");
    expect(Math.max(...noon.fills.map(alphaOf))).toBeLessThanOrEqual(0.5);
    expect(noon.fills.length).toBeLessThan(night.fills.length / 2);
  });

  it("gives the shader the Sun's direction and the light: the Sun in the open strip at noon, behind the camera's floor at midnight", () => {
    const at = (iso: string) => {
      const sky = nightSky(new Date(iso), WHITE_PLAINS);
      const camera = frameAim(aimSky(sky, "follow"), WHITE_PLAINS.latitude, VIEW);
      return { camera, uniforms: tonightUniforms(sky, camera) };
    };
    const noon = at("2026-11-12T17:00:00Z");
    expect(noon.uniforms.u_light).toEqual([1, skyLight(30.94).glow, 1]);
    const [x, y, z] = noon.uniforms.u_sun;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);
    const screenX = noon.camera.anchorX + (noon.camera.scale * 2 * x) / (1 + z);
    expect(screenX).toBeGreaterThan(1364 / 1000);
    expect(screenX).toBeLessThan(1.6);
    const midnight = at("2026-11-12T05:00:00Z");
    expect(midnight.uniforms.u_light).toEqual([0, 0, 0]);
    expect(midnight.uniforms.u_sun[1]).toBeLessThan(-0.5);
  });

  it("passes the theme checks in both variants, with denser glass by day and the cost under the budget", () => {
    expect(themeModes(TONIGHTS_SKY)).toEqual(["light", "dark"]);
    const report = checkTheme(TONIGHTS_SKY);
    expect(report.results.filter((line) => !line.pass)).toEqual([]);
    for (const mode of ["light", "dark"]) for (const surface of ["sidebar", "transcript", "composer", "hud", "accent"]) expect(report.results.some((line) => line.id === `contrast:${mode}:${surface}`), `${mode} ${surface}`).toBe(true);
    expect(glassSurfaceFor(TONIGHTS_SKY, "transcript", "light")).toEqual({ opacity: 0.7, blur: 14 });
    expect(glassSurfaceFor(TONIGHTS_SKY, "transcript", "dark")).toEqual({ opacity: 0.16, blur: 6 });
    if (TONIGHTS_SKY.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    expect(TONIGHTS_SKY.scene.backdrop.modes).toEqual({ light: { dark: "#020308", light: "#ffffff" }, dark: { dark: "#020308", light: "#808aa4" } });
    expect(staticCost(TONIGHTS_SKY.scene.source)).toBeLessThan(STATIC_BUDGET);
  });
});
