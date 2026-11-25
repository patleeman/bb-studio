import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExpoMessage } from "./apns.js";
import { PushWindows } from "./push-window.js";

afterEach(() => { vi.useRealTimers(); });

const msg = (body: string): ExpoMessage[] => [{ to: "apns:" + "d".repeat(64), title: "Lead", body, data: { kind: "turn-finished", threadId: "thr_1" } }];

describe("PushWindows lifecycle and races", () => {
  it("does not drop a push that arrives while release()'s flush() is in flight and returns false", async () => {
    vi.useFakeTimers();
    let resolveFlush!: (sent: boolean) => void;
    const flushes: Array<{ key: string; body: string; shown: number; held: number }> = [];
    let call = 0;
    const windows = new PushWindows(
      async (input) => {
        call += 1;
        flushes.push({ key: input.key, body: input.messages[0]?.body ?? "", shown: input.shown, held: input.held });
        if (call === 1) {
          return new Promise<boolean>((resolve) => { resolveFlush = resolve; });
        }
        return true;
      },
      { windowMs: 1_000 },
    );

    // 1st push opens window, 2nd push is held.
    expect(windows.offer("thr_1", msg("first"))).toBe(true);
    expect(windows.offer("thr_1", msg("second"))).toBe(false);

    // Window expires -> release() starts flush #1 (in flight).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flushes).toHaveLength(1);

    // 3rd push arrives while flush #1 is still in flight -> held in the new window.
    expect(windows.offer("thr_1", msg("third"))).toBe(false);
    expect(windows.held()).toEqual({ thr_1: 1 });

    // Flush #1 resolves false -> must NOT delete the window holding "third".
    resolveFlush(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(windows.held()).toEqual({ thr_1: 1 });

    // When the new window expires, "third" must flush (with shown = 1 since flush #1 didn't send).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flushes).toHaveLength(2);
    expect(flushes[1]).toEqual({ key: "thr_1", body: "third", shown: 1, held: 1 });

    windows.dispose();
  });

  it("ignores offer() and does not schedule timers after dispose()", () => {
    vi.useFakeTimers();
    const flush = vi.fn(async () => true);
    const windows = new PushWindows(flush, { windowMs: 1_000 });
    windows.dispose();

    expect(windows.offer("thr_1", msg("after dispose"))).toBe(false);
    expect(windows.held()).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("evicts expired single-push windows when subsequent offers arrive", () => {
    let clock = 1_000;
    const windows = new PushWindows(async () => true, { windowMs: 1_000, now: () => clock });

    expect(windows.offer("thr_old_1", msg("one"))).toBe(true);
    expect(windows.offer("thr_old_2", msg("two"))).toBe(true);
    expect(windows.size).toBe(2);

    // Advance past window expiry; offering a new key evicts expired idle entries.
    clock += 2_000;
    expect(windows.offer("thr_new", msg("three"))).toBe(true);
    expect(windows.size).toBe(1);

    windows.dispose();
  });
});
