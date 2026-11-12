import { describe, expect, it } from "vitest";
import { BUILTIN_FORMS, drawPresence, polyParts, POLY_HOLD, POLY_SOLIDS, PRESENCE_STATES, satelliteCount, tesseractVertex, tierOf, type Palette, type PresenceContext, type PresenceFrame } from "./forms";

const PALETTE: Palette = [[255, 79, 216], [123, 47, 247], [79, 240, 255]];

function recorder() {
  const calls: string[] = [];
  const styles: string[] = [];
  const paint = { arc: 0, lineTo: 0, fill: 0, stroke: 0, fillRect: 0 };
  const gradient = { addColorStop(_at: number, color: string) { styles.push(color); } };
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_object, key: string) {
      if (key === "createRadialGradient" || key === "createLinearGradient") return (...args: number[]) => { calls.push(`${key}(${args.map((arg) => arg.toFixed(2)).join(",")})`); return gradient; };
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        if (key in paint) paint[key as keyof typeof paint]++;
        calls.push(`${key}(${args.map((arg) => (typeof arg === "number" ? arg.toFixed(2) : String(arg))).join(",")})`);
      };
    },
    set(_object, key: string, value: unknown) {
      target[key] = value;
      if (key === "fillStyle" || key === "strokeStyle") styles.push(String(value));
      calls.push(`${key}=${typeof value === "string" || typeof value === "number" ? value : "gradient"}`);
      return true;
    },
  }) as unknown as PresenceContext;
  return { ctx, calls, styles, paint, digest: () => calls.join("|") };
}

function render(over: Partial<PresenceFrame>) {
  const record = recorder();
  drawPresence(record.ctx, { form: "orb", size: 36, dpr: 2, clock: 2.2, formTime: 5.5, state: "idle", workers: 2, palette: PALETTE, light: false, ...over });
  return record;
}

describe("the eight built-in forms", () => {
  for (const form of BUILTIN_FORMS) {
    for (const size of [24, 36, 160]) {
      it(`${form} draws at ${size} px, and each state draws differently`, () => {
        const digests = PRESENCE_STATES.map((state) => {
          const record = render({ form, size, state });
          expect(record.paint.fill + record.paint.stroke, `${form} ${state}`).toBeGreaterThan(3);
          expect(record.calls.some((call) => call.includes("NaN")), `${form} ${state} NaN`).toBe(false);
          expect(record.calls[0]).toBe("setTransform(2.00,0.00,0.00,2.00,0.00,0.00)");
          return record.digest();
        });
        expect(new Set(digests).size).toBe(PRESENCE_STATES.length);
      });
    }
    it(`${form} moves with time and is the same picture at the same time`, () => {
      expect(render({ form, size: 160 }).digest()).toBe(render({ form, size: 160 }).digest());
      expect(render({ form, size: 160, formTime: 6.5 }).digest()).not.toBe(render({ form, size: 160 }).digest());
    });
    it(`${form} is simpler at 24 px than at 160 px`, () => {
      expect(render({ form, size: 24 }).calls.length).toBeLessThan(render({ form, size: 160 }).calls.length);
    });
  }
});

describe("the four states", () => {
  it("working draws one satellite per running worker, capped by size", () => {
    expect(satelliteCount(1, "tiny")).toBe(1);
    expect(satelliteCount(5, "tiny")).toBe(3);
    expect(satelliteCount(5, "small")).toBe(4);
    expect(satelliteCount(9, "full")).toBe(6);
    expect(satelliteCount(0, "full")).toBe(1);
    const arcs = (workers: number) => render({ form: "tesseract", size: 36, state: "working", workers }).paint.arc;
    expect(arcs(2) - arcs(1)).toBe(arcs(3) - arcs(2));
    expect(arcs(2)).toBeGreaterThan(arcs(1));
  });

  it("thinking sweeps a shimmer over the form and has no satellites; working has no shimmer", () => {
    const thinking = render({ form: "knot", state: "thinking" }), working = render({ form: "knot", state: "working" });
    expect(thinking.calls).toContain("globalCompositeOperation=source-atop");
    expect(working.calls).not.toContain("globalCompositeOperation=source-atop");
    expect(working.paint.arc).toBeGreaterThan(thinking.paint.arc);
  });

  it("needs you turns amber and adds two pulse rings", () => {
    const needs = render({ form: "poly", state: "needs" }), idle = render({ form: "poly", state: "idle" });
    expect(needs.styles.some((style) => style.startsWith("rgba(255,171,61"))).toBe(true);
    expect(idle.styles.some((style) => style.startsWith("rgba(255,171,61"))).toBe(false);
    expect(needs.styles.some((style) => style.startsWith("rgba(255,79,216"))).toBe(false);
  });

  it("stays inside the picture at 24 and 36 px in every state", () => {
    for (const form of BUILTIN_FORMS) for (const size of [24, 36]) for (const state of PRESENCE_STATES) for (const formTime of [0, 3.1, 7.7, 12.9, 21.3, 33]) {
      const record = render({ form, size, state, formTime, clock: formTime / 3 });
      for (const call of record.calls) {
        const found = /^(?:lineTo|moveTo)\(([-\d.]+),([-\d.]+)\)$/.exec(call);
        if (found) expect(Math.max(Math.abs(Number(found[1])), Math.abs(Number(found[2]))), `${form} ${size} ${state} ${formTime} ${call}`).toBeLessThanOrEqual(size * 0.5);
      }
    }
  });

  it("a light ground draws with normal blending in darker ink", () => {
    expect(render({ form: "tesseract", light: true }).calls).not.toContain("globalCompositeOperation=lighter");
    expect(render({ form: "tesseract" }).calls).toContain("globalCompositeOperation=lighter");
  });
});

