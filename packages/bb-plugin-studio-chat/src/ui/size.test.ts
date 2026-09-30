import { describe, expect, it } from "vitest";
import { clampSize } from "./size";

describe("clampSize", () => {
  const viewport = { width: 1440, height: 900 };

  it("keeps a size that fits", () => {
    expect(clampSize({ width: 520, height: 700 }, viewport)).toEqual({ width: 520, height: 700 });
  });

  it("stops at the minimum and keeps clear of the screen edges", () => {
    expect(clampSize({ width: 100, height: 100 }, viewport)).toEqual({ width: 340, height: 320 });
    expect(clampSize({ width: 5000, height: 5000 }, viewport)).toEqual({ width: 1400, height: 788 });
  });

  it("prefers the minimum on a screen smaller than it", () => {
    expect(clampSize({ width: 500, height: 500 }, { width: 300, height: 300 })).toEqual({ width: 340, height: 320 });
  });
});
