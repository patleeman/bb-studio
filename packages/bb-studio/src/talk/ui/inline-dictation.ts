import { useLayoutEffect, useState } from "react";
import { BUILT_IN_MIC_SELECTOR } from "./composer-dom";
import { talk } from "./controller";
import { FIELD_ATTR, FIELD_DOCK_ATTR, findField } from "./fields";

// Dictation docks into the input it types into: BB's composer (beside its
// mic), or another plugin's dictation field that offers a dock
// (`data-talk-field-dock`, fields.ts). Anywhere else, or off screen, the
// floating recorder shows instead.
//
// While dictation is docked, the composer keeps one row at every width. The
// dock reads the composer's own width (not the window's): below
// COMPACT_BELOW, Talk's less-used controls and the composer's other actions
// (expand, hands-free…) move into the pill's ▾ menu ("tucked"); below
// TIGHT_BELOW the level meter goes too. Only when even that can't fit does the
// row wrap.
const CSS = `
[data-talk-inline-mic] { display: none !important; }
[data-talk-inline-tucked] { display: none !important; }
[data-talk-inline-row] { flex-wrap: wrap; }
[data-talk-inline-row][data-talk-inline-narrow] { position: relative !important; inset: auto !important; }
[data-talk-inline-narrow] [data-talk-inline-actions] { min-width: 0; margin-left: auto; flex-wrap: nowrap; }
[data-talk-inline-host] { display: flex; min-width: 0; max-width: 100%; }
`;

export const COMPACT_BELOW = 640;
export const TIGHT_BELOW = 440;
export const LAYOUT_EVENT = "bb-talk:inline-layout";

/** wide: every control shows. compact: the ▾ menu holds the rest. tight: no meter either. */
export type DockLayout = "wide" | "compact" | "tight";

/** A composer action hidden while the dock is compact; the ▾ menu clicks it. */
export interface TuckedAction {
  label: string;
  button: HTMLButtonElement;
}

export function dockLayout(width: number): DockLayout {
  return width < TIGHT_BELOW ? "tight" : width < COMPACT_BELOW ? "compact" : "wide";
}

const layouts = new WeakMap<HTMLElement, { layout: DockLayout; tucked: TuckedAction[] }>();

/** The dock's current layout, kept on its host element. */
export function readDockLayout(host: HTMLElement | null): { layout: DockLayout; tucked: TuckedAction[] } {
  return (host && layouts.get(host)) ?? { layout: "wide", tucked: [] };
}

function buttonLabel(button: HTMLButtonElement): string {
  return (button.getAttribute("aria-label") || button.title || button.textContent || "").trim();
}

const HIDDEN = '[hidden], [inert], [aria-hidden="true"]';

/** Whether the element is laid out, inside the viewport, and not clipped by a scrolling or clipping ancestor. */
function onScreen(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.bottom > innerHeight || rect.left < 0 || rect.right > innerWidth) return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/hidden|clip|auto|scroll/.test(style.overflowX || style.overflow) && (rect.left < bounds.left || rect.right > bounds.right)) return false;
    if (/hidden|clip|auto|scroll/.test(style.overflowY || style.overflow) && (rect.top < bounds.top || rect.bottom > bounds.bottom)) return false;
  }
  return true;
}

/** Dock only into the source input, and only while its controls are on screen. */
export function inlineMic(composer: HTMLElement | null): HTMLButtonElement | null {
  if (!composer?.isConnected || composer.closest(HIDDEN)) return null;
  const mic = composer.querySelector<HTMLButtonElement>(BUILT_IN_MIC_SELECTOR);
  if (!mic || mic.closest(HIDDEN)) return null;
  const anchor = mic.hasAttribute("data-talk-inline-mic") ? mic.parentElement?.querySelector<HTMLElement>("[data-talk-inline-host]") : mic;
  return anchor && onScreen(anchor) ? mic : null;
}

/** A dictation field's dock, while the field is on screen. */
export function fieldDock(key: string): HTMLElement | null {
  const field = findField(key);
  if (!field || field.closest(HIDDEN)) return null;
  const dock = field.querySelector<HTMLElement>(`[${FIELD_DOCK_ATTR}]`);
  if (!dock || dock.closest(HIDDEN)) return null;
  return onScreen(field) ? dock : null;
}

function dockHost(): HTMLSpanElement {
  const host = document.createElement("span");
  host.setAttribute("data-talk-inline-host", "");
  host.setAttribute("data-bb-plugin", "studio");
  host.setAttribute("data-bb-plugin-root", "");
  return host;
}