describe("the geometry", () => {
  it("picks a tier by size", () => {
    expect([24, 29, 30, 36, 69, 70, 160].map(tierOf)).toEqual(["tiny", "tiny", "small", "small", "small", "full", "full"]);
  });

  it("the tesseract turns in 4D: w changes and lengths are kept", () => {
    const start = tesseractVertex([1, 1, 1, 1], 0), later = tesseractVertex([1, 1, 1, 1], 1.3);
    expect(start).toEqual([1, 1, 1, 1]);
    expect(Math.abs(later[3] - 1)).toBeGreaterThan(0.2);
    expect(later[2]).toBe(1);
    expect(Math.hypot(...later)).toBeCloseTo(2, 10);
  });

  it("the polyhedron holds one solid, then fades to the next as a compound of the two", () => {
    expect(POLY_SOLIDS.map((solid) => [solid.V.length, solid.E.length])).toEqual([[12, 30], [20, 30], [8, 12], [6, 12]]);
    for (let solid = 0; solid < 4; solid++) {
      const held = polyParts(solid + POLY_HOLD / 2);
      expect(held).toEqual([{ solid, alpha: 1, scale: expect.any(Number) }]);
      expect(held[0]!.scale * POLY_SOLIDS[solid]!.radius).toBeCloseTo(1, 6);
      const mid = polyParts(solid + POLY_HOLD + (1 - POLY_HOLD) / 2);
      expect(mid.map((part) => part.solid)).toEqual([solid, (solid + 1) % 4]);
      expect(mid[0]!.alpha).toBeGreaterThan(0.5);
      expect(mid[1]!.alpha).toBeGreaterThan(0.5);
    }
  });

  it("the polyhedron's size never jumps between frames", () => {
    let last: Map<number, number> | null = null;
    for (let phase = 0; phase <= 4.001; phase += 0.005) {
      const now = new Map(polyParts(phase).map((part) => [part.solid, part.scale * POLY_SOLIDS[part.solid]!.radius]));
      if (last) for (const [solid, radius] of now) if (last.has(solid)) expect(Math.abs(radius - last.get(solid)!), `phase ${phase}`).toBeLessThan(0.03);
      last = now;
    }
  });

  it("mid-fade the icosahedron and dodecahedron are duals, and the cube sits on the dodecahedron's corners", () => {
    const [ico, dod] = polyParts(POLY_HOLD + 0.2);
    const icoEdge = POLY_SOLIDS[0]!.E[0]!, mid = (solid: number, edge: readonly [number, number], scale: number) => {
      const a = POLY_SOLIDS[solid]!.V[edge[0]]!, b = POLY_SOLIDS[solid]!.V[edge[1]]!;
      return Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2) * scale;
    };
    expect(mid(0, icoEdge, ico!.scale)).toBeCloseTo(mid(1, POLY_SOLIDS[1]!.E[0]!, dod!.scale), 6);
    const [dodLate, cube] = polyParts(1 + POLY_HOLD + 0.2);
    expect(cube!.scale * POLY_SOLIDS[2]!.radius).toBeCloseTo(dodLate!.scale * POLY_SOLIDS[1]!.radius, 6);
  });
});
