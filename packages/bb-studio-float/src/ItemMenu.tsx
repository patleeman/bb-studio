// Moving Studio items and threads in one gesture, anywhere on screen:
// - right-click one for Open, Float, Open in split, Copy reference (a thread:
//   Copy link), New thread;
// - Mod-click to open it in a split, Shift-click to float it;
// - drag it onto the floating panel (or the corner, with no panel) to float it.
// Items are marked with the kit's studioItemProps or studioThreadProps, and
// links into plugin views and threads count too. An element's own menu, and
// Shift+right-click, keep their usual behavior.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import {
  CopyReferenceMenuItem,
  cn,
  dropTarget,
  floatPanelFor,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  openNewItemThread,
  STUDIO_ITEM_CLICKS_OFF,
  studioTargetAt,
  targetHref,
  useCanFloat,
  useOpenTarget,
  type FloatTarget,
} from "@bb-studio/kit/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { update } from "./store";
import { openTab } from "./stack";
import { useItemDrag } from "./useItemDrag";

interface Menu {
  x: number;
  y: number;
  target: FloatTarget;
}

/** How the menu names the split click: ⌘ on a Mac, Ctrl elsewhere. */
const MOD_CLICK = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ Click" : "Ctrl Click";

const floatTarget = (target: FloatTarget) => update((state) => openTab(state, target));

const targetAt = (event: Event) => studioTargetAt(event.target instanceof Element ? event.target : null);

/** Mod-click splits any item or thread; Shift-click floats one a window can show. */
function useModifierClicks(split: (target: FloatTarget) => void) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Splitting itself clicks a link with Mod held; that click isn't the user's.
      if (!event.isTrusted || event.button !== 0 || event.defaultPrevented || event.altKey) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod && !event.shiftKey) return;
      const target = targetAt(event);
      if (!target) return;
      // Shift-click on something no window can show: let the click do what it does.
      if (!mod && target.kind === "path" && !floatPanelFor(target.path)) return;
      if ((event.target as Element).closest(`[${STUDIO_ITEM_CLICKS_OFF}]`)) return;
      event.preventDefault();
      event.stopPropagation();
      if (mod) split(target);
      else floatTarget(target);
    };
    // Capturing, so the item's own click handler doesn't open it as well.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [split]);
}

/** Where a dragged item can float: over the panel, or in the corner when there's none. */
function DropZone() {
  const [over, setOver] = useState(false);
  const panel = document.querySelector(".bb-float-stack")?.getBoundingClientRect();
  const style = panel
    ? { left: panel.left, top: panel.top, width: panel.width, height: panel.height }
    : { right: 24, bottom: 24, width: 320, height: 120 };
  return (
    <div
      data-float-drop=""
      className={cn(
        "pointer-events-auto fixed z-50 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm font-medium backdrop-blur-sm transition-colors",
        over ? "border-primary bg-primary/15 text-foreground" : "border-primary/50 bg-background/70 text-muted-foreground",
      )}
      style={style}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const target = dropTarget(event.dataTransfer);
        if (target) floatTarget(target);
      }}
    >
      <Icon name="AppWindow" className="size-4" /> Drop to float
    </div>
  );
}

export function ItemGestures() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const navigate = useBbNavigate();
  const { open, anchor } = useOpenTarget();
  // The click listener is added once and opens through the latest `open`.
  const latestOpen = useRef(open);
  latestOpen.current = open;
  const split = useCallback((target: FloatTarget) => latestOpen.current(target, "split"), []);
  useModifierClicks(split);
  const dragging = useItemDrag();

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || event.shiftKey) return;
      const target = targetAt(event);
      if (!target) return;
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, target });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  const canFloat = useCanFloat(menu?.target ?? null);
  const target = menu?.target;
  const copyLink = (value: FloatTarget) =>
    void navigator.clipboard.writeText(new URL(targetHref(value), window.location.origin).href).then(
      () => toast.success("Copied the link."),
      () => toast.error("Couldn't copy the link."),
    );

  return (
    <>
      {anchor}
      {dragging ? <DropZone /> : null}
      {menu && target ? (
        <DropdownMenu key={`${menu.x},${menu.y}`} open modal={false} onOpenChange={(next) => !next && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: menu.x, top: menu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" sideOffset={0} className="w-56" aria-label={`${target.title ?? "Item"} options`}>
            <DropdownMenuItem onSelect={() => open(target, "main")}>
              <Icon name="ArrowUpRight" className="size-4" /> Open
            </DropdownMenuItem>
            {canFloat ? (
              <DropdownMenuItem onSelect={() => floatTarget(target)}>
                <Icon name="AppWindow" className="size-4" /> Float
                <span className="ml-auto text-muted-foreground">⇧ Click</span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => open(target, "split")}>
              <Icon name="Columns2" className="size-4" /> Open in split
              <span className="ml-auto text-muted-foreground">{MOD_CLICK}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {target.kind === "path" ? (
              <CopyReferenceMenuItem item={{ href: target.path, ...(target.title ? { title: target.title } : {}), ...(target.icon ? { icon: target.icon } : {}) }} />
            ) : (
              <DropdownMenuItem onSelect={() => copyLink(target)}>
                <Icon name="studio/link" fallback="Copy" className="size-4" /> Copy link
              </DropdownMenuItem>
            )}
            {target.kind === "path" ? (
              <DropdownMenuItem onSelect={() => openNewItemThread(navigate, { title: target.title ?? "This item", href: target.path })}>
                <Icon name="MessageSquarePlus" className="size-4" /> New thread with this
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
