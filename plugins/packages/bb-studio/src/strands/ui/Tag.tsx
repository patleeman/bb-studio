// Above each message in a Bot conversation (design 4a, option a): a thin
// divider with the strand's name where the strand changes from the turn
// before, otherwise the strand's name, muted. Text only. While a strand is
// selected, the other strands' messages dim. On hover, "Move to…" moves the
// message's turn to another strand, or starts a new strand from it.
//
// A reply that needs the user (src/strands/reply.ts; design "Replies that
// need you", option a) carries one amber line above its last message: "Needs
// you", its ask in the reply's own words, and Done. It stays until the user
// answers in its strand or presses Done. A status reply's messages are
// slightly muted.
import type { ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "../../kit/format";
import { Icon, Popover, PopoverContent, PopoverTrigger } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { useIsBotThread } from "../../ui/conversations/bot-thread-owners";
import type { ReplyTagView } from "../contract";
import { replyOf, tagOf, type Tags } from "./model";
import { useNewestInTurn } from "./reply-marks";
import { ensureDimStyle, timelineFiltersInHost, useSelection } from "./selection";
import { moveFocus, useSelectStrand } from "./Strip";

const ROW = "[data-timeline-row-id]";
const DIM = "data-studio-strand-dim";
const STATUS = "data-studio-reply-status";

/** The amber line above a reply that needs the user: its ask, and Done. */
export function ReplyAsk({ threadId, reply }: { threadId: string; reply: Pick<ReplyTagView, "seq" | "ask"> }) {
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const done = async () => {
    setBusy(true);
    try { if (!(await call("strands.resolveReply", { threadId, seq: reply.seq })).ok) toast.error("Couldn't mark it done."); }
    catch (error) { toast.error("Couldn't mark it done.", { description: errorMessage(error) }); }
    finally { setBusy(false); }
  };
  return (
    <div data-reply-needs-you={reply.seq} className="mt-0.5 flex w-full basis-full items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5">
      <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold leading-5 text-warning">
        <span aria-hidden className="size-1.5 rounded-full bg-warning" />Needs you
      </span>
      <span data-reply-ask="" className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-foreground">{reply.ask ?? "This reply asks you something"}</span>
      <button type="button" disabled={busy} onClick={() => void done()}
        className="h-[22px] shrink-0 cursor-pointer rounded-md border border-border bg-transparent px-2 text-[11.5px] text-foreground hover:bg-accent disabled:opacity-50">
        Done
      </button>
    </div>
  );
}

export function StrandTag({ message }: ExperimentalMessageMetadataProps) {
  const bots = useIsBotThread(message.threadId);
  if (!bots) return null;
  return <Tag message={message} />;
}

/** "Move to…": the conversation's strands (this one checked), then "New strand from here". */
function MoveMenu({ threadId, seq, current, strands }: { threadId: string; seq: number; current: string; strands: Tags["strands"] }) {
  const call = useCall();
  const [open, setOpen] = useState(false);
  const run = async (what: () => Promise<{ ok: boolean }>, done?: string) => {
    setOpen(false);
    try {
      if (!(await what()).ok) { toast.error("Couldn't move the message."); return; }
      // A move can be undone for 10 seconds: its turn goes back to the strand it was in.
      if (done) toast(done, { duration: 10_000, action: { label: "Undo", onClick: () => void call("strands.unmove", { threadId, seq }).catch(() => toast.error("Couldn't undo the move.")) } });
    } catch (error) { toast.error("Couldn't move the message.", { description: errorMessage(error) }); }
  };
  const item = "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] outline-none hover:bg-accent/60 focus-visible:bg-accent/60";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-strand-move="" aria-haspopup="menu" className="cursor-pointer rounded px-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground">Move to…</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1"
        onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-strand-option]")?.focus(); }}>
        <div role="menu" aria-label="Move to strand" onKeyDown={moveFocus} data-testid="strand-move-menu">
          <div className="px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground">Move to…</div>
          {strands.map((strand) => (
            <button key={strand.id} type="button" role="menuitem" data-strand-option={strand.id} disabled={strand.id === current}
              onClick={() => void run(() => call("strands.move", { threadId, seq, strandId: strand.id }), `Moved to ${strand.title}`)} className={item}>
              <span className="min-w-0 flex-1 truncate">{strand.title}</span>
              {strand.id === current ? <Icon name="Check" className="size-3 text-muted-foreground" /> : null}
            </button>
          ))}
          <div className="my-1 border-t border-border/60" />
          <button type="button" role="menuitem" data-strand-option="new" onClick={() => void run(() => call("strands.split", { threadId, seq }))} className={item}>
            <Icon name="Plus" className="size-3.5" />New strand from here
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Tag({ message }: ExperimentalMessageMetadataProps) {
  const tags = useLive("strands.tags", { threadId: message.threadId }, { pollMs: 60_000 });
  const selection = useSelection(message.threadId);
  const choose = useSelectStrand(message.threadId);
  const ref = useRef<HTMLElement | null>(null);
  const tag = tagOf(tags.data, message.turnId);
  const reply = message.role === "assistant" ? replyOf(tags.data, message.turnId) : null;
  const asking = reply?.tag === "needs-you" && !reply.resolved;
  // Only the turn's newest message carries the line.
  const newest = useNewestInTurn(message.threadId, message.turnId, message.id, message.createdAt, asking);
  const status = reply?.tag === "status";
  // BB's timeline filter hides the other strands' messages; without it, they dim.
  const dim = !!selection && selection.strandId !== tag?.strandId && !timelineFiltersInHost();
  useLayoutEffect(() => {
    const row = ref.current?.closest(ROW);
    if (!row) return;
    ensureDimStyle(row.ownerDocument);
    if (dim) row.setAttribute(DIM, ""); else row.removeAttribute(DIM);
    if (status) row.setAttribute(STATUS, ""); else row.removeAttribute(STATUS);
    return () => { row.removeAttribute(DIM); row.removeAttribute(STATUS); };
  }, [dim, status]);
  const ask = asking && newest && reply ? <ReplyAsk threadId={message.threadId} reply={reply} /> : null;
  if (!tag || !tags.data) {
    if (ask) return <><span ref={ref} hidden />{ask}</>;
    return selection || status ? <span ref={ref} hidden /> : null;
  }
  const open = () => choose({ id: tag.strandId, latestSeq: null });
  const move = <MoveMenu threadId={message.threadId} seq={tag.seq} current={tag.strandId} strands={tags.data.strands} />;
  // Under a filter for another strand, this message is kept in view because it waits for an answer.
  const name = selection && selection.strandId !== tag.strandId ? `from ${tag.title}` : tag.title;
  // The divider goes above the turn's first message (the user's); its reply carries the name.
  if (tag.divider && message.role === "user") {
    return (
      <div ref={(element) => { ref.current = element; }} data-strand-divider={tag.strandId} className="mt-3 flex w-full items-center gap-2 text-[11px] font-semibold text-muted-foreground/70">
        <button type="button" onClick={open} className="cursor-pointer truncate hover:text-foreground">{name}</button>
        <span className="font-normal">{move}</span>
        <span aria-hidden className="h-px flex-1 bg-border/70" />
      </div>
    );
  }
  return (
    <>
      <span ref={(element) => { ref.current = element; }} className="inline-flex items-center gap-1.5">
        <button type="button" data-strand-tag={tag.strandId} onClick={open} aria-label={`Strand: ${tag.title}`}
          className="cursor-pointer text-[11px] text-muted-foreground/70 hover:text-foreground">
          {name}
        </button>
        {move}
      </span>
      {ask}
    </>
  );
}
