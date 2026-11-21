// The strands overview (design 4b), the Strands page's middle: a Bot's
// conversations with open strands, needs you first. Each card: up to 2 asks
// with their buttons, then a compact chip per other strand. A chip opens the
// conversation at that strand's newest message, selected; Open opens the
// conversation. Your list sits above it and the areas below
// (src/loops/ui/TodosPage.tsx).
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { PageColumn } from "../../kit/app/index";
import { toAppPathOf } from "../../kit/app/host-sdk";
import { cn, Icon, Tooltip } from "../../kit/ui/index";
import { useLive } from "../../ui/live";
import type { OverviewConversation, StrandAsk, StrandView } from "../contract";
import { select } from "./selection";
import { AskButtonsFor, StateMark } from "./Strip";

export { isStrandsPath, strandsPath } from "./overview-route";

/** Opens a conversation at a strand's newest message, with the strand selected. */
function useOpenStrand() {
  const navigate = useBbNavigate();
  return (threadId: string, strand: Pick<StrandView, "id" | "latestSeq"> | null) => {
    if (strand) select(threadId, { strandId: strand.id, seq: strand.latestSeq });
    const path = strand?.latestSeq != null ? `/threads/${encodeURIComponent(threadId)}#msg=${strand.latestSeq}` : null;
    if (!path || !toAppPathOf(navigate)?.(path)) navigate.toThread(threadId);
  };
}

function Card({ row, now }: { row: OverviewConversation; now: number }) {
  const open = useOpenStrand();
  const needs = row.strands.filter((strand) => strand.state === "needs-you");
  const asks = needs.flatMap((strand): { strand: StrandView; ask: StrandAsk | null }[] => (strand.asks.length ? strand.asks.map((ask) => ({ strand, ask })) : [{ strand, ask: null }]));
  const shown = asks.slice(0, 2);
  const more = asks.length - shown.length;
  const chips = row.strands.filter((strand) => strand.state !== "needs-you");
  return (
    <section aria-label={row.title} data-overview-conversation={row.threadId} className="rounded-xl border border-border bg-card/60 px-3 py-2.5">
      <header className="flex items-center gap-2">
        {needs.length ? <span role="img" aria-label="Needs you" className="size-1.5 rounded-full bg-warning" /> : null}
        <h2 className="min-w-0 truncate text-[13.5px] font-semibold">{row.title}</h2>
        {row.isMain && row.title.trim().toLowerCase() !== "main" ? <span className="text-[12px] text-muted-foreground">Main</span> : null}
        <button type="button" onClick={() => open(row.threadId, null)} className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded px-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground">
          Open<Icon name="ArrowUpRight" className="size-3" />
        </button>
      </header>
      {shown.map(({ strand, ask }) => (
        <div key={`${strand.id}:${ask?.id ?? ""}`} data-strand-ask={ask?.id ?? strand.id} className="mt-1.5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => open(row.threadId, ask?.kind === "reply" && ask.seq !== null ? { ...strand, latestSeq: ask.seq } : strand)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
              <span role="img" aria-label="Needs you" className="size-1.5 shrink-0 rounded-full bg-warning" />
              <span className="truncate text-[12.5px] font-semibold">{strand.title}</span>
              <span className="truncate text-[11.5px] text-muted-foreground/70">· {ask?.label ?? strand.detail ?? "Needs you"}</span>
            </button>
            {ask && !ask.details.length ? <span className="flex shrink-0 gap-1.5"><AskButtonsFor ask={ask} threadId={row.threadId} /></span> : null}
          </div>
          {ask && ask.details.length ? (
            // An approval's whole command and details before its buttons.
            <div className="pl-3.5">
              <ul className="mt-1 space-y-0.5 rounded bg-muted/40 px-1.5 py-1 font-mono text-[11px] text-foreground/90">
                {ask.details.map((line, index) => <li key={index} className="whitespace-pre-wrap break-all">{line}</li>)}
              </ul>
              <div className="mt-1.5 flex flex-wrap gap-1.5"><AskButtonsFor ask={ask} threadId={row.threadId} /></div>
            </div>
          ) : null}
        </div>
      ))}
      {more || chips.length ? (
        <div className={cn("flex flex-wrap items-center gap-[5px]", shown.length ? "mt-2 border-t border-border/60 pt-2" : "mt-1.5")}>
          {more ? (
            <button type="button" onClick={() => open(row.threadId, null)} className="inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 text-[11.5px] hover:bg-accent/60">
              <span role="img" aria-label="Needs you" className="size-1.5 rounded-full bg-warning" />{more} more need you
            </button>
          ) : null}
          {chips.map((strand) => (
            <Tooltip key={strand.id} label={strand.detail ?? strand.summary ?? strand.title}>
              <button type="button" data-strand-chip={strand.id} onClick={() => open(row.threadId, strand)}
                className={cn("inline-flex h-6 max-w-56 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] hover:bg-accent/60",
                  strand.state === "quiet" ? "border-border/60 text-muted-foreground/70" : "border-border text-muted-foreground")}>
                <span className="truncate">{strand.title}</span>
                <StateMark strand={strand} now={now} />
              </button>
            </Tooltip>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** "2 need you · 3 running", or "" when nothing does. */
export function overviewLine(data: { needs: number; running: number } | null | undefined): string {
  return [data?.needs ? `${data.needs} need you` : null, data?.running ? `${data.running} running` : null].filter(Boolean).join(" · ");
}

/** The conversations' strand cards, needs you first; `overview` is strands.overview's answer. */
export function StrandsCards({ overview, now = Date.now(), query = "" }: { overview: { data?: { conversations: OverviewConversation[] } | null; error?: string | null }; now?: number; query?: string }) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = overview.data?.conversations ?? [];
  const rows = words.length
    ? all.map((row) => (words.every((word) => row.title.toLowerCase().includes(word)) ? row : { ...row, strands: row.strands.filter((strand) => words.every((word) => `${strand.title} ${strand.summary ?? ""} ${strand.detail ?? ""}`.toLowerCase().includes(word))) }))
      .filter((row) => row.strands.length)
    : all;
  return (
    <section aria-label="Strands" data-testid="strands-overview" className="flex flex-col gap-2.5">
      {!overview.data ? <p className="text-sm text-muted-foreground">{overview.error ?? "Loading…"}</p> : null}
      {overview.data && !rows.length ? <p data-testid="strands-empty" className="text-sm text-muted-foreground">{words.length ? "No strands match." : "No open strands"}</p> : null}
      {rows.map((row) => <Card key={row.threadId} row={row} now={now} />)}
    </section>
  );
}

/** The overview alone, at the page's width (tests and a page with no Your list). */
export function StrandsOverview({ botId, now = Date.now() }: { botId: string; now?: number }) {
  const overview = useLive("strands.overview", { botId }, { pollMs: 30_000 });
  const header = overviewLine(overview.data);
  return (
    <PageColumn className="max-w-3xl">
      <div className="flex flex-col gap-2.5 py-4">
        <h1 className="flex items-baseline gap-3 text-[17px] font-semibold">
          Strands{header ? <span className="text-[13px] font-normal text-muted-foreground">{header}</span> : null}
        </h1>
        <StrandsCards overview={overview} now={now} />
      </div>
    </PageColumn>
  );
}
