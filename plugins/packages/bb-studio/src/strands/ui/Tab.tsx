// The Strands tab in a conversation's workbench (design 4a, "bench"): every
// strand by state, needs you first with its buttons; quiet ones faded, and
// "Earlier" folded. A row selects its strand, like a chip; its ⋯ menu
// renames, pins or merges it (the user's choice always wins).
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

/** The row's ⋯ menu: Rename, Pin or Unpin, Merge into another strand. */
function RowMenu({ strand, others, onRename }: { strand: StrandView; others: readonly StrandView[]; onRename(): void }) {
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
                  <DropdownMenuItem key={other.id} onSelect={() => void run(() => call("strands.merge", { strandId: strand.id, into: other.id }), "Couldn't merge the strands.")}>{other.title}</DropdownMenuItem>
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

function Row({ strand, threadId, selected, now, others }: { strand: StrandView; threadId: string; selected: boolean; now: number; others: readonly StrandView[] }) {
  const choose = useSelectStrand(threadId);
  const [renaming, setRenaming] = useState(false);
  const sub = strand.state === "needs-you" ? strand.asks[0]?.label ?? strand.detail
    : strand.state === "running" || strand.state === "waiting" || strand.state === "done-unseen" ? strand.detail ?? strand.summary
    : strand.summary;
  return (
    <div role="button" tabIndex={0} data-strand-row={strand.id} onClick={() => choose(strand)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(strand); } }}
      className={cn("cursor-pointer rounded-lg px-2 py-[7px] hover:bg-accent/50", selected && "bg-accent", strand.state === "quiet" && "opacity-60")}>
      <div className="flex items-baseline gap-2">
        {strand.state === "needs-you" ? <StateMark strand={strand} now={now} /> : null}
        {renaming ? <RenameField strand={strand} onDone={() => setRenaming(false)} /> : <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug">{strand.title}</span>}
        {strand.pinned ? <Icon name="Pin" aria-label="Pinned" className="size-3 shrink-0 self-center text-muted-foreground" /> : null}
        <span className="whitespace-nowrap text-[11px] text-muted-foreground/70">{strand.lastAt ? relativeTime(strand.lastAt, now) : ""}</span>
        <RowMenu strand={strand} others={others} onRename={() => setRenaming(true)} />
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
          <div data-strand-ask-buttons="" className="flex flex-wrap gap-[5px]"><AskButtonsFor ask={strand.asks[0]} threadId={threadId} /></div>
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
  const all = [...list.data.strands, ...list.data.earlier];
  return (
    <div className="h-full overflow-auto px-1.5 py-2" data-testid="strands-tab">
      <h2 className="mx-2 my-0.5 text-[13px] font-semibold">Strands</h2>
      {!groups.length ? <p className="mx-2 mt-2 text-xs text-muted-foreground">{list.data.backfill.done ? "No strands yet" : "Sorting this conversation…"}</p> : null}
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <div className="px-2 pb-[3px] pt-2.5 text-[11px] font-semibold text-muted-foreground/70">{group.label}</div>
          {group.strands.map((strand) => <Row key={strand.id} strand={strand} threadId={threadId} selected={selection?.strandId === strand.id} now={now} others={all.filter((other) => other.id !== strand.id)} />)}
        </section>
      ))}
      {list.data.earlier.length ? (
        <section aria-label="Earlier">
          <button type="button" aria-expanded={earlier} onClick={() => setEarlier(!earlier)} className="w-full cursor-pointer px-2 pb-[3px] pt-2.5 text-left text-[11px] font-semibold text-muted-foreground/70 hover:text-foreground">
            Earlier ({list.data.earlier.length})
          </button>
          {earlier ? list.data.earlier.map((strand) => <Row key={strand.id} strand={strand} threadId={threadId} selected={selection?.strandId === strand.id} now={now} others={all.filter((other) => other.id !== strand.id)} />) : null}
        </section>
      ) : null}
    </div>
  );
}
