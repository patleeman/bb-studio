// Every Studio view has one bar, and it's BB's own: the page's title bar.
// A nav panel lends Studio its title bar through StudioBarSlot; ItemHeader
// fills it with a breadcrumb (the way back, then the item) on the left and
// the item's tools on the right: icon buttons (star, new thread, open
// beside) and a menu. Where there is no title bar the same bar sits at the top of
// the view.
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { experimental_useAppPanel, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { mentionPrompt } from "../contract";
import { Icon } from "../ui/icon";
import { usePortalScopeProps } from "../ui/portal-scope";
import { cn } from "../ui/utils";
import { useOpenTarget } from "./move";
import { useStudioContainer } from "./container";
import { openAppPath } from "./nav";
import { hasGlobalWorkbench, useHostTabWindow } from "./host-sdk";
import { openWorkspaceItem } from "./workspace";
import { useItemChat, type ItemChatRef } from "./item-chat";
import { ItemMenu, linkedItemRef } from "./item-menu";
import { useItemStarred, type ItemStarRef } from "./item-star";
import { ITEM_THREAD_TAB, openBeside } from "./workbench";
import { ICON_BUTTON } from "./pieces";

export interface RelatedRef { pluginId: string; id: string }
export type ItemThread = { title: string; href: string; ref?: RelatedRef };

export function openNewItemThread(navigate: ReturnType<typeof useBbNavigate>, item: ItemThread) {
  navigate.toCompose({ initialPrompt: mentionPrompt([item]), focusPrompt: true });
}

/** An item the header's "Ask the Bot about this" is about, and where the header is. */
export interface AskAboutItem { item: ItemThread; itemRef: ItemChatRef; container: ReturnType<typeof useStudioContainer> }

let askAbout: ((ask: AskAboutItem) => void) | null = null;
/**
 * The app's "Ask the Bot about this" (src/ui/ask-about-item.ts): the item
 * goes to the Bot in the current conversation, mentioned in its composer.
 * Without it the header offers "New thread about this", as before.
 */
export function setAskAboutItem(handler: ((ask: AskAboutItem) => void) | null): void {
  askAbout = handler;
}

/** "Ask the Bot about this": the item, mentioned in the current conversation's composer. */
export function AskBotButton({ item, itemRef }: { item: ItemThread; itemRef: ItemChatRef }) {
  const container = useStudioContainer();
  return (
    <button type="button" aria-label="Ask the Bot about this" title="Ask the Bot about this" data-studio-item-ask={`${itemRef.pluginId}:${itemRef.id}`} className={ICON_BUTTON} onClick={() => askAbout?.({ item, itemRef, container })}>
      <Icon name="MessageSquarePlus" />
    </button>
  );
}

/**
 * Starts a thread about the item, in the workbench beside it: a composer tab
 * that holds the item and becomes the thread once sent. Nothing is created
 * until then; an item gets no thread of its own. Where there is no workbench
 * beside the item (stable BB's Studio page), the composer opens as it did
 * before: in a split, or BB's new-thread screen with the item mentioned.
 */
export function NewThreadButton({ item, itemRef }: { item: ItemThread; itemRef: ItemChatRef }) {
  const panel = experimental_useAppPanel();
  const navigate = useBbNavigate();
  const container = useStudioContainer();
  const host = useItemChat();
  const start = () => {
    if (openBeside(panel, container, { tabId: ITEM_THREAD_TAB, params: { pluginId: itemRef.pluginId, id: itemRef.id }, title: "New thread" })) return;
    if (host) host.start(itemRef);
    else openNewItemThread(navigate, item);
  };
  return (
    <button type="button" aria-label="New thread about this" title="New thread about this" data-studio-item-thread={`${itemRef.pluginId}:${itemRef.id}`} className={ICON_BUTTON} onClick={start}>
      <Icon name="MessageSquarePlus" />
    </button>
  );
}

/**
 * Opens the view on screen again in a split beside it. In a thread's
 * workbench the other place is the Studio app (src/ui/studio-open.tsx), so
 * there it opens the item as a Studio tab instead.
 */
export function OpenInSplitButton({ item }: { item: ItemThread }) {
  const { open, anchor } = useOpenTarget();
  const container = useStudioContainer();
  // Where BB has no splits and shows items in its main view: from a workbench the other place is the main view.
  if (hasGlobalWorkbench) {
    if (container?.kind !== "thread") return null;
    return (
      <button type="button" aria-label="Open in main view" title="Open in main view" className={ICON_BUTTON} onClick={() => openAppPath(item.href)}>
        <Icon name="ArrowUpRight" />
      </button>
    );
  }
  if (container?.kind === "thread") {
    return (
      <button type="button" aria-label="Open in Studio" title="Open in Studio" className={ICON_BUTTON} onClick={() => { if (!openWorkspaceItem({ href: item.href, title: item.title })) openAppPath(item.href); }}>
        <Icon name="ArrowUpRight" />
      </button>
    );
  }
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
// own label (its icon, name and breadcrumb) and takes the row's width, so the
// page shows one title, on the left, with its actions on the right. Like the
// rest of the title bar on macOS, it drags the window everywhere but its
// controls. The label is the row's child just before the one holding the
// slot: BB may put controls ahead of it (the fork's back and forward), so
// "the row's first child" is not the label. If BB's header changes shape,
// the bar still shows, on the right. StudioBar marks the elements
// (markTitleBar): :has() here made every keystroke re-check the page.
const BAR_CSS = `
[data-studio-bar-label] { display: none; }
[data-studio-bar-fill] { flex: 1 1 auto; min-width: 0; }
[data-studio-bar-drag] { app-region: drag; -webkit-app-region: drag; }
[data-studio-bar-drag] :is(button, a, input, select, textarea, [role="button"], [contenteditable="true"]) { app-region: no-drag; -webkit-app-region: no-drag; }
`;

/** Marks the title bar around a filled slot for BAR_CSS, until the returned cleanup. */
function markTitleBar(slot: HTMLElement) {
  // The workspace's tab row lends this slot; the row, not the item, owns the title bar.
  if (slot.hasAttribute("data-studio-workspace-bar")) return () => {};
  const row = slot.closest<HTMLElement>('[data-testid="app-page-header-content-row"]');
  const marks: [HTMLElement, string][] = [];
  if (row) {
    marks.push([row, "data-studio-bar-row"]);
    let actions: HTMLElement | null = null;
    for (let element = slot.parentElement; element && element !== row; element = element.parentElement) {
      marks.push([element, "data-studio-bar-fill"]);
      if (element.parentElement === row) actions = element;
    }
    if (actions?.matches('div[class~="[app-region:no-drag]"]')) marks.push([actions, "data-studio-bar-drag"]);
    const label = actions?.previousElementSibling;
    if (label instanceof HTMLElement && label.tagName === "DIV") marks.push([label, "data-studio-bar-label"]);
  }
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
    // Workspace editors each keep their own tools, in their tab's slot in the
    // tab row; inactive tabs must never compete for the outer Studio title bar.
    if (element.hasAttribute("data-studio-workspace-editor")) {
      const frame = element.closest("[data-studio-workspace-frame]")?.getAttribute("data-studio-workspace-frame");
      return frame ? [...document.querySelectorAll<HTMLElement>("[data-studio-workspace-bar]")].find(slot => slot.getAttribute("data-studio-workspace-bar") === frame) ?? null : null;
    }
    const slot = element.querySelector<HTMLElement>(":scope > header [data-studio-bar-slot]");
    if (slot) return slot;
  }
  return null;
}

function useBarSlot(anchor: React.RefObject<HTMLElement | null>, inline = false): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (inline) return;
    // The title bar and the view mount together; give the slot a few frames.
    let frame = 0, tries = 0, current: HTMLElement | null = null;
    const find = () => (anchor.current ? paneSlot(anchor.current) : null);
    // A retained view set aside leaves its pane; its bar must leave that title bar too.
    const owns = (slot: HTMLElement) => {
      if (anchor.current?.closest("[data-studio-workspace-editor]")) return paneSlot(anchor.current) === slot;
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
  }, [anchor, inline]);
  return slot;
}

