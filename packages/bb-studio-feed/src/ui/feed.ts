// Pieces the reader and the card share.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { PostView } from "../contract";
import { PANEL_PATH, type RealtimeEvent } from "../shared";

export type { PostView };

export function feedEvent(payload: unknown): RealtimeEvent | null {
  const type = (payload as { type?: unknown } | null)?.type;
  return type === "post" || type === "removed" || type === "seen" ? (payload as RealtimeEvent) : null;
}

/** Re-renders every minute, so "5m ago" stays true. */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  return tick;
}

/** "Commute Bot in #command-center". */
export const from = (post: Pick<PostView, "author" | "channelName">) => (post.channelName ? `${post.author} in #${post.channelName}` : post.author);

/** Where Discuss goes: the thread or channel it came from, or a new thread about it. */
export function useDiscuss() {
  const navigate = useBbNavigate();
  return {
    openPost: (post: Pick<PostView, "id">) => navigate.toPluginPanel(PANEL_PATH, { subPath: post.id }),
    openSource: (post: Pick<PostView, "threadId">) => {
      if (post.threadId) navigate.toThread(post.threadId);
    },
    newThread: (post: Pick<PostView, "id" | "title" | "author" | "channelName">) =>
      navigate.toCompose({
        initialPrompt: `Let's discuss this feed post: "${post.title}" (${from(post)}). Read it first with feed_read id ${post.id}.\n\n`,
        focusPrompt: true,
      }),
  };
}
