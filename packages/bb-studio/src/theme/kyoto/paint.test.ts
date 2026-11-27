import { describe, expect, it } from "vitest";
import type { SceneLayer } from "../scene/live";
import { ATLAS_SIZE, gardenSpec, specKey, TILES, tileVec, WORLD, type GardenSpec, type Tile } from "./atlas";
import { GARDEN_TICK_MS, gardenPainter, kyotoDriver, type GardenCanvas } from "./driver";
import { paintGarden, type GardenContext } from "./paint";
import { readGarden, type KyotoUniforms } from "./scene";

const KYOTO = { name: "Kyoto, Japan", latitude: 35, longitude: 135.8, source: "city" as const };
const uniformsAt = (iso: string, snow = 0): KyotoUniforms => {
  const uniforms = readGarden(new Date(iso), { place: KYOTO, weather: null }).uniforms;
  return { ...uniforms, u_weather: [uniforms.u_weather[0], uniforms.u_weather[1], snow] };
};

interface Recorded { fills: { tile: string; style: string }[]; clips: Tile[]; cleared: number; bad: number; operations: string[] }

const TILE_ENTRIES = Object.entries(TILES);

function recorder(): { context: GardenContext; seen: Recorded } {
  const seen: Recorded = { fills: [], clips: [], cleared: 0, bad: 0, operations: [] };
  const stack: string[] = [];
  let tile = "";
  let pending: Tile | null = null;
  let composite = "source-over";
  const num = (v: number) => { if (!Number.isFinite(v)) seen.bad += 1; };
  const gradient = { addColorStop: (offset: number) => num(offset) } as unknown as CanvasGradient;
  const ctx = {
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    strokeStyle: "" as string | CanvasGradient | CanvasPattern,
    lineWidth: 1,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    get globalCompositeOperation(): GlobalCompositeOperation { return composite as GlobalCompositeOperation; },
    set globalCompositeOperation(value: GlobalCompositeOperation) { composite = String(value); seen.operations.push(composite); },
    save() { stack.push(tile); },
    restore() { tile = stack.pop() ?? ""; },
    translate(x: number, y: number) { num(x); num(y); },
    scale(x: number, y: number) { num(x); num(y); },
    beginPath() {},
    closePath() {},
    rect(x: number, y: number, width: number, height: number) { num(x); num(y); num(width); num(height); pending = { x, y, width, height }; },
    clip() {
      if (!pending) return;
      seen.clips.push(pending);
      tile = TILE_ENTRIES.find(([, each]) => each.x === pending!.x && each.y === pending!.y)?.[0] ?? "?";
    },
    moveTo(x: number, y: number) { num(x); num(y); },
    lineTo(x: number, y: number) { num(x); num(y); },
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) { num(cpx); num(cpy); num(x); num(y); },
    ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number) {
      num(x); num(y); num(rx); num(ry); num(rot); num(start); num(end);
    },
    arc(x: number, y: number, r: number, start: number, end: number) { num(x); num(y); num(r); num(start); num(end); },
    fill() { seen.fills.push({ tile, style: String(ctx.fillStyle) }); },
    stroke() {},
    fillRect(x: number, y: number, w: number, h: number) { num(x); num(y); num(w); num(h); seen.fills.push({ tile, style: String(ctx.fillStyle) }); },
    clearRect(x: number, y: number, width: number, height: number) { num(x); num(y); num(width); num(height); seen.cleared = width * height; },
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) { num(x0); num(y0); num(x1); num(y1); return gradient; },
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
      num(x0); num(y0); num(r0); num(x1); num(y1); num(r1);
      return gradient;
    },
  };
  return { context: ctx as unknown as GardenContext, seen };
}

function paintOf(spec: GardenSpec): Recorded {
  const { context, seen } = recorder();
  paintGarden(context, spec);
  return seen;
}

const AUTUMN: GardenSpec = { spring: 0, summer: 0, autumn: 1, winter: 0, snow: 0, low: 0 };
const WINTER: GardenSpec = { spring: 0, summer: 0, autumn: 0, winter: 1, snow: 0.9, low: 0 };
const count = (seen: Recorded, tile: string, style?: string) => seen.fills.filter((fill) => fill.tile === tile && (!style || fill.style === style)).length;

