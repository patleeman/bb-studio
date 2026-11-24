// Above each message in a Bot conversation (design 4a, option a): a thin
// divider with the strand's name where the strand changes from the turn
// before, otherwise the strand's name, muted. Text only. While a strand is
// selected, the other strands' messages dim. On hover, "Move to…" moves the
// message's turn to another strand, or starts a new strand from it.
//
// A reply that needs the user (src/strands/reply.ts; design "Replies that
// need you", round 3, option a) has its asking sentence marked in place in
// its newest message, with a quiet Done (AskMark). It stays until Jev says a
// message of the user's answers it, or Done.
import { useBbNavigate, type ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toAppPathOf } from "../../kit/app/host-sdk";
import { currentPathname } from "../../kit/app/route";
import { errorMessage } from "../../kit/format";
import { cn, Icon, Popover, PopoverContent, PopoverTrigger } from "../../kit/ui/index";
import { peekLive, useCall, useLive } from "../../ui/live";
import { useIsBotThread } from "../../ui/conversations/bot-thread-owners";
import { messageLinkPath } from "../../work/ui/in-flight-model";
import type { ReplyTagView } from "../contract";
import { filterTurnsOf, replyOf, seqsOf, tagOf, type Tags } from "./model";
import { useNewestInTurn } from "./reply-marks";
import { findText, FLASH_MS, lastParagraph, markRange, takeFlash, useFlashVersion } from "./ask-mark";
import { ensureDimStyle, openFoldOf, select, selectionOf, setFoldTags, timelineFiltersInHost, useSelection } from "./selection";
import { moveFocus } from "./Strip";

const ROW = "[data-timeline-row-id]";
const DIM = "data-studio-strand-dim";

const rectsOf = (range: Range | null): DOMRect[] => (range && typeof range.getClientRects === "function" ? [...range.getClientRects()] : []);

/**
 * A reply that needs the user: its asking sentence marked in place (a faint
 * amber highlight, nothing added to the message), and a quiet Done beside it
 * that shows on hover or keyboard focus of the sentence. Jump to reply
 * scrolls to the sentence and flashes it.
 */
export function AskMark({ threadId, reply }: { threadId: string; reply: Pick<ReplyTagView, "seq" | "ask"> }) {
  const call = useCall();
  const button = useRef<HTMLButtonElement | null>(null);
  const range = useRef<Range | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const flashVersion = useFlashVersion();
  // Mark the sentence, and find it again when the message's text changes.
  useLayoutEffect(() => {
    const row = button.current?.closest(ROW);
    if (!row) return;
    let unmark = () => {};
    const mark = () => {
      unmark();
      // The named sentence, or nothing when it can't be found (never a wrong one); the last paragraph only when Jev named none.
      range.current = reply.ask ? findText(row, reply.ask) : lastParagraph(row);
      unmark = range.current ? markRange(range.current) : () => {};
    };
    mark();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(mark, 50); });
    observer.observe(row, { childList: true, subtree: true, characterData: true });
    const onMove = (event: Event) => {
      const { clientX: x, clientY: y, target } = event as MouseEvent;
      if (target === button.current) { setHovered(true); return; }
      const current = range.current;
      if (!current) { setHovered(false); return; }
      if (typeof current.getBoundingClientRect === "function") {
        const bounds = current.getBoundingClientRect();
        if (x < bounds.left - 4 || x > bounds.right + 64 || y < bounds.top - 3 || y > bounds.bottom + 3) {
          setHovered(false);
          return;
        }
      }
      setHovered(rectsOf(current).some((rect) => x >= rect.left - 4 && x <= rect.right + 64 && y >= rect.top - 3 && y <= rect.bottom + 3));
    };
    const onLeave = () => setHovered(false);
    row.addEventListener("mousemove", onMove);
    row.addEventListener("mouseleave", onLeave);
    return () => { observer.disconnect(); clearTimeout(timer); unmark(); row.removeEventListener("mousemove", onMove); row.removeEventListener("mouseleave", onLeave); };
  }, [reply.ask]);
  // Jump to reply: once the host has scrolled to the message, bring the sentence into view and flash it.
  useEffect(() => {
    if (!takeFlash(threadId, reply.seq)) return;
    let unflash = () => {};
    const show = setTimeout(() => {
      if (!range.current) return;
      const element = range.current.startContainer.parentElement;
      if (typeof element?.scrollIntoView === "function") element.scrollIntoView({ block: "center" });
      unflash = markRange(range.current, true);
    }, 300);
    const end = setTimeout(() => unflash(), 300 + FLASH_MS);
    return () => { clearTimeout(show); clearTimeout(end); unflash(); };
  }, [flashVersion, threadId, reply.seq]);
  const shown = hovered || focused;
  // Done sits just after the sentence's last line.
  useLayoutEffect(() => {
    const element = button.current;
    const last = rectsOf(range.current).at(-1);
    const parent = element?.offsetParent as HTMLElement | null | undefined;
    if (!shown || !element || !last || !parent) return;
    const box = parent.getBoundingClientRect();
    element.style.left = `${Math.max(0, Math.min(last.right - box.left + 6, box.width - element.offsetWidth))}px`;
    element.style.top = `${last.top - box.top + (last.height - element.offsetHeight) / 2}px`;
  }, [shown]);
  const done = async () => {
    setBusy(true);
    try { if (!(await call("strands.resolveReply", { threadId, seq: reply.seq })).ok) toast.error("Couldn't mark it done."); }
    catch (error) { toast.error("Couldn't mark it done.", { description: errorMessage(error) }); }
    finally { setBusy(false); }
  };
  return (
    <button ref={button} type="button" data-reply-done-mark={reply.seq} data-shown={shown || undefined} disabled={busy}
      aria-label="Done: this reply no longer needs you" onClick={() => void done()} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      className={cn("absolute left-0 top-0 z-10 h-5 cursor-pointer rounded-md border border-border bg-popover px-1.5 text-[11px] text-foreground shadow-sm transition-opacity hover:bg-accent motion-reduce:transition-none",
        shown ? "opacity-100" : "pointer-events-none opacity-0")}>
      Done
    </button>
  );
}

