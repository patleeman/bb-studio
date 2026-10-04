// Pieces the reader and the card share.
import { useOpenCompanion } from "@bb-studio/kit/app";
import { useEffect, useState } from "react";
import type { PostView } from "../contract";
import { discussionHref, FEED_ICON, postHref, type RealtimeEvent } from "../shared";

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

/** Where Discuss goes: the thread it came from, or a new thread about it. */
export function useDiscuss() {
  const open = useOpenCompanion();
  return {
    openPost: (post: Pick<PostView, "id" | "title">) => open({ kind: "path", path: postHref(post.id), title: post.title, icon: FEED_ICON }),
    openSource: (post: Pick<PostView, "threadId">) => {
      if (post.threadId) open({ kind: "thread", threadId: post.threadId });
    },
    newThread: (post: Pick<PostView, "id" | "title">) => open({ kind: "path", path: discussionHref(post.id), title: `Chat: ${post.title}`, icon: "MessageSquare" }),
  };
}