/**
 * A Studio view's bar: in its panel's title bar when the panel lends one,
 * otherwise at the top of the view. Children lay out in one row.
 */
export function StudioBar({ children, className, slotOnly = false }: { children: ReactNode; className?: string; slotOnly?: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  const slot = useBarSlot(anchor);
  useLayoutEffect(() => slot ? markTitleBar(slot) : undefined, [slot]);
  const bar = <div data-studio-bar="" className="flex h-full min-w-0 flex-1 items-center gap-2">{children}</div>;
  if (slot) return <>
    <span ref={anchor} hidden />
    {createPortal(bar, slot)}
  </>;
  if (slotOnly) return <span ref={anchor} hidden />;
  return <div ref={anchor} className={cn("flex h-11 shrink-0 items-center border-b border-border bg-background px-2", className)}>{bar}</div>;
}

/**
 * In a workspace tab row the tab names the item and renames it, so a view's
 * crumbs, separators and title field render nothing there; its status stays.
 */
const InTabRow = createContext(false);

/** True in a workspace tab row, where a view shows only what the tab can't: Pages' parent pages, say. */
export function useInTabRow(): boolean {
  return useContext(InTabRow);
}

/** The parent crumb, then the item's own crumbs or title, separated like BB's breadcrumbs. */
export function BarCrumb({ children, onClick, current = false, title }: { children: ReactNode; onClick?(event: ReactMouseEvent): void; current?: boolean; title?: string }) {
  const inTabRow = useContext(InTabRow);
  const className = cn("flex h-7 min-w-0 shrink items-center gap-1.5 truncate rounded-md px-1.5 text-sm", current ? "font-medium text-foreground" : "text-muted-foreground", onClick && "hover:bg-state-hover hover:text-foreground");
  if (inTabRow) return null;
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
  if (useContext(InTabRow)) return null;
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
  if (useContext(InTabRow)) return null;
  return <span aria-hidden className="shrink-0 text-sm text-muted-foreground/50">/</span>;
}

export function ItemHeader({
  backLabel,
  onBack,
  leading,
  trailing,
  thread,
  item,
  className,
  inline = false,
}: {
  /** Where back goes, as the first crumb. */
  backLabel: string;
  onBack(): void;
  /** The item's crumbs, title, or status after the back crumb. */
  leading?: ReactNode;
  /** The view's own tools: ICON_BUTTONs, then the item menu. Without any, the header draws the shared menu. */
  trailing?: ReactNode;
  /** The item a new thread is about; `item` serves when not given. */
  thread?: ItemThread;
  /** The item shown, for Open in split; `thread` serves when given. */
  item?: ItemThread;
  className?: string;
  /** Keeps the bar in the view, with its back crumb, instead of lending it to a title bar (a view laid over another one). */
  inline?: boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const tabWindow = useHostTabWindow();
  const windowBar = inline ? null : tabWindow;
  const scope = usePortalScopeProps();
  const slot = useBarSlot(anchor, inline || windowBar !== null);
  useLayoutEffect(() => slot ? markTitleBar(slot) : undefined, [slot]);
  const inWindow = windowBar !== null;
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  useLayoutEffect(() => {
    // A workspace slot sits beside the tabs, so the pane's width decides; the
    // view's own place finds it when a single pane's row is in BB's title bar.
    const pane = slot?.hasAttribute("data-studio-workspace-bar") ? anchor.current?.closest<HTMLElement>("[data-workspace-pane]") ?? slot.closest<HTMLElement>("[data-workspace-pane]") : null;
    const measured = inWindow ? null : pane ?? slot ?? anchor.current;
    const measure = () => setCompact((measured?.getBoundingClientRect().width || window.innerWidth) < (pane ? 480 : 520));
    measure();
    const observer = typeof ResizeObserver === "undefined" || !measured ? null : new ResizeObserver(measure);
    if (measured) observer?.observe(measured);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [slot, inWindow]);
  const moved = item ?? thread;
  // Studio owns item links and thread creation across item views.
  const chatItem = thread ?? item;
  // A kind built into Studio lives at /plugins/studio/studio/<segment>/<id>,
  // and its items keep their old namespace: the known routes say which.
  const relatedRef = chatItem?.ref ?? (chatItem ? linkedItemRef(chatItem.href) : null);
  // In the workspace's tab row only the item's own tools show: the workspace
  // splits tabs itself, and a new thread isn't offered there.
  const inWorkspace = !!slot?.hasAttribute("data-studio-workspace-bar");
  const named = inWorkspace || inWindow;
  const splitHere = !named && moved;
  const tools = splitHere || trailing || relatedRef;
  const bar = (
    <div data-studio-bar="" data-studio-item-header="" className={cn("flex h-full min-w-0 items-center gap-2", !named && "flex-1")}>
      {/* In the workspace a tab has nowhere to go back to; the view's own crumbs,
          renames and status stay. Beside the tabs they take their own width
          (a share of nothing is nothing) and shrink before the tools do. */}
      <nav aria-label="Breadcrumb" data-studio-item-crumbs="" className={cn("flex min-w-0 items-center gap-0.5", named ? "shrink" : "flex-1")}>
        {/* The way back never shrinks: the item's own title and status truncate first (UX review 2, item 12). */}
        {named ? null : <span className="flex shrink-0"><BarCrumb onClick={onBack} title={`Back to ${backLabel}`}>{backLabel}</BarCrumb></span>}
        {leading && !named ? <BarSeparator /> : null}
        {leading}
      </nav>
      {tools ? <div className="flex shrink-0 items-center gap-0.5">
        {relatedRef ? <StarButton item={relatedRef} /> : null}
        <ItemActions compact={compact}>
          {!inWorkspace && relatedRef && chatItem ? (askAbout ? <AskBotButton item={chatItem} itemRef={relatedRef} /> : <NewThreadButton item={chatItem} itemRef={relatedRef} />) : null}
          {splitHere ? <OpenInSplitButton item={splitHere} /> : null}
          {trailing && splitHere && !compact ? <span aria-hidden className="mx-1 h-4 w-px bg-border" /> : null}
          {trailing ?? (!inWorkspace && relatedRef && chatItem ? <ItemMenu reference={chatItem} /> : null)}
        </ItemActions>
      </div> : null}
    </div>
  );
  if (windowBar) return <>
    <span ref={anchor} hidden />
    {windowBar.toolbar ? createPortal(<div {...scope} className="contents"><InTabRow.Provider value>{bar}</InTabRow.Provider></div>, windowBar.toolbar) : null}
  </>;
  if (slot) return <>
    <span ref={anchor} hidden />
    {createPortal(<InTabRow.Provider value={inWorkspace}>{bar}</InTabRow.Provider>, slot)}
  </>;
  return (
    <div ref={anchor} className={cn("flex h-11 shrink-0 items-center border-b border-border bg-background px-2", className)}>
      {bar}
    </div>
  );
}

/** Stars or unstars the item; filled while it's starred. Hidden until Studio's stars load. */
export function StarButton({ item }: { item: ItemStarRef }) {
  const { host, starred } = useItemStarred(item);
  if (!host || starred === undefined) return null;
  const label = starred ? "Unstar" : "Star";
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={starred} data-studio-star={`${item.pluginId}:${item.id}`} className={ICON_BUTTON}
      onClick={() => void host.set(item, !starred)}>
      <Icon name="Star" className={cn(starred && "fill-current text-amber-500")} />
    </button>
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
