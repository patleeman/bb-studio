import { ThreadChat, useBbNavigate, type ExperimentalMessageMetadataProps, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { ThreadTabProps } from "../../kit/app/thread-panel";
import { errorMessage } from "../../kit/format";
import { Icon, Tooltip } from "../../kit/ui/index";
import type { SideThreadView } from "../../contract";
import { BotFace } from "../../presence/ui/BotFace";
import { openTabRef } from "../tab-open";
import { useIsBotThread } from "../conversations/bot-thread-owners";
import { useCall } from "../live";
import { mountSideThreadRows, sideThreadLabel, type ThreadFooter } from "./reply-in-thread";

export const SIDE_THREAD_ACTION = "bot-side-thread";
export const REPLY_IN_THREAD = "Reply in thread";

export function BotThreadDirective(_props: PluginMessageDirectiveProps) {
  return null;
}

export function SideThreadPanel({ params }: ThreadTabProps) {
  const threadId = params && typeof params === "object" && !Array.isArray(params) && typeof params.threadId === "string" ? params.threadId : null;
  if (!threadId) {
    return <p className="p-4 text-sm text-muted-foreground">No side thread</p>;
  }
  return <ThreadChat threadId={threadId} variant="compact" />;
}

export async function openThreadBeside(sourceThreadId: string, threadId: string, fallback: (threadId: string) => void, open: typeof openTabRef = openTabRef): Promise<boolean> {
  const opened = await open({ kind: "conversation", id: threadId }, "Thread", { threadId: sourceThreadId }).catch(() => false);
  if (!opened) fallback(threadId);
  return opened;
}

export function ReplyInThreadAction({ message }: ExperimentalMessageMetadataProps) {
  const call = useCall();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const bots = useIsBotThread(message.threadId);
  if (message.role !== "assistant" || !bots) return null;
  const run = async () => {
    setBusy(true);
    try {
      const opened = await call("bot_thread_reply", { threadId: message.threadId, messageId: message.id, turnId: message.turnId });
      await openThreadBeside(message.threadId, opened.threadId, (threadId) => navigate.toThread(threadId));
    } catch (cause) {
      toast.error(errorMessage(cause) || "Couldn't open the thread.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip label={REPLY_IN_THREAD}>
      <button type="button" aria-label={REPLY_IN_THREAD} data-studio-reply-in-thread="" disabled={busy} onClick={() => void run()}
        className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
        <Icon name="MessageSquare" className="size-3" />
      </button>
    </Tooltip>
  );
}

export function Replier({ thread }: { thread: Pick<SideThreadView, "lastReplyRole" | "botId"> }) {
  if (thread.lastReplyRole === "assistant") return <BotFace botId={thread.botId} size={16} still className="rounded-full" />;
  if (thread.lastReplyRole === "user") {
    return (
      <span data-testid="user-mark" aria-label="You" role="img" className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name="UserRound" className="size-2.5" />
      </span>
    );
  }
  return null;
}

export function ThreadIndicator({ thread, onOpen, now = Date.now() }: { thread: SideThreadView; onOpen(): void; now?: number }) {
  return (
    <button type="button" data-studio-side-thread="" data-thread={thread.threadId} onClick={onOpen}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-state-hover">
      <Replier thread={thread} />
      <span>{`💬 ${sideThreadLabel(thread, now)}`}</span>
    </button>
  );
}

export function ThreadIndicators() {
  const call = useCall();
  const navigate = useBbNavigate();
  const [footers, setFooters] = useState<readonly ThreadFooter[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    mountSideThreadRows(controller.signal, (threadId) => call("bot_side_threads", { threadId }), setFooters);
    return () => controller.abort();
  }, [call]);
  return (
    <>
      {footers.map((footer) => createPortal(
        <ThreadIndicator thread={footer.thread} onOpen={() => void openThreadBeside(footer.sourceThreadId, footer.thread.threadId, (threadId) => navigate.toThread(threadId))} />,
        footer.host, footer.key,
      ))}
    </>
  );
}