// A plain function on purpose: BB rejects a memo() object as a slot component
// ("must be a React component function"), and that fails Studio's whole frontend.
export function StrandTag({ message }: ExperimentalMessageMetadataProps) {
  const bots = useIsBotThread(message.threadId);
  if (!bots) return null;
  return <Tag message={message} />;
}

/** "Move to…": mounts its Radix Popover only once clicked so closed message rows carry zero popover overhead. */
function MoveMenu({ threadId, seq, current, strands }: { threadId: string; seq: number; current: string; strands: Tags["strands"] }) {
  const [mounted, setMounted] = useState(false);
  if (!mounted) {
    return (
      <button type="button" data-strand-move="" aria-haspopup="menu" onClick={() => setMounted(true)}
        className="cursor-pointer rounded px-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground">
        Move to…
      </button>
    );
  }
  return <MoveMenuPopover threadId={threadId} seq={seq} current={current} strands={strands} />;
}

function MoveMenuPopover({ threadId, seq, current, strands }: { threadId: string; seq: number; current: string; strands: Tags["strands"] }) {
  const call = useCall();
  const [open, setOpen] = useState(true);
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
  // BB's timeline folds the conversation's runs of status replies from these tags.
  useEffect(() => { setFoldTags(message.threadId, tags.data); }, [message.threadId, tags.data]);
  const selection = useSelection(message.threadId);
  const call = useCall();
  const navigate = useBbNavigate();
  const ref = useRef<HTMLElement | null>(null);
  const tag = tagOf(tags.data, message.turnId);
  const reply = message.role === "assistant" ? replyOf(tags.data, message.turnId) : null;
  const asking = reply?.tag === "needs-you" && !reply.resolved;
  // Only the turn's newest message carries the line.
  const newest = useNewestInTurn(message.threadId, message.turnId, message.id, message.createdAt, asking);
  // BB's timeline filter hides the other strands' messages; without it, they dim.
  const dim = !!selection && selection.strandId !== tag?.strandId && !timelineFiltersInHost();
  useLayoutEffect(() => {
    const row = ref.current?.closest(ROW);
    if (!row) return;
    ensureDimStyle(row.ownerDocument);
    if (dim) row.setAttribute(DIM, ""); else row.removeAttribute(DIM);
    return () => row.removeAttribute(DIM);
  }, [dim]);
  const ask = asking && newest && reply ? <AskMark threadId={message.threadId} reply={reply} /> : null;
  if (!tag || !tags.data) {
    if (ask) return <><span ref={ref} hidden />{ask}</>;
    return selection ? <span ref={ref} hidden /> : null;
  }
  const open = () => {
    const threadId = message.threadId;
    const current = selectionOf(threadId);
    if (current?.strandId === tag.strandId) { select(threadId, null); return; }
    const listData = peekLive("strands.list", { threadId });
    const turns = filterTurnsOf(tags.data, listData, tag.strandId, threadId);
    const seq = seqsOf(tags.data, tag.strandId).at(-1) ?? null;
    select(threadId, { strandId: tag.strandId, seq, firstSeq: turns.firstSeq, turnIds: turns.turnIds });
    if (seq !== null) {
      const opening = tags.data?.opening ?? null;
      const targetSeq = selectionOf(threadId) && seq === (opening?.seq ?? null) ? (opening?.replySeq ?? null) : seq;
      if (targetSeq !== null) {
        const path = messageLinkPath(currentPathname(), threadId, targetSeq);
        openFoldOf(threadId, targetSeq);
        if (path) toAppPathOf(navigate)?.(path, { replace: true });
      }
    }
    void call("strands.opened", { strandId: tag.strandId }).catch(() => undefined);
  };
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
