import { describe, expect, it, vi } from "vitest";
import { callFileOpenerHandleOpen } from "./file-opener-handle.fork";

describe("callFileOpenerHandleOpen", () => {
  it("treats only true as handled", async () => {
    await expect(callFileOpenerHandleOpen(() => true)).resolves.toBe(true);
    await expect(
      callFileOpenerHandleOpen(() => Promise.resolve(true)),
    ).resolves.toBe(true);
    await expect(callFileOpenerHandleOpen(() => false)).resolves.toBe(false);
  });

  it("falls back when the handler throws or rejects", async () => {
    await expect(
      callFileOpenerHandleOpen(() => {
        throw new Error("boom");
      }),
    ).resolves.toBe(false);
    await expect(
      callFileOpenerHandleOpen(() => Promise.reject(new Error("boom"))),
    ).resolves.toBe(false);
  });

  it("falls back when the handler does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const pending = callFileOpenerHandleOpen(
        () => new Promise<boolean>(() => {}),
        50,
      );
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
