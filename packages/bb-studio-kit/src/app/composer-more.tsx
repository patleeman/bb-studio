// The row under a composer, beside its project, machine and branch, fills up
// as plugins add to it. Studio plugins put their controls in one ⋯ menu at the
// end of that row instead: the first to arrive adds the button and its panel,
// and each portals into the panel. BB has no slot in that row, so plugins
// bundling different kit versions share it through the markup alone; a
// control stays in the composer's action row if the row isn't found.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MORE = "data-studio-composer-more";
const PANEL = "data-studio-composer-more-panel";
const ORDER = "data-studio-composer-more-order";
/** Marks a non-button row in the panel, so the ⋯ button shows for it. */
export const COMPOSER_MORE_ITEM = "data-studio-composer-more-item";
const POPPER = "[data-radix-popper-content-wrapper]";
const MENU_ITEM = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const GAP = 6;

const TRIGGER_CLASS = "inline-flex h-6 shrink-0 cursor-pointer items-center justify-center rounded-md px-1 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground aria-expanded:bg-state-active aria-expanded:text-foreground";
const PANEL_CLASS = "fixed z-50 flex min-w-52 max-w-80 flex-col gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md";
const DOTS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="19" cy="12" r="1.75"/></svg>';
// Chips laid out for a row read as menu rows in the panel.
const CSS = `
[${PANEL}][hidden] { display: none !important; }
[${PANEL}] button, [${PANEL}] [${COMPOSER_MORE_ITEM}] { display: flex !important; width: 100%; max-width: none; height: 28px; justify-content: flex-start; gap: 8px; padding: 0 8px; border-radius: 4px; font-size: var(--text-xs); }
[${PANEL}] button > span { max-width: none; }
[${PANEL}] button > svg[data-icon="ChevronDown"] { margin-left: auto; transform: rotate(-90deg); }
[${PANEL}] [${COMPOSER_MORE_ITEM}] { align-items: center; color: var(--muted-foreground); }
[${PANEL}] svg { width: 14px; height: 14px; flex: none; }
`;

/** The project, machine and branch group in the row under `anchor`'s composer. */
function footerGroup(anchor: HTMLElement): HTMLElement | null {
  const footer = anchor.closest("[data-promptbox]")?.nextElementSibling;
  return footer?.firstElementChild instanceof HTMLElement ? footer.firstElementChild : null;
}

let ids = 0;

/** The ⋯ panel for `group`, adding the button and panel when there's none. */
function morePanel(group: HTMLElement): HTMLElement {
  const existing = group.querySelector(`:scope > [${MORE}]`);
  const id = existing?.getAttribute("aria-controls");
  const found = id ? document.getElementById(id) : null;
  if (found) return found;
  existing?.remove();
  collectPanels();
  if (!document.querySelector(`style[${MORE}]`)) {
    const style = document.createElement("style");
    style.setAttribute(MORE, "");
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const trigger = document.createElement("button");
  const panel = document.createElement("div");
  panel.id = `studio-composer-more-${Date.now().toString(36)}-${++ids}`;
  trigger.type = "button";
  trigger.setAttribute(MORE, "");
  trigger.setAttribute("aria-label", "More options");
  trigger.setAttribute("title", "More options");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", panel.id);
  trigger.className = TRIGGER_CLASS;
  trigger.innerHTML = DOTS;
  trigger.hidden = true;
  panel.setAttribute(PANEL, "");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "More options");
  panel.className = PANEL_CLASS;
  panel.hidden = true;

  const open = () => !panel.hidden;
  const close = () => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const place = () => {
    const rect = trigger.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    // Above the row unless it doesn't fit there: a thread's composer sits at
    // the bottom of the window, a new thread's at the top.
    const above = rect.top - GAP - height >= 8 || rect.bottom + GAP + height > innerHeight;
    panel.style.top = `${above ? Math.max(8, rect.top - GAP - height) : rect.bottom + GAP}px`;
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
  };
  trigger.addEventListener("click", () => {
    if (open()) return close();
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    place();
    panel.querySelector<HTMLElement>("button")?.focus();
  });
  // Menus opened from the panel portal outside it; they stay part of it.
  const inside = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return !!element && (panel.contains(element) || trigger.contains(element) || !!element.closest(POPPER));
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!panel.isConnected) return detach();
    if (open() && !inside(event.target)) close();
  };
  const onClick = (event: MouseEvent) => {
    if (!panel.isConnected) return detach();
    // A pick in a menu opened from the panel is done with the panel too.
    if (open() && event.target instanceof Element && event.target.closest(MENU_ITEM)?.closest(POPPER)) setTimeout(close);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!panel.isConnected) return detach();
    if (event.key !== "Escape" || !open() || document.querySelector(POPPER)) return;
    close();
    trigger.focus();
  };
  const onResize = () => (open() ? close() : undefined);
  const detach = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    removeEventListener("resize", onResize);
    observer.disconnect();
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  addEventListener("resize", onResize);
  // The button shows while anything is in the panel. This watches the panel's
  // own `hidden`, so only write what changes or each write wakes it again.
  const observer = new MutationObserver(() => {
    const empty = !panel.querySelector(`button, [${COMPOSER_MORE_ITEM}]`);
    if (trigger.hidden !== empty) trigger.hidden = empty;
    if (open() && (empty || !trigger.isConnected)) close();
  });
  observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

  group.appendChild(trigger);
  document.body.appendChild(panel);
  return panel;
}

/** Drops empty panels whose button left with its composer. */
function collectPanels() {
  for (const panel of document.querySelectorAll<HTMLElement>(`[${PANEL}]`)) {
    if (!panel.firstElementChild && !document.querySelector(`[aria-controls="${panel.id}"]`)) panel.remove();
  }
}

/** Keeps `node` in the panel in `order`, after anything with a lower one. */
function insert(panel: HTMLElement, node: HTMLElement, order: number) {
  const next = [...panel.children].find((child) => child !== node && Number(child.getAttribute(ORDER)) > order);
  if (node.parentElement === panel && node.nextElementSibling === (next ?? null)) return;
  panel.insertBefore(node, next ?? null);
}

/**
 * Renders `children` in the ⋯ menu under the composer this is a composer
 * action of. Lower `order`s come first.
 */
export function ComposerMore({ pluginId, order, children }: { pluginId: string; order: number; children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const shell = anchor?.closest("[data-promptbox]")?.parentElement;
    if (!anchor || !shell) return;
    const host = document.createElement("span");
    host.style.display = "contents";
    host.setAttribute("data-bb-plugin", pluginId);
    host.setAttribute("data-bb-plugin-root", "");
    host.setAttribute(ORDER, String(order));
    // The footer can re-render or remount; keep the node in its panel.
    const place = () => {
      const group = footerGroup(anchor);
      if (group) insert(morePanel(group), host, order);
      else host.remove();
      setSlot(group ? host : null);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(shell, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      host.remove();
      collectPanels();
    };
  }, [anchor, pluginId, order]);
  return (
    <>
      <span ref={setAnchor} hidden />
      {slot ? createPortal(children, slot) : children}
    </>
  );
}

/**
 * A ref for a menu trigger and the side its menu opens on: beside the ⋯
 * panel when the trigger is in it, below it anywhere else.
 */
export function useComposerMoreSide(): [(node: HTMLElement | null) => void, "right" | "bottom"] {
  const [node, ref] = useState<HTMLElement | null>(null);
  return [ref, node?.closest(`[${PANEL}]`) ? "right" : "bottom"];
}
