// The one way Studio draws an item or a thread in a list: the sidebar, the
// workbench picker and the Library all use this row and this icon, so the
// same thing looks the same wherever it is listed.
// - ItemIcon: in a row, every kind gets the same muted line glyph, so colour
//   is left to mean state (running, needs you). An item's emoji belongs to
//   its header; `emoji` asks for it there.
// - ItemRow: one line, 28px: icon, title, a quiet trailing note (a time, a
//   kind, a status), and an x on hover when the row can be closed.
import type { MouseEvent, ReactNode } from "react";
import { Icon } from "../kit/app/index";
import { tabKind } from "./studio-tab/model";

import { THREAD_KIND } from "./item-icons";

export { hostIcon, THREAD_KIND } from "./item-icons";

export function ItemIcon({ kind, icon, emoji = false, className = "text-muted-foreground" }: { kind: string; icon?: string | null; emoji?: boolean; className?: string }) {
  if (emoji && kind !== THREAD_KIND && icon) return <span aria-hidden className="w-4 shrink-0 text-center text-[13px] leading-none">{icon}</span>;
  return <Icon name={kind === THREAD_KIND ? "MessageSquare" : tabKind(kind)?.icon ?? "FileText"} className={`size-4 shrink-0 ${className}`} />;
}

export const ITEM_ROW_CLASS = "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-state-hover";

/** A small control at the end of a row: the x, the menu button. */
export const ROW_CONTROL_CLASS = "flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground";

export interface ItemRowProps {
  kind: string;
  icon?: string | null;
  title: string;
  /** Replaces the default icon, such as the sidebar's thread glyph. */
  leading?: ReactNode;
  /** The quiet note at the end of the row. */
  trailing?: ReactNode;
  current?: boolean;
  indent?: boolean;
  testId?: string;
  onOpen(event: MouseEvent<HTMLButtonElement>): void;
  onContextMenu?(event: MouseEvent<HTMLButtonElement>): void;
  /** Controls shown on hover at the row's end, before the x: a menu button. */
  actions?: ReactNode;
  /** Shows an x on hover (always, on touch screens) that calls this. */
  onClose?(): void;
  closeTitle?: string;
}

export function ItemRow({ kind, icon, title, leading, trailing, current, indent, testId = "item-row", onOpen, onContextMenu, actions, onClose, closeTitle = "Close" }: ItemRowProps) {
  const hasControls = Boolean(actions || onClose);
  return (
    <div className="group/row relative">
      <button type="button" data-testid={testId} data-row-type={kind === THREAD_KIND ? "thread" : "item"} title={title} onClick={onOpen} onContextMenu={onContextMenu}
        aria-current={current ? "page" : undefined} className={`${ITEM_ROW_CLASS} ${indent ? "pl-5" : ""} aria-[current=page]:bg-state-active`}>
        {leading ?? <ItemIcon kind={kind} icon={icon} />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {trailing ? <span className={hasControls ? "flex shrink-0 group-focus-within/row:invisible group-hover/row:invisible [@media(hover:none)]:invisible" : "flex shrink-0"}>{trailing}</span> : null}
      </button>
      {hasControls ? (
        <span className="absolute right-1 top-1 hidden items-center gap-0.5 focus-within:flex group-focus-within/row:flex group-hover/row:flex has-[[data-state=open]]:flex [@media(hover:none)]:flex">
          {actions}
          {onClose ? (
            <button type="button" data-testid="unified-close" aria-label={`Close ${title}`} title={closeTitle} onClick={onClose} className={ROW_CONTROL_CLASS}>
              <Icon name="X" className="size-3.5" />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** A row's quiet trailing text. */
export function RowNote({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-xs tabular-nums text-[color-mix(in_oklab,var(--foreground)_55%,transparent)]">{children}</span>;
}
