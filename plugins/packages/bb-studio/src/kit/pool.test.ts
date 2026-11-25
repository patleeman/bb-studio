import { describe, expect, it } from "vitest";
import { mapPool } from "./pool";

describe("mapPool", () => {
  it("preserves input order while bounding in-flight concurrency", async () => {
    let active = 0;
    let peak = 0;
    const items = [40, 10, 30, 5, 25, 15, 20, 10];
    const results = await mapPool(items, 3, async (delay, index) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return `${index}:${delay}`;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(results).toEqual(items.map((delay, index) => `${index}:${delay}`));
  });

  it("handles empty input without invoking fn", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
