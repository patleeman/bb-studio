// The one row of every Bot page: one line, its icon and title on the left,
// small muted meta on the right (or fixed meta columns, where the page is a
// table: Automations), an optional status before the meta, and actions that
// show on hover or focus. A row with `onOpen` is a button.
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Icon } from "../../kit/ui/icon";
import { cn } from "../../kit/ui/utils";
import { dragSourceProps, type DragItem } from "../../kit/app/item-drag";

export type BotPageTone = "neutral" | "success" | "warning" | "danger";

const TONE: Record<BotPageTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

/** A fixed-width meta column, right-aligned; the header (BotPageColumns) uses the same `className`. */
export interface BotPageColumn { key: string; content: ReactNode; className: string }

export interface BotPageRowProps {
  /** An icon name, or a node (an item's icon, a status glyph). */
  icon?: string | ReactNode;
  iconClassName?: string;
  title: ReactNode;
  /** The title's full text, for its tooltip when it truncates. */
  titleText?: string;
  /** Small muted text on the right: a date, a kind, a count. */
  meta?: ReactNode;
  metaTone?: BotPageTone;
  columns?: readonly BotPageColumn[];
  status?: { label: string; tone?: BotPageTone } | null;
  /** Shown on hover and keyboard focus, after the meta. */
  actions?: ReactNode;
  onOpen?(event: MouseEvent | KeyboardEvent): void;
  link?: string;
  /** The row whose detail is open. */
  selected?: boolean;
  /** Done, archived, replaced: the title in muted ink. */
  muted?: boolean;
  disabled?: boolean;
  testId?: string;
  data?: Record<`data-${string}`, string | undefined>;
  /** What the row drags as (src/kit/app/item-drag.ts): dropped on the workbench, it opens as a tab. */
  dragItem?: DragItem | null;
}

export const BOT_ROW_ICON = "size-4 shrink-0";

export function BotPageRow({ icon, iconClassName, title, titleText, meta, metaTone = "neutral", columns, status, actions, onOpen, link, selected = false, muted = false, disabled = false, testId, data, dragItem = null }: BotPageRowProps) {
  const inner = <>
    {icon === undefined || icon === null ? null : typeof icon === "string"
      ? <Icon name={icon} className={cn(BOT_ROW_ICON, "text-muted-foreground", iconClassName)} />
      : <span className={cn("flex shrink-0 items-center justify-center", iconClassName)}>{icon}</span>}
    <span data-testid="bot-page-row-title" title={titleText} className={cn("min-w-0 flex-1 truncate text-sm", muted ? "text-muted-foreground" : "text-foreground")}>{title}</span>
    {status ? <span data-testid="bot-page-row-status" className={cn("shrink-0 text-xs", TONE[status.tone ?? "neutral"])}>{status.label}</span> : null}
    {columns?.map((column) => <span key={column.key} data-column={column.key} className={cn("shrink-0 truncate text-right text-xs text-muted-foreground tabular-nums", column.className)}>{column.content}</span>)}
    {meta !== undefined && meta !== null && meta !== "" ? <span data-testid="bot-page-row-meta" className={cn("max-w-[45%] shrink-0 truncate text-right text-xs tabular-nums", TONE[metaTone])}>{meta}</span> : null}
  </>;
  const line = "flex h-9 min-w-0 flex-1 items-center gap-2.5 px-2";
  return (
    <div data-testid={testId} data-selected={selected || undefined} data-row-link={link} {...data} {...dragSourceProps(dragItem)}
      className={cn("group flex min-w-0 items-center rounded-md", selected ? "bg-state-active" : "hover:bg-state-hover focus-within:bg-state-hover")}>
      {onOpen ? (
        <button type="button" data-testid="bot-page-row-open" disabled={disabled} aria-current={selected || undefined} onClick={(event) => onOpen(event)}
          className={cn(line, "rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default")}>{inner}</button>
      ) : <div className={line}>{inner}</div>}
      {actions ? <div data-testid="bot-page-row-actions" className="hidden shrink-0 items-center gap-1 pr-1.5 group-hover:flex group-focus-within:flex [@media(hover:none)]:flex">{actions}</div> : null}
    </div>
  );
}

/** The column titles over rows with `columns`: the first names the title column ("Name"). */
export function BotPageColumns({ title, columns, icon = true }: { title: string; columns: readonly { key: string; label: string; className: string }[]; icon?: boolean }) {
  return (
    <div data-testid="bot-page-columns" role="row" className="flex h-7 items-center gap-2.5 border-b border-border px-2 text-xs font-medium text-muted-foreground">
      {icon ? <span aria-hidden className={BOT_ROW_ICON} /> : null}
      <span role="columnheader" className="min-w-0 flex-1">{title}</span>
      {columns.map((column) => <span key={column.key} role="columnheader" className={cn("shrink-0 text-right", column.className)}>{column.label}</span>)}
    </div>
  );
}
