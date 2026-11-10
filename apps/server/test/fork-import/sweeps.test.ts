import { createMigratedConnection } from "@bb/db/testing";
import { describe, expect, it, vi } from "vitest";
import {
  createForkSweepScheduler,
  startForkSweeps,
  type ForkSweepJob,
} from "../../src/services/fork-import/sweeps.js";
import { defineSingleItemSweep } from "../../src/services/system/item-sweep.js";
import { setServerMoveFrozen } from "../../src/services/server-move/freeze-state.js";
import { testLogger } from "../helpers/test-app.js";

function job(
  name: string,
  process: () => void | Promise<void>,
  options: Partial<Pick<ForkSweepJob, "background" | "cadenceMs">> = {},
): ForkSweepJob {
  return {
    name,
    category: "maintenance",
    background: options.background ?? false,
    cadenceMs: options.cadenceMs ?? 0,
    sweep: () => defineSingleItemSweep({ name, process }),
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("fork sweeps", () => {
  it("runs a job again only after its cadence", async () => {
    const db = createMigratedConnection();
    const runs: number[] = [];
    const scheduler = createForkSweepScheduler({ db, logger: testLogger }, [
      job("cadence", () => void runs.push(1), { cadenceMs: 60_000 }),
    ]);
    await scheduler.tick(100_000);
    await scheduler.tick(130_000);
    await scheduler.tick(160_000);
    expect(runs).toHaveLength(2);
  });

  it("does not wait for a background job and does not start it twice while it runs", async () => {
    const db = createMigratedConnection();
    const gate = deferred();
    let started = 0;
    let finished = 0;
    let after = 0;
    const scheduler = createForkSweepScheduler({ db, logger: testLogger }, [
      job(
        "slow",
        async () => {
          started += 1;
          await gate.promise;
          finished += 1;
        },
        { background: true },
      ),
      job("after", () => {
        after += 1;
      }),
    ]);
    await scheduler.tick(1);
    await scheduler.tick(2);
    expect(after).toBe(2);
    await vi.waitFor(() => expect(started).toBe(1));
    gate.resolve();
    await vi.waitFor(() => expect(finished).toBe(1));
    await scheduler.tick(3);
    await vi.waitFor(() => expect(finished).toBe(2));
    expect(started).toBe(2);
  });

  it("logs a failing job and still runs the next one", async () => {
    const db = createMigratedConnection();
    const error = vi.spyOn(testLogger, "warn");
    let ran = false;
    const scheduler = createForkSweepScheduler({ db, logger: testLogger }, [
      job("broken", () => {
        throw new Error("boom");
      }),
      job("healthy", () => {
        ran = true;
      }),
    ]);
    try {
      await scheduler.tick(1);
      expect(ran).toBe(true);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("skips every job while a server move has frozen the database", async () => {
    const db = createMigratedConnection();
    let runs = 0;
    const scheduler = createForkSweepScheduler({ db, logger: testLogger }, [
      job("frozen", () => {
        runs += 1;
      }),
    ]);
    setServerMoveFrozen(db, true);
    try {
      await scheduler.tick(1);
      expect(runs).toBe(0);
    } finally {
      setServerMoveFrozen(db, false);
    }
    await scheduler.tick(2);
    expect(runs).toBe(1);
  });

  it("ticks on its own timer until stopped, and stops on SIGTERM", async () => {
    const db = createMigratedConnection();
    let runs = 0;
    const jobs = [
      job("timer", () => {
        runs += 1;
      }),
    ];
    const stop = startForkSweeps({ db, logger: testLogger }, jobs, 5);
    await vi.waitFor(() => expect(runs).toBeGreaterThan(1));
    stop();
    const stopped = runs;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runs).toBe(stopped);

    const before = process.listeners("SIGTERM");
    startForkSweeps({ db, logger: testLogger }, jobs, 5);
    const added = process
      .listeners("SIGTERM")
      .filter((listener) => !before.includes(listener));
    expect(added).toHaveLength(1);
    await vi.waitFor(() => expect(runs).toBeGreaterThan(stopped));
    for (const listener of added) listener("SIGTERM");
    expect(process.listeners("SIGTERM")).toEqual(before);
    expect(process.listeners("SIGINT")).not.toContain(added[0]);
    const afterSignal = runs;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runs).toBe(afterSignal);
  });
});
