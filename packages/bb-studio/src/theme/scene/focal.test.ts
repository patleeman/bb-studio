import { describe, expect, it } from "vitest";
import { JELLY_FIT, WHALE_FIT } from "../builtin/deep-sea";
import { DEEP_SEA } from "../builtin/deep-sea";
import { BIKE_FIT, GRID, RING_FIT, RING_HALF_WIDTH } from "../builtin/grid";
import { clearFromRect, type ClearRect } from "./contract";
import { FOCAL_FADE, FOCAL_GLSL, FOCAL_INSET, focalSpan } from "./focal";
import { cardSlots, layoutColumn, openRect, type SceneLayout } from "./layout";

const OLD_INSET = 0.045;

function openOf(layout: SceneLayout): ClearRect | null {
  const rect = openRect(layout);
  return rect ? clearFromRect(rect, layout, layout) : null;
}

function source(theme: typeof GRID): string {
  if (theme.scene.kind !== "shader") throw new Error("A scene theme has a shader");
  return theme.scene.source;
}

const closed = [
  { width: 1600, height: 1000, sidebar: 320, panel: null },
  { width: 1680, height: 930, sidebar: 320, panel: null },
] satisfies SceneLayout[];

const withPanel = [
  { width: 1600, height: 1000, sidebar: 320, panel: { left: 1180, top: 48, right: 1590, bottom: 988 } },
  { width: 1680, height: 930, sidebar: 320, panel: { left: 1260, top: 48, right: 1670, bottom: 918 } },
] satisfies SceneLayout[];

describe("the focal span in the open area", () => {
  for (const layout of closed) {
    it(`at ${layout.width} px with the side panel closed, is wider than the old fully clear zone and stays clear of the transcript card`, () => {
      const open = openOf(layout)!;
      const column = layoutColumn(layout);
      const span = focalSpan(open, layout.width, layout.height);
      const oldClear = open[2] - (open[0] + 2.2 * OLD_INSET * layout.height);
      expect(span.left).toBeGreaterThanOrEqual(column.right + 2.2 * FOCAL_INSET * layout.height - 0.01);
      expect(span.right).toBeLessThan(layout.width);
      expect(span.right - span.left).toBeGreaterThan(oldClear * 1.2);
    });

    it(`at ${layout.width} px, Grid's ring, Deep Sea's whale and jellyfish and Grid's light cycles fit inside it`, () => {
      const span = focalSpan(openOf(layout)!, layout.width, layout.height);
      const width = (span.right - span.left) / layout.height;
      const ringRadius = Math.min(Math.max(RING_FIT * width, 0.04), 0.36) * RING_HALF_WIDTH;
      expect(2 * ringRadius).toBeLessThanOrEqual(width);
      expect(Math.min(0.22, WHALE_FIT * width)).toBeLessThanOrEqual(width);
      const body = Math.min(0.05, JELLY_FIT * width);
      expect(2.2 * body).toBeLessThan(width);
      const bike = BIKE_FIT * width;
      expect(bike).toBeLessThan(width / 2);
    });
  }

  for (const layout of withPanel) {
    it(`at ${layout.width} px with the side panel open, has no room, so the movers hide`, () => {
      expect(openOf(layout)).toBeNull();
      expect(cardSlots(layout)[2]).not.toBeNull();
    });
  }

  it("is the span both scenes use, with the tighter fade for their subjects", () => {
    for (const theme of [GRID, DEEP_SEA]) {
      expect(source(theme)).toContain(FOCAL_GLSL);
      expect(source(theme)).toContain(`float clearing = ${FOCAL_FADE};`);
    }
    expect(source(DEEP_SEA)).toMatch(/float rise = fract\(w\.x \+ 0\.21 \+ w\.y \* 0\.006\);/);
    expect(source(GRID)).toMatch(/float rowA = hz \* \([^;]*fract\(w\.x \+ 0\.21\)\);/);
  });

  it("spreads the workers' rows: the golden-ratio seeds stay apart, unlike seed × 1.618", () => {
    const seeds = [0, 1, 2, 3].map((slot) => Math.round(((slot * 0.6180339887 + 0.137) % 1) * 1000) / 1000);
    const apart = (values: number[]) => Math.min(...values.flatMap((a, i) => values.slice(i + 1).map((b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); })));
    expect(apart(seeds.map((seed) => (seed * 1.618 + 0.21) % 1))).toBeLessThan(0.01);
    expect(apart(seeds.map((seed) => (seed + 0.21) % 1))).toBeGreaterThan(0.14);
  });

  it("turns Grid's light cycles at the span's ends instead of running them off the window", () => {
    const grid = source(GRID);
    expect(grid).toMatch(/float from = dir > 0\.0 \? lane\.x \+ room : lane\.y - room;/);
    expect(grid).toMatch(/float rowY = mix\(row, other, bend\);/);
    expect(grid).not.toMatch(/mix\(-0\.1, 1\.1/);
  });
});
