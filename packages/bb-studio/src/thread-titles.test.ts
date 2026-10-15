import { describe, expect, it, vi } from "vitest";
import { ThreadTitles } from "./thread-titles";

describe("thread titles", () => {
  it("looks each thread up once while fresh, and treats a failed lookup as untitled", async () => {
    let now = 0;
    const fetch = vi.fn(async (id: string) => (id === "gone" ? Promise.reject(new Error("deleted")) : ` ${id} title `));
    const titles = new ThreadTitles(fetch, () => now);
    expect(await titles.titles(["a", "a", "gone"])).toEqual(new Map([["a", "a title"], ["gone", ""]]));
    await titles.titles(["a"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    now = 10 * 60_000;
    await titles.titles(["a"]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
