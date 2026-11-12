import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DrawingSaveQueue } from "./save-queue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("retries an unchanged scene after a failed autosave", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const queue = new DrawingSaveQueue(save);
  const states: { pending: boolean; error: unknown }[] = [];
  queue.subscribe((state) => states.push(state));
  queue.enqueue("scene");
  await vi.advanceTimersByTimeAsync(1200);
  expect(queue.hasPending).toBe(true);
  expect(states.at(-1)?.error).toBeInstanceOf(Error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(save.mock.calls).toEqual([["scene"], ["scene"]]);
  expect(states.at(-1)).toEqual({ pending: false, error: null });
});

it("saves the newest pending scene after an in-flight failure, in order", async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const queue = new DrawingSaveQueue(save);
  queue.enqueue("old");
  await vi.advanceTimersByTimeAsync(1200);
  queue.enqueue("newer");
  queue.enqueue("newest");
  await vi.advanceTimersByTimeAsync(1200);
  expect(save).toHaveBeenCalledTimes(1);
  reject(new Error("offline"));
  await vi.advanceTimersByTimeAsync(0);
  expect(save.mock.calls).toEqual([["old"], ["newest"]]);
  expect(queue.hasPending).toBe(false);
});

it("bounds automatic retries while retaining the scene for manual retry", async () => {
  const save = vi.fn().mockRejectedValue(new Error("offline"));
  const queue = new DrawingSaveQueue(save);
  queue.enqueue("scene");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(save).toHaveBeenCalledTimes(4);
  expect(queue.hasPending).toBe(true);
  save.mockResolvedValue(undefined);
  queue.retry();
  await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenCalledTimes(5);
  expect(queue.hasPending).toBe(false);
});

it("flushes and retries after the editor unsubscribes", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const queue = new DrawingSaveQueue(save);
  const listener = vi.fn();
  const unsubscribe = queue.subscribe(listener);
  queue.enqueue("scene");
  unsubscribe();
  listener.mockClear();
  await queue.flush();
  await vi.advanceTimersByTimeAsync(1000);
  expect(save.mock.calls).toEqual([["scene"], ["scene"]]);
  expect(listener).not.toHaveBeenCalled();
  expect(queue.hasPending).toBe(false);
});

it("cancels pending retries after deletion", async () => {
  const save = vi.fn().mockRejectedValue(new Error("offline"));
  const queue = new DrawingSaveQueue(save);
  queue.enqueue("scene");
  await queue.flush();
  queue.cancel();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(save).toHaveBeenCalledTimes(1);
});
