// A Studio item's row in the sidebar, drawn as BB draws a thread's: the whole
// row highlights on hover, and its buttons show at the right end, × to close
// (open tabs only) and ⋯ for the same menu right-click opens. A row that
// expands, like a space's tab, shows a chevron over its icon on hover.
import { Icon, SIDEBAR_ROW, cn, openFloat, openPathInSplit, useCanFloat } from "@bb-studio/kit/app";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@bb-studio/kit/ui";
import { useId, useRef, useState, type CSSProperties, type MouseEvent } from "react";

const ACTION =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-state-hover aria-expanded:text-muted-foreground max-md:pointer-coarse:size-9";

/** Opens the row's context menu under `target`, as BB's thread ⋯ does. */
function openOptions(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom }));
}

export function SidebarItemRow({
  href,
  title,
  kindIcon,
  glyph,
  selected,
  style,
  onOpen,
  onClose,
  expanded = false,
  onToggle,
  rowProps,
}: {
  href: string;
  title: string;
  kindIcon: string;
  /** The item's emoji, if it has one, in place of its kind's icon. */
  glyph?: string | null;
  selected: boolean;
  style?: CSSProperties;
  onOpen(): void;
  /** Shows × and Close tab. */
  onClose?(): void;
  /** Whether the row's children show; with `onToggle`, the icon expands it. */
  expanded?: boolean;
  onToggle?(): void;
  rowProps?: Record<`data-${string}`, string>;
}) {
  const target = { kind: "path" as const, path: href, title, icon: kindIcon };
  const canFloat = useCanFloat(target);
  const link = useRef<HTMLAnchorElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          {...rowProps}
          className={cn(
            "group/item relative rounded-md hover:bg-sidebar-accent focus-within:bg-sidebar-accent data-[state=open]:bg-sidebar-accent",
            selected && "bg-sidebar-accent",
          )}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault();
            openOptions(event.target as HTMLElement);
          }}
        >
          <a
            ref={link}
            href={href}
            aria-current={selected ? "page" : undefined}
            style={style}
            className={cn(
              SIDEBAR_ROW,
              "hover:bg-transparent",
              selected && "text-sidebar-accent-foreground",
              onClose
                ? "group-hover/item:pr-16 group-focus-within/item:pr-16 group-data-[state=open]/item:pr-16 pointer-coarse:pr-20"
                : "group-hover/item:pr-9 group-focus-within/item:pr-9 group-data-[state=open]/item:pr-9 pointer-coarse:pr-11",
            )}
            onClick={(event: MouseEvent) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onOpen();
            }}
            onAuxClick={(event) => {
              // Middle-click closes, as in a browser.
              if (event.button !== 1 || !onClose) return;
              event.preventDefault();
              onClose();
            }}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center text-subtle-foreground",
                onToggle && "group-hover/item:opacity-0 group-focus-within/item:opacity-0 pointer-coarse:opacity-0",
              )}
            >
              {glyph ? <span className="text-sm leading-none">{glyph}</span> : <Icon name={kindIcon} className="size-4" />}
            </span>
            <span className="min-w-0 flex-1 truncate">{title}</span>
          </a>
          {onToggle ? (
            // Over the icon, outside the link: a button can't sit inside an <a>.
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
              className="absolute top-1/2 left-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground opacity-0 outline-none hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/item:opacity-100 group-focus-within/item:opacity-100 pointer-coarse:opacity-100"
              onClick={onToggle}
            >
              <Icon name="ChevronRight" aria-hidden className={cn("size-3.5 transition-transform duration-150", expanded && "rotate-90")} />
            </button>
          ) : null}
          <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100 group-data-[state=open]/item:pointer-events-auto group-data-[state=open]/item:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
            {onClose ? (
              <button type="button" aria-label={`Close ${title}`} title="Close tab" className={ACTION} onClick={onClose}>
                <Icon name="X" className="size-[15px]" />
              </button>
            ) : null}
            <button
              type="button"
              aria-label={`${title} options`}
              title="Options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              className={ACTION}
              onClick={(event) => openOptions(event.currentTarget)}
            >
              <Icon name="MoreHorizontal" className="size-[15px]" />
            </button>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent id={menuId} aria-label={`${title} options`}>
        <ContextMenuItem onSelect={() => openPathInSplit(link.current, href) || onOpen()}>
          <Icon name="Columns2" />
          Open in split
        </ContextMenuItem>
        {canFloat ? (
          <ContextMenuItem onSelect={() => openFloat(target)}>
            <Icon name="AppWindow" />
            Float
          </ContextMenuItem>
        ) : null}
        {onClose ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onClose}>
              <Icon name="X" />
              Close tab
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
