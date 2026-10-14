// Side threads on the desktop (src/bot-side-threads.ts): the row under a Bot
// reply with a side thread (its `::bot-thread{}` directive), "2 replies · 5m",
// and the tab beside the chat that shows the side thread. Starting one is
// the reply's "Reply in thread" action (reply-in-thread.ts).
import { errorMessage, relativeTime } from "@bb-studio/kit/format";
import { Icon } from "@bb-studio/kit/ui";
import { ThreadChat, useBbNavigate, type PluginMessageDirectiveProps, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { SideThreadView } from "../../contract";
import { useCall, useLive } from "../live";

/** The thread panel action that shows a side thread (app.tsx). */
export const SIDE_THREAD_ACTION = "bot-side-thread";

type SideThreads = { chat: boolean; threads: SideThreadView[] };

/** "Reply in thread", "Working…", "1 reply · 5m ago", "3 replies". */
export function sideThreadLabel(thread: SideThreadView | undefined, now = Date.now()): string {
  if (!thread) return "Reply in thread";
  if (thread.working) return thread.replies ? `${replies(thread.replies)} · working…` : "Working…";
  if (!thread.replies) return "Thread";
  return thread.lastReplyAt ? `${replies(thread.replies)} · ${relativeTime(thread.lastReplyAt, now)}` : replies(thread.replies);
}

function replies(count: number): string {
  return count === 1 ? "1 reply" : `${count} replies`;
}

/** The row under a Bot reply. */
export function BotThreadDirective({ message }: PluginMessageDirectiveProps) {
  const call = useCall();
  const navigate = useBbNavigate();
  const { data } = useLive<SideThreads>("bot_side_threads", { threadId: message.threadId }, { pollMs: 30_000 });
  const thread = data?.threads.find((each) => each.messageId === message.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a reply with a side thread: "Reply in thread" is in the reply's
  // action bar (reply-in-thread.ts). Nothing outside a Bot's chat either: a
  // side thread's own replies may carry the directive too.
  if (!data?.chat || !thread) return null;

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const opened = thread ?? await call("bot_side_thread_open", { threadId: message.threadId, messageId: message.id }) as { threadId: string };
      // Beside the chat; where there's no side panel, as the thread itself.
      if (!navigate.openThreadPanel({ actionId: SIDE_THREAD_ACTION, title: "Thread", params: { threadId: opened.threadId } })) navigate.toThread(opened.threadId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="not-prose mt-1 flex items-center gap-2 text-xs" data-testid="bot-thread-row">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 ${thread ? "font-medium text-primary hover:bg-state-hover" : "text-muted-foreground/70 hover:bg-state-hover hover:text-foreground"}`}
      >
        <Icon name={thread ? "MessageSquare" : "MessageSquarePlus"} className="size-3.5" />
        <span className="tabular-nums">{busy && !thread ? "Opening…" : sideThreadLabel(thread)}</span>
      </button>
      {error ? <span role="alert" className="text-destructive">{error}</span> : null}
    </div>
  );
}

/** A side thread in a tab beside the Bot's chat. */
export function SideThreadPanel({ params }: PluginThreadPanelProps) {
  const threadId = params && typeof params === "object" && !Array.isArray(params) && typeof params.threadId === "string" ? params.threadId : null;
  if (!threadId) {
    return <p className="p-4 text-sm text-muted-foreground">Open a side thread from “Reply in thread” under one of your Bot’s replies.</p>;
  }
  return <ThreadChat threadId={threadId} variant="compact" />;
}
