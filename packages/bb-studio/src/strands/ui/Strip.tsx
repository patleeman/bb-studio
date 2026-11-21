// The strands line above Main's composer (design 4a, made compact at
// Patrick's ask): one text line, "◆ Model router · 2 need you · 3 running ·
// 4 quiet ▾", the current strand's name then counts, amber only for "need
// you". It opens a compact list (one line per strand; an ask with its
// buttons inline), keyboard-navigable. Picking a strand selects it: its
// messages stay, the rest dim, and the line steps through them. Nothing
// open, no line. It takes the In flight strip's place where strands run
// (phase 1: Main); the workbench Strands tab is the full view.
import { experimental_useAppPanel, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { toAppPathOf } from "../../kit/app/host-sdk";
import { usePathname } from "../../kit/app/route";
import { openThreadTab } from "../../kit/app/thread-panel";
import { useComposerThread } from "../../kit/composer";
import { errorMessage } from "../../kit/format";
import { Icon, Popover, PopoverContent, PopoverTrigger, Tooltip, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { messageLinkPath } from "../../work/ui/in-flight-model";
import { InFlightBanner } from "../../work/ui/InFlight";
import type { StrandAsk, StrandList, StrandView } from "../contract";
import { ageOf, countsOf, currentOf, decisionButtons, hasOpen, seqsOf, stepSeq, stripShown } from "./model";
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

/** Selects a strand and opens its newest message; picking the selected one again (a chip, a tag) clears it unless `keep`. */
export function useSelectStrand(threadId: string) {
  const jump = useJump(threadId);
  const call = useCall();
  const tags = useLive("strands.tags", { threadId }, { pollMs: 60_000 });
  return useCallback((strand: Pick<StrandView, "id" | "latestSeq"> | null, keep = false) => {
    const current = selectionOf(threadId);
    if (!strand || (current?.strandId === strand.id && !keep)) { select(threadId, null); return; }
    const seq = strand.latestSeq ?? seqsOf(tags.data, strand.id).at(-1) ?? null;
    select(threadId, { strandId: strand.id, seq });
    if (seq !== null) jump(seq);
    void call("strands.opened", { strandId: strand.id }).catch(() => undefined);
  }, [call, jump, tags.data, threadId]);
}

/** In flight's banner, except where strands run (phase 1: Main): there the strands line takes its place. */
export function InFlightUnlessStrands() {
  const threadId = useComposerThread();
  const list = useLive("strands.list", { threadId: threadId ?? "" }, { enabled: !!threadId, pollMs: STRANDS_POLL_MS });
  if (!threadId || stripShown(list.data)) return null;
  return <InFlightBanner />;
}

/** The strands line, unframed, right above the composer; nothing where strands don't run or nothing is open. */
export function StrandsLineBanner() {
  const threadId = useComposerThread();
  const list = useLive("strands.list", { threadId: threadId ?? "" }, { enabled: !!threadId, pollMs: STRANDS_POLL_MS });
  if (!threadId || !stripShown(list.data)) return null;
  return <StrandsStrip threadId={threadId} />;
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

const smallButton = "h-6 cursor-pointer whitespace-nowrap rounded-md border px-2 text-[11.5px] disabled:opacity-50";

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
        className={cn(smallButton, button.primary ? "border-transparent bg-foreground font-semibold text-background" : "border-border bg-transparent hover:bg-accent")}>
        {button.label}
      </button>
    ))}</>;
  }
  // A worker's question is answered in the worker; Main's own is in its composer already.
  if (ask.threadId !== threadId) {
    return <button type="button" onClick={() => navigate.toThread(ask.threadId)} className={cn(smallButton, "border-border hover:bg-accent")}>Open</button>;
  }
  return null;
}

function IconButton({ label, icon, onClick }: { label: string; icon: string; onClick(): void }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} onClick={onClick} className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
        <Icon name={icon} className="size-3.5" />
      </button>
    </Tooltip>
  );
}

