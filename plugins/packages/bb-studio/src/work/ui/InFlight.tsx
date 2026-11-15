import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { toAppPathOf } from "../../kit/app/host-sdk";
import { usePathname } from "../../kit/app/route";
import { useComposerThread } from "../../kit/composer";
import { Icon, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { TASKS_UNAVAILABLE } from "../../tasks/contract";
import type { WorkCard } from "../contract";
import { inFlightRows, needsYouCount, rowDetail, splitRows } from "./in-flight-model";
import { ENDED_DETAIL, stateLabel } from "./model";
import { useCardsOnScreen } from "./on-screen";
import { revealCard } from "./reveal";
import { StateGlyph } from "./WorkCard";

export const COLLAPSED_KEY = "bb.studio.in-flight.collapsed";

function readCollapsed(): boolean {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { return false; }
}

function writeCollapsed(value: boolean): void {
  try { window.localStorage.setItem(COLLAPSED_KEY, String(value)); } catch { return; }
}

export function InFlightBanner() {
  const threadId = useComposerThread();
  return threadId ? <InFlight threadId={threadId} /> : null;
}

export function InFlight({ threadId }: { threadId: string }) {
  const live = useLive("work.list", { threadId }, { pollMs: 60_000 });
  const call = useCall();
  const navigate = useBbNavigate();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [showDone, setShowDone] = useState(false);
  const [hidden, setHidden] = useState<ReadonlyMap<string, number>>(() => new Map());
  const onScreen = useCardsOnScreen();
  const cards = live.data?.cards ?? [];
  const rows = inFlightRows(cards.filter((card) => !onScreen.has(card.id) && hidden.get(card.id) !== card.updatedAt));
  if (!live.data && live.error?.includes(TASKS_UNAVAILABLE)) return <p role="alert" data-testid="in-flight-error" className="px-3 py-1.5 text-xs text-destructive">{live.error}</p>;
  if (!rows.length) return null;
  const { live: open, finished } = splitRows(rows);
  const needs = needsYouCount(rows);
  const toggle = () => { setCollapsed(!collapsed); writeCollapsed(!collapsed); };
  const reveal = (card: WorkCard) => revealCard({ id: card.id, threadId, messageSeq: card.messageSeq, pathname, toAppPath: toAppPathOf(navigate) });
  const hide = (gone: readonly WorkCard[]) => setHidden((before) => new Map([...before, ...gone.map((card) => [card.id, card.updatedAt] as const)]));
  const unhide = (gone: readonly WorkCard[]) => setHidden((before) => new Map([...before].filter(([id]) => !gone.some((card) => card.id === id))));
  const dismiss = (card: WorkCard) => {
    hide([card]);
    void call("work.dismiss", { id: card.id }).then(() => live.refresh(), () => unhide([card]));
  };
  const clearDone = () => {
    const gone = [...finished];
    hide(gone);
    setShowDone(false);
    void call("work.clear", { threadId }).then(() => live.refresh(), () => unhide(gone));
  };
  const row = (card: WorkCard) => {
    const detail = rowDetail(card);
    return (
      <li key={card.id} className="group flex min-w-0 items-center border-b border-border/35 last:border-b-0">
        <button type="button" data-testid="in-flight-row" data-state={card.state} data-stale={card.stale || undefined} title={card.title} onClick={() => reveal(card)} className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 pl-3 pr-1 text-left text-xs transition-colors hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none">
          <span className="flex w-3 shrink-0 justify-center"><StateGlyph state={card.state} stale={card.stale} /></span>
          <span className="min-w-0 max-w-[45%] shrink-0 truncate text-foreground">{card.title}</span>
          <span className="min-w-0 flex-1 truncate text-subtle-foreground">{detail}</span>
          {card.state === "needs-you"
            ? <span data-testid="in-flight-needs-you" className="shrink-0 rounded bg-warning/15 px-1.5 py-px text-2xs font-medium text-warning">Needs you</span>
            : <span className="shrink-0 text-2xs text-subtle-foreground" title={card.stale ? ENDED_DETAIL : undefined}>{stateLabel(card)}</span>}
        </button>
        <button type="button" data-testid="in-flight-dismiss" aria-label={`Remove ${card.title} from In flight`} title="Remove from In flight" onClick={() => dismiss(card)} className="mr-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100">
          <Icon name="X" className="size-3" />
        </button>
      </li>
    );
  };
  return (
    <div data-testid="in-flight" role="region" aria-label="In flight" className="min-w-0">
      <div className={cn("flex min-h-8 min-w-0 items-stretch text-xs text-foreground", !collapsed && "border-b border-border/35")}>
        <button type="button" aria-expanded={!collapsed} onClick={toggle} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 pl-3 pr-2 transition-colors hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none">
          <span className="font-normal">In flight</span>
          {needs ? <span data-testid="in-flight-needs" className="flex shrink-0 items-center gap-1 text-2xs text-warning"><span aria-hidden className="size-1.5 rounded-full bg-warning" />{needs} {needs === 1 ? "needs" : "need"} you</span> : null}
          <span data-testid="in-flight-count" className="ml-auto shrink-0 text-2xs tabular-nums text-subtle-foreground">{open.length}</span>
          <Icon name={collapsed ? "ChevronUp" : "ChevronDown"} className="size-3 shrink-0 text-muted-foreground" />
        </button>
        {finished.length ? (
          <button type="button" data-testid="in-flight-clear" onClick={clearDone} className="shrink-0 cursor-pointer border-l border-border/35 px-3 text-2xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:outline-none">Clear done</button>
        ) : null}
      </div>
      {collapsed ? null : (
        <ul className="py-0.5">
          {open.map(row)}
          {finished.length ? (
            <li key="done" className="border-b border-border/35 last:border-b-0">
              <button type="button" data-testid="in-flight-done" aria-expanded={showDone} onClick={() => setShowDone(!showDone)} className="flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-1 px-3 py-1 text-left text-2xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:outline-none">
                <span className="tabular-nums">{finished.length} done</span>
                <Icon name={showDone ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" />
              </button>
            </li>
          ) : null}
          {showDone ? finished.map(row) : null}
        </ul>
      )}
    </div>
  );
}
