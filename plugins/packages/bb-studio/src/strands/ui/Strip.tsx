// The strip above Main's composer (design 4a): at most 2 asks with their own
// buttons, "N more need you", then a chip per strand. A chip selects its
// strand: its messages stay, the rest dim, and a bar steps through them.
// It takes the In flight strip's place where strands run (phase 1: Main).
import { experimental_useAppPanel, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { toAppPathOf } from "../../kit/app/host-sdk";
import { usePathname } from "../../kit/app/route";
import { openThreadTab } from "../../kit/app/thread-panel";
import { useComposerThread } from "../../kit/composer";
import { errorMessage } from "../../kit/format";
import { Icon, Tooltip, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { messageLinkPath } from "../../work/ui/in-flight-model";
import { InFlightBanner } from "../../work/ui/InFlight";
import type { StrandAsk, StrandView } from "../contract";
import { ageOf, decisionButtons, seqsOf, stepSeq, stripOf, stripShown, type AskRow } from "./model";
import { select, selectionOf, useSelection } from "./selection";

export const STRANDS_TAB = "strands";
export const STRANDS_POLL_MS = 30_000;

/** Opens message `seq` of a thread in the timeline (its #msg= link, the search jump). */
export function useJump(threadId: string): (seq: number) => boolean {
  const navigate = useBbNavigate();
  const pathname = usePathname();
  return useCallback((seq: number) => {
    const path = messageLinkPath(pathname, threadId, seq);
    return !!path && !!toAppPathOf(navigate)?.(path, { replace: true });
  }, [navigate, pathname, threadId]);
}

/** Selects a strand (or clears it) and opens its newest message. */
export function useSelectStrand(threadId: string) {
  const jump = useJump(threadId);
  const call = useCall();
  const tags = useLive("strands.tags", { threadId }, { pollMs: 60_000 });
  return useCallback((strand: Pick<StrandView, "id" | "latestSeq"> | null) => {
    const current = selectionOf(threadId);
    if (!strand || current?.strandId === strand.id) { select(threadId, null); return; }
    const seq = strand.latestSeq ?? seqsOf(tags.data, strand.id).at(-1) ?? null;
    select(threadId, { strandId: strand.id, seq });
    if (seq !== null) jump(seq);
    void call("strands.opened", { strandId: strand.id }).catch(() => undefined);
  }, [call, jump, tags.data, threadId]);
}

/** The banner: the strands strip where strands run, else the In flight strip. */
export function StrandsOrInFlightBanner() {
  const threadId = useComposerThread();
  const list = useLive("strands.list", { threadId: threadId ?? "" }, { enabled: !!threadId, pollMs: STRANDS_POLL_MS });
  if (!threadId) return null;
  if (stripShown(list.data)) return <StrandsStrip threadId={threadId} />;
  return <InFlightBanner />;
}

export function StateMark({ strand, now }: { strand: StrandView; now: number }) {
  switch (strand.state) {
    case "needs-you": return <span role="img" aria-label="Needs you" className="size-1.5 shrink-0 rounded-full bg-warning" />;
    case "running": return <span role="img" aria-label="Running" className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-none" />;
    case "waiting": return <span role="img" aria-label="Waiting" className="inline-flex shrink-0 gap-[1.5px]"><i className="h-[7px] w-[2px] rounded-[1px] bg-muted-foreground" /><i className="h-[7px] w-[2px] rounded-[1px] bg-muted-foreground" /></span>;
    case "done-unseen": return <Icon name="Check" aria-label="Finished" className="size-3 shrink-0 text-muted-foreground" />;
    case "quiet": return <span className="text-muted-foreground/70">{ageOf(strand.lastAt, now)}</span>;
    default: return null;
  }
}

function Chip({ strand, pressed, onClick, now }: { strand: StrandView; pressed: boolean; onClick(): void; now: number }) {
  const quiet = strand.state === "quiet";
  return (
    <Tooltip label={strand.detail ?? strand.summary ?? strand.title}>
      <button type="button" aria-pressed={pressed} data-strand-chip={strand.id} onClick={onClick}
        className={cn("inline-flex h-6 max-w-56 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] hover:bg-accent/60",
          pressed ? "border-foreground/35 bg-accent text-foreground" : quiet ? "border-border/60 text-muted-foreground/70" : "border-border text-muted-foreground")}>
        <span className="truncate">{strand.title}</span>
        <StateMark strand={strand} now={now} />
      </button>
    </Tooltip>
  );
}

export function AskButtonsFor({ ask, threadId }: { ask: StrandAsk; threadId: string }) {
  const call = useCall();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const decide = async (decision: StrandAsk["decisions"][number]) => {
    setBusy(true);
    try { await call("bot_worker_approval_resolve", { threadId: ask.threadId, interactionId: ask.id, decision }); }
    catch (error) { toast.error("Couldn't answer the approval.", { description: errorMessage(error) }); }
    finally { setBusy(false); }
  };
  if (ask.kind === "approval") {
    return <>{decisionButtons(ask).map((button) => (
      <button key={button.decision} type="button" disabled={busy} onClick={() => void decide(button.decision)}
        className={cn("h-6 cursor-pointer whitespace-nowrap rounded-md border px-2 text-[11.5px] disabled:opacity-50", button.primary ? "border-transparent bg-foreground font-semibold text-background" : "border-border bg-transparent hover:bg-accent")}>
        {button.label}
      </button>
    ))}</>;
  }
  // A worker's question is answered in the worker; Main's own is in its composer already.
  if (ask.threadId !== threadId) {
    return <button type="button" onClick={() => navigate.toThread(ask.threadId)} className="h-6 cursor-pointer whitespace-nowrap rounded-md border border-border px-2 text-[11.5px] hover:bg-accent">Open</button>;
  }
  return null;
}

function AskLine({ row, threadId, onSelect }: { row: AskRow; threadId: string; onSelect(): void }) {
  return (
    <div className="flex items-center gap-2 rounded-md py-[3px] pl-2 pr-1" data-strand-ask={row.ask?.id ?? row.strand.id}>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
        <span role="img" aria-label="Needs you" className="size-1.5 shrink-0 rounded-full bg-warning" />
        <span className="truncate text-[12.5px] font-semibold">{row.strand.title}</span>
        <span className="truncate whitespace-nowrap text-[11.5px] text-muted-foreground/70">· {row.ask?.label ?? row.strand.detail ?? "Needs you"}</span>
      </button>
      {row.ask ? <span className="flex shrink-0 gap-1.5"><AskButtonsFor ask={row.ask} threadId={threadId} /></span> : null}
    </div>
  );
}

function SelectionBar({ threadId, strand, onClear }: { threadId: string; strand: StrandView; onClear(): void }) {
  const selection = useSelection(threadId);
  const tags = useLive("strands.tags", { threadId }, { pollMs: 60_000 });
  const jump = useJump(threadId);
  const seqs = seqsOf(tags.data, strand.id);
  const step = (by: -1 | 1) => {
    const seq = stepSeq(seqs, selection?.seq ?? null, by);
    if (seq === null) return;
    select(threadId, { strandId: strand.id, seq });
    jump(seq);
  };
  const count = seqs.length || strand.messages;
  return (
    <div className="mb-[3px] flex items-center gap-2 border-b border-border/60 pb-1.5 pl-2 pr-1 pt-1 text-xs" data-strand-selection={strand.id}>
      <b className="truncate text-[12.5px]">{strand.title}</b>
      <span className="whitespace-nowrap text-muted-foreground">{count} {count === 1 ? "message" : "messages"}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <IconButton label="Previous message in this strand" icon="ChevronUp" onClick={() => step(-1)} />
        <IconButton label="Next message in this strand" icon="ChevronDown" onClick={() => step(1)} />
        <button type="button" disabled aria-disabled="true" className="h-6 whitespace-nowrap rounded-md border border-border px-2 text-[11.5px] opacity-50">Show only this</button>
        <IconButton label="Clear" icon="X" onClick={onClear} />
      </span>
    </div>
  );
}

function IconButton({ label, icon, onClick }: { label: string; icon: string; onClick(): void }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} onClick={onClick} className="grid size-6 cursor-pointer place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground">
        <Icon name={icon} className="size-3.5" />
      </button>
    </Tooltip>
  );
}

