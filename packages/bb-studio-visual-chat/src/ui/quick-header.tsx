// The quick card's header: the chat's title (the card's drag handle), the
// ‹ › arrows, Expand and Close. ‹ › page through the chat's versions, and
// past its first version ‹ steps to the chat before it in the list (a fresh
// chat has none, so ‹ goes straight to the last chat): every summon starts a
// new chat, and the earlier ones are a step back. › comes forward again, and
// past the newest chat it starts a new one.
import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { cn, Icon } from "./studio";
import type { canvasContract } from "../contract";
import type { CanvasMeta, CanvasView } from "../shared";
import { neighborChats } from "./quick-store";
import type { Timeline } from "./route";

export interface CardSteps {
  back(): void;
  forward(): void;
  canBack: boolean;
  canForward: boolean;
  backTitle: string;
  forwardTitle: string;
  /** The version showing, of the chat's versions. */
  position: number;
  total: number;
}

const quote = (text: string) => `“${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`;

/** The card's steps through versions, then chats; null when not in the card (threadId undefined). */
export function useCardSteps(threadId: string | null | undefined, canvas: CanvasView | null | undefined, timeline: Timeline, onThread: ((threadId: string | null) => void) | undefined): CardSteps | null {
  const rpc = useRpc<typeof canvasContract>();
  const on = threadId !== undefined && !!onThread;
  const [list, setList] = useState<CanvasMeta[]>([]);
  const status = canvas?.status;
  useEffect(() => {
    if (!on) return;
    let live = true;
    rpc.call("canvas.list", null).then(({ canvases }) => { if (live) setList(canvases as CanvasMeta[]); }, () => {});
    return () => { live = false; };
  }, [on, rpc, threadId, status]);
  const { older, newer } = useMemo(() => neighborChats(list, threadId ?? null), [list, threadId]);
  const { position, total } = timeline;
  const back = useCallback(() => {
    if (position > 1) timeline.back();
    else if (older) onThread?.(older.threadId);
  }, [position, timeline, older, onThread]);
  // A new chat isn't a step forward from one that's still new.
  const forwardToNew = newer === "new" && !!threadId;
  const forward = useCallback(() => {
    if (position < total) timeline.forward();
    else if (newer === "new") { if (threadId) onThread?.(null); }
    else if (newer) onThread?.(newer.threadId);
  }, [position, total, timeline, newer, threadId, onThread]);
  if (!on) return null;
  return {
    back, forward, position, total,
    canBack: position > 1 || !!older,
    canForward: position < total || forwardToNew || (!!newer && newer !== "new"),
    backTitle: position > 1 ? `Version ${position - 1} (←)` : older ? `Previous chat: ${quote(older.title)} (←)` : "No earlier chat",
    forwardTitle: position < total ? `Version ${position + 1} (→)` : forwardToNew ? "New chat (→)" : newer && newer !== "new" ? `Next chat: ${quote(newer.title)} (→)` : "Latest",
  };
}

const HEADER_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/75 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30";

export function CardHeader({ canvas, pending, steps, titleId, onExpand, onClose, onDragStart }: {
  canvas: CanvasView | null;
  pending: string | null;
  steps: CardSteps | null;
  titleId: string;
  onExpand(): void;
  onClose(): void;
  onDragStart(event: ReactPointerEvent<HTMLElement>): void;
}) {
  const title = canvas?.title ?? (pending ? "New visual chat" : "Visual Chat");
  return (
    <div className="relative z-20 flex h-10 shrink-0 cursor-grab touch-none select-none items-center gap-0.5 border-b border-border/60 pl-3 pr-1.5 text-sm text-muted-foreground active:cursor-grabbing" onPointerDown={onDragStart} data-canvas-card-header>
      <Icon name="GridView" className="mr-1.5 size-3.5 shrink-0" />
      <h2 id={titleId} className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/85" title={title} data-canvas-card-title>{title}</h2>
      {steps ? (
        <span className="flex shrink-0 items-center" data-canvas-versions data-position={steps.position} data-total={steps.total}>
          <button type="button" className={HEADER_BUTTON} aria-label="Previous" title={steps.backTitle} disabled={!steps.canBack} onClick={steps.back} data-canvas-card-back>
            <Icon name="ChevronLeft" className="size-3.5" />
          </button>
          {steps.total > 1 ? (
            <span className={cn("min-w-[2.5rem] select-none text-center text-[12px] tabular-nums", steps.position < steps.total ? "font-medium text-foreground" : "text-muted-foreground/70")} aria-live="polite" data-canvas-version-label>{steps.position} / {steps.total}</span>
          ) : null}
          <button type="button" className={HEADER_BUTTON} aria-label="Next" title={steps.forwardTitle} disabled={!steps.canForward} onClick={steps.forward} data-canvas-card-forward>
            <Icon name="ChevronRight" className="size-3.5" />
          </button>
        </span>
      ) : null}
      <button type="button" className={HEADER_BUTTON} aria-label="Expand to the full page" title="Expand to the full page" onClick={onExpand} data-canvas-card-expand>
        <Icon name="Maximize2" className="size-3.5" />
      </button>
      <button type="button" className={HEADER_BUTTON} aria-label="Close" title="Close (Esc)" onClick={onClose} data-canvas-card-close>
        <Icon name="X" className="size-4" />
      </button>
    </div>
  );
}
