// The bar floating over every Studio item view: a back pill on the left,
// then the view's own breadcrumb or status, and its buttons on the right.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { mentionPrompt } from "../contract";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import { openFloat, useCanFloat, useInFloat } from "./float";
import { useOpenTarget } from "./move";
import { useHomeThread, useItemChat, type ItemChatRef } from "./item-chat";
import { FLOATING, FLOATING_BUTTON, ICON_BUTTON } from "./pieces";
import { useStudioChatPresent, useStudioPresent } from "./presence";
import { RelatedPanel, type RelatedRef } from "./related-panel";
import { SpacePicker } from "./space-picker";

export type ItemThread = { title: string; href: string; ref?: RelatedRef };

export function openNewItemThread(navigate: ReturnType<typeof useBbNavigate>, item: ItemThread) {
  navigate.toCompose({ initialPrompt: mentionPrompt([item]), focusPrompt: true });
}

/** The shared action used by item headers and narrow-screen menus. */
export function useNewItemThread(item: ItemThread | undefined) {
  const navigate = useBbNavigate();
  return () => {
    if (item) openNewItemThread(navigate, item);
  };
}

/**
 * Moves the item on screen: Float takes it out of the main view, which goes
 * back as the header's back pill would; a split opens it beside. Not shown
 * inside a floating tab, whose own menu moves it.
 */
function MoveMenu({ item, onBack }: { item: ItemThread; onBack(): void }) {
  const target = { kind: "path" as const, path: item.href, title: item.title };
  const canFloat = useCanFloat(target);
  const inFloat = useInFloat();
  const { open, anchor } = useOpenTarget();
  if (inFloat) return null;
  return (
    <>
      {anchor}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Move" title="Float or split" className={FLOATING_BUTTON}>
            <Icon name="AppWindow" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {canFloat ? (
            <DropdownMenuItem
              onSelect={() => {
                if (openFloat(target)) onBack();
              }}
            >
              <Icon name="AppWindow" className="size-4" /> Float this
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => open(target, "split")}>
            <Icon name="Columns2" className="size-4" /> Open in split
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ItemActions({ compact, children }: { compact: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
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
      : "flex items-center gap-1.5"}>{children}</div>
  </div>;
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
  backLabel: string;
  onBack(): void;
  /** Breadcrumbs or status beside the back pill. */
  leading?: ReactNode;
  /** The view's buttons, built from ICON_BUTTON and FLOATING_BUTTON. */
  trailing?: ReactNode;
  /** Adds the shared Chat action for this item. */
  thread?: ItemThread;
  /** The item shown, for the Float and split menu; `thread` serves when given. */
  item?: ItemThread;
  /** Replaces the shared item chat when a view owns its conversation. Null hides it. */
  chatAction?: ReactNode;
  className?: string;
}) {
  const header = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  useLayoutEffect(() => {
    const measure = () => setCompact((header.current?.getBoundingClientRect().width || window.innerWidth) < 600);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (header.current) observer?.observe(header.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const newThread = useNewItemThread(thread);
  const inFloat = useInFloat();
  const moved = item ?? thread;
  // Studio Chat owns item links and conversation creation across item views.
  const studioChat = useStudioChatPresent();
  const studio = useStudioPresent();
  const chatItem = thread ?? item;
  const path = chatItem?.href.split(/[?#]/)[0]?.split("/") ?? [];
  const relatedRef = chatItem?.ref ?? (path[1] === "plugins" && path[2] && path[4]
    ? { pluginId: path[2], id: decodeURIComponent(path[4]) }
    : null);
  return (
    <div
      ref={header}
      data-studio-item-header=""
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-2 p-3 max-md:p-2",
        className,
      )}
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-1.5">
        {!inFloat ? <button
          type="button"
          aria-label={`Back to ${backLabel}`}
          className={cn(
            FLOATING,
            "flex h-8 shrink-0 items-center gap-1 rounded-md pr-3 pl-2 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground",
          )}
          onClick={onBack}
        >
          <Icon name="ChevronLeft" className="size-4" /> <span className={compact ? "sr-only" : undefined}>{backLabel}</span>
        </button> : null}
        {leading}
      </div>
      {trailing || thread || moved ? <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
        {chatAction}
        {chatAction === undefined && thread && studioChat === false ? <button type="button" className={FLOATING_BUTTON} onClick={newThread}>
          <Icon name="MessageSquare" /> Chat
        </button> : null}
        {chatAction === undefined && relatedRef && studioChat ? <HomeThreadChip item={relatedRef} /> : null}
        {(relatedRef && studio) || (moved && !inFloat) || trailing ? <ItemActions compact={compact}>
          {relatedRef && studio ? <SpacePicker item={relatedRef} /> : null}
          {relatedRef && studio ? <RelatedPanel ref={relatedRef} compact={inFloat} /> : null}
          {moved && !inFloat ? <MoveMenu item={moved} onBack={onBack} /> : null}
          {trailing}
        </ItemActions> : null}
      </div> : null}
    </div>
  );
}

/** The thread this item's chat and quotes go to, from Studio Chat. */
function HomeThreadChip({ item }: { item: ItemChatRef }) {
  const host = useItemChat();
  const home = useHomeThread(item);
  const openingDialog = useRef<(() => void) | null>(null);
  if (!host) return null;
  return (
    <div data-studio-chat-item={`${item.pluginId}:${item.id}`} className={cn(FLOATING, "flex h-8 shrink-0 items-center rounded-md text-sm text-muted-foreground")}>
      <button
        type="button"
        className="flex h-full items-center gap-1.5 rounded-l-md pr-2 pl-2.5 hover:bg-state-hover hover:text-foreground disabled:opacity-50"
        title={home ? `Continue "${home.title}"` : "Start a conversation about this item"}
        disabled={home === undefined}
        onClick={() => host.open(item)}
      >
        <Icon name="MessageSquare" className="size-4 shrink-0" /> Chat
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Chat options" className="flex h-full shrink-0 items-center rounded-r-md px-1.5 hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active">
            <Icon name="ChevronDown" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={(event) => {
          const launch = openingDialog.current;
          openingDialog.current = null;
          if (!launch) return;
          event.preventDefault();
          launch();
        }}>
          {home ? <DropdownMenuItem onSelect={() => host.open(item)}>
            <Icon name="MessageSquare" className="size-4" /> <span className="truncate">{home.title}</span>
          </DropdownMenuItem> : null}
          {host.start ? <DropdownMenuItem onSelect={() => { openingDialog.current = () => host.start?.(item); }}>
            <Icon name="MessageSquarePlus" className="size-4" /> New conversation
          </DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={() => { openingDialog.current = () => host.choose(item); }}>
            <Icon name="ArrowLeftRight" className="size-4" /> Choose conversation…
          </DropdownMenuItem>
          {home ? <DropdownMenuItem onSelect={() => void host.unlink(item)}>
            <Icon name="Unlink" className="size-4" /> Unlink
          </DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
