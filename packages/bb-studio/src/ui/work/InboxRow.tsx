// One thing addressed to you: a request you act on in place, a report you
// read and clear, or a comment.
import { GHOST_BUTTON, Icon, OUTLINE_BUTTON, PRIMARY_BUTTON, openAppPath } from "@bb-studio/kit/app";
import { experimental_useSidebarThreadActions as useSidebarThreadActions } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { Face } from "./Face";
import { inboxLink } from "./links";
import { useCall, type InboxEvent, type TeamBot } from "./model";
import { cn } from "./styles";
import { plainPreview } from "./text";

const SOURCE_ICONS: Record<string, string> = { comment: "MessageSquarePlus", review: "Eye", report: "FileText", request: "CircleQuestion" };

/** What kind of thing this is, in a word, so cards with the same buttons read apart. */
export function eventKind(event: InboxEvent): string {
  const source = event.source.toLowerCase();
  if (source === "bb-interaction") return event.answerable ? "Question" : "Approval";
  if (source === "team-attention") return "Bot needs a decision";
  if (source === "page-requests") return event.type === "request" ? "Page job failed" : "Page job";
  if (source === "comments" || event.type === "comment") return "Comment";
  if (source.includes("task")) return event.type === "request" ? "Task to review" : "Task update";
  if (source.includes("feed") || event.type === "report") return "Report";
  return event.type === "request" ? "Request" : "Update";
}

function when(at: number): string {
  const date = new Date(at);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function InboxRow({ event, bot, onChanged }: {
  event: InboxEvent;
  bot: TeamBot | undefined;
  onChanged: () => void;
}) {
  const call = useCall();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (method: string, input: unknown) => {
    setBusy(true); setError(null);
    try { await call(method, input); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const threadActions = useSidebarThreadActions();
  const link = inboxLink(event);
  const open = link ? () => {
    void call("inbox_read", { keys: [event.key] }).catch(() => undefined);
    if (link.kind === "path") openAppPath(link.path);
    else threadActions.open(link.threadId);
  } : null;
  const unreadReport = event.type !== "request" && event.readAt === null;

  return (
    <li className="flex gap-3 border-b border-border py-3 last:border-b-0">
      <div className="pt-0.5">
        {bot
          ? <Face name={bot.name} avatar={bot.avatar} state={bot.state} />
          : <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon name={SOURCE_ICONS[event.type] ?? "Info"} className="size-4" aria-hidden /></span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            disabled={!open}
            onClick={() => open?.()}
            className={cn("min-w-0 truncate text-left text-sm enabled:hover:underline", unreadReport || event.type === "request" ? "font-semibold" : "font-medium")}
          >
            {plainPreview(event.title)}
          </button>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{when(event.createdAt)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
          <span className="text-foreground/70">{eventKind(event)}</span>
          {bot ? <span className="text-foreground/80"> · {bot.name}</span> : null}
          {event.body ? ` · ${plainPreview(event.body)}` : null}
        </p>
        {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {event.answerable
            ? <form className="flex min-w-0 flex-1 gap-1.5" onSubmit={(submit) => { submit.preventDefault(); if (answer.trim()) void run("inbox_act", { key: event.key, actionId: "answer", text: answer.trim() }); }}>
                <input aria-label={`Answer: ${event.title}`} placeholder="Answer…" value={answer} onChange={(change) => setAnswer(change.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
                <button type="submit" disabled={busy || !answer.trim()} className={OUTLINE_BUTTON}>Send</button>
              </form>
            : null}
          {(event.actions ?? []).map((action) => (
            <button key={action.id} type="button" disabled={busy} onClick={() => void run("inbox_act", { key: event.key, actionId: action.id })} className={action.primary ? cn(PRIMARY_BUTTON, "h-8 px-3") : OUTLINE_BUTTON}>
              {action.label}
            </button>
          ))}
          {event.type !== "request" && open
            ? <button type="button" onClick={open} className={OUTLINE_BUTTON}>Open</button>
            : null}
          <button type="button" disabled={busy} onClick={() => void run("inbox_done", { keys: [event.key] })} className={GHOST_BUTTON} aria-label={`Done: ${event.title}`}>
            {event.type === "request" ? "Dismiss" : "Done"}
          </button>
        </div>
      </div>
    </li>
  );
}
