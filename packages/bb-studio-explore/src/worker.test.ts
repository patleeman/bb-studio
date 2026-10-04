import { afterEach, expect, it, vi } from "vitest";
import { exploreWorkers } from "./worker";

afterEach(() => vi.useRealTimers());

it("captures the configured time limit for each explainer", async () => {
  vi.useFakeTimers();
  let timeoutMs = 60_000;
  const bb = {
    events: { on: () => {} },
    sdk: { threads: {
      get: async () => ({ status: "active" }),
      output: async () => ({ output: null }),
      timeline: async () => ({ rows: [] }),
    } },
  };
  const workers = exploreWorkers(bb as never, { timeoutMs: () => timeoutMs });
  const pending = workers.awaitWorker("worker", new AbortController().signal, () => {});
  const rejected = expect(pending).rejects.toThrow("reached its time limit");
  timeoutMs = 120_000;
  await vi.advanceTimersByTimeAsync(62_000);
  await rejected;
  workers.dispose();
});
