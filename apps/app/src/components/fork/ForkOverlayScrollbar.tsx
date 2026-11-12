import { useEffect } from "react";
import { FORK_CARDS_ATTRIBUTE } from "./ForkAppBackdrop";

export const FORK_OVERLAY_SCROLL_ATTRIBUTE = "data-fork-overlay-scroll";
export const FORK_SCROLL_THUMB_ATTRIBUTE = "data-fork-scroll-thumb";
export const FORK_OVERLAY_SCROLLERS = [
  "[data-page-scroll-viewport]",
  "[data-resource-collection-viewport]",
  `[${FORK_OVERLAY_SCROLL_ATTRIBUTE}]`,
  '[data-sidebar="inset"] .relative.h-full.overflow-hidden > .h-full.overflow-y-auto',
].join(", ");

const EDGE_INSET = 2;
const MIN_THUMB = 28;
const IDLE_MS = 900;

export interface ForkScrollThumbBox {
  top: number;
  left: number;
  height: number;
  travel: number;
  range: number;
}

const CARD = '[data-fork-card="main"]';
const PSEUDO_CARD_HOSTS =
  ".box-border.h-full.w-full, .relative.h-full.overflow-hidden";

export function forkScrollCardRight(scroller: HTMLElement): number {
  const edge = scroller.getBoundingClientRect().right;
  const card = scroller.querySelector(CARD) ?? scroller.closest(CARD);
  if (card !== null) return Math.min(edge, card.getBoundingClientRect().right);
  const view = scroller.ownerDocument.defaultView;
  if (view === null) return edge;
  for (const host of [
    scroller.firstElementChild,
    scroller.closest(PSEUDO_CARD_HOSTS),
  ]) {
    if (!(host instanceof HTMLElement)) continue;
    const backing = view.getComputedStyle(host, "::before");
    if (backing.content === "none" || backing.content === "normal") continue;
    const width = Number.parseFloat(backing.width);
    if (!Number.isFinite(width) || width <= 0) continue;
    const box = host.getBoundingClientRect();
    return Math.min(edge, box.left + (box.width + width) / 2);
  }
  return edge;
}

export function forkScrollThumbBox(
  scroller: Pick<
    HTMLElement,
    "scrollTop" | "scrollHeight" | "clientHeight" | "getBoundingClientRect"
  >,
  thumbWidth: number,
  right?: number,
): ForkScrollThumbBox | null {
  const range = scroller.scrollHeight - scroller.clientHeight;
  if (range <= 1 || scroller.clientHeight <= 0) return null;
  const rect = scroller.getBoundingClientRect();
  const track = rect.height - 2 * EDGE_INSET;
  if (track <= MIN_THUMB) return null;
  const height = Math.max(
    MIN_THUMB,
    Math.round((track * scroller.clientHeight) / scroller.scrollHeight),
  );
  const travel = track - height;
  const progress = Math.min(1, Math.max(0, scroller.scrollTop / range));
  return {
    top: rect.top + EDGE_INSET + travel * progress,
    left: (right ?? rect.right) - EDGE_INSET - thumbWidth,
    height,
    travel,
    range,
  };
}

function overlayScroller(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const scroller = target.closest(FORK_OVERLAY_SCROLLERS);
  return scroller instanceof HTMLElement ? scroller : null;
}

export function mountForkOverlayScrollbar(doc: Document): () => void {
  const view = doc.defaultView;
  if (view === null) return () => {};
  const thumb = doc.createElement("div");
  thumb.setAttribute(FORK_SCROLL_THUMB_ATTRIBUTE, "");
  thumb.setAttribute("aria-hidden", "true");
  doc.body.appendChild(thumb);
  let current: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let timer: number | null = null;
  let drag: { y: number; scrollTop: number; scale: number } | null = null;

  const resized =
    typeof view.ResizeObserver === "function"
      ? new view.ResizeObserver(() => {
          if (current === null) return;
          if (current.isConnected) show(current);
          else hide();
        })
      : null;
  const follow = (scroller: HTMLElement | null) => {
    if (scroller === current) return;
    resized?.disconnect();
    current = scroller;
    if (scroller !== null) resized?.observe(scroller);
  };
  const hide = () => {
    thumb.removeAttribute("data-visible");
    follow(null);
  };
  const idle = () => {
    if (timer !== null) view.clearTimeout(timer);
    timer = view.setTimeout(() => {
      timer = null;
      if (drag === null && (current === null || current !== hovered)) hide();
    }, IDLE_MS);
  };
  const show = (scroller: HTMLElement) => {
    if (!doc.documentElement.hasAttribute(FORK_CARDS_ATTRIBUTE)) return hide();
    const box = forkScrollThumbBox(
      scroller,
      thumb.offsetWidth || 6,
      forkScrollCardRight(scroller),
    );
    if (box === null) {
      if (current === scroller) hide();
      return;
    }
    follow(scroller);
    thumb.style.top = `${box.top}px`;
    thumb.style.left = `${box.left}px`;
    thumb.style.height = `${box.height}px`;
    thumb.setAttribute("data-visible", "");
    idle();
  };
  const onScroll = (event: Event) => {
    if (event.target instanceof HTMLElement) {
      if (event.target.matches(FORK_OVERLAY_SCROLLERS)) show(event.target);
      else if (current !== null && event.target.contains(current))
        show(current);
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (drag !== null && current !== null) {
      current.scrollTop =
        drag.scrollTop + (event.clientY - drag.y) * drag.scale;
      return;
    }
    if (event.target === thumb) return;
    const scroller = overlayScroller(event.target);
    if (scroller === hovered) return;
    hovered = scroller;
    if (scroller !== null) show(scroller);
    else idle();
  };
  const onPointerLeave = () => {
    hovered = null;
    idle();
  };
  const onThumbDown = (event: PointerEvent) => {
    if (current === null || event.button !== 0) return;
    const box = forkScrollThumbBox(current, thumb.offsetWidth || 6);
    if (box === null || box.travel <= 0) return;
    event.preventDefault();
    thumb.setPointerCapture(event.pointerId);
    thumb.setAttribute("data-dragging", "");
    drag = {
      y: event.clientY,
      scrollTop: current.scrollTop,
      scale: box.range / box.travel,
    };
  };
  const onThumbUp = () => {
    drag = null;
    thumb.removeAttribute("data-dragging");
    idle();
  };
  const onResize = () => {
    if (current !== null) show(current);
  };

  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  doc.addEventListener("pointermove", onPointerMove, { passive: true });
  doc.documentElement.addEventListener("pointerleave", onPointerLeave);
  thumb.addEventListener("pointerdown", onThumbDown);
  thumb.addEventListener("pointerup", onThumbUp);
  thumb.addEventListener("pointercancel", onThumbUp);
  view.addEventListener("resize", onResize);
  return () => {
    if (timer !== null) view.clearTimeout(timer);
    resized?.disconnect();
    doc.removeEventListener("scroll", onScroll, { capture: true });
    doc.removeEventListener("pointermove", onPointerMove);
    doc.documentElement.removeEventListener("pointerleave", onPointerLeave);
    view.removeEventListener("resize", onResize);
    thumb.remove();
  };
}

export function ForkOverlayScrollbarHost() {
  useEffect(() => mountForkOverlayScrollbar(document), []);
  return null;
}
