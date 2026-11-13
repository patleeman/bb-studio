import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { toAppPathOf } from "../../kit/app/host-sdk";
import { usePathname } from "../../kit/app/route";
import { useComposerThread } from "../../kit/composer";
import { Icon, cn } from "../../kit/ui/index";
import { useLive } from "../../ui/live";
import type { WorkCard } from "../contract";
import { inFlightRows, needsYouCount, openCount, rowDetail } from "./in-flight-model";
import { STATE } from "./model";
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
  const navigate = useBbNavigate();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const cards = live.data?.cards ?? [];
  const rows = inFlightRows(cards);
  if (!rows.length) return null;
  const open = openCount(rows);
  const needs = needsYouCount(rows);
  const toggle = () => { setCollapsed(!collapsed); writeCollapsed(!collapsed); };
  const reveal = (card: WorkCard) => revealCard({ id: card.id, threadId, messageSeq: card.messageSeq, pathname, toAppPath: toAppPathOf(navigate) });
  return (
    <div data-testid="in-flight" role="region" aria-label="In flight" className="min-w-0">
      <button type="button" aria-expanded={!collapsed} onClick={toggle} className={cn("flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none", !collapsed && "border-b border-border/35")}>
        <span className="font-normal">In flight</span>
        {needs ? <span data-testid="in-flight-needs" className="flex shrink-0 items-center gap-1 text-2xs text-warning"><span aria-hidden className="size-1.5 rounded-full bg-warning" />{needs} {needs === 1 ? "needs" : "need"} you</span> : null}
        <span data-testid="in-flight-count" className="ml-auto shrink-0 text-2xs tabular-nums text-subtle-foreground">{open}</span>
        <Icon name={collapsed ? "ChevronUp" : "ChevronDown"} className="size-3 shrink-0 text-muted-foreground" />
      </button>
      {collapsed ? null : (
        <ul className="py-0.5">
          {rows.map((card) => {
            const detail = rowDetail(card);
            return (
              <li key={card.id} className="border-b border-border/35 last:border-b-0">
                <button type="button" data-testid="in-flight-row" data-state={card.state} title={card.title} onClick={() => reveal(card)} className="flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-1 text-left text-xs transition-colors hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none">
                  <span className="flex w-3 shrink-0 justify-center"><StateGlyph state={card.state} /></span>
                  <span className="min-w-0 max-w-[45%] shrink-0 truncate text-foreground">{card.title}</span>
                  <span className="min-w-0 flex-1 truncate text-subtle-foreground">{detail}</span>
                  {card.state === "needs-you"
                    ? <span data-testid="in-flight-needs-you" className="shrink-0 rounded bg-warning/15 px-1.5 py-px text-2xs font-medium text-warning">Needs you</span>
                    : <span className="shrink-0 text-2xs text-subtle-foreground">{STATE[card.state]}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
