import { describe, expect, it } from "vitest";
import { checkTheme, staticCost, STATIC_BUDGET } from "../checks";
import { REEF_BOXES, REEF_SIZE } from "../deep-sea/atlas";
import { deepSeaDriver, type ReefCanvas } from "../deep-sea/driver";
import type { ReefContext } from "../deep-sea/paint";
import { createThemeRegistry } from "../registry";
import type { LiveUniforms, SceneLayer } from "../scene/live";
import { DEEP_SEA } from "./deep-sea";
import { BUILTIN_DRIVERS } from "./drivers";

function source(): string {
  if (DEEP_SEA.scene.kind !== "shader") throw new Error("A scene theme has a shader");
  return DEEP_SEA.scene.source;
}

function fakeCanvas() {
  const calls: string[] = [];
  const gradient = { addColorStop: () => {} };
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, name) {
      if (typeof name !== "string") return undefined;
      if (name in target) return target[name];
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => gradient;
      if (name === "createImageData") return (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
      return (..._args: unknown[]) => { calls.push(name); };
    },
    set(target, name, value) {
      if (typeof name === "string") target[name] = value;
      return true;
    },
  }) as unknown as ReefContext;
  const canvas: ReefCanvas = { width: 0, height: 0, getContext: () => context };
  return { canvas, calls };
}

describe("Deep Sea", () => {
  it("comes last in the scene row, after Data City, and has a driver", () => {
    const ids = createThemeRegistry().scenes().map((entry) => entry.theme.id);
    expect(ids.slice(-2)).toEqual(["data-city", "deep-sea"]);
    expect(BUILTIN_DRIVERS["deep-sea"]).toBeTypeOf("function");
  });

  it("passes every check under the static budget, with the dark scenes' glass, small corners and an aqua accent", () => {
    const report = checkTheme(DEEP_SEA);
    expect(report.pass, report.results.filter((line) => !line.pass).map((line) => line.reason).join("; ")).toBe(true);
    expect(staticCost(source())).toBeLessThanOrEqual(STATIC_BUDGET);
    expect(DEEP_SEA.glass).toMatchObject({ sidebar: { opacity: 0.14, blur: 6 }, main: { opacity: 0.03, blur: 0 }, transcript: { opacity: 0.16, blur: 6 }, composer: { opacity: 0.42, blur: 10 } });
    expect(DEEP_SEA.radius).toBe(6);
    expect(DEEP_SEA.variants.dark?.accent).toBe("#3cc8d8");
  });

  it("samples the painted reef only when the driver has drawn it, and keeps drawing water, rays and jellyfish when it has not", () => {
    expect(source()).toMatch(/float keep = [^;]*\* u_reef;/);
    expect(source()).toMatch(/if \(u_reef < 0\.5\) return vec3\(/);
    if (DEEP_SEA.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    expect(DEEP_SEA.scene.uniforms.u_reef).toBe(0);
  });

  it("packs every painted layer inside the texture without overlapping", () => {
    const boxes = Object.entries(REEF_BOXES);
    for (const [name, box] of boxes) {
      expect(box.x + box.width, name).toBeLessThanOrEqual(REEF_SIZE);
      expect(box.y + box.height, name).toBeLessThanOrEqual(REEF_SIZE);
    }
    for (const [name, a] of boxes) for (const [other, b] of boxes) {
      if (name === other) continue;
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      expect(apart, `${name} and ${other}`).toBe(true);
    }
  });
});

describe("Deep Sea's driver", () => {
  it("paints the reef once and publishes it as the scene's layer with u_reef on", () => {
    const { canvas, calls } = fakeCanvas();
    const published: { uniforms: LiveUniforms; layer?: SceneLayer }[] = [];
    const stop = deepSeaDriver({ createCanvas: () => canvas })((uniforms, layer) => published.push({ uniforms, layer }));
    expect(published).toEqual([{ uniforms: { u_reef: 1 }, layer: { source: canvas, version: 1 } }]);
    expect(canvas.width).toBe(REEF_SIZE);
    expect(canvas.height).toBe(REEF_SIZE);
    expect(calls.filter((call) => call === "fill").length).toBeGreaterThan(500);
    expect(calls).toContain("putImageData");
    stop();
    expect(published).toHaveLength(1);
  });

  it("leaves u_reef off where no canvas can be made", () => {
    const published: { uniforms: LiveUniforms; layer?: SceneLayer }[] = [];
    deepSeaDriver({ createCanvas: () => null })((uniforms, layer) => published.push({ uniforms, layer }));
    deepSeaDriver({ createCanvas: () => ({ width: 0, height: 0, getContext: () => null }) })((uniforms, layer) => published.push({ uniforms, layer }));
    expect(published).toEqual([{ uniforms: { u_reef: 0 }, layer: undefined }, { uniforms: { u_reef: 0 }, layer: undefined }]);
  });
});
