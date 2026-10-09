// Every Studio view has one bar, and it's BB's own: the page's title bar.
// A nav panel lends Studio its title bar through StudioBarSlot; ItemHeader
// fills it with a breadcrumb (the way back, then the item) on the left and
// the item's tools on the right: icon buttons, one labelled action (Chat),
// and a menu. Where there is no title bar the same bar sits at the top of
// the view.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { mentionPrompt } from "../contract";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import { useOpenTarget } from "./move";
import { useHomeThread, useItemChat, type ItemChatRef } from "./item-chat";
import { BAR_BUTTON, ICON_BUTTON } from "./pieces";
import { useStudioChatPresent, useStudioPresent } from "./presence";
import { RelatedPanel, type RelatedRef } from "./related-panel";

export type ItemThread = { title: string; href: string; ref?: RelatedRef };

export function openNewItemThread(navigate: ReturnType<typeof useBbNavigate>, item: ItemThread) {
  navigate.toCompose({ initialPrompt: mentionPrompt([item]), focusPrompt: true });
}

/** The shared action used by item headers and narrow-screen menus. */
function useNewItemThread(item: ItemThread | undefined) {
  const navigate = useBbNavigate();
  return () => {
    if (item) openNewItemThread(navigate, item);
  };
}

/** Opens the view on screen again in a split beside it. */
export function OpenInSplitButton({ item }: { item: ItemThread }) {
  const { open, anchor } = useOpenTarget();
  return (
    <>
      {anchor}
      <button type="button" aria-label="Open in split" title="Open in split" className={ICON_BUTTON} onClick={() => open({ kind: "path", path: item.href, title: item.title }, "split")}>
        <Icon name="Columns2" />
      </button>
    </>
  );
}

function ItemActions({ compact, children }: { compact: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    // Opened while compact, it would reappear open when compact again.
    if (!compact) setExpanded(false);
    if (!compact || !expanded) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!root.current?.contains(target) && !target.closest('[role="menu"], [role="dialog"]')) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setExpanded(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [compact, expanded]);
  return <div ref={root} className="relative">
    {compact ? <button ref={trigger} type="button" aria-label="Item actions" title="Item actions" aria-expanded={expanded} aria-controls={id} className={ICON_BUTTON} onClick={() => setExpanded(value => !value)}><Icon name="MoreHorizontal" className="size-4" /></button> : null}
    <div id={id} data-studio-item-actions="" role="group" aria-label="Item actions" style={{ display: compact && !expanded ? "none" : undefined }} className={compact
      ? "absolute top-10 right-0 z-30 flex w-max max-w-[min(24rem,calc(100vw-2rem))] flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2 shadow-xl"
      : "flex items-center gap-0.5"}>{children}</div>
  </div>;
}

// BB's title bar, laid out for a Studio bar: the bar replaces the panel's
// fixed label and takes the row's width, and, like the rest of the title bar
// on macOS, drags the window everywhere but its controls. If BB's header
// changes shape, the bar still shows, on the right. StudioBar marks the
// elements (markTitleBar): :has() here made every keystroke re-check the page.
const BAR_CSS = `
[data-studio-bar-row] > div:first-child { display: none; }
[data-studio-bar-row] > div:last-child,
[data-studio-bar-row] > div:last-child > div:first-child,
[data-studio-bar-root] { flex: 1 1 auto; min-width: 0; }
[data-studio-bar-drag] { app-region: drag; -webkit-app-region: drag; }
[data-studio-bar-drag] :is(button, a, input, select, textarea, [role="button"], [contenteditable="true"]) { app-region: no-drag; -webkit-app-region: no-drag; }
`;

