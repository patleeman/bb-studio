// Right-click a Studio item anywhere (a collection row, a mention or embed on
// a page, a link) to open it, float it, or open it in a split. Items are
// marked with the kit's studioItemProps, and links into plugin views count
// too. A menu of the element's own, or Shift, keeps the usual menu.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  openAppPath,
  openPathInSplit,
  studioItemAt,
  useCanFloat,
  type FloatTarget,
  type StudioItemLink,
} from "@bb-studio/kit/app";
import { useEffect, useRef, useState } from "react";
import { update } from "./store";
import { openTab } from "./stack";

interface Menu {
  x: number;
  y: number;
  item: StudioItemLink;
}

/** Opens `path` in a split from an anchor of Float's own, else in full. */
export function useOpenInSplit() {
  const anchor = useRef<HTMLAnchorElement>(null);
  const open = (path: string) => {
    if (!openPathInSplit(anchor.current, path)) openAppPath(path);
  };
  // BB opens a Mod-clicked link in a split only from the plugin's own tree.
  const element = <a ref={anchor} aria-hidden tabIndex={-1} className="hidden" />;
  return { open, element };
}

export function ItemContextMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const split = useOpenInSplit();

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || event.shiftKey) return;
      const item = studioItemAt(event.target instanceof Element ? event.target : null);
      if (!item) return;
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, item });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  const target: FloatTarget | null = menu ? { kind: "path", path: menu.item.href, title: menu.item.title, icon: menu.item.icon } : null;
  const canFloat = useCanFloat(target);

  return (
    <>
      {split.element}
      {menu && target ? (
        <DropdownMenu key={`${menu.x},${menu.y}`} open modal={false} onOpenChange={(open) => !open && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: menu.x, top: menu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" sideOffset={0} className="w-48" aria-label={`${menu.item.title ?? "Item"} options`}>
            <DropdownMenuItem onSelect={() => openAppPath(menu.item.href)}>
              <Icon name="ArrowUpRight" className="size-4" /> Open
            </DropdownMenuItem>
            {canFloat ? (
              <DropdownMenuItem onSelect={() => update((state) => openTab(state, target))}>
                <Icon name="AppWindow" className="size-4" /> Float
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => split.open(menu.item.href)}>
              <Icon name="Columns2" className="size-4" /> Open in split
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