/** Arrow keys, Home and End move between the list's options. */
function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  const keys: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
  const step = keys[event.key];
  if (step === undefined) return;
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-strand-option]")];
  if (!options.length) return;
  event.preventDefault();
  const at = options.indexOf(document.activeElement as HTMLElement);
  const next = step === -Infinity ? 0 : step === Infinity ? options.length - 1 : Math.max(0, Math.min(options.length - 1, (at < 0 ? -1 : at) + step));
  options[next]!.focus();
}

function StrandOption({ strand, threadId, selected, now, onPick }: { strand: StrandView; threadId: string; selected: boolean; now: number; onPick(): void }) {
  const ask = strand.state === "needs-you" ? strand.asks[0] ?? null : null;
  return (
    <li data-strand-row={strand.id} className={cn("rounded-md", selected && "bg-accent")}>
      <button type="button" data-strand-option={strand.id} data-needs-you={strand.state === "needs-you" ? "" : undefined} aria-current={selected || undefined} onClick={onPick}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] outline-none hover:bg-accent/60 focus-visible:bg-accent/60">
        <span className="grid w-3 shrink-0 place-items-center">{strand.state === "quiet" ? null : <StateMark strand={strand} now={now} />}</span>
        <span className={cn("min-w-0 flex-1 truncate", strand.state === "quiet" && "text-muted-foreground")}>{strand.title}</span>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/70">{ageOf(strand.lastAt, now)}</span>
      </button>
      {ask ? (
        // The whole ask before its buttons: the full command, folder, actions and session grant, never cut.
        <div className="pb-1.5 pl-7 pr-2" data-strand-ask={ask.id}>
          <p className="whitespace-pre-wrap break-words text-[11.5px] text-muted-foreground">{ask.label}</p>
          {ask.details.length ? (
            <ul className="mt-1 space-y-0.5 rounded bg-muted/40 px-1.5 py-1 font-mono text-[11px] text-foreground/90">
              {ask.details.map((line, index) => <li key={index} className="whitespace-pre-wrap break-all">{line}</li>)}
            </ul>
          ) : null}
          <div className="mt-1.5 flex flex-wrap gap-1.5"><AskButtonsFor ask={ask} threadId={threadId} /></div>
        </div>
      ) : null}
    </li>
  );
}

/** The compact list behind the line: needs you first (with each ask's buttons), then by state and newest. */
function StrandsMenu({ list, threadId, now, onPick, onAll }: { list: StrandList; threadId: string; now: number; onPick(strand: StrandView): void; onAll(): void }) {
  const selection = useSelection(threadId);
  return (
    <div onKeyDown={moveFocus}>
      <ul aria-label="Strands" className="max-h-80 overflow-auto p-1" data-testid="strands-menu">
        {list.strands.map((strand) => <StrandOption key={strand.id} strand={strand} threadId={threadId} now={now} selected={selection?.strandId === strand.id} onPick={() => onPick(strand)} />)}
      </ul>
      <div className="border-t border-border/60 p-1">
        <button type="button" data-strand-option="all" onClick={onAll} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60">
          <Icon name="LayoutList" className="size-3.5" />All strands
        </button>
      </div>
    </div>
  );
}