/** Marks the title bar around a filled slot for BAR_CSS, until the returned cleanup. */
function markTitleBar(slot: HTMLElement) {
  const row = slot.closest<HTMLElement>('[data-testid="app-page-header-content-row"]');
  const drag = row ? [...row.children].find((child): child is HTMLElement => child.matches('div[class~="[app-region:no-drag]"]') && child.contains(slot)) : undefined;
  const root = slot.parentElement?.matches("[data-bb-plugin-root]") ? slot.parentElement : null;
  const marks: [HTMLElement, string][] = [];
  if (row) marks.push([row, "data-studio-bar-row"]);
  if (drag) marks.push([drag, "data-studio-bar-drag"]);
  if (root) marks.push([root, "data-studio-bar-root"]);
  for (const [element, name] of marks) element.setAttribute(name, "");
  return () => { for (const [element, name] of marks) element.removeAttribute(name); };
}

/** A nav panel's headerContent: where its views' Studio bar goes. */
export function StudioBarSlot() {
  return <>
    <style>{BAR_CSS}</style>
    <div data-studio-bar-slot="" className="flex min-w-0 flex-1 items-center" />
  </>;
}

/** The title bar slot of the pane this element is in, if its panel lends one. */
function paneSlot(from: HTMLElement): HTMLElement | null {
  for (let element = from.parentElement, depth = 0; element && depth < 24; element = element.parentElement, depth++) {
    // Workspace editors each keep their own tools; inactive tabs must never
    // compete for the outer Studio title bar.
    if (element.hasAttribute("data-studio-workspace-editor")) return element.closest("[data-studio-workspace-frame]")?.querySelector<HTMLElement>(":scope > header [data-studio-bar-slot]") ?? null;
    const slot = element.querySelector<HTMLElement>(":scope > header [data-studio-bar-slot]");
    if (slot) return slot;
  }
  return null;
}

function useBarSlot(anchor: React.RefObject<HTMLElement | null>): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // The title bar and the view mount together; give the slot a few frames.
    let frame = 0, tries = 0, current: HTMLElement | null = null;
    const find = () => (anchor.current ? paneSlot(anchor.current) : null);
    // A retained view set aside leaves its pane; its bar must leave that title bar too.
    const owns = (slot: HTMLElement) => {
      if (anchor.current?.closest("[data-studio-workspace-editor]") && paneSlot(anchor.current) !== slot) return false;
      const pane = slot.closest("header")?.parentElement;
      return !!pane && !!anchor.current && pane.contains(anchor.current);
    };
    const look = () => {
      frame = 0;
      const found = find();
      if (found || ++tries > 20) { current = found; setSlot(found); return; }
      frame = requestAnimationFrame(look);
    };
    look();
    // BB swaps its title bar at the compact breakpoint, and may lend one
    // late: follow the slot to the new one, or keep looking, once a frame.
    const observer = new MutationObserver(() => {
      if (frame || (current?.isConnected && owns(current))) return;
      if (current) { current = null; setSlot(null); tries = 0; look(); return; }
      frame = requestAnimationFrame(() => {
        frame = 0;
        current = find();
        if (current) setSlot(current);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [anchor]);
  return slot;
}

/**
 * A Studio view's bar: in its panel's title bar when the panel lends one,
 * otherwise at the top of the view. Children lay out in one row.
 */
export function StudioBar({ children, className }: { children: ReactNode; className?: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const slot = useBarSlot(anchor);
  useLayoutEffect(() => slot ? markTitleBar(slot) : undefined, [slot]);
  const bar = <div data-studio-bar="" className="flex h-full min-w-0 flex-1 items-center gap-2">{children}</div>;
  if (slot) return <>
    <span ref={anchor} hidden />
    {createPortal(bar, slot)}
  </>;
  return <div ref={anchor} className={cn("flex h-11 shrink-0 items-center border-b border-border bg-background px-2", className)}>{bar}</div>;
}

/** The parent crumb, then the item's own crumbs or title, separated like BB's breadcrumbs. */
export function BarCrumb({ children, onClick, current = false, title }: { children: ReactNode; onClick?(): void; current?: boolean; title?: string }) {
  const className = cn("flex h-7 min-w-0 shrink items-center gap-1.5 truncate rounded-md px-1.5 text-sm", current ? "font-medium text-foreground" : "text-muted-foreground", onClick && "hover:bg-state-hover hover:text-foreground");
  return onClick
    ? <button type="button" title={title} className={className} onClick={onClick}>{children}</button>
    : <span title={title} aria-current={current ? "page" : undefined} className={className}>{children}</span>;
}

/** The item's name as the bar's last crumb, renamed in place. */
export function BarTitle({ title, placeholder = "Untitled", label = "Name", disabled = false, onRename }: {
  title: string;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  onRename(title: string): void;
}) {
  return (
    <input
      aria-label={label}
      key={title}
      defaultValue={title}
      placeholder={placeholder}
      maxLength={200}
      disabled={disabled}
      className="h-7 min-w-16 max-w-full shrink rounded-md bg-transparent px-1.5 text-sm font-medium text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground hover:bg-state-hover focus:bg-state-hover disabled:opacity-60"
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = title;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next !== title) onRename(next);
      }}
    />
  );
}

