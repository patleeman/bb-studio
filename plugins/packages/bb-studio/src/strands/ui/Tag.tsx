// Above each message in a Bot conversation (design 4a, option a): a thin
// divider with the strand's name where the strand changes from the turn
// before, otherwise the strand's name, muted. Text only. While a strand is
// selected, the other strands' messages dim. On hover, "Move to…" moves the
// message's turn to another strand, or starts a new strand from it.
import type { ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "../../kit/format";
import { Icon, Popover, PopoverContent, PopoverTrigger } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { useIsBotThread } from "../../ui/conversations/bot-thread-owners";
import { tagOf, type Tags } from "./model";
import { ensureDimStyle, useSelection } from "./selection";
import { moveFocus, useSelectStrand } from "./Strip";

const ROW = "[data-timeline-row-id]";
const DIM = "data-studio-strand-dim";

export function StrandTag({ message }: ExperimentalMessageMetadataProps) {
  const bots = useIsBotThread(message.threadId);
  if (!bots) return null;
  return <Tag message={message} />;
}

/** "Move to…": the conversation's strands (this one checked), then "New strand from here". */
function MoveMenu({ threadId, seq, current, strands }: { threadId: string; seq: number; current: string; strands: Tags["strands"] }) {
  const call = useCall();
  const [open, setOpen] = useState(false);
  const run = async (what: () => Promise<{ ok: boolean }>) => {
    setOpen(false);
    try { if (!(await what()).ok) toast.error("Couldn't move the message."); }
    catch (error) { toast.error("Couldn't move the message.", { description: errorMessage(error) }); }
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
              onClick={() => void run(() => call("strands.move", { threadId, seq, strandId: strand.id }))} className={item}>
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
  const dim = !!selection && selection.strandId !== tag?.strandId;
  useLayoutEffect(() => {
    const row = ref.current?.closest(ROW);
    if (!row) return;
    ensureDimStyle(row.ownerDocument);
    if (dim) row.setAttribute(DIM, ""); else row.removeAttribute(DIM);
    return () => row.removeAttribute(DIM);
  }, [dim]);
  if (!tag || !tags.data) return selection ? <span ref={ref} hidden /> : null;
  const open = () => choose({ id: tag.strandId, latestSeq: null });
  const move = <MoveMenu threadId={message.threadId} seq={tag.seq} current={tag.strandId} strands={tags.data.strands} />;
  // The divider goes above the turn's first message (the user's); its reply carries the name.
  if (tag.divider && message.role === "user") {
    return (
      <div ref={(element) => { ref.current = element; }} data-strand-divider={tag.strandId} className="mt-3 flex w-full items-center gap-2 text-[11px] font-semibold text-muted-foreground/70">
        <button type="button" onClick={open} className="cursor-pointer truncate hover:text-foreground">{tag.title}</button>
        <span className="font-normal">{move}</span>
        <span aria-hidden className="h-px flex-1 bg-border/70" />
      </div>
    );
  }
  return (
    <span ref={(element) => { ref.current = element; }} className="inline-flex items-center gap-1.5">
      <button type="button" data-strand-tag={tag.strandId} onClick={open} aria-label={`Strand: ${tag.title}`}
        className="cursor-pointer text-[11px] text-muted-foreground/70 hover:text-foreground">
        {tag.title}
      </button>
      {move}
    </span>
  );
}