export function StrandsStrip({ threadId, now = Date.now() }: { threadId: string; now?: number }) {
  const list = useLive("strands.list", { threadId }, { pollMs: STRANDS_POLL_MS });
  const tags = useLive("strands.tags", { threadId }, { pollMs: 60_000 });
  const selection = useSelection(threadId);
  const choose = useSelectStrand(threadId);
  const jump = useJump(threadId);
  const panel = experimental_useAppPanel();
  const [open, setOpen] = useState(false);
  const focusAsks = useRef(false);
  if (!list.data || !hasOpen(list.data)) return null;
  const data = list.data;
  const counts = countsOf(data);
  const current = currentOf(data, selection);
  const selected = selection ? current : null;
  const seqs = selected ? seqsOf(tags.data, selected.id) : [];
  const step = (by: -1 | 1) => {
    if (!selected) return;
    const seq = stepSeq(seqs, selection?.seq ?? null, by);
    if (seq === null) return;
    select(threadId, { strandId: selected.id, seq });
    jump(seq);
  };
  const openList = (asks: boolean) => { focusAsks.current = asks; setOpen(true); };
  const parts = [
    counts.needs ? { key: "needs", text: `${counts.needs} need you`, amber: true } : null,
    counts.running ? { key: "running", text: `${counts.running} running` } : null,
    counts.finished ? { key: "finished", text: `${counts.finished} finished` } : null,
    counts.waiting ? { key: "waiting", text: `${counts.waiting} waiting` } : null,
    counts.quiet ? { key: "quiet", text: `${counts.quiet} quiet` } : null,
  ].filter((part): part is { key: string; text: string; amber?: boolean } => !!part);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <section aria-label="Strands" data-testid="strands-strip" className="flex h-6 min-w-0 items-center gap-1.5 px-3 text-[11.5px] text-muted-foreground">
        <PopoverTrigger asChild>
          <button type="button" data-strands-line="" aria-haspopup="listbox" onClick={() => { focusAsks.current = false; }}
            className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded px-1 hover:bg-accent/60 hover:text-foreground">
            <span aria-hidden className="text-[9px] text-muted-foreground/70">◆</span>
            <span className={cn("truncate", selected ? "font-semibold text-foreground" : "text-foreground/90")}>{current?.title ?? "Strands"}</span>
            {selected ? <span className="shrink-0 whitespace-nowrap">· {seqs.length || selected.messages} {(seqs.length || selected.messages) === 1 ? "message" : "messages"}</span> : null}
            <Icon name="ChevronDown" className="size-3 shrink-0" />
          </button>
        </PopoverTrigger>
        {selected ? (
          <span className="flex shrink-0 items-center gap-0.5" data-strand-selection={selected.id}>
            <IconButton label="Previous message in this strand" icon="ChevronUp" onClick={() => step(-1)} />
            <IconButton label="Next message in this strand" icon="ChevronDown" onClick={() => step(1)} />
            <button type="button" disabled aria-disabled="true" className="h-5 whitespace-nowrap rounded px-1.5 opacity-50">Show only this</button>
            <IconButton label="Clear" icon="X" onClick={() => select(threadId, null)} />
          </span>
        ) : null}
        <span className="ml-auto flex min-w-0 shrink items-center gap-1 overflow-hidden whitespace-nowrap">
          {parts.map((part, index) => (
            <span key={part.key} className="flex items-center gap-1">
              {index ? <span aria-hidden className="text-muted-foreground/50">·</span> : null}
              {part.amber ? (
                <button type="button" data-strands-needs="" onClick={() => openList(true)} className="flex cursor-pointer items-center gap-1 rounded px-0.5 font-medium text-warning hover:bg-warning/10">
                  <span aria-hidden className="size-1.5 rounded-full bg-warning" />{part.text}
                </button>
              ) : <span>{part.text}</span>}
            </span>
          ))}
        </span>
      </section>
      <PopoverContent side="top" align="start" className="w-[400px] max-w-[90vw] p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const root = (event.currentTarget as HTMLElement | null) ?? document;
          const target = (focusAsks.current && root.querySelector<HTMLElement>("[data-needs-you]"))
            || root.querySelector<HTMLElement>("[data-strand-option][aria-current]") || root.querySelector<HTMLElement>("[data-strand-option]");
          target?.scrollIntoView({ block: "nearest" });
          target?.focus();
        }}>
        <StrandsMenu list={data} threadId={threadId} now={now}
          onPick={(strand) => { choose(strand, true); setOpen(false); }}
          onAll={() => { setOpen(false); if (panel) openThreadTab(panel, { actionId: STRANDS_TAB, title: "Strands" }); }} />
      </PopoverContent>
    </Popover>
  );
}
