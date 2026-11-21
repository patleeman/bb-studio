// Above each message in Main (design 4a, option a): a thin divider with the
// strand's name where the strand changes from the turn before, otherwise
// the strand's name, muted. Text only. While a strand is selected, the
// other strands' messages dim.
import type { ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef } from "react";
import { useLive } from "../../ui/live";
import { useIsBotThread } from "../../ui/conversations/bot-thread-owners";
import { tagOf } from "./model";
import { ensureDimStyle, useSelection } from "./selection";
import { useSelectStrand } from "./Strip";

const ROW = "[data-timeline-row-id]";
const DIM = "data-studio-strand-dim";

export function StrandTag({ message }: ExperimentalMessageMetadataProps) {
  const bots = useIsBotThread(message.threadId);
  if (!bots) return null;
  return <Tag message={message} />;
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
    if (dim) { ensureDimStyle(row.ownerDocument); row.setAttribute(DIM, ""); } else row.removeAttribute(DIM);
    return () => row.removeAttribute(DIM);
  }, [dim]);
  if (!tag) return selection ? <span ref={ref} hidden /> : null;
  const open = () => choose({ id: tag.strandId, latestSeq: null });
  // The divider goes above the turn's first message (the user's); its reply carries the name.
  if (tag.divider && message.role === "user") {
    return (
      <div ref={(element) => { ref.current = element; }} data-strand-divider={tag.strandId} className="mt-3 flex w-full items-center gap-2 text-[11px] font-semibold text-muted-foreground/70">
        <button type="button" onClick={open} className="cursor-pointer truncate hover:text-foreground">{tag.title}</button>
        <span aria-hidden className="h-px flex-1 bg-border/70" />
      </div>
    );
  }
  return (
    <button ref={(element) => { ref.current = element; }} type="button" data-strand-tag={tag.strandId} onClick={open} aria-label={`Strand: ${tag.title}`}
      className="cursor-pointer text-[11px] text-muted-foreground/70 hover:text-foreground">
      {tag.title}
    </button>
  );
}
