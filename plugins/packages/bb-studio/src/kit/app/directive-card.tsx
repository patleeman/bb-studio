import { useState, type DragEvent, type ReactNode } from "react";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import { hasGlobalWorkbench } from "./host-sdk";
import { linkDragItem, writeDragItem } from "./item-drag";
import type { StudioItemLink } from "./studio-item";
import { CHAT_CARD, CHAT_CARD_HEAD, CHAT_CARD_ICON_BUTTON, CHAT_CARD_SKELETON } from "./chat-card";

/** Whether previews start collapsed: one choice for every add-on's cards, kept across reloads. */
export const PREVIEW_COLLAPSED_KEY = "bb.studio.directive-preview.collapsed";

// Where items open in BB's main view and workbench, a card starts as its
// header and a short excerpt, so the chat has no second scrolling page in it.
function readCollapsed(): boolean {
  try { return (window.localStorage.getItem(PREVIEW_COLLAPSED_KEY) ?? String(hasGlobalWorkbench)) === "true"; }
  catch { return hasGlobalWorkbench; }
}

function writeCollapsed(collapsed: boolean): void {
  try { window.localStorage.setItem(PREVIEW_COLLAPSED_KEY, String(collapsed)); }
  catch { /* Storage off: the choice lasts until reload. */ }
}

const shown = new Map<string, unknown>();

/**
 * `value`, or while it's still undefined, the last value given for `key`.
 * BB can remount a reply's cards when the chat around them re-renders; a card
 * that starts from what the last one showed doesn't flash its loading state.
 * Null, an item that's gone, is forgotten.
 */
export function remember<T>(key: string, value: T | null | undefined): T | null | undefined {
  if (value === undefined) return shown.get(key) as T | undefined;
  if (value === null) shown.delete(key);
  else shown.set(key, value);
  return value;
}

/**
 * A directive card with the same loading and deleted states in every add-on.
 * With a `body`, the item shows inline under a header that collapses it and
 * opens the item beside the chat; without one, the card is a compact link.
 */
export function ItemDirectiveCard({
  state,
  kind,
  icon,
  title,
  preview,
  details,
  body,
  bodyHeight = 320,
  alwaysShown = false,
  onOpen,
  onOpenFull,
  item,
}: {
  state: "loading" | "deleted" | "ready";
  kind: string;
  icon: string;
  title?: string;
  preview?: ReactNode;
  details?: ReactNode;
  /** The item's read-only content, shown inline. */
  body?: ReactNode;
  /** The tallest the body gets before it scrolls, in pixels. */
  bodyHeight?: number;
  alwaysShown?: boolean;
  /** Gets the click, so a Mod- or Shift-click can open the item in the second pane or a window (src/links/router.ts). */
  onOpen?(event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }): void;
  onOpenFull?(): void;
  /** The item the card shows. With it the card can be dragged: to the workbench, a composer, the main view, a page. */
  item?: StudioItemLink;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const dragged = item ? linkDragItem({ href: item.href, title: item.title ?? title }) : null;
  const drag = dragged ? { draggable: true, "data-studio-drag": dragged.kind, onDragStart: (event: DragEvent<HTMLElement>) => { event.dataTransfer.effectAllowed = "all"; writeDragItem(event.dataTransfer, dragged); } } : {};
  if (state === "deleted") {
    return <div data-studio-card="" className={cn(CHAT_CARD, "flex-row items-center gap-2 px-3 py-2 text-muted-foreground")}>
      <Icon name={icon} className="size-4" /> This {kind} was deleted.
    </div>;
  }
  if (state === "loading") {
    return <div className={CHAT_CARD_SKELETON} />;
  }
  if (body !== undefined) {
    const toggle = () => { setCollapsed(!collapsed); writeCollapsed(!collapsed); };
    return (
      <div data-studio-card="" className={CHAT_CARD}>
        <div {...drag} data-studio-card-head="" className={cn(CHAT_CARD_HEAD, (alwaysShown || !collapsed) && "border-b border-border/70")}>
          <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
            <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
            <span data-studio-card-title="" className="truncate text-sm font-medium">{title}</span>
            <span data-studio-card-meta="" className="truncate text-xs text-muted-foreground">{details}</span>
          </button>
          <button type="button" data-testid="directive-open-full" onClick={() => (onOpenFull ?? onOpen)?.()} aria-label={`Open ${title ?? kind}`} title={`Open ${kind}`} className={CHAT_CARD_ICON_BUTTON}>
            <Icon name="ArrowUpRight" aria-hidden className="size-3.5" />
          </button>
          {alwaysShown ? null : <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Show" : "Hide"} ${title ?? kind}`}
            title={collapsed ? `Show ${kind}` : `Hide ${kind}`}
            className={CHAT_CARD_ICON_BUTTON}
          >
            <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} aria-hidden className="size-3.5" />
          </button>}
        </div>
        {alwaysShown
          ? <div aria-hidden data-testid="directive-preview" onClick={onOpen} className="cursor-pointer">{body}</div>
          : collapsed
            ? hasGlobalWorkbench ? <div aria-hidden data-testid="directive-excerpt" onClick={onOpen} className="max-h-[4.75rem] cursor-pointer overflow-hidden border-t border-border/70 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"><div className="pointer-events-none">{body}</div></div> : null
            : <div className="overflow-auto" style={{ maxHeight: bodyHeight }}>{body}</div>}
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} {...drag} data-studio-card="" className={cn(CHAT_CARD, "group hover:bg-state-hover")}>
      {preview}
      <div data-studio-card-head="" className={cn(CHAT_CARD_HEAD, "w-full pr-3")}>
        <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
        <span data-studio-card-title="" className="min-w-0 truncate text-sm font-medium">{title}</span>
        <span data-studio-card-meta="" className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{details}</span>
        <Icon name="ArrowUpRight" className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
      </div>
    </button>
  );
}
