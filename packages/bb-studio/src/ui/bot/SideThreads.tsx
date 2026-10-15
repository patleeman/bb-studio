// Side threads on the desktop (src/bot-side-threads.ts): the tab beside the
// chat that shows one, and the overlay that opens it when a reply's
// "2 replies" row (reply-in-thread.ts) is clicked.
import { ThreadChat, useBbNavigate, type PluginMessageDirectiveProps, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { OPEN_SIDE_THREAD_EVENT } from "./reply-in-thread";

/** The thread panel action that shows a side thread (app.tsx). */
export const SIDE_THREAD_ACTION = "bot-side-thread";

/**
 * `::bot-thread{}`: older Bot replies end with it, from when the Bot was asked
 * to write it. Studio draws the rows itself now (reply-in-thread.ts), so it
 * draws nothing, only keeping the line from showing as text.
 */
export function BotThreadDirective(_props: PluginMessageDirectiveProps) {
  return null;
}

/** A side thread in a tab beside the Bot's chat. */
export function SideThreadPanel({ params }: PluginThreadPanelProps) {
  const threadId = params && typeof params === "object" && !Array.isArray(params) && typeof params.threadId === "string" ? params.threadId : null;
  if (!threadId) {
    return <p className="p-4 text-sm text-muted-foreground">Open a side thread from the replies row under one of your Bot’s replies.</p>;
  }
  return <ThreadChat threadId={threadId} variant="compact" />;
}

/**
 * Opens a side thread when a reply's row asks (the content script can't
 * navigate): beside the chat, or as the thread where there's no side panel.
 */
export function SideThreadOpener() {
  const navigate = useBbNavigate();
  useEffect(() => {
    const open = (event: Event) => {
      const threadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId;
      if (!threadId) return;
      if (!navigate.openThreadPanel({ actionId: SIDE_THREAD_ACTION, title: "Thread", params: { threadId } })) navigate.toThread(threadId);
    };
    window.addEventListener(OPEN_SIDE_THREAD_EVENT, open);
    return () => window.removeEventListener(OPEN_SIDE_THREAD_EVENT, open);
  }, [navigate]);
  return null;
}
