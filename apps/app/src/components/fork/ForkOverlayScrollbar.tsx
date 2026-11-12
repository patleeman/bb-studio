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

export function forkScrollThumbBox(
  scroller: Pick<
    HTMLElement,
    "scrollTop" | "scrollHeight" | "clientHeight" | "getBoundingClientRect"
  >,
  thumbWidth: number,
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
    left: rect.right - EDGE_INSET - thumbWidth,
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

  const hide = () => {
    thumb.removeAttribute("data-visible");
    current = null;
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
    const box = forkScrollThumbBox(scroller, thumb.offsetWidth || 6);
    if (box === null) {
      if (current === scroller) hide();
      return;
    }
    current = scroller;
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
