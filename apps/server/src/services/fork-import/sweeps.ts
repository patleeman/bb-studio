import { isServerMoveFrozen } from "../server-move/freeze-state.js";
import { runEventLoopWork } from "../system/event-loop-work.js";
import type { ItemSweep, SweepDeps } from "../system/item-sweep.js";
import type { PeriodicSweepJob } from "../system/periodic-sweeps.js";

export const FORK_SWEEP_TICK_MS = 10_000;

export interface ForkSweepJob extends Pick<
  PeriodicSweepJob,
  "background" | "cadenceMs" | "category" | "name"
> {
  sweep(deps: SweepDeps, now: number): ItemSweep;
}

interface ForkSweepJobState {
  lastStartedAt: number;
  running: boolean;
}

export interface ForkSweepScheduler {
  tick(now: number): Promise<void>;
}

export function createForkSweepScheduler(
  deps: SweepDeps,
  jobs: readonly ForkSweepJob[],
): ForkSweepScheduler {
  const states = new Map<string, ForkSweepJobState>();

  async function runJob(job: ForkSweepJob, now: number): Promise<void> {
    const state = states.get(job.name) ?? { lastStartedAt: 0, running: false };
    states.set(job.name, state);
    if (state.running) {
      deps.logger.debug(
        { sweepJob: job.name, sweepJobCategory: job.category },
        "Periodic sweep job skipped while already running",
      );
      return;
    }
    if (job.cadenceMs > 0 && now - state.lastStartedAt < job.cadenceMs) {
      return;
    }
    state.lastStartedAt = now;
    state.running = true;
    const run = runEventLoopWork(`sweep:${job.name}`, () =>
      job.sweep(deps, now).run(deps, now),
    )
      .catch((error: unknown) => {
        deps.logger.error(
          { err: error, sweepJob: job.name, sweepJobCategory: job.category },
          "Periodic sweep job failed",
        );
      })
      .finally(() => {
        state.running = false;
      });
    if (job.background) return;
    await run;
  }

  return {
    async tick(now) {
      if (isServerMoveFrozen(deps.db)) return;
      for (const job of jobs) await runJob(job, now);
    },
  };
}

export function startForkSweeps(
  deps: SweepDeps,
  jobs: readonly ForkSweepJob[],
  tickMs = FORK_SWEEP_TICK_MS,
): () => void {
  const scheduler = createForkSweepScheduler(deps, jobs);
  const interval = setInterval(() => {
    void scheduler.tick(Date.now());
  }, tickMs);
  interval.unref();
  const stop = (): void => {
    clearInterval(interval);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return stop;
}
