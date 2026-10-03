// A turn that made no progress: the provider kept failing, or the host went
// away, so the bot never started on the request. Asking it to wrap up would
// only get a report that nothing was done. Instead it's stopped and sent
// again, once; a retry that stalls too times out at the limit and says why.
// A turn that made no progress: the provider kept failing, or the host went
// away, so the bot never started on the request. Asking it to wrap up would
// only get a report that nothing was done. Instead it's stopped and sent
// again, once; a retry that stalls too times out at the limit and says why.
// A turn that made no progress: the provider kept failing, or the host went
// away, so the bot never started on the request. Asking it to wrap up would
// only get a report that nothing was done. Instead it's stopped and sent
// again, once; a retry that stalls too times out at the limit and says why.
// A turn that made no progress: the provider kept failing, or the host went
// away, so the bot never started on the request. Asking it to wrap up would
// only get a report that nothing was done. Instead it's stopped and sent
// again, once; a retry that stalls too times out at the limit and says why.
import { turnHasProgress } from "./activity";
import type { Job } from "./contract";
import type { Runtime } from "./mission-runtime";
import { errorText, missingThread, primaryLane } from "./mission-runtime";

const PROGRESS_CHECK_MS = 30_000;

/**
 * Whether the job's turn has made progress, read from its thread at most every
 * 30 seconds. True when the thread can't be read, so a failed read never
 * restarts a working turn.
 */
export async function jobHasProgress(runtime: Runtime, job: Job): Promise<boolean> {
  const cached = runtime.progressChecks.get(job.id);
  if (cached?.progress || (cached && Date.now() - cached.at < PROGRESS_CHECK_MS)) return cached.progress;
  let progress = true;
  if (job.threadId) {
    try {
      const timeline = await runtime.bb.sdk.threads.timeline({ threadId: job.threadId, includeNestedRows: "true", segmentLimit: "100" });
      // From when the prompt went out: the bot may answer before the runtime sees the turn start.
      progress = turnHasProgress(timeline, job.dispatchStartedAt ?? job.startedAt ?? job.updatedAt);
    } catch (cause) {
      runtime.bb.log.debug(`Could not check turn progress: ${errorText(cause)}`);
    }
  }
  if (runtime.progressChecks.size > 500) runtime.progressChecks.clear();
  runtime.progressChecks.set(job.id, { at: Date.now(), progress });
  return progress;
}

/** Whether the job stalled after its retry too, as last checked. */
export const stalledAfterRetry = (runtime: Runtime, job: Job): boolean =>
  Boolean(job.stallRetriedAt) && runtime.progressChecks.get(job.id)?.progress === false;

/** Stops the stalled turn and queues the job to be sent again, with a note that it's a retry. */
export async function retryStalled(runtime: Runtime, job: Job): Promise<void> {
  const threadId = job.threadId;
  if (!threadId) return;
  try {
    for (const entry of await runtime.bb.sdk.threads.queuedMessages.list({ threadId }))
      await runtime.bb.sdk.threads.queuedMessages.delete({ threadId, queuedMessageId: entry.id });
    await runtime.bb.sdk.threads.stop({ threadId });
  } catch (cause) {
    if (!missingThread(cause)) throw cause;
  }
  const current = runtime.store.job(job.id);
  if (!current || !["dispatching", "running"].includes(current.status)) return;
  current.status = "queued";
  current.threadId = null;
  current.startedAt = null;
  current.dispatchStartedAt = null;
  current.turnMs = undefined;
  current.clockAt = undefined;
  current.requiresPromptMatch = false;
  current.pendingSteer = undefined;
  current.stallRetriedAt = Date.now();
  current.error = null;
  runtime.store.putJob(current);
  runtime.progressChecks.delete(job.id);
  const lane = primaryLane(job.botId, job.conversationKey);
  if (runtime.busy.get(lane)?.threadId === threadId) runtime.busy.delete(lane);
  runtime.bb.log.info(`Retrying ${job.id}: its turn made no progress.`);
  runtime.changed();
}