/** Talk's controls inside a field's dock, sized by the field's width. */
export function mountFieldDock(dock: HTMLElement) {
  const field = dock.closest<HTMLElement>(`[${FIELD_ATTR}]`) ?? dock;
  const host = dockHost();
  dock.append(host);
  let current: DockLayout | null = null;
  const layout = () => {
    const next = dockLayout(field.getBoundingClientRect().width);
    layouts.set(host, { layout: next, tucked: [] });
    if (next === current) return;
    current = next;
    host.setAttribute("data-talk-inline-layout", next);
    host.dispatchEvent(new CustomEvent(LAYOUT_EVENT));
  };
  layout();
  const observer = new ResizeObserver(layout);
  observer.observe(field);
  return {
    anchor: dock as Element, host,
    remove: () => {
      observer.disconnect();
      host.remove();
    },
  };
}

/** A portal beside the mic; removing it restores the native toolbar exactly. */
export function mountInlineDock(mic: HTMLButtonElement) {
  const parent = mic.parentElement!;
  const actions = mic.closest<HTMLElement>("[data-promptbox-standard-actions]") ?? parent;
  const row = mic.closest<HTMLElement>("[data-promptbox-action-row]") ?? actions.parentElement!;
  const composer = mic.closest<HTMLElement>("[data-promptbox]")!;
  const host = dockHost();
  parent.insertBefore(host, mic);
  mic.setAttribute("data-talk-inline-mic", "");
  actions.setAttribute("data-talk-inline-actions", "");
  row.setAttribute("data-talk-inline-row", "");
  // The dock, the mic and the send controls stay; any other action tucks away.
  const stays = (child: Element) =>
    child.contains(host) || child.contains(mic) || child.matches("[data-promptbox-submit-group]") || !!child.querySelector('[data-promptbox-submit-action], [type="submit"]');
  let current = "";
  const layout = () => {
    const next = dockLayout(composer.getBoundingClientRect().width);
    row.toggleAttribute("data-talk-inline-narrow", next !== "wide");
    const tucked: TuckedAction[] = [];
    for (const child of Array.from(actions.children)) {
      const tuck = next !== "wide" && !stays(child);
      if (child.hasAttribute("data-talk-inline-tucked") !== tuck) child.toggleAttribute("data-talk-inline-tucked", tuck);
      if (!tuck) continue;
      const buttons = child instanceof HTMLButtonElement ? [child] : Array.from(child.querySelectorAll("button"));
      for (const button of buttons) {
        const label = buttonLabel(button);
        if (label && !button.closest("[hidden]")) tucked.push({ label, button });
      }
    }
    const key = `${next}\n${tucked.map((action) => action.label).join("\n")}`;
    layouts.set(host, { layout: next, tucked });
    if (key === current) return;
    current = key;
    host.setAttribute("data-talk-inline-layout", next);
    host.dispatchEvent(new CustomEvent(LAYOUT_EVENT));
  };
  layout();
  const observer = new ResizeObserver(layout);
  observer.observe(composer);
  // The composer adds and removes its own actions (expand, plugin buttons).
  const children = new MutationObserver(layout);
  children.observe(actions, { childList: true });
  return {
    mic, anchor: mic as Element, host,
    remove: () => {
      observer.disconnect();
      children.disconnect();
      host.remove();
      for (const child of Array.from(actions.children)) child.removeAttribute("data-talk-inline-tucked");
      mic.removeAttribute("data-talk-inline-mic");
      actions.removeAttribute("data-talk-inline-actions");
      row.removeAttribute("data-talk-inline-row");
      row.removeAttribute("data-talk-inline-narrow");
    },
  };
}

/** The docked pill's layout: it follows the composer's width, not the window's. */
export function useDockLayout(host: HTMLElement | null): { layout: DockLayout; tucked: TuckedAction[] } {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => {
    if (!host) return;
    const update = () => setVersion((value) => value + 1);
    host.addEventListener(LAYOUT_EVENT, update);
    update();
    return () => host.removeEventListener(LAYOUT_EVENT, update);
  }, [host]);
  return readDockLayout(host);
}

/** Follow navigation, input remounts, scroll visibility, and toolbar changes. */
export function useInlineDictation(enabled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    let dock: { anchor: Element; host: HTMLElement; remove(): void } | null = null;
    const sync = () => {
      const field = talk.getState().field;
      const anchor = field ? fieldDock(field.key) : inlineMic(talk.dictationComposer());
      if (anchor === dock?.anchor && dock.host.isConnected) return;
      dock?.remove();
      dock = !anchor ? null : field ? mountFieldDock(anchor) : mountInlineDock(anchor as HTMLButtonElement);
      setSlot(dock?.host ?? null);
    };
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    // Attribute changes may hide a pane without unmounting it. Keep this
    // separate from the meter's per-frame style updates.
    const timer = window.setInterval(sync, 500);
    const unsubscribe = talk.subscribe(schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    sync();
    return () => {
      observer.disconnect();
      clearInterval(timer);
      cancelAnimationFrame(frame);
      unsubscribe();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      dock?.remove();
      style.remove();
      setSlot(null);
    };
  }, [enabled]);
  return enabled ? slot : null;
}
