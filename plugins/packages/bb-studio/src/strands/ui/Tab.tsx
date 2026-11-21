// The Strands tab in a conversation's workbench (design 4a, "bench"): every
// strand by state, needs you first with its buttons; quiet ones faded, and
// "Earlier" folded. A row selects its strand, like a chip.
import { useState } from "react";
import type { ThreadTabProps } from "../../kit/app/thread-panel";
import { relativeTime } from "../../kit/format";
import { cn } from "../../kit/ui/index";
import { useLive } from "../../ui/live";
import type { StrandView } from "../contract";
import { groupsOf } from "./model";
import { useSelection } from "./selection";
import { AskButtonsFor, StateMark, STRANDS_POLL_MS, useSelectStrand } from "./Strip";

function Row({ strand, threadId, selected, now }: { strand: StrandView; threadId: string; selected: boolean; now: number }) {
  const choose = useSelectStrand(threadId);
  const sub = strand.state === "needs-you" ? strand.asks[0]?.label ?? strand.detail
    : strand.state === "running" || strand.state === "waiting" || strand.state === "done-unseen" ? strand.detail ?? strand.summary
    : strand.summary;
  return (
    <div role="button" tabIndex={0} data-strand-row={strand.id} onClick={() => choose(strand)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(strand); } }}
      className={cn("cursor-pointer rounded-lg px-2 py-[7px] hover:bg-accent/50", selected && "bg-accent", strand.state === "quiet" && "opacity-60")}>
      <div className="flex items-baseline gap-2">
        {strand.state === "needs-you" ? <StateMark strand={strand} now={now} /> : null}
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug">{strand.title}</span>
        <span className="whitespace-nowrap text-[11px] text-muted-foreground/70">{strand.lastAt ? relativeTime(strand.lastAt, now) : ""}</span>
      </div>
      {sub || (strand.state !== "needs-you" && strand.state !== "active" && strand.state !== "quiet") ? (
        <div className="mt-[3px] flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {strand.state !== "needs-you" && strand.state !== "quiet" ? <StateMark strand={strand} now={now} /> : null}
          <span className="truncate">{sub ?? ""}</span>
        </div>
      ) : null}
      {strand.state === "needs-you" && strand.asks[0] ? (
        // Buttons answer; they don't select the row.
        <div className="mt-[7px]" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          {strand.asks[0].details.length ? (
            <ul className="mb-1.5 space-y-0.5 rounded bg-muted/40 px-1.5 py-1 font-mono text-[11px] text-foreground/90">
              {strand.asks[0].details.map((line, index) => <li key={index} className="whitespace-pre-wrap break-all">{line}</li>)}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-[5px]"><AskButtonsFor ask={strand.asks[0]} threadId={threadId} /></div>
        </div>
      ) : null}
    </div>
  );
}

export function StrandsTab({ threadId }: ThreadTabProps) {
  const list = useLive("strands.list", { threadId }, { pollMs: STRANDS_POLL_MS });
  const selection = useSelection(threadId);
  const [earlier, setEarlier] = useState(false);
  const now = Date.now();
  if (!list.data) return <p className="p-4 text-sm text-muted-foreground">{list.error ?? "Loading…"}</p>;
  if (!list.data.enabled) return <p className="p-4 text-sm text-muted-foreground">No strands in this conversation</p>;
  const groups = groupsOf(list.data);
  return (
    <div className="h-full overflow-auto px-1.5 py-2" data-testid="strands-tab">
      <h2 className="mx-2 my-0.5 text-[13px] font-semibold">Strands</h2>
      {!groups.length ? <p className="mx-2 mt-2 text-xs text-muted-foreground">{list.data.backfill.done ? "No strands yet" : "Sorting this conversation…"}</p> : null}
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <div className="px-2 pb-[3px] pt-2.5 text-[11px] font-semibold text-muted-foreground/70">{group.label}</div>
          {group.strands.map((strand) => <Row key={strand.id} strand={strand} threadId={threadId} selected={selection?.strandId === strand.id} now={now} />)}
        </section>
      ))}
      {list.data.earlier.length ? (
        <section aria-label="Earlier">
          <button type="button" aria-expanded={earlier} onClick={() => setEarlier(!earlier)} className="w-full cursor-pointer px-2 pb-[3px] pt-2.5 text-left text-[11px] font-semibold text-muted-foreground/70 hover:text-foreground">
            Earlier ({list.data.earlier.length})
          </button>
          {earlier ? list.data.earlier.map((strand) => <Row key={strand.id} strand={strand} threadId={threadId} selected={selection?.strandId === strand.id} now={now} />) : null}
        </section>
      ) : null}
    </div>
  );
}
