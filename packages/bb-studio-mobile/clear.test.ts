import { describe, expect, it } from "vitest";
import { clearPayload, noteNotified, NOTIFIED_TTL_MS, partition, settled, type ThreadReadState } from "./clear.js";

const thread = (overrides: Partial<ThreadReadState> = {}): ThreadReadState => ({
  hasPendingInteraction: false,
  lastReadAt: null,
  latestAttentionAt: 1_000,
  archivedAt: null,
  deletedAt: null,
  ...overrides,
});

describe("settled", () => {
  it("waits while the latest reply is unread", () => {
    expect(settled(thread({ lastReadAt: 999 }))).toBe(false);
    expect(settled(thread())).toBe(false);
  });

  it("clears once read", () => {
    expect(settled(thread({ lastReadAt: 1_000 }))).toBe(true);
  });

  it("waits while a question is open, even if read", () => {
    expect(settled(thread({ lastReadAt: 2_000, hasPendingInteraction: true }))).toBe(false);
  });

  it("clears archived, deleted, and missing threads", () => {
    expect(settled(thread({ archivedAt: 5 }))).toBe(true);
    expect(settled(thread({ deletedAt: 5 }))).toBe(true);
    expect(settled(null)).toBe(true);
  });

  it("preserves notifications when a lookup failed or has no result", () => {
    expect(settled(undefined)).toBe(false);
    expect(partition({ thr_a: 100 }, {}, 200)).toEqual({ clear: [], keep: { thr_a: 100 } });
  });
});

describe("partition", () => {
  it("clears settled threads and keeps the rest", () => {
    const notified = noteNotified({}, ["thr_a", "thr_b"], 100);
    const result = partition(notified, { thr_a: thread({ lastReadAt: 1_000 }), thr_b: thread() }, 200);
    expect(result).toEqual({ clear: ["thr_a"], keep: { thr_b: 100 } });
  });

  it("forgets threads past the TTL without clearing them", () => {
    const result = partition({ thr_a: 0 }, { thr_a: thread() }, NOTIFIED_TTL_MS + 1);
    expect(result).toEqual({ clear: [], keep: {} });
  });
});

describe("clearPayload", () => {
  it("is a silent push listing the threads", () => {
    expect(JSON.parse(clearPayload(["thr_a"]))).toEqual({ aps: { "content-available": 1 }, clearThreadIds: ["thr_a"] });
  });
});