export function BarSeparator() {
  return <span aria-hidden className="shrink-0 text-sm text-muted-foreground/50">/</span>;
}

export function ItemHeader({
  backLabel,
  onBack,
  leading,
  trailing,
  thread,
  item,
  chatAction,
  className,
}: {
  /** Where back goes, as the first crumb. */
  backLabel: string;
  onBack(): void;
  /** The item's crumbs, title, or status after the back crumb. */
  leading?: ReactNode;
  /** The view's own tools: ICON_BUTTONs, then the item menu. */
  trailing?: ReactNode;
  /** Adds the shared Chat action for this item. */
  thread?: ItemThread;
  /** The item shown, for Open in split; `thread` serves when given. */
  item?: ItemThread;
  /** Replaces the shared item chat when a view owns its conversation. Null hides it. */
  chatAction?: ReactNode;
  className?: string;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const slot = useBarSlot(anchor);
  useLayoutEffect(() => slot ? markTitleBar(slot) : undefined, [slot]);
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  useLayoutEffect(() => {
    const measured = slot ?? anchor.current;
    const measure = () => setCompact((measured?.getBoundingClientRect().width || window.innerWidth) < 520);
    measure();
    const observer = typeof ResizeObserver === "undefined" || !measured ? null : new ResizeObserver(measure);
    if (measured) observer?.observe(measured);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [slot]);
  const newThread = useNewItemThread(thread);
  const moved = item ?? thread;
  // Studio Chat owns item links and conversation creation across item views.
  const studioChat = useStudioChatPresent();
  const studio = useStudioPresent();
  const chatItem = thread ?? item;
  const path = chatItem?.href.split(/[?#]/)[0]?.split("/") ?? [];
  const relatedRef = chatItem?.ref ?? (path[1] === "plugins" && path[2] && path[4]
    ? { pluginId: path[2], id: decodeURIComponent(path[4]) }
    : null);
  const tools = relatedRef && studio || moved || trailing;
  const bar = (
    <div data-studio-bar="" data-studio-item-header="" className="flex h-full min-w-0 flex-1 items-center gap-2">
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5">
        <BarCrumb onClick={onBack} title={`Back to ${backLabel}`}>{backLabel}</BarCrumb>
        {leading ? <BarSeparator /> : null}
        {leading}
      </nav>
      {chatAction !== null && (chatAction || thread || relatedRef) || tools ? <div className="flex shrink-0 items-center gap-0.5">
        {chatAction}
        {chatAction === undefined && thread && studioChat === false ? <button type="button" className={BAR_BUTTON} onClick={newThread}>
          <Icon name="MessageSquare" /> Chat
        </button> : null}
        {chatAction === undefined && relatedRef && studioChat ? <HomeThreadChip item={relatedRef} /> : null}
        {tools ? <ItemActions compact={compact}>
          {relatedRef && studio ? <RelatedPanel ref={relatedRef} /> : null}
          {moved ? <OpenInSplitButton item={moved} /> : null}
          {trailing && ((relatedRef && studio) || moved) && !compact ? <span aria-hidden className="mx-1 h-4 w-px bg-border" /> : null}
          {trailing}
        </ItemActions> : null}
      </div> : null}
    </div>
  );
  if (slot) return <>
    <span ref={anchor} hidden />
    {createPortal(bar, slot)}
  </>;
  return (
    <div ref={anchor} className={cn("flex h-11 shrink-0 items-center border-b border-border bg-background px-2", className)}>
      {bar}
    </div>
  );
}

export interface ChatMenuItem { label: ReactNode; icon: string; onSelect(): void }

/**
 * An item's Chat: open its conversation, or pick from the menu. Menu
 * actions run once the menu has closed, so one that opens a dialog takes
 * focus cleanly.
 */
export function ChatButton({ title, disabled = false, onOpen, items, ...rest }: {
  title: string;
  disabled?: boolean;
  onOpen(): void;
  items: readonly ChatMenuItem[];
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title">) {
  const afterMenu = useRef<(() => void) | null>(null);
  return (
    <div {...rest} className="flex h-7 shrink-0 items-center rounded-md text-sm text-muted-foreground">
      <button type="button" className="flex h-full items-center gap-1.5 rounded-l-md pr-1.5 pl-2 hover:bg-state-hover hover:text-foreground disabled:opacity-50" title={title} disabled={disabled} onClick={onOpen}>
        <Icon name="MessageSquare" className="size-4 shrink-0" /> Chat
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Chat options" disabled={disabled} className="flex h-full shrink-0 items-center rounded-r-md px-1 hover:bg-state-hover hover:text-foreground disabled:opacity-50 data-[state=open]:bg-state-active">
            <Icon name="ChevronDown" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={(event) => {
          const launch = afterMenu.current;
          afterMenu.current = null;
          if (!launch) return;
          event.preventDefault();
          launch();
        }}>
          {items.map((item, index) => <DropdownMenuItem key={index} onSelect={() => { afterMenu.current = item.onSelect; }}>
            <Icon name={item.icon} className="size-4" /> {item.label}
          </DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The thread this item's chat and quotes go to, from Studio Chat. */
function HomeThreadChip({ item }: { item: ItemChatRef }) {
  const host = useItemChat();
  const home = useHomeThread(item);
  if (!host) return null;
  return (
    <ChatButton
      data-studio-chat-item={`${item.pluginId}:${item.id}`}
      title={home ? `Continue "${home.title}"` : "Start a conversation about this item"}
      disabled={home === undefined}
      onOpen={() => host.open(item)}
      items={[
        ...(home ? [{ label: <span className="truncate">{home.title}</span>, icon: "MessageSquare", onSelect: () => host.open(item) }] : []),
        { label: "New conversation", icon: "MessageSquarePlus", onSelect: () => host.start(item) },
        { label: "Choose conversation…", icon: "MoveTo", onSelect: () => host.choose(item) },
        ...(home ? [{ label: "Unlink", icon: "CircleX", onSelect: () => void host.unlink(item) }] : []),
      ]}
    />
  );
}

/** An item title that turns into a text field on click. */
export function EditableTitle({
  title,
  placeholder = "Untitled",
  onRename,
  className,
}: {
  title: string;
  placeholder?: string;
  onRename(title: string): void;
  className?: string;
}) {
  return (
    <input
      aria-label="Title"
      defaultValue={title}
      key={title}
      placeholder={placeholder}
      maxLength={200}
      className={cn(
        "w-full min-w-0 bg-transparent text-[32px] leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 max-md:text-[28px]",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = title;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next && next !== title) onRename(next);
        else event.currentTarget.value = title;
      }}
    />
  );
}
