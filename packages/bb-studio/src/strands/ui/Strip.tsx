// The strands box above a Bot conversation's composer (it replaced the In
// flight box). Compact by default: one header line with the current strand,
// what it is about (its summary) and the counts, amber only for "need you".
// It expands in place into a filter field: type to narrow the strands by name
// and summary, grouped needs you / active / quiet, each with its one-line
// summary and an ask's buttons. Picking one applies it as a filter (a token
// with ×; Esc clears it): BB's timeline shows only that strand's messages,
// expanded, back to its first one (the fork's timeline filter; an older BB
// dims the others instead), and the header steps through them. It is the
// one box above the composer: a strand's workers (running, waiting on you,
// finished, failed) show on its row, and workers no strand holds are counted
// in the line and listed under "In no strand". Nothing open, no box. The
// workbench Strands tab is the full view.
import { experimental_useAppPanel, useBbNavigate, useComposer } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { toAppPathOf } from "../../kit/app/host-sdk";
import { usePathname } from "../../kit/app/route";
import { openThreadTab } from "../../kit/app/thread-panel";
import { useComposerThread } from "../../kit/composer";
import { errorMessage } from "../../kit/format";
import { Icon, Tooltip, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { messageLinkPath } from "../../work/ui/in-flight-model";
import type { StrandAsk, StrandView } from "../contract";
import { ageOf, boxGroups, countsOf, currentOf, decisionButtons, filterTurnsOf, hasOpen, replyAskOf, rowWorkersOf, seqsOf, stepSeq, strayCountsOf, stripShown } from "./model";
import { hostContextSegments, useHidePromptStack } from "./prompt-stack";
import { flashReply } from "./ask-mark";
import { openFoldOf, select, selectionOf, setStrandTurns, showSent, useSelection, zoomInHost } from "./selection";

export const STRANDS_TAB = "strands";
export const STRANDS_POLL_MS = 30_000;

/**
 * Opens message `seq` of a thread in the timeline (its #msg= link, the search
 * jump). Under a strand filter, the conversation's opening message (which BB's
 * filtered timeline never shows) opens at its turn's reply, or not at all,
 * instead of BB saying "Message not found".
 */
export function useJump(threadId: string): (seq: number) => boolean {
  const navigate = useBbNavigate();
  const pathname = usePathname();
  const opening = useLive("strands.tags", { threadId }, { pollMs: 60_000 }).data?.opening ?? null;
  const openingSeq = opening?.seq ?? null;
  const openingReply = opening?.replySeq ?? null;
  return useCallback((asked: number) => {
    const seq = selectionOf(threadId) && asked === openingSeq ? openingReply : asked;
    if (seq === null) return false;
    const path = messageLinkPath(pathname, threadId, seq);
    // A message in a folded run of status replies: open the run first, so the jump lands on it.
    openFoldOf(threadId, seq);
    return !!path && !!toAppPathOf(navigate)?.(path, { replace: true });
  }, [navigate, pathname, threadId, openingSeq, openingReply]);
}

/**
 * Applies a strand as the conversation's filter and opens its newest message;
 * picking the filtered one again (a tag, a tab item) clears it unless `keep`.
 */
export function useSelectStrand(threadId: string) {
  const jump = useJump(threadId);
  const call = useCall();
  const tags = useLive("strands.tags", { threadId }, { pollMs: 60_000 });
  const list = useLive("strands.list", { threadId }, { pollMs: STRANDS_POLL_MS });
  return useCallback((strand: Pick<StrandView, "id" | "latestSeq"> & Partial<Pick<StrandView, "firstSeq">> | null, keep = false) => {
    const current = selectionOf(threadId);
    if (!strand || (current?.strandId === strand.id && !keep)) { select(threadId, null); return; }
    const turns = filterTurnsOf(tags.data, list.data, strand.id, threadId);
    const seq = strand.latestSeq ?? seqsOf(tags.data, strand.id).at(-1) ?? null;
    select(threadId, { strandId: strand.id, seq, firstSeq: strand.firstSeq ?? turns.firstSeq, turnIds: turns.turnIds });
    if (seq !== null) jump(seq);
    void call("strands.opened", { strandId: strand.id }).catch(() => undefined);
  }, [call, jump, tags.data, list.data, threadId]);
}

/**
 * A conversation's strand filter, wherever it is shown (the box, or the
 * header where BB zooms): the filtered strand and its messages, stepping
 * through them, Esc to clear it (unless something else is typed in; `own` is
 * the box's own search field), and the strand's new turns joining the filter
 * as they are learned.
 */
export function useStrandFilter(threadId: string, own?: { readonly current: HTMLElement | null }) {
  const list = useLive("strands.list", { threadId }, { pollMs: STRANDS_POLL_MS });
  const tags = useLive("strands.tags", { threadId }, { pollMs: 60_000 });
  const selection = useSelection(threadId);
  const jump = useJump(threadId);
  const data = list.data;
  const current = currentOf(data, selection);
  const filtered = selection ? current : null;
  // New turns of the filtered strand (and asks waiting elsewhere) join the filter as they are learned.
  useEffect(() => {
    if (!selection) return;
    const turns = filterTurnsOf(tags.data, data, selection.strandId, threadId);
    if (turns.turnIds.length) setStrandTurns(threadId, selection.strandId, turns.turnIds, filtered?.firstSeq ?? turns.firstSeq);
  }, [tags.data, data, selection, threadId, filtered?.firstSeq]);
  // Esc clears the filter (unless something else is being typed in).
  useEffect(() => {
    if (!selection) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) && target !== own?.current;
      if (typing) return;
      // Handled: Esc Esc (keyboard mode) doesn't count this one.
      event.preventDefault();
      select(threadId, null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection, threadId, own]);
  const seqs = filtered ? seqsOf(tags.data, filtered.id) : [];
  const step = (by: -1 | 1) => {
    if (!filtered) return;
    const seq = stepSeq(seqs, selection?.seq ?? null, by);
    if (seq === null) return;
    select(threadId, { ...selection!, seq });
    jump(seq);
  };
  return { list, tags, data, selection, current, filtered, seqs, step };
}

/** Opens the conversation's Strands tab (the full list, asks, merging, stray workers). */
export function useOpenStrandsTab() {
  const panel = experimental_useAppPanel();
  return useCallback(() => { if (panel) openThreadTab(panel, { actionId: STRANDS_TAB, title: "Strands" }); }, [panel]);
}

/** In flight's place: the strands box, in BB's card above the composer; nothing where strands don't run or nothing is open. */
export function StrandsBoxBanner() {
  const threadId = useComposerThread();
  const composer = useComposer();
  // A message sent here (queued ones too) is drawn at once, not after strands tags its turn.
  useEffect(() => (threadId ? composer.onSubmitted(() => showSent(threadId)) : undefined), [composer, threadId]);
  return threadId ? <StrandsBoxFor threadId={threadId} /> : null;
}

/** The box for one conversation, where it runs and has something to show; also drawn inside a composer Studio replaces (BB draws no banners there). */
export function StrandsBoxFor({ threadId }: { threadId: string }) {
  const list = useLive("strands.list", { threadId }, { enabled: !!threadId, pollMs: STRANDS_POLL_MS });
  const shown = stripShown(list.data);
  // The box stands in for BB's running children; where strands run, the Info tab shows BB's context row.
  // BB's running children give way only to a box actually drawn (not where BB zooms and the box is gone).
  const drawn = shown && !zoomInHost();
  useHidePromptStack(threadId, [
    ...(drawn && hasOpen(list.data) ? ["active-child-threads" as const] : []),
    ...(list.data?.enabled && hostContextSegments() ? ["thread-context" as const] : []),
  ]);
  // Where BB zooms (the fork's zoom seam), the header's switch, filter chip and Strands button take the box's place.
  if (!drawn) return null;
  return <StrandsBox threadId={threadId} />;
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

/** Opens message `seq` of a conversation: in place when it is open, else by its link. */
function useOpenMessage() {
  const navigate = useBbNavigate();
  const pathname = usePathname();
  return useCallback((threadId: string, seq: number) => {
    openFoldOf(threadId, seq);
    const here = messageLinkPath(pathname, threadId, seq);
    if (!toAppPathOf(navigate)?.(here ?? `/threads/${encodeURIComponent(threadId)}#msg=${seq}`, here ? { replace: true } : undefined)) navigate.toThread(threadId);
  }, [navigate, pathname]);
}

export function AskButtonsFor({ ask, threadId, onOpen }: { ask: StrandAsk; threadId: string; /** After Jump to reply opens the reply (the box closes so it shows). */ onOpen?(): void }) {
  const call = useCall();
  const navigate = useBbNavigate();
  const openMessage = useOpenMessage();
  const [busy, setBusy] = useState(false);
  // A reply that needs you: open it, or mark it done.
  if (ask.kind === "reply") {
    const done = async () => {
      if (ask.seq === null) return;
      setBusy(true);
      try { if (!(await call("strands.resolveReply", { threadId: ask.threadId, seq: ask.seq })).ok) toast.error("Couldn't mark it done."); }
      catch (error) { toast.error("Couldn't mark it done.", { description: errorMessage(error) }); }
      finally { setBusy(false); }
    };
    return <>
      {ask.seq !== null ? <button type="button" data-reply-jump={ask.seq} onClick={() => { flashReply(ask.threadId, ask.seq!); openMessage(ask.threadId, ask.seq!); onOpen?.(); }} className={cn(smallButton, "border-transparent bg-foreground font-semibold text-background")}>Jump to reply</button> : null}
      <button type="button" data-reply-done={ask.seq ?? ""} disabled={busy || ask.seq === null} onClick={() => void done()} className={cn(smallButton, "border-border bg-transparent hover:bg-accent")}>Done</button>
    </>;
  }
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
export function moveFocus(event: KeyboardEvent<HTMLElement>): void {
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

const WORKER_WORD: Record<StrandView["workers"][number]["status"], string> = { running: "running", "needs-you": "needs you", done: "finished", failed: "failed" };

/** A worker's mark: a spinner while it runs, amber when it waits on you, else neutral. */
function WorkerMark({ status }: { status: StrandView["workers"][number]["status"] }) {
  if (status === "running") return <span role="img" aria-label="Running" className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-none" />;
  if (status === "needs-you") return <span role="img" aria-label="Needs you" className="size-1.5 shrink-0 rounded-full bg-warning" />;
  return <Icon name={status === "failed" ? "X" : "Check"} aria-label={status === "failed" ? "Failed" : "Finished"} className="size-3 shrink-0" />;
}

/** One worker on a strand's row: its mark, title and state. */
function WorkerLine({ worker }: { worker: StrandView["workers"][number] }) {
  return (
    <span data-strand-worker={worker.threadId} data-status={worker.status} className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span className="grid w-3 shrink-0 place-items-center"><WorkerMark status={worker.status} /></span>
      <span className="min-w-0 truncate text-foreground/80">{worker.title}</span>
      <span className={cn("shrink-0", worker.status === "needs-you" && "text-warning")}>{WORKER_WORD[worker.status]}</span>
    </span>
  );
}

/** One strand in the box's list: mark, name, its running workers and age, its one-line summary, its workers, and an ask with its whole details and buttons. */
function StrandOption({ strand, threadId, active, now, onPick, onClose }: { strand: StrandView; threadId: string; active: boolean; now: number; onPick(): void; onClose(): void }) {
  const ask = strand.state === "needs-you" ? strand.asks[0] ?? null : null;
  const workers = rowWorkersOf(strand, now);
  const running = workers.filter((worker) => worker.status === "running").length;
  // Where the state's detail only names its workers, their lines say it: the row says what the strand is about.
  const about = ask ? null : workers.length && strand.state !== "waiting" ? strand.summary : strand.detail ?? strand.summary;
  return (
    <li data-strand-row={strand.id} className={cn("rounded-md", active && "bg-accent")}>
      <button type="button" data-strand-option={strand.id} data-needs-you={strand.state === "needs-you" ? "" : undefined} aria-current={active || undefined} onClick={onPick}
        className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:bg-accent/60">
        <span className="flex w-full items-center gap-2 text-[12.5px]">
          <span className="grid w-3 shrink-0 place-items-center">{strand.state === "quiet" ? null : <StateMark strand={strand} now={now} />}</span>
          <span className={cn("min-w-0 flex-1 truncate font-medium", strand.state === "quiet" && "text-muted-foreground")}>{strand.title}</span>
          {running ? <span data-strand-running="" className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{running} running</span> : null}
          <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/70">{ageOf(strand.lastAt, now)}</span>
        </span>
        {about ? <span className="truncate pl-5 text-[11.5px] text-muted-foreground">{about}</span> : null}
        {workers.length ? <span className="flex flex-col gap-px pl-5" data-strand-workers="">{workers.map((worker) => <WorkerLine key={worker.threadId} worker={worker} />)}</span> : null}
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
          <div className="mt-1.5 flex flex-wrap gap-1.5"><AskButtonsFor ask={ask} threadId={threadId} onOpen={onClose} /></div>
        </div>
      ) : null}
    </li>
  );
}

export function StrandsBox({ threadId, now = Date.now() }: { threadId: string; now?: number }) {
  const choose = useSelectStrand(threadId);
  const panel = experimental_useAppPanel();
  const navigate = useBbNavigate();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { data, selection, current, filtered, seqs, step } = useStrandFilter(threadId, input);
  useEffect(() => { if (expanded) input.current?.focus(); }, [expanded]);
  if (!data || !hasOpen(data)) return null;
  const counts = countsOf(data);
  const groups = boxGroups(data, query);
  const matches = groups.flatMap((group) => group.strands);
  const needle = query.trim().toLowerCase();
  const stray = data.strayWorkers ?? [];
  const strayCounts = strayCountsOf(data);
  const strayShown = needle ? stray.filter((worker) => worker.title.toLowerCase().includes(needle)) : stray;
  // A strand waiting on a reply opens at that reply.
  const pick = (strand: StrandView) => { const reply = replyAskOf(strand); if (reply) flashReply(threadId, reply.seq); choose(reply ? { ...strand, latestSeq: reply.seq } : strand, true); setExpanded(false); setQuery(""); };
  const openTab = () => { setExpanded(false); if (panel) openThreadTab(panel, { actionId: STRANDS_TAB, title: "Strands" }); };
  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && matches[0]) { event.preventDefault(); pick(matches[0]); }
    // Handled here, not again by the list's own arrow keys.
    else if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); listRef.current?.querySelector<HTMLElement>("[data-strand-option]")?.focus(); }
    else if (event.key === "Escape") { event.preventDefault(); if (query) setQuery(""); else setExpanded(false); }
  };
  type Part = { key: string; text: string; amber?: boolean; opens?: boolean };
  const parts = ([
    counts.needs + strayCounts.needs ? { key: "needs", text: `${counts.needs + strayCounts.needs} need you`, amber: true } : null,
    counts.running + strayCounts.running ? { key: "running", text: `${counts.running + strayCounts.running} running` } : null,
    strayCounts.failed ? { key: "failed", text: `${strayCounts.failed} failed`, opens: true } : null,
    counts.finished ? { key: "finished", text: `${counts.finished} finished` } : null,
    counts.waiting ? { key: "waiting", text: `${counts.waiting} waiting` } : null,
    counts.quiet ? { key: "quiet", text: `${counts.quiet} quiet` } : null,
  ] as (Part | null)[]).filter((part): part is Part => !!part);
  const about = current?.summary ?? current?.detail ?? null;
  return (
    <section aria-label="Strands" data-testid="strands-strip" data-expanded={expanded || undefined} className="flex flex-col text-[12px]">
      <div className="flex min-h-8 min-w-0 items-center gap-2 px-2.5 py-1">
        {filtered ? (
          <span data-strand-filter={filtered.id} className="inline-flex min-w-0 max-w-[45%] shrink items-center gap-1 rounded-md border border-foreground/25 bg-accent px-1.5 py-0.5 font-medium text-foreground">
            <span className="truncate">{filtered.title}</span>
            <button type="button" aria-label="Clear filter" onClick={() => select(threadId, null)} className="grid size-4 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:text-foreground">
              <Icon name="X" className="size-3" />
            </button>
          </span>
        ) : null}
        <button type="button" data-strands-line="" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent/50">
          {filtered ? null : <>
            <span aria-hidden className="text-[9px] text-muted-foreground/70">◆</span>
            <span className="shrink-0 font-medium text-foreground">{current?.title ?? "Strands"}</span>
          </>}
          {about ? <span className="min-w-0 truncate text-muted-foreground">{filtered ? about : `· ${about}`}</span> : null}
          <Icon name={expanded ? "ChevronUp" : "ChevronDown"} className="size-3 shrink-0 text-muted-foreground" />
        </button>
        {filtered ? (
          <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground" data-strand-selection={filtered.id}>
            <span className="whitespace-nowrap">{seqs.length || filtered.messages} {(seqs.length || filtered.messages) === 1 ? "message" : "messages"}</span>
            <IconButton label="Previous message in this strand" icon="ChevronUp" onClick={() => step(-1)} />
            <IconButton label="Next message in this strand" icon="ChevronDown" onClick={() => step(1)} />
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-[11.5px] text-muted-foreground">
          {parts.map((part, index) => (
            <span key={part.key} className="flex items-center gap-1">
              {index ? <span aria-hidden className="text-muted-foreground/50">·</span> : null}
              {part.amber ? (
                <button type="button" data-strands-needs="" onClick={() => setExpanded(true)} className="flex cursor-pointer items-center gap-1 rounded px-0.5 font-medium text-warning hover:bg-warning/10">
                  <span aria-hidden className="size-1.5 rounded-full bg-warning" />{part.text}
                </button>
              ) : part.opens ? (
                <button type="button" data-strands-failed="" onClick={() => setExpanded(true)} className="cursor-pointer rounded px-0.5 hover:bg-accent/60 hover:text-foreground">{part.text}</button>
              ) : <span>{part.text}</span>}
            </span>
          ))}
        </span>
      </div>
      {expanded ? (
        <div className="border-t border-border/70" data-testid="strands-menu" onKeyDown={moveFocus} ref={listRef}>
          <div className="flex items-center gap-2 px-2.5 pt-2">
            <Icon name="Search" className="size-3.5 text-muted-foreground" />
            <input ref={input} type="text" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onInputKey}
              aria-label="Filter strands" placeholder="Filter strands" data-strand-query=""
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70" />
          </div>
          <div className="max-h-72 overflow-auto px-1 pb-1 pt-1">
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold text-muted-foreground/70">{group.label}</div>
                <ul className="flex flex-col gap-px">
                  {group.strands.map((strand) => <StrandOption key={strand.id} strand={strand} threadId={threadId} now={now} active={selection?.strandId === strand.id} onPick={() => pick(strand)} onClose={() => { setExpanded(false); setQuery(""); }} />)}
                </ul>
              </section>
            ))}
            {strayShown.length ? (
              <section aria-label="In no strand" data-strands-stray="">
                <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold text-muted-foreground/70">In no strand</div>
                <ul className="flex flex-col gap-px">
                  {strayShown.map((worker) => (
                    <li key={worker.threadId}>
                      <button type="button" data-strand-option={`worker:${worker.threadId}`} onClick={() => { setExpanded(false); navigate.toThread(worker.threadId); }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] outline-none hover:bg-accent/60 focus-visible:bg-accent/60">
                        <WorkerLine worker={worker} />
                        {worker.status === "failed" && worker.endedAt !== null ? <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/70">{ageOf(worker.endedAt, now)}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {!groups.length && !strayShown.length ? <p className="px-2 py-1.5 text-muted-foreground">No strands match</p> : null}
          </div>
          <div className="flex items-center border-t border-border/60 px-1 py-1">
            <button type="button" data-strand-option="all" onClick={openTab} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60">
              <Icon name="ListView" className="size-3.5" />All strands
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