export function StrandsStrip({ threadId, now = Date.now() }: { threadId: string; now?: number }) {
  const list = useLive("strands.list", { threadId }, { pollMs: STRANDS_POLL_MS });
  const selection = useSelection(threadId);
  const choose = useSelectStrand(threadId);
  const panel = experimental_useAppPanel();
  const [all, setAll] = useState(false);
  const { asks, more, chips } = stripOf(list.data, { all });
  const selected = selection ? [...(list.data?.strands ?? []), ...(list.data?.earlier ?? [])].find((strand) => strand.id === selection.strandId) ?? null : null;
  const openTab = () => { if (panel) openThreadTab(panel, { actionId: STRANDS_TAB, title: "Strands" }); };
  if (!list.data) return null;
  return (
    <section aria-label="Strands" data-testid="strands-strip" className="px-1.5 pb-1.5 pt-1">
      {selected ? <SelectionBar threadId={threadId} strand={selected} onClear={() => select(threadId, null)} /> : null}
      {asks.map((row) => <AskLine key={`${row.strand.id}:${row.ask?.id ?? ""}`} row={row} threadId={threadId} onSelect={() => choose(row.strand)} />)}
      <div className={cn("flex flex-wrap items-center gap-[5px] px-0.5", asks.length || selected ? "mt-[3px] border-t border-border/60 pt-[5px]" : "")}>
        {more ? (
          <button type="button" onClick={() => setAll(true)} className="inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 text-[11.5px] text-foreground hover:bg-accent/60">
            <span role="img" aria-label="Needs you" className="size-1.5 rounded-full bg-warning" />{more} more need you
          </button>
        ) : null}
        {chips.map((strand) => <Chip key={strand.id} strand={strand} now={now} pressed={selection?.strandId === strand.id} onClick={() => choose(strand)} />)}
        {panel ? (
          <Tooltip label="All strands">
            <button type="button" aria-label="All strands" onClick={openTab} className="ml-auto grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <Icon name="LayoutList" className="size-3.5" />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </section>
  );
}
