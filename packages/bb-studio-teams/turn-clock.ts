// How long a bot's turn has run, for its time limit. Wall-clock time would
// count a sleeping computer or a disconnected host against the turn, and a
// scheduled turn on a laptop that slept through it would be told to wrap up,
// then time out, without having run. So the clock only moves while the
// runtime watches the turn: a gap longer than CLOCK_GAP_MS between two looks
// (it checks every couple of seconds) isn't counted.
import type { Job } from "./contract";

export const CLOCK_GAP_MS = 2 * 60_000;

type Clocked = Pick<Job, "turnMs" | "clockAt" | "startedAt" | "dispatchStartedAt" | "updatedAt">;

/** The job's clock after a look at `now`. The first look counts from when the turn started. */
export function advanceTurnClock(job: Clocked, now: number): { turnMs: number; clockAt: number } {
  if (job.clockAt === undefined) {
    const start = job.startedAt ?? job.dispatchStartedAt ?? job.updatedAt;
    return { turnMs: Math.max(0, now - start), clockAt: now };
  }
  const gap = now - job.clockAt;
  return { turnMs: (job.turnMs ?? 0) + (gap > 0 && gap <= CLOCK_GAP_MS ? gap : 0), clockAt: now };
}
