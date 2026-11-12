import { describe, expect, it } from "vitest";
import { AMBER_LIGHT, PRESENCE_STATES, type Palette } from "./forms";
import { haloFilter, haloPulse } from "./halo";
import { tripleToHex } from "./palette";

const palette: Palette = [[9, 105, 218], [26, 50, 120], [154, 103, 0]];
const halo = (over: Partial<Parameters<typeof haloFilter>[0]> = {}) => haloFilter({ surfaceLight: true, state: "idle", size: 24, clock: 1, palette, ...over });

describe("the halo behind a presence", () => {
  it("is off on a dark surface in every state", () => {
    for (const state of PRESENCE_STATES) expect(halo({ surfaceLight: false, state })).toBe("none");
  });

  it("outlines the shape in the surface's ink, with no fixed gray", () => {
    for (const state of PRESENCE_STATES) {
      const filter = halo({ state });
      expect(filter).toMatch(/^drop-shadow\(0 0 [\d.]+px color-mix\(in oklab, var\(--ink\) \d+%, transparent\)\)/);
      expect(filter).not.toMatch(/oklch\([^)]* 0 0\)|#808080|rgba?\(/);
    }
  });

  it("gives each state its own look: idle a plain outline, thinking a pulsing glow, working a firmer outline, needs an amber glow", () => {
    expect(halo({ state: "idle" }).match(/drop-shadow/g)).toHaveLength(1);
    expect(halo({ state: "thinking" })).toContain(tripleToHex(palette[0]));
    expect(halo({ state: "working" }).match(/var\(--ink\)/g)).toHaveLength(2);
    expect(halo({ state: "needs" })).toContain(tripleToHex(AMBER_LIGHT[0]));
    expect(new Set(PRESENCE_STATES.map((state) => halo({ state })))).toHaveProperty("size", 4);
  });

  it("pulses while thinking and holds still while working, and the same clock gives the same halo", () => {
    expect(haloPulse("thinking", 0.3)).not.toBeCloseTo(haloPulse("thinking", 0.9), 2);
    expect(halo({ state: "working", clock: 0.3 })).toBe(halo({ state: "working", clock: 0.9 }));
    expect(halo({ state: "thinking", clock: 0.3 })).toBe(halo({ state: "thinking", clock: 0.3 }));
  });

  it("stays thin at icon sizes and capped at the picker's size", () => {
    expect(halo({ size: 24 })).toMatch(/^drop-shadow\(0 0 0\.5px/);
    expect(halo({ size: 280 })).toMatch(/^drop-shadow\(0 0 1\.25px/);
    expect(halo({ size: 280, state: "thinking" })).toContain("drop-shadow(0 0 7px");
  });
});
