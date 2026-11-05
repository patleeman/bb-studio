// The quick card: a floating Visual Chat over whatever page is open, for a
// quick question. It's the canvas page in a compact card (the same board,
// streaming, morphs and pictures, and the same chat line), bottom right by
// default, dragged by its header and resized from any edge; each window
// remembers where it was (quick-geometry.ts). A non-modal dialog: focus
// goes to the field on open and back where it was on close, and Esc closes
// it from inside unless there's a draft in the field or dictation is on.
// Loaded from the prebuilt bundle on the first summon (src/quick-app.tsx).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { openAppPath } from "./studio";
import { CanvasPage, type CardProps } from "./route";
import { COMPOSER_SELECTOR, geometryOf, loadGeometry, movedRect, placeCard, resizedRect, saveGeometry, type Edge, type Rect, type Viewport } from "./quick-geometry";
import type { QuickStore } from "./quick-store";

const readViewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

/** The resize handles: four edges, then four corners. */
const HANDLES: { edge: Edge; className: string }[] = [
  { edge: { x: -1, y: 0 }, className: "inset-y-3 left-0 w-1.5 cursor-ew-resize" },
  { edge: { x: 1, y: 0 }, className: "inset-y-3 right-0 w-1.5 cursor-ew-resize" },
  { edge: { x: 0, y: -1 }, className: "inset-x-3 top-0 h-1.5 cursor-ns-resize" },
  { edge: { x: 0, y: 1 }, className: "inset-x-3 bottom-0 h-1.5 cursor-ns-resize" },
  { edge: { x: -1, y: -1 }, className: "left-0 top-0 size-3 cursor-nwse-resize" },
  { edge: { x: 1, y: 1 }, className: "bottom-0 right-0 size-3 cursor-nwse-resize" },
  { edge: { x: 1, y: -1 }, className: "right-0 top-0 size-3 cursor-nesw-resize" },
  { edge: { x: -1, y: 1 }, className: "bottom-0 left-0 size-3 cursor-nesw-resize" },
];

const sameRects = (a: readonly Rect[], b: readonly Rect[]) => a.length === b.length && a.every((each, i) => each.left === b[i]!.left && each.top === b[i]!.top && each.width === b[i]!.width && each.height === b[i]!.height);

/**
 * BB's composers on screen, measured (read-only) while the card sits in its
 * default place, so it stays above them as they grow, shrink or come and go.
 */
function useComposerRects(enabled: boolean): Rect[] {
  const [rects, setRects] = useState<Rect[]>([]);
  // Measured before the card first paints, so it never shows over the composer and then jumps.
  useLayoutEffect(() => {
    if (!enabled) return;
    const observer = new ResizeObserver(() => measure());
    let watched: Element[] = [];
    function measure() {
      const found = [...document.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR)].filter((each) => !each.closest("[data-canvas-card]"));
      if (found.length !== watched.length || found.some((each, i) => each !== watched[i])) {
        observer.disconnect();
        for (const each of found) observer.observe(each);
        watched = found;
      }
      const next = found.map((each) => {
        const r = each.getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      }).filter((each) => each.width > 0 && each.height > 0);
      setRects((now) => (sameRects(now, next) ? now : next));
    }
    measure();
    // A composer can mount or unmount under the card (another page opens): look again now and then.
    const timer = window.setInterval(measure, 1000);
    window.addEventListener("resize", measure);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", measure); observer.disconnect(); };
  }, [enabled]);
  return rects;
}

/** Movement below this is a click, not a drag. */
const DRAG_THRESHOLD = 3;

export function QuickCard({ store, threadId }: { store: QuickStore; threadId: string | null }) {
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [viewport, setViewport] = useState(readViewport);
  // null until the user moves or resizes it: then it sits in its default place, clear of every composer.
  const [geometry, setGeometry] = useState(loadGeometry);
  const composers = useComposerRects(geometry === null);
  // While dragging or resizing: the rectangle under the pointer.
  const [moving, setMoving] = useState<Rect | null>(null);
  const placed = placeCard(geometry, viewport, composers);
  const rect = moving ?? placed;
  const shown = useRef(placed);
  shown.current = placed;

  // Kept on screen as the window changes size.
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Focus goes into the field on open (the field's autoFocus does it once it mounts; this covers a late mount).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const card = root.current;
      if (card && !card.contains(document.activeElement)) card.querySelector<HTMLInputElement>("[data-canvas-input]")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [threadId]);

  /** Follows the pointer from `start` until it's released, then keeps the result. */
  const track = useCallback((event: ReactPointerEvent<HTMLElement>, next: (start: Rect, dx: number, dy: number, viewport: Viewport) => Rect, sized: boolean) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const start = shown.current;
    const origin = { x: event.clientX, y: event.clientY };
    let last: Rect | null = null;
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - origin.x;
      const dy = move.clientY - origin.y;
      if (!last && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      move.preventDefault();
      last = next(start, dx, dy, readViewport());
      setMoving(last);
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (!last) return;
      const kept = geometryOf(last, readViewport(), sized || (geometry?.width ?? null) !== null);
      saveGeometry(kept);
      setGeometry(kept);
      setMoving(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }, [geometry]);

  const onDragStart = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // The header's buttons stay buttons.
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    track(event, movedRect, false);
  }, [track]);

  const onEscape = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    // Dictating into the card: Esc is Talk's.
    const html = document.documentElement;
    if (html.dataset.bbTalk === "dictating" && html.dataset.bbTalkField?.startsWith("canvas-quick:")) return;
    // Esc from inside the card is the card's, never BB's back.
    event.preventDefault();
    event.stopPropagation();
    // A draft in the field stays: Esc never throws words away.
    const field = root.current?.querySelector<HTMLInputElement>("[data-canvas-input]");
    if (field && field.value.trim() !== "") return;
    store.close();
  };

  const card: CardProps = useMemo(() => ({
    onThread: (next) => store.setThread(next),
    onClose: () => store.close(),
    onExpand: () => { store.expand((path) => openAppPath(path)); },
    onDragStart,
    titleId,
  }), [store, onDragStart, titleId]);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed z-[55] flex flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onKeyDown={onEscape}
      data-canvas-card
      data-moving={moving ? "" : undefined}
      data-thread={threadId ?? "new"}
    >
      <div className="absolute inset-0">
        <CanvasPage key={threadId ?? "new"} threadId={threadId} card={card} />
      </div>
      {HANDLES.map(({ edge, className }) => (
        <div key={`${edge.x},${edge.y}`} aria-hidden className={`absolute z-30 touch-none ${className}`} onPointerDown={(event) => { event.preventDefault(); track(event, (start, dx, dy, view) => resizedRect(start, edge, dx, dy, view), true); }} data-canvas-card-resize={`${edge.x},${edge.y}`} />
      ))}
    </div>
  );
}