describe("the Kyoto Garden atlas", () => {
  it("lays its tiles out inside the texture without overlap, and names each to the shader as a fraction of it", () => {
    const tiles = Object.entries(TILES);
    for (const [name, tile] of tiles) {
      expect(tile.x + tile.width, name).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(tile.y + tile.height, name).toBeLessThanOrEqual(ATLAS_SIZE);
      for (const [other, each] of tiles) {
        if (other === name) continue;
        const apart = tile.x + tile.width <= each.x || each.x + each.width <= tile.x || tile.y + tile.height <= each.y || each.y + each.height <= tile.y;
        expect(apart, `${name} and ${other}`).toBe(true);
      }
    }
    expect(tileVec("maple")).toBe("vec4(0.00000, 0.43750, 0.56250, 0.25000)");
    expect(tileVec("mask")).toBe("vec4(0.56250, 0.68750, 0.28125, 0.07422)");
    expect(TILES.mask.width * 2).toBe(TILES.pond.width);
    expect(TILES.maple.width).toBe(TILES.pond.width);
    expect(WORLD.mapleLeft + WORLD.trunk).toBeLessThan(TILES.maple.width / 800);
  });

  it("reads one painting from a season, its snow and a low sun, in steps coarse enough to repaint rarely", () => {
    expect(gardenSpec(uniformsAt("2026-11-11T03:00:00Z"))).toEqual({ spring: 0, summer: 0, autumn: 1, winter: 0, snow: 0, low: 0 });
    expect(gardenSpec(uniformsAt("2026-01-20T03:00:00Z"))).toEqual({ spring: 0, summer: 0, autumn: 0, winter: 1, snow: 0.9, low: 0 });
    expect(gardenSpec(uniformsAt("2026-07-11T03:00:00Z", 0.62)).snow).toBe(0.6);
    expect(gardenSpec(uniformsAt("2026-11-11T07:35:00Z")).low).toBe(1);
    expect(specKey(gardenSpec(uniformsAt("2026-11-11T03:00:00Z")))).toBe(specKey(gardenSpec(uniformsAt("2026-11-11T04:30:00Z"))));
    expect(specKey(gardenSpec(uniformsAt("2026-11-11T03:00:00Z")))).not.toBe(specKey(gardenSpec(uniformsAt("2026-12-01T03:00:00Z"))));
  });

  it("paints every tile inside its own clip with finite numbers, the same way each time", () => {
    const first = paintOf(AUTUMN);
    expect(first.cleared).toBe(ATLAS_SIZE * ATLAS_SIZE);
    expect(first.bad).toBe(0);
    const tiles = Object.entries(TILES).filter(([name]) => name !== "marker").map(([, tile]) => tile);
    expect(first.clips).toHaveLength(tiles.length);
    expect(first.clips).toEqual(expect.arrayContaining(tiles));
    for (const name of Object.keys(TILES)) if (name !== "marker") expect(count(first, name), name).toBeGreaterThan(20);
    expect(count(first, "maple")).toBeGreaterThan(8000);
    expect(count(first, "ground")).toBeGreaterThan(8000);
    expect(first.fills.at(-1)).toEqual({ tile: "", style: "#fff" });
    const second = paintOf(AUTUMN);
    const same = second.fills.length === first.fills.length && second.fills.every((f, i) => f.tile === first.fills[i]!.tile && f.style === first.fills[i]!.style);
    if (!same) expect(second.fills).toEqual(first.fills);
    expect(same).toBe(true);
  });

  it("keeps the pond's water and the canopy's shade in separate channels of the mask, and cuts the water out of the bank", () => {
    const seen = paintOf(AUTUMN);
    expect(count(seen, "mask", "rgb(255,0,0)")).toBe(1);
    expect(seen.fills.filter((fill) => fill.tile === "mask")[0]!.style).toBe("#000");
    expect(seen.operations).toEqual(["destination-out", "lighter"]);
    expect(count(seen, "pond", "#000")).toBe(1);
  });

  it("strips the maple to twigs and lays snow in winter, and warms the canopy's rim when the sun is low", () => {
    const autumn = paintOf(AUTUMN);
    const winter = paintOf(WINTER);
    const snow = "rgba(244,247,252,";
    const snowIn = (seen: Recorded, tile: string) => seen.fills.filter((fill) => fill.tile === tile && fill.style.startsWith(snow)).length;
    expect(count(winter, "maple")).toBeLessThan(count(autumn, "maple") / 4);
    for (const tile of ["mid", "bamboo", "stone", "maple"]) { expect(snowIn(winter, tile), tile).toBeGreaterThan(0); expect(snowIn(autumn, tile), tile).toBe(0); }
    expect(count(paintOf({ ...AUTUMN, low: 1 }), "maple")).toBeGreaterThan(count(autumn, "maple") + 1000);
  });
});

describe("the Kyoto Garden painter", () => {
  const canvasOf = () => { const { context, seen } = recorder(); const canvas: GardenCanvas = { width: 0, height: 0, getContext: () => context }; return { canvas, seen }; };

  it("paints once per painting and hands the engine a new version only when the painting changes", () => {
    const { canvas, seen } = canvasOf();
    const paint = gardenPainter(() => canvas);
    const first = paint(uniformsAt("2026-11-11T03:00:00Z"));
    expect(first).toEqual({ source: canvas, version: 1 });
    expect([canvas.width, canvas.height]).toEqual([ATLAS_SIZE, ATLAS_SIZE]);
    const fills = seen.fills.length;
    expect(paint(uniformsAt("2026-11-11T04:00:00Z"))).toBeUndefined();
    expect(seen.fills.length).toBe(fills);
    expect(paint(uniformsAt("2026-01-20T03:00:00Z"))).toEqual({ source: canvas, version: 2 });
    expect(gardenPainter(() => null)(uniformsAt("2026-11-11T03:00:00Z"))).toBeUndefined();
    expect(gardenPainter(() => ({ width: 0, height: 0, getContext: () => null }))(uniformsAt("2026-11-11T03:00:00Z"))).toBeUndefined();
  });

  it("is published by the driver with the first uniforms and again when the season's painting changes", async () => {
    const { canvas } = canvasOf();
    let clock = Date.parse("2026-11-11T03:00:00Z");
    const timers = new Map<number, () => void>();
    const layers: (SceneLayer | undefined)[] = [];
    const stop = kyotoDriver({
      createCanvas: () => canvas,
      loadSky: async () => ({ place: KYOTO, weather: null }),
      loadPreview: async () => null,
      now: () => clock,
      timeZone: () => "Asia/Tokyo",
      every: (ms, run) => { timers.set(ms, run); return () => timers.delete(ms); },
    })((_uniforms, layer) => layers.push(layer));
    expect(layers[0]).toEqual({ source: canvas, version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock = Date.parse("2026-11-11T03:40:00Z");
    timers.get(GARDEN_TICK_MS)!();
    expect(layers.filter(Boolean)).toHaveLength(1);
    clock = Date.parse("2027-01-20T03:00:00Z");
    timers.get(GARDEN_TICK_MS)!();
    expect(layers.filter(Boolean).at(-1)).toEqual({ source: canvas, version: 2 });
    stop();
  });
});
