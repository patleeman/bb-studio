// Lets the recording pill be dragged anywhere in the window. Its position is
// kept as a fraction of the free space on each axis, so it stays in the same
// corner through window resizes and reloads, and can never end up off screen.
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const STORAGE_KEY = "bb-plugin-talk:pill-position";
const MARGIN = 8;
/** Movement below this is a click, not a drag. */
const DRAG_THRESHOLD = 4;

export interface Fraction {
  x: number;
  y: number;
}

/** Top center, where the pill starts. */
const DEFAULT_POSITION: Fraction = { x: 0.5, y: 0 };

export interface Bounds {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** The free space the pill can move within, as [left, top, width, height]. */
function freeSpace(bounds: Bounds, size: { width: number; height: number }): [number, number, number, number] {
  const top = bounds.insetTop + MARGIN;
  return [
    MARGIN,
    top,
    Math.max(0, bounds.width - size.width - 2 * MARGIN),
    Math.max(0, bounds.height - bounds.insetBottom - MARGIN - size.height - top),
  ];
}

export function toPixels(position: Fraction, bounds: Bounds, size: { width: number; height: number }) {
  const [left, top, width, height] = freeSpace(bounds, size);
  return { left: left + clamp01(position.x) * width, top: top + clamp01(position.y) * height };
}

export function toFraction(pixels: { left: number; top: number }, bounds: Bounds, size: { width: number; height: number }): Fraction {
  const [left, top, width, height] = freeSpace(bounds, size);
  return {
    x: width === 0 ? 0.5 : clamp01((pixels.left - left) / width),
    y: height === 0 ? 0 : clamp01((pixels.top - top) / height),
  };
}

function loadPosition(): Fraction {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Fraction> | null;
    if (typeof parsed?.x === "number" && typeof parsed.y === "number") {
      return { x: clamp01(parsed.x), y: clamp01(parsed.y) };
    }
  } catch {
    // A corrupt entry falls back to the default.
  }
  return DEFAULT_POSITION;
}

function viewportBounds(): Bounds {
  // env() is only readable through layout, so measure it with a probe.
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const bounds = {
    width: window.innerWidth,
    height: window.innerHeight,
    insetTop: parseFloat(style.paddingTop) || 0,
    insetBottom: parseFloat(style.paddingBottom) || 0,
  };
  probe.remove();
  return bounds;
}

/**
 * Positions an element with `position: fixed` and makes `handleProps`' owner
 * drag it. A press that moves less than a few pixels stays a normal click, so
 * buttons inside the handle keep working; the click that ends a drag is
 * swallowed.
 */
export function useDraggable<T extends HTMLElement>() {
  // A callback ref, so the pill is placed whenever it (re)mounts.
  const [element, ref] = useState<T | null>(null);
  const [position, setPosition] = useState(loadPosition);
  const [pixels, setPixels] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    if (!element || dragging) return;
    const update = () => setPixels(toPixels(position, viewportBounds(), element.getBoundingClientRect()));
    update();
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [element, dragging, position]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (!element || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const start = { x: event.clientX, y: event.clientY };
    const rect = element.getBoundingClientRect();
    const bounds = viewportBounds();
    let moved = false;
    let last = { left: rect.left, top: rect.top };
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        setDragging(true);
      }
      move.preventDefault();
      // Clamp through the fraction so the pill cannot leave the window.
      const fraction = toFraction({ left: rect.left + dx, top: rect.top + dy }, bounds, rect);
      last = toPixels(fraction, bounds, rect);
      setPixels(last);
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (!moved) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const next = toFraction(last, bounds, rect);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Unsaved positions still apply for this page.
      }
      setPosition(next);
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }, [element]);

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const style: CSSProperties = pixels
    ? { position: "fixed", left: pixels.left, top: pixels.top }
    : { position: "fixed", left: 0, top: 0, visibility: "hidden" };
  return { ref, style, dragging, handleProps: { onPointerDown, onClickCapture } };
}
