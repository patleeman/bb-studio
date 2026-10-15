// Side threads on the desktop (src/bot-side-threads.ts): the tab beside the
// chat that shows one. The reply's "Reply in thread" and its "2 replies"
// row are reply-in-thread.ts.
import { ThreadChat, type PluginMessageDirectiveProps, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";

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
    return <p className="p-4 text-sm text-muted-foreground">Open a side thread from “Reply in thread” under one of your Bot’s replies.</p>;
  }
  return <ThreadChat threadId={threadId} variant="compact" />;
}
