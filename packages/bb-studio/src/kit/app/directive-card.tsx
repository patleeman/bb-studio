import { useState, type ReactNode } from "react";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";

/** Whether previews start collapsed: one choice for every add-on's cards, kept across reloads. */
export const PREVIEW_COLLAPSED_KEY = "bb.studio.directive-preview.collapsed";

function readCollapsed(): boolean {
  try { return window.localStorage.getItem(PREVIEW_COLLAPSED_KEY) === "true"; }
  catch { return false; }
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

const HEADER_BUTTON = "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
  onOpen,
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
  onOpen?(): void;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  if (state === "deleted") {
    return <div className="my-2 flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm text-muted-foreground">
      <Icon name={icon} className="size-4" /> This {kind} was deleted.
    </div>;
  }
  if (state === "loading") {
    return <div className="my-2 h-14 max-w-md animate-pulse rounded-lg border border-border/70 bg-muted/40 motion-reduce:animate-none" />;
  }
  if (body !== undefined) {
    const toggle = () => { setCollapsed(!collapsed); writeCollapsed(!collapsed); };
    return (
      <div className="my-2 w-full max-w-2xl overflow-hidden rounded-lg border border-border/70 bg-background">
        <div className={cn("flex items-center gap-2 py-1.5 pr-1.5 pl-3", !collapsed && "border-b border-border/70")}>
          <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
            <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{title}</span>
            <span className="truncate text-xs text-muted-foreground">{details}</span>
          </button>
          <button type="button" onClick={onOpen} aria-label={`Open ${title ?? kind}`} title={`Open ${kind} beside the chat`} className={HEADER_BUTTON}>
            <Icon name="ArrowUpRight" aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Show" : "Hide"} ${title ?? kind}`}
            title={collapsed ? `Show ${kind}` : `Hide ${kind}`}
            className={HEADER_BUTTON}
          >
            <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} aria-hidden className="size-3.5" />
          </button>
        </div>
        {collapsed ? null : <div className="overflow-auto" style={{ maxHeight: bodyHeight }}>{body}</div>}
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} className={cn(
      "group my-2 flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border/70 bg-background text-left hover:border-border hover:bg-state-hover",
    )}>
      {preview}
      <div className="flex w-full items-center gap-3 px-3 py-2.5">
        {preview ? null : <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon name={icon} className="size-4" />
        </div>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{details}</div>
        </div>
        <Icon name="ArrowUpRight" className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
      </div>
    </button>
  );
}
