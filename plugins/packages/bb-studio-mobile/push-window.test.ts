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

  it("holds and flushes a push that arrives while release()'s flush() is in flight and returns true, keeping cumulative count", async () => {
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

    expect(windows.offer("thr_1", msg("first"))).toBe(true);
    expect(windows.offer("thr_1", msg("second"))).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toEqual({ key: "thr_1", body: "second", shown: 2, held: 1 });

    // New push arrives while flush #1 is still in flight.
    expect(windows.offer("thr_1", msg("third"))).toBe(false);
    resolveFlush(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(windows.held()).toEqual({ thr_1: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flushes).toHaveLength(2);
    expect(flushes[1]).toEqual({ key: "thr_1", body: "third", shown: 3, held: 1 });

    windows.dispose();
  });

  it("after dispose(), offer() returns true (send now, no window/timers) even on repeated keys, and in-flight release() leaves no state", async () => {
    vi.useFakeTimers();
    let resolveFlush!: (sent: boolean) => void;
    const windows = new PushWindows(
      () => new Promise<boolean>((resolve) => { resolveFlush = resolve; }),
      { windowMs: 1_000 },
    );

    expect(windows.offer("thr_1", msg("first"))).toBe(true);
    expect(windows.offer("thr_1", msg("second"))).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);

    // Dispose while release()'s flush is in flight.
    windows.dispose();
    resolveFlush(false);
    await Promise.resolve();
    await Promise.resolve();

    // Repeated offers for the same key after dispose must pass through immediately without opening windows or timers.
    expect(windows.offer("thr_1", msg("after dispose 1"))).toBe(true);
    expect(windows.offer("thr_1", msg("after dispose 2"))).toBe(true);
    expect(windows.held()).toEqual({});
    expect(windows.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("evicts expired idle windows on offer(), while keeping windows with held pushes/timers and the key being offered", () => {
    vi.useFakeTimers();
    let clock = 1_000;
    const windows = new PushWindows(async () => true, { windowMs: 1_000, now: () => clock });

    // Idle single-push window (will expire).
    expect(windows.offer("thr_idle", msg("one"))).toBe(true);
    // Window with a held push + active timer.
    expect(windows.offer("thr_held", msg("two"))).toBe(true);
    expect(windows.offer("thr_held", msg("two-b"))).toBe(false);
    // Another idle window that we will re-offer directly.
    expect(windows.offer("thr_same", msg("three"))).toBe(true);
    expect(windows.size).toBe(3);

    // Advance clock past window expiry without firing timers yet; offering thr_same evicts thr_idle
    // but keeps thr_held (has held push & timer) and refreshes thr_same.
    clock += 2_000;
    expect(windows.offer("thr_same", msg("three-new"))).toBe(true);
    expect(windows.size).toBe(2);
    expect(windows.held()).toEqual({ thr_held: 1 });

    windows.dispose();
  });
});
