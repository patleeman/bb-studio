import type { Job, RoomRun } from "./contract";
import { channelQueues, channelWorkActivity } from "./channel-work";

/** One live session in the rail: the running head plus what waits behind it. */
export type RailLiveEntry = {
  jobId: string;
  botId: string;
  threadId: string | null;
  activity: string;
  running: boolean;
  startedAt: number | null;
  queuedBehind: number;
  stoppable: boolean;
};

export function railLive(jobs: Job[]): RailLiveEntry[] {
  return channelQueues(jobs).map(({ head, queued }) => ({
    jobId: head.id,
    botId: head.botId,
    threadId: head.threadId,
    activity: channelWorkActivity(head),
    running: head.status === "running",
    startedAt: head.startedAt ?? head.dispatchStartedAt,
    queuedBehind: queued.length,
    stoppable: !head.cancellationPending,
  }));
}

/**
 * Runs still choosing recipients. Without this the gap between sending and a
 * bot appearing looks like nothing happened.
 */
export const railRoutingCount = (runs: RoomRun[]) =>
  runs.filter((run) => run.routing === "pending" && run.status === "running")
    .length;
