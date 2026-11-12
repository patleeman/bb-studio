import { describe, expect, it } from "vitest";
import { BUILTIN_DRIVERS } from "../builtin/drivers";
import { GRID } from "../builtin/grid";
import { checkTheme, staticCost, STATIC_BUDGET } from "../checks";
import type { LiveUniforms, SceneLayer } from "../scene/live";
import { CITY_BOXES, CITY_SIZE } from "./atlas";
import { gridDriver, type CityCanvas } from "./driver";
import type { CityContext } from "./paint";

function fakeCanvas() {
  const calls: string[] = [];
  const gradient = { addColorStop: () => {} };
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, name) {
      if (typeof name !== "string") return undefined;
      if (name in target) return target[name];
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => gradient;
      return (..._args: unknown[]) => { calls.push(name); };
    },
    set(target, name, value) {
      if (typeof name === "string") target[name] = value;
      return true;
    },
  }) as unknown as CityContext;
  const canvas: CityCanvas = { width: 0, height: 0, getContext: () => context };
  return { canvas, calls };
}

describe("Grid's painted city", () => {
  it("passes every check under the static budget and keeps its square corners and cyan", () => {
    const report = checkTheme(GRID);
    expect(report.pass, report.results.filter((line) => !line.pass).map((line) => line.reason).join("; ")).toBe(true);
    if (GRID.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    expect(staticCost(GRID.scene.source)).toBeLessThanOrEqual(STATIC_BUDGET);
    expect(GRID.scene.uniforms.u_city).toBe(0);
    expect(GRID.radius).toBe(2);
    expect(GRID.variants.dark?.accent).toBe("#5ff6ff");
    expect(BUILTIN_DRIVERS.grid).toBeTypeOf("function");
  });

  it("packs the skylines, the ring and the light cycle inside the texture without overlapping", () => {
    const boxes = Object.entries(CITY_BOXES);
    for (const [name, box] of boxes) {
      expect(box.x + box.width, name).toBeLessThanOrEqual(CITY_SIZE);
      expect(box.y + box.height, name).toBeLessThanOrEqual(CITY_SIZE);
    }
    for (const [name, a] of boxes) for (const [other, b] of boxes) {
      if (name === other) continue;
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${name} and ${other}`).toBe(true);
    }
  });

  it("paints the city once and publishes it as the scene's layer with u_city on", () => {
    const { canvas, calls } = fakeCanvas();
    const published: { uniforms: LiveUniforms; layer?: SceneLayer }[] = [];
    const stop = gridDriver({ createCanvas: () => canvas })((uniforms, layer) => published.push({ uniforms, layer }));
    expect(published).toEqual([{ uniforms: { u_city: 1 }, layer: { source: canvas, version: 1 } }]);
    expect(canvas.width).toBe(CITY_SIZE);
    expect(calls.filter((call) => call === "fillRect").length).toBeGreaterThan(1000);
    stop();
    expect(published).toHaveLength(1);
  });

  it("leaves u_city off, and the shader on its own towers, where no canvas can be made", () => {
    const published: { uniforms: LiveUniforms; layer?: SceneLayer }[] = [];
    gridDriver({ createCanvas: () => null })((uniforms, layer) => published.push({ uniforms, layer }));
    gridDriver({ createCanvas: () => ({ width: 0, height: 0, getContext: () => null }) })((uniforms, layer) => published.push({ uniforms, layer }));
    expect(published).toEqual([{ uniforms: { u_city: 0 }, layer: undefined }, { uniforms: { u_city: 0 }, layer: undefined }]);
  });
});
