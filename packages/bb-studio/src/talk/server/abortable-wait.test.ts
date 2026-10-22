import { afterEach, describe, expect, it, vi } from "vitest";
import { abortableWait } from "./abortable-wait";

afterEach(() => vi.useRealTimers());

describe("abortableWait", () => {
  it("removes the abort listener after every normal timeout", async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const add = vi.spyOn(signal, "addEventListener");
    const remove = vi.spyOn(signal, "removeEventListener");

    for (let i = 0; i < 100; i++) {
      const wait = abortableWait(10, signal);
      await vi.advanceTimersByTimeAsync(10);
      await wait;
    }

    expect(add).toHaveBeenCalledTimes(100);
    expect(remove).toHaveBeenCalledTimes(100);
  });

  it("resolves immediately for an aborted service and cancels its timer when aborted", async () => {
    vi.useFakeTimers();
    const already = new AbortController();
    already.abort();
    const add = vi.spyOn(already.signal, "addEventListener");
    await abortableWait(10, already.signal);
    expect(add).not.toHaveBeenCalled();

    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const wait = abortableWait(60_000, controller.signal);
    controller.abort();
    await wait;
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
