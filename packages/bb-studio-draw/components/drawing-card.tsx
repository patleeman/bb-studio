// A drawing's card in the thread panel and the composer picker: the server's
// thumbnail over its name, in Studio's card style.
import type { ReactNode } from "react";
import { Icon, THUMBNAIL, cn } from "@bb-studio/kit/app";
import { relativeTime } from "@bb-studio/kit/format";
import { DRAW_ICON, thumbnailUrl } from "../src/shared";

export type DrawingMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  elementCount: number;
};

export function drawingName(drawing: Pick<DrawingMeta, "name">): string {
  return drawing.name.trim() || "Untitled drawing";
}

export function DrawingCard({
  drawing,
  onOpen,
  openLabel,
  actions,
}: {
  drawing: DrawingMeta;
  onOpen(): void;
  /** Accessible name for the card's button, e.g. "Open Plan". */
  openLabel: string;
  /** Icon buttons at the end of the caption. */
  actions?: ReactNode;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-background transition-colors hover:border-foreground/20">
      <button
        type="button"
        aria-label={openLabel}
        title={openLabel}
        className="flex h-28 items-center justify-center border-b border-border bg-foreground/[0.03] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
      >
        {drawing.elementCount > 0 ? (
          <img
            src={thumbnailUrl(drawing.id, drawing.updatedAt)}
            alt=""
            loading="lazy"
            className={THUMBNAIL}
          />
        ) : (
          <Icon name={DRAW_ICON} className="size-6 text-muted-foreground/60" />
        )}
      </button>
      <div className="flex items-center gap-1 py-1.5 pr-1.5 pl-3">
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm font-medium", !drawing.name.trim() && "text-muted-foreground")}>
            {drawingName(drawing)}
          </div>
          <div className="truncate text-xs text-muted-foreground">{relativeTime(drawing.updatedAt)}</div>
        </div>
        {actions}
      </div>
    </div>
  );
}

/** A small icon button for card captions. */
export const CARD_ACTION =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";
