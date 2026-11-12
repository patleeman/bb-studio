// Opening Studio items and threads the same way anywhere on screen:
// - right-click one for Open, Open in main view (from a thread's workbench),
//   Open in new window (an item, on a BB with plugin windows), Star (an
//   item), Copy reference (a thread: Copy link), New thread with this. On a
//   BB with splits (stable BB) the second item is Open in split. Shortcuts
//   sit on the right of their rows;
// - Mod-click and Shift-click on a link to anything the tab kinds registry
//   knows go through the link router (src/links/router.ts): a new tab in the
//   workbench's second pane, or a window of its own. Other links keep the
//   older Mod-click: the other place (a split, or the main view). In a thread
//   (its workbench, or a card in its transcript) the rule in ./studio-open.tsx
//   applies to those: Open is a workbench tab, and Mod-click opens it in the
//   Studio app. Elsewhere the container is what the main view shows.
// Items are marked with the kit's studioItemProps or studioThreadProps, and
// links into plugin views and threads count too. An element's own menu, and
// Shift+right-click, keep their usual behavior.
// While any right-click menu is open (this one, or BB's own on a sidebar
// row), the native tooltip of what was right-clicked is held back, so it
// isn't drawn over the menu (UX review 2, item 21).
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import {
  CopyReferenceMenuItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  useItemStarred,
  openNewItemThread,
  OpenInWindowMenuItem,
  STUDIO_ITEM_CLICKS_OFF,
  studioTargetAt,
  targetHref,
  useOpenTarget,
  type OpenTarget,
} from "../kit/app/index";
import { useEffect, useRef, useState } from "react";
import { hasGlobalWorkbench } from "../kit/app/host-sdk";
import { linkedItemRef } from "../kit/app/item-menu";
import { hasDragItem, linkDragItem, writeDragItem } from "../kit/app/item-drag";
import { openLinkFromAnywhere, routesLink } from "../links/open";
import { containerAt, openFrom, routeContainer, type StudioContainer, type StudioRef } from "./studio-open";
import { toast } from "sonner";

interface Menu {
  x: number;
  y: number;
  target: OpenTarget;
  container: StudioContainer | null;
}

const refOf = (target: OpenTarget): StudioRef => target.kind === "thread"
  ? { threadId: target.threadId, ...(target.title ? { title: target.title } : {}) }
  : { href: target.path, ...(target.title ? { title: target.title } : {}), ...(target.icon ? { icon: target.icon } : {}) };
const inThread = (container: StudioContainer | null): container is Extract<StudioContainer, { kind: "thread" }> => container?.kind === "thread";

/** How the menu names the split click: ⌘ on a Mac, Ctrl elsewhere. */
const MOD_CLICK = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ Click" : "Ctrl Click";

const targetAt = (event: Event) => studioTargetAt(event.target instanceof Element ? event.target : null);

export function linkGesture(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, target: OpenTarget): { link: string; modifiers: { meta: boolean; ctrl: boolean; shift: boolean }; title: string | null } | null {
  if (!event.metaKey && !event.ctrlKey && !event.shiftKey) return null;
  const link = targetHref(target);
  if (!routesLink(link)) return null;
  return { link, modifiers: { meta: event.metaKey, ctrl: event.ctrlKey, shift: event.shiftKey }, title: target.title ?? null };
}

/**
 * Holds back the native tooltips (`title`) of a right-clicked element and its
 * ancestors until the next press or key anywhere (a menu closes on those), so
 * no tooltip is drawn over the open menu. Returns how many it held.
 */
export function holdTooltips(from: Element | null, doc: Document = document): number {
  const held: [Element, string][] = [];
  for (let element = from; element && element !== doc.body; element = element.parentElement) {
    const title = element.getAttribute("title");
    if (title === null) continue;
    held.push([element, title]);
    element.removeAttribute("title");
  }
  if (!held.length) return 0;
  const restore = () => {
    for (const [element, title] of held) if (!element.hasAttribute("title")) element.setAttribute("title", title);
    doc.removeEventListener("pointerdown", restore, true);
    doc.removeEventListener("keydown", restore, true);
  };
  // After this right-click's own events.
  setTimeout(() => {
    doc.addEventListener("pointerdown", restore, true);
    doc.addEventListener("keydown", restore, true);
  }, 0);
  return held.length;
}

