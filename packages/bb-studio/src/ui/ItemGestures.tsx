// Opening Studio items and threads the same way anywhere on screen:
// - right-click one for Open, Open in split, Copy reference (a thread: Copy
//   link), New thread with this;
// - Mod-click to open it in a split.
// Items are marked with the kit's studioItemProps or studioThreadProps, and
// links into plugin views and threads count too. An element's own menu, and
// Shift+right-click, keep their usual behavior.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import {
  CopyReferenceMenuItem,
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
  useOpenTarget,
  type OpenTarget,
} from "@bb-studio/kit/app";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface Menu {
  x: number;
  y: number;
  target: OpenTarget;
}

/** How the menu names the split click: ⌘ on a Mac, Ctrl elsewhere. */
const MOD_CLICK = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ Click" : "Ctrl Click";

const targetAt = (event: Event) => studioTargetAt(event.target instanceof Element ? event.target : null);

export function ItemGestures() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const navigate = useBbNavigate();
  const { open, anchor } = useOpenTarget();
  // The listeners are added once and open through the latest `open`.
  const latestOpen = useRef(open);
  latestOpen.current = open;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Splitting itself clicks a link with Mod held; that click isn't the user's.
      if (!event.isTrusted || event.button !== 0 || event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const target = targetAt(event);
      if (!target || (event.target as Element).closest(`[${STUDIO_ITEM_CLICKS_OFF}]`)) return;
      event.preventDefault();
      event.stopPropagation();
      latestOpen.current(target, "split");
    };
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || event.shiftKey) return;
      const target = targetAt(event);
      if (!target) return;
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, target });
    };
    // Capturing, so the item's own click handler doesn't open it as well.
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  const target = menu?.target;
  const copyLink = (value: OpenTarget) =>
    void navigator.clipboard.writeText(new URL(targetHref(value), window.location.origin).href).then(
      () => toast.success("Copied the link."),
      () => toast.error("Couldn't copy the link."),
    );

  return (
    <>
      {anchor}
      {menu && target ? (
        <DropdownMenu key={`${menu.x},${menu.y}`} open modal={false} onOpenChange={(next) => !next && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: menu.x, top: menu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" sideOffset={0} className="w-56" aria-label={`${target.title ?? "Item"} options`}>
            <DropdownMenuItem onSelect={() => open(target, "main")}>
              <Icon name="ArrowUpRight" className="size-4" /> Open
            </DropdownMenuItem>
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
