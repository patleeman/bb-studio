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

  it("handles empty input and concurrency greater than item count", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
    expect(await mapPool([1, 2], 10, async (n) => n * 2)).toEqual([2, 4]);
  });

  it("rejects non-integer or non-positive concurrency", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(mapPool([1], bad, async (n) => n)).rejects.toThrow("positive integer");
    }
  });

  it("stops starting new items after a failure, waits for in-flight work, and throws the lowest-index error", async () => {
    const started: number[] = [];
    let inflightFinished = false;
    await expect(
      mapPool([0, 1, 2, 3, 4], 3, async (item) => {
        started.push(item);
        if (item === 1) {
          // Rejects slower than item 2, but has a lower index so it must be thrown.
          await new Promise((resolve) => setTimeout(resolve, 25));
          throw new Error("err-1");
        }
        if (item === 2) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new Error("err-2");
        }
        if (item === 0) {
          await new Promise((resolve) => setTimeout(resolve, 35));
          inflightFinished = true;
        }
        return item;
      }),
    ).rejects.toThrow("err-1");
    expect(inflightFinished).toBe(true);
    // Items 3 and 4 must not have been started after item 2 failed.
    expect(started).toEqual([0, 1, 2]);
  });
});
