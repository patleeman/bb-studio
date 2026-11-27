// The Strands tab in a conversation's workbench: every strand as its own
// card, by state (needs you first, with its ask's buttons), quiet ones faded
// and Earlier folded. A card shows the name, what the strand is about, its
// state, messages, first and last activity, and its workers; clicking it
// filters the conversation to that strand. Its ⋯ menu renames, pins or
// merges it (the user's choice always wins). No color but amber for needs you.
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "../../kit/format";
import type { ThreadTabProps } from "../../kit/app/thread-panel";
import { relativeTime } from "../../kit/format";
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, Icon } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import type { StrandView } from "../contract";
import { groupsOf } from "./model";
import { useSelection } from "./selection";
import { AskButtonsFor, StateMark, STRANDS_POLL_MS, useSelectStrand } from "./Strip";
import { ageOf } from "./model";

/** The row's ⋯ menu: Rename, Pin or Unpin, Merge into another strand. */
function RowMenu({ strand, others, onRename, onMerge }: { strand: StrandView; others: readonly StrandView[]; onRename(): void; onMerge(into: StrandView): void }) {
  const call = useCall();
  const run = async (what: () => Promise<{ ok: boolean }>, failed: string) => {
    try { if (!(await what()).ok) toast.error(failed); } catch (error) { toast.error(failed, { description: errorMessage(error) }); }
  };
  return (
    // Its clicks act on the menu, not the row.
    <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`${strand.title}: more`} data-strand-menu={strand.id} className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            <Icon name="MoreHorizontal" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run(() => call("strands.pin", { strandId: strand.id, pinned: !strand.pinned }), "Couldn't pin the strand.")}>{strand.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
          {others.length ? <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Merge into</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {others.map((other) => (
                  <DropdownMenuItem key={other.id} onSelect={() => onMerge(other)}>{other.title}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function RenameField({ strand, onDone }: { strand: StrandView; onDone(): void }) {
  const call = useCall();
  const [title, setTitle] = useState(strand.title);
  const save = async () => {
    const name = title.trim();
    if (name && name !== strand.title) {
      try { if (!(await call("strands.rename", { strandId: strand.id, title: name })).ok) toast.error("Couldn't rename the strand."); }
      catch (error) { toast.error("Couldn't rename the strand.", { description: errorMessage(error) }); }
    }
    onDone();
  };
  return (
    <input autoFocus aria-label="Strand name" value={title} maxLength={80} data-strand-rename={strand.id}
      onChange={(event) => setTitle(event.target.value)} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") void save(); if (event.key === "Escape") onDone(); }}
      onBlur={() => void save()}
      className="min-w-0 flex-1 rounded border border-border bg-transparent px-1 text-[12.5px] font-semibold outline-none focus:border-foreground/40" />
  );
}

/** A strand's state in words, beside its neutral mark (amber only for needs you). */
function stateLabel(strand: StrandView, now: number): string {
  switch (strand.state) {
    case "needs-you": return "Needs you";
    case "running": return "Running";
    case "done-unseen": return "Finished";
    case "waiting": return strand.detail ? `Waiting on ${strand.detail}` : "Waiting";
    case "quiet": return `Quiet · ${ageOf(strand.lastAt, now)}`;
    default: return "Open";
  }
}

const WORKER_MARK: Record<StrandView["workers"][number]["status"], { icon: string; label: string; spin?: boolean }> = {
  running: { icon: "Spinner", label: "running", spin: true },
  "needs-you": { icon: "AlertCircle", label: "needs you" },
  done: { icon: "Check", label: "finished" },
  failed: { icon: "X", label: "failed" },
};

/** One strand as its own card: name, what it is about, state, messages, first and last activity, workers, and an open ask with its buttons. Clicking it filters the conversation to it. */
function StrandCard({ strand, threadId, selected, now, others }: { strand: StrandView; threadId: string; selected: boolean; now: number; others: readonly StrandView[] }) {
  const choose = useSelectStrand(threadId);
  const call = useCall();
  const [renaming, setRenaming] = useState(false);
  const [merging, setMerging] = useState<StrandView | null>(null);
  const ask = strand.state === "needs-you" ? strand.asks[0] ?? null : null;
  // A merge is confirmed first, then can be undone for 10 seconds.
  const merge = async (into: StrandView) => {
    setMerging(null);
    try {
      if (!(await call("strands.merge", { strandId: strand.id, into: into.id })).ok) { toast.error("Couldn't merge the strands."); return; }
      toast(`Merged into ${into.title}`, { duration: 10_000, action: { label: "Undo", onClick: () => void call("strands.unmerge", { strandId: strand.id }).catch(() => toast.error("Couldn't undo the merge.")) } });
    } catch (error) { toast.error("Couldn't merge the strands.", { description: errorMessage(error) }); }
  };
  const about = strand.summary ?? (strand.state === "needs-you" ? null : strand.detail);
  const span = [strand.firstAt ? `first ${relativeTime(strand.firstAt, now)}` : null, strand.lastAt ? `last ${relativeTime(strand.lastAt, now)}` : null].filter(Boolean).join(" · ");
  return (
    <li role="button" tabIndex={0} data-strand-row={strand.id} aria-pressed={selected} onClick={() => choose(strand)}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); choose(strand); } }}
      className={cn("cursor-pointer list-none rounded-lg border bg-card/50 px-3 py-2.5 outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-foreground/40 bg-accent/60" : "border-border", strand.state === "quiet" && "opacity-70")}>
      <div className="flex items-center gap-2">
        {strand.state === "needs-you" ? <span role="img" aria-label="Needs you" className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
        {renaming ? <RenameField strand={strand} onDone={() => setRenaming(false)} /> : <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug">{strand.title}</h3>}
        {strand.pinned ? <Icon name="Pin" aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground" /> : null}
        <RowMenu strand={strand} others={others} onRename={() => setRenaming(true)} onMerge={setMerging} />
      </div>
      {merging ? (
        <div role="alertdialog" aria-label="Merge strands" data-strand-merge-confirm="" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[12px]"
          onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") setMerging(null); }}>
          <span className="min-w-0 flex-1">Merge “{strand.title}” into “{merging.title}”?</span>
          <button type="button" autoFocus onClick={() => void merge(merging)} className="h-6 cursor-pointer rounded-md bg-foreground px-2 text-[11.5px] font-semibold text-background">Merge</button>
          <button type="button" onClick={() => setMerging(null)} className="h-6 cursor-pointer rounded-md border border-border px-2 text-[11.5px] hover:bg-accent">Cancel</button>
        </div>
      ) : null}
      {about ? <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{about}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground" data-strand-facts="">
        <span className={cn("inline-flex items-center gap-1.5", strand.state === "needs-you" && "font-medium text-warning")}>
          {strand.state === "needs-you" || strand.state === "quiet" ? null : <StateMark strand={strand} now={now} />}
          {stateLabel(strand, now)}
        </span>
        <span>{strand.messages} {strand.messages === 1 ? "message" : "messages"}</span>
        {span ? <span>{span}</span> : null}
      </div>
      {strand.workers.length ? (
        <ul className="mt-1.5 flex flex-col gap-0.5" aria-label="Workers">
          {strand.workers.map((worker) => {
            const mark = WORKER_MARK[worker.status];
            return (
              <li key={worker.threadId} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <Icon name={mark.icon} aria-hidden className={cn("size-3 shrink-0", mark.spin && "animate-spin motion-reduce:animate-none", worker.status === "needs-you" && "text-warning")} />
                <span className="min-w-0 truncate text-foreground/90">{worker.title}</span>
                <span className="shrink-0">{mark.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {ask ? (
        // Buttons answer; they don't filter.
        <div className="mt-2 border-t border-border/60 pt-2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <p className="whitespace-pre-wrap break-words text-[12px]">{ask.label}</p>
          {ask.details.length ? (
            <ul className="mt-1 space-y-0.5 rounded bg-muted/40 px-1.5 py-1 font-mono text-[11px] text-foreground/90">
              {ask.details.map((line, index) => <li key={index} className="whitespace-pre-wrap break-all">{line}</li>)}
            </ul>
          ) : null}
          <div data-strand-ask-buttons="" className="mt-1.5 flex flex-wrap gap-[5px]"><AskButtonsFor ask={ask} threadId={threadId} /></div>
        </div>
      ) : null}
    </li>
  );
}

export function StrandsTab({ threadId, now: at }: ThreadTabProps & { now?: number }) {
  const list = useLive("strands.list", { threadId }, { pollMs: STRANDS_POLL_MS });
  const selection = useSelection(threadId);
  const [earlier, setEarlier] = useState(false);
  const now = at ?? Date.now();
  if (!list.data) {
    return list.error ? (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="alert">
        <span className="min-w-0 flex-1">{list.error}</span>
        <button type="button" onClick={() => void list.refresh()} className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-state-hover">Retry</button>
      </div>
    ) : <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (!list.data.enabled) return <p className="p-4 text-sm text-muted-foreground">No strands in this conversation</p>;
  const groups = groupsOf(list.data);
  const all = [...list.data.strands, ...list.data.earlier];
  return (
    <div className="h-full overflow-auto px-2 py-2.5" data-testid="strands-tab">
      <h2 className="mx-2 my-0.5 text-[14px] font-semibold">Strands</h2>
      {!groups.length ? <p className="mx-2 mt-2 text-xs text-muted-foreground">{list.data.backfill.done ? "No strands yet" : "Sorting this conversation…"}</p> : null}
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="px-2 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{group.label}</h3>
          <ul className="flex flex-col gap-2 px-1">
            {group.strands.map((strand) => <StrandCard key={strand.id} strand={strand} threadId={threadId} selected={selection?.strandId === strand.id} now={now} others={all.filter((other) => other.id !== strand.id)} />)}
          </ul>
        </section>
      ))}
      {list.data.earlier.length ? (
        <section aria-label="Earlier">
          <button type="button" aria-expanded={earlier} onClick={() => setEarlier(!earlier)} className="w-full cursor-pointer px-2 pb-[3px] pt-2.5 text-left text-[11px] font-semibold text-muted-foreground/70 hover:text-foreground">
            Earlier ({list.data.earlier.length})
          </button>
          {earlier ? (
            <ul className="flex flex-col gap-2 px-1">
              {list.data.earlier.map((strand) => <StrandCard key={strand.id} strand={strand} threadId={threadId} selected={selection?.strandId === strand.id} now={now} others={all.filter((other) => other.id !== strand.id)} />)}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