/** Star or Unstar an item, as its header's star does; nothing until Studio's stars load. */
function StarMenuItem({ href }: { href: string }) {
  const ref = linkedItemRef(href);
  const { host, starred } = useItemStarred(ref);
  if (!ref || !host || starred === undefined) return null;
  return (
    <DropdownMenuItem onSelect={() => void host.set(ref, !starred)}>
      <Icon name="Star" className={starred ? "size-4 fill-current text-amber-500" : "size-4"} /> {starred ? "Unstar" : "Star"}
    </DropdownMenuItem>
  );
}

export function ItemGestures() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const navigate = useBbNavigate();
  const { open, anchor } = useOpenTarget();
  // The listeners are added once and open through the latest `open`.
  const latestOpen = useRef(open);
  latestOpen.current = open;
  const latestNavigate = useRef(navigate);
  latestNavigate.current = navigate;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Splitting itself clicks a link with Mod held; that click isn't the user's.
      if (!event.isTrusted || event.button !== 0 || event.defaultPrevented || event.altKey) return;
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey) return;
      const target = targetAt(event);
      if (!target || (event.target as Element).closest(`[${STUDIO_ITEM_CLICKS_OFF}]`)) return;
      const routed = linkGesture(event, target);
      if (routed) {
        event.preventDefault();
        event.stopPropagation();
        void openLinkFromAnywhere(routed.link, { source: "gesture", modifiers: routed.modifiers, title: routed.title });
        return;
      }
      if (event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      const container = containerAt(event.target as Element) ?? routeContainer();
      if (inThread(container)) openFrom(container, refOf(target), { alternate: true }, latestNavigate.current);
      else latestOpen.current(target, "split");
    };
    // Capturing, before BB's own row menus take the event.
    const onAnyContextMenu = (event: MouseEvent) => { if (!event.shiftKey) holdTooltips(event.target instanceof Element ? event.target : null); };
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || event.shiftKey) return;
      const target = targetAt(event);
      if (!target) return;
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, target, container: containerAt(event.target as Element) ?? routeContainer() });
    };
    // A link to a thread or a Studio item, or an element marked as one, dragged from anywhere (a transcript, a page, a list):
    // it carries the item, so it drops on the workbench, a composer, the main view and a page.
    const onDragStart = (event: DragEvent) => {
      if (!event.dataTransfer || hasDragItem(event.dataTransfer)) return;
      const target = targetAt(event);
      const item = target ? linkDragItem({ href: targetHref(target), title: target.title }) : null;
      if (item) writeDragItem(event.dataTransfer, item);
    };
    document.addEventListener("dragstart", onDragStart);
    // Capturing, so the item's own click handler doesn't open it as well.
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("contextmenu", onAnyContextMenu, true);
    return () => {
      document.removeEventListener("contextmenu", onAnyContextMenu, true);
      document.removeEventListener("dragstart", onDragStart);
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
            {inThread(menu.container) ? (
              <>
                <DropdownMenuItem onSelect={() => openFrom(menu.container, refOf(target), {}, navigate)}>
                  <Icon name="ArrowUpRight" className="size-4" /> Open
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFrom(menu.container, refOf(target), { alternate: true }, navigate)}>
                  <Icon name="studio/studio" fallback="ArrowUpRight" className="size-4" /> {hasGlobalWorkbench ? "Open in main view" : target.kind === "thread" ? "Open in split" : "Open in Studio"}
                  <span className="ml-auto text-muted-foreground">{MOD_CLICK}</span>
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => open(target, "main")}>
                  <Icon name="ArrowUpRight" className="size-4" /> Open
                </DropdownMenuItem>
                {/* No splits in BB Studio (the fork): Open is the only place. */}
                {hasGlobalWorkbench ? null : (
                  <DropdownMenuItem onSelect={() => open(target, "split")}>
                    <Icon name="Columns2" className="size-4" /> Open in split
                    <span className="ml-auto text-muted-foreground">{MOD_CLICK}</span>
                  </DropdownMenuItem>
                )}
              </>
            )}
            {target.kind === "path" ? <OpenInWindowMenuItem href={target.path} title={target.title} /> : null}
            {target.kind === "path" ? <StarMenuItem href={target.path} /> : null}
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
