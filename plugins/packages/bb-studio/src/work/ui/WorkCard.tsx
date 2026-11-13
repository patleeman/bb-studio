import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { remember } from "../../kit/app/directive-card";
import { CHAT_CARD_BODY, CHAT_CARD_SKELETON, ChatCard, ChatCardHeader, ChatCardIconButton } from "../../kit/app/chat-card";
import { relativeTime } from "../../kit/format";
import { Icon, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import type { WorkCard } from "../contract";
import { WORK_ID, type WorkState } from "../shared";
import { KIND, shownStep, STATE } from "./model";

export function StateGlyph({ state, className }: { state: WorkState; className?: string }) {
  if (state === "running") return <span role="img" aria-label={STATE.running} className={cn("size-2 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent motion-reduce:animate-none", className)} />;
  if (state === "waiting") return <Icon name="Clock" aria-label={STATE.waiting} className={cn("size-3 shrink-0 text-muted-foreground", className)} />;
  if (state === "needs-you") return <span role="img" aria-label={STATE["needs-you"]} className={cn("size-2 shrink-0 rounded-full bg-warning", className)} />;
  if (state === "failed") return <Icon name="X" aria-label={STATE.failed} className={cn("size-3 shrink-0 text-destructive", className)} />;
  return <Icon name="Check" aria-label={STATE.done} className={cn("size-3 shrink-0 text-success", className)} />;
}

export function WorkDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const id = attributes.id ?? "";
  if (!WORK_ID.test(id)) return null;
  return <LiveWorkCard id={id} threadId={message.threadId} messageId={message.id} />;
}

function LiveWorkCard({ id, threadId, messageId }: { id: string; threadId: string; messageId: string }) {
  const live = useLive("work.get", { id }, { pollMs: 120_000 });
  const call = useCall();
  const missing = !!live.error && /not found/i.test(live.error);
  const card = remember<WorkCard>(`work:${id}`, missing ? null : (live.data ?? undefined));
  const anchored = useRef(false);
  const unplaced = !!card && card.threadId === threadId && card.messageSeq === null;
  useEffect(() => {
    if (!unplaced || anchored.current) return;
    anchored.current = true;
    void call("work.anchor", { id, threadId, messageId }).catch(() => {});
  }, [unplaced, call, id, threadId, messageId]);
  if (missing) return <div className="my-1 flex items-center gap-2 text-xs text-muted-foreground"><Icon name="Unavailable" className="size-3.5" />This work card was removed.</div>;
  if (!card) return <div className={cn(CHAT_CARD_SKELETON, "h-24")} />;
  return <WorkCardView card={card} />;
}

export function WorkCardView({ card, now = Date.now() }: { card: WorkCard; now?: number }) {
  const navigate = useBbNavigate();
  const kind = KIND[card.kind];
  const worker = card.workerThreadId;
  const open = worker ? () => navigate.toThread(worker) : undefined;
  const step = shownStep(card);
  return (
    <ChatCard data-testid="work-card" data-work-card-id={card.id} data-state={card.state} className="studio-work-card">
      <ChatCardHeader icon={kind.icon} title={card.title} onOpen={open}
        meta={<>{kind.label}{step ? <> · <span data-testid="work-step">{step}</span></> : null}</>}
        actions={<>
          <span className={cn("shrink-0 text-xs text-muted-foreground", !open && "pr-1.5")} title={new Date(card.updatedAt).toLocaleString()}>{relativeTime(card.updatedAt, now)}</span>
          {open ? <ChatCardIconButton icon="ArrowUpRight" label={`Open ${card.kind === "lead" ? "lead" : "worker"}`} data-testid="work-open" onClick={open} /> : null}
        </>} />
      <div className={cn(CHAT_CARD_BODY, "flex flex-col gap-2 pt-0")}>
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <StateGlyph state={card.state} />
          <span data-testid="work-state" className={cn("shrink-0", card.state === "needs-you" ? "text-warning" : card.state === "failed" ? "text-destructive" : "text-foreground")}>{STATE[card.state]}</span>
          {card.line ? <span data-testid="work-line" className="min-w-0 truncate text-muted-foreground">{card.line}</span> : null}
        </div>
        {card.state === "needs-you" && card.needs ? (
          <div data-testid="work-needs" className="rounded-md border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-warning/5 px-2.5 py-1.5 text-sm text-foreground">{card.needs}</div>
        ) : null}
      </div>
    </ChatCard>
  );
}
