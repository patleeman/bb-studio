import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { remember } from "../../kit/app/directive-card";
import { relativeTime } from "../../kit/format";
import { Icon, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import type { WorkCard } from "../contract";
import { WORK_ID, type WorkState } from "../shared";
import { KIND, STATE } from "./model";

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
  if (!card) return <div className="my-2 h-24 w-full max-w-3xl animate-pulse rounded-lg border border-border/70 bg-muted/40 motion-reduce:animate-none" />;
  return <WorkCardView card={card} />;
}

export function WorkCardView({ card, now = Date.now() }: { card: WorkCard; now?: number }) {
  const navigate = useBbNavigate();
  const kind = KIND[card.kind];
  return (
    <div data-testid="work-card" data-work-card-id={card.id} data-state={card.state} className="studio-work-card my-2 w-full max-w-3xl rounded-lg">
      <div className="rounded-lg border border-border/70 bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name={kind.icon} className="size-3.5 shrink-0" />
          <span className="shrink-0">{kind.label}</span>
          {card.step ? <><span aria-hidden>·</span><span data-testid="work-step" className="min-w-0 truncate">{card.step}</span></> : null}
          <span className="ml-auto shrink-0" title={new Date(card.updatedAt).toLocaleString()}>{relativeTime(card.updatedAt, now)}</span>
        </div>
        <div className="mt-1 text-base font-semibold leading-snug text-foreground">{card.title}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-sm">
          <StateGlyph state={card.state} />
          <span data-testid="work-state" className={cn("shrink-0", card.state === "needs-you" ? "text-warning" : card.state === "failed" ? "text-destructive" : "text-foreground")}>{STATE[card.state]}</span>
          {card.line ? <span data-testid="work-line" className="min-w-0 truncate text-muted-foreground">{card.line}</span> : null}
        </div>
        {card.state === "needs-you" && card.needs ? (
          <div data-testid="work-needs" className="mt-2 rounded-md border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-warning/5 px-2.5 py-1.5 text-sm text-foreground">{card.needs}</div>
        ) : null}
        {card.workerThreadId ? (
          <button type="button" data-testid="work-open" onClick={() => navigate.toThread(card.workerThreadId!)} className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <Icon name="ArrowUpRight" className="size-3" />Open {card.kind === "lead" ? "lead" : "worker"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
