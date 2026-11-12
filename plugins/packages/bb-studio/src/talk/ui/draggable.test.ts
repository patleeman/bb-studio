// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadPosition, toFraction, toPixels } from "./draggable";

const bounds = { width: 1000, height: 800, insetTop: 20, insetBottom: 10 };
const size = { width: 300, height: 40 };

describe("pill position", () => {
  it("maps the corners of the free space", () => {
    expect(toPixels({ x: 0, y: 0 }, bounds, size)).toEqual({ left: 8, top: 28 });
    expect(toPixels({ x: 1, y: 1 }, bounds, size)).toEqual({ left: 692, top: 742 });
    expect(toPixels({ x: 0.5, y: 0 }, bounds, size)).toEqual({ left: 350, top: 28 });
  });

  it("round-trips pixels through fractions", () => {
    const pixels = { left: 400, top: 300 };
    expect(toPixels(toFraction(pixels, bounds, size), bounds, size)).toEqual(pixels);
  });

  it("clamps drags past the window edge", () => {
    expect(toFraction({ left: -500, top: 5000 }, bounds, size)).toEqual({ x: 0, y: 1 });
  });

  it("keeps a full-width pill in place", () => {
    const phone = { width: 390, height: 844, insetTop: 47, insetBottom: 34 };
    const wide = { width: 374, height: 48 };
    expect(toFraction({ left: 120, top: 55 }, phone, wide)).toEqual({ x: 0.5, y: 0 });
    expect(toPixels({ x: 0.9, y: 0 }, phone, wide).left).toBe(8);
  });
});

describe("loadPosition", () => {
  it("starts where the caller asks until the pill has been dragged, then remembers the drag", () => {
    localStorage.removeItem("test:pill");
    expect(loadPosition("test:pill")).toEqual({ x: 0.5, y: 0 });
    expect(loadPosition("test:pill", { x: 1, y: 0.8 })).toEqual({ x: 1, y: 0.8 });
    localStorage.setItem("test:pill", JSON.stringify({ x: 0.2, y: 0.3 }));
    expect(loadPosition("test:pill", { x: 1, y: 0.8 })).toEqual({ x: 0.2, y: 0.3 });
    localStorage.removeItem("test:pill");
  });
});
