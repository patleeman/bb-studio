import {
  experimental_Icon as Icon,
  useSidebarThreadDraft,
  useSidebarThreadRowStatuses,
} from "@get-bb/plugin-sdk/app";
import type { RoomWork, ThreadStatusView } from "./contract";
import { channelStatusPresentation } from "./channel-status";
import { useThreadDraft } from "./channel-drafts";

export type ChannelStatusInput = {
  roomId: string;
  /** The channel's thread; its composer holds the channel's draft. */
  threadId?: string;
  threads: readonly ThreadStatusView[];
  work?: RoomWork;
  active: boolean;
  unread: boolean;
  needsAttention: boolean;
};

export function useChannelStatus(input: ChannelStatusInput) {
  const threadDraft = useSidebarThreadDraft(input.threadId ?? "");
  const watchedDraft = useThreadDraft(input.threadId);
  const draft = !!input.threadId && (threadDraft.hasUnsubmittedDraft || watchedDraft);
  const rowStatuses = useSidebarThreadRowStatuses();
  // A status another plugin set on the channel's own thread belongs on its row too.
  const threads = input.threadId && rowStatuses.has(input.threadId) &&
    !input.threads.some((thread) => thread.threadId === input.threadId)
    ? [...input.threads, { threadId: input.threadId, status: "idle" as const, indicator: "none" as const }]
    : input.threads;
  return channelStatusPresentation({ ...input, threads, work: input.work, draft, rowStatuses });
}

export function ChannelStatusIcon({ status }: {
  status: ReturnType<typeof channelStatusPresentation>;
}) {
  if (status.shortLabel === "Ready") return null;
  return <span className="channel-nav-status">
    <span className={`bot-thread-status-icon bot-thread-status-${status.tone}`}
      data-motion={status.motion ?? undefined}
      role="img" aria-label={status.label} title={status.label}>
      {status.icon ? <Icon name={status.icon} /> :
        <span className="channel-unread-dot" aria-hidden="true" />}
    </span>
  </span>;
}
