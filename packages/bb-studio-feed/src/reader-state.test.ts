import { afterEach, expect, it, vi } from "vitest";
import { emptyFilters, emptyReaderState, filterError, filterInput, MAX_RESTORE_POSTS, parseReaderState, readReaderState, READER_STATE_KEY, writeReaderState } from "./reader-state";
import { rpcContract } from "./contract";

afterEach(() => vi.unstubAllGlobals());

it("includes both selected local days, including a 23-hour DST day", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const result = filterInput({ ...emptyFilters(), query: "  queue  ", unread: true, from: "2026-03-08", through: "2026-03-08" });
    expect(result).toEqual({ topic: null, query: "queue", unread: true, since: new Date(2026, 2, 8).getTime() - 1, until: new Date(2026, 2, 9).getTime() - 1 });
    expect(result.until! - result.since!).toBe(23 * 60 * 60 * 1000);
    expect(rpcContract.list.input.safeParse(result).success).toBe(true);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

it("rejects reversed ranges and nonexistent calendar dates", () => {
  expect(filterError({ ...emptyFilters(), from: "2026-02-30" })).toBe("Choose valid dates.");
  expect(filterError({ ...emptyFilters(), from: "2026-10-02", through: "2026-10-01" })).toContain("on or before");
  expect(filterError({ ...emptyFilters(), from: "2024-02-29" })).toBeNull();
});

it("restores valid filters and position while bounding untrusted browser state", () => {
  const state = { filters: { ...emptyFilters(), query: "x".repeat(500), topic: "t".repeat(100), unread: true }, open: "post_open", count: 99999, position: { postId: "post_anchor", offset: -12, scrollTop: 800 } };
  const restored = parseReaderState(JSON.stringify(state));
  expect(restored.count).toBe(MAX_RESTORE_POSTS);
  expect(restored.filters.query).toHaveLength(200);
  expect(restored.filters.topic).toHaveLength(40);
  expect(restored.open).toBe("post_open");
  expect(restored.position).toEqual(state.position);
  expect(rpcContract.list.input.safeParse(filterInput(restored.filters)).success).toBe(true);
  for (const raw of [null, "garbage", "null", "[]", "{}"])
    expect(parseReaderState(raw)).toEqual(emptyReaderState());
});

it("keeps only reader state in tab storage and tolerates disabled storage", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  const state = { ...emptyReaderState(), filters: { ...emptyFilters(), query: "Orbit" }, count: 120, open: "post_1" };
  writeReaderState(state);
  expect([...data.keys()]).toEqual([READER_STATE_KEY]);
  expect(readReaderState()).toEqual(state);
  vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } });
  expect(readReaderState()).toEqual(emptyReaderState());
  expect(() => writeReaderState(state)).not.toThrow();
});
