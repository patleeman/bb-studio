import { describe, expect, it } from "vitest";
import { LruCache } from "./lru";

describe("LruCache", () => {
  it("evicts the least-recently-used entry when exceeding max", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1).set("b", 2);
    // Touch "a" so "b" becomes the least-recently-used key.
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("refreshes recency on overwrite and supports undefined values", () => {
    const cache = new LruCache<string, string | undefined>(2);
    cache.set("a", undefined);
    cache.set("b", "two");
    expect(cache.has("a")).toBe(true);
    cache.set("a", "one");
    cache.set("c", "three");
    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")).toBe("one");
  });
});
