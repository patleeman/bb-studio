// The design canvas: a surface you drag to pan and pinch (or ⌘/Ctrl-scroll)
// to zoom, like Claude Design's. Content is laid out at its real size and
// moved with one transform. Screens on it are live; gestures they don't use
// come back through `api` (see the screen script), and holding Space drags
// the canvas from anywhere, screens included.
//
// It opens at 100% on the first section, or where the user last left this
// design (`viewKey`), remembered in this browser (canvas-view.ts).
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ICON_BUTTON, Icon, cn } from "../../kit/app/index";
import { isTypingTarget, keyInScope } from "../../ui/typing-target";
import { MAX_SCALE, MIN_SCALE, clampScale as clamp, firstSectionView, fitView, openingView, readSavedView, storeSavedView, type SavedView, type Size, type View, type ViewMode } from "./canvas-view";

const STEP = 1.25;
/** Largest wheel delta one zoom event uses: e^0.25, about one STEP. */
const WHEEL_ZOOM_CAP = 25;
/** How long the view rests before it is remembered. */
const SAVE_DELAY_MS = 300;

/** A small floating bar of canvas controls. */
const PILL_BAR = "pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border bg-background/90 p-0.5 shadow-sm backdrop-blur";

/** Moves the canvas from outside it: for gestures that start inside a screen. */
export type CanvasApi = {
  /** Applies a wheel gesture at a point in page coordinates. */
  wheel(gesture: { deltaX: number; deltaY: number; zoom: boolean; clientX: number; clientY: number }): void;
  /** Space pressed or released inside a screen. */
  setSpace(down: boolean): void;
};

/** Targets that use Space themselves: controls. Text fields are `isTypingTarget`. */
const usesSpace = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("button, a, [role='button'], [role='checkbox'], [role='switch'], [role='menuitem'], [role='option'], [role='tab']"));

export function Canvas({ children, leftTools, rightTools, fitKey, viewKey, api }: {
  children: ReactNode;
  leftTools?: ReactNode;
  rightTools?: ReactNode;
  /** The board's shape: the view is placed again when this changes, until the user has moved it. */
  fitKey: string;
  /** Remembers the zoom and position under this key (a design's id) and opens there next time. */
  viewKey?: string;
  api?: Ref<CanvasApi>;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  /** Space held: the whole canvas, screens included, drags. */
  const [space, setSpace] = useState(false);
  /** Space only pans while the pointer is over the canvas, so it never steals keys elsewhere in BB. */
  const hovered = useRef(false);
  /** How new content or a resized viewport moves the view; "user" once the user pans or zooms. */
  const mode = useRef<ViewMode>("first");
  /** The `viewKey` the view was opened for: its remembered view has been applied. */
  const opened = useRef<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  /** The viewport's and the content's sizes, or null before they are laid out. */
  const measure = useCallback((): { box: Size; inner: Size } | null => {
    const box = viewport.current?.getBoundingClientRect();
    const inner = content.current;
    if (!box || !inner || !box.width || !inner.offsetWidth) return null;
    return { box: { width: box.width, height: box.height }, inner: { width: inner.offsetWidth, height: inner.offsetHeight } };
  }, []);

  /** Places the view for its mode: the first section at 100%, or everything in view. */
  const place = useCallback(() => {
    const sizes = measure();
    if (!sizes || mode.current === "user") return;
    setView(mode.current === "fit" ? fitView(sizes.box, sizes.inner) : firstSectionView(sizes.box, sizes.inner));
  }, [measure]);

  const fit = useCallback(() => {
    mode.current = "fit";
    place();
  }, [place]);

  /** 100% on the first section, as a choice the user made. */
  const actualSize = useCallback(() => {
    const sizes = measure();
    if (!sizes) return;
    mode.current = "user";
    setView(firstSectionView(sizes.box, sizes.inner));
  }, [measure]);

  /**
   * Opens where this design was left (or at 100% on its first section), then
   * places the view again when the content or viewport changes, until the user takes over.
   */
  const arrange = useCallback(() => {
    const key = viewKey ?? "";
    if (opened.current === key) return place();
    const sizes = measure();
    if (!sizes) return;
    const opening = openingView(viewKey ? readSavedView(viewKey) : undefined, fitKey, sizes.box, sizes.inner);
    opened.current = key;
    mode.current = opening.mode;
    setView(opening.view);
  }, [measure, place, fitKey, viewKey]);
  useLayoutEffect(() => arrange(), [arrange]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => arrange());
    observer.observe(element);
    return () => observer.disconnect();
  }, [arrange]);

  // Remember the view once it rests, but only one the user chose: a design
  // nobody has moved keeps opening at 100% on its first section.
  const pending = useRef<{ id: string; saved: SavedView } | null>(null);
  const flush = useCallback(() => {
    if (pending.current) storeSavedView(pending.current.id, pending.current.saved);
    pending.current = null;
  }, []);
  useEffect(() => {
    if (!viewKey || opened.current !== viewKey || mode.current === "first") return;
    if (pending.current && pending.current.id !== viewKey) flush();
    pending.current = { id: viewKey, saved: { ...view, fit: mode.current === "fit", layout: fitKey, at: Date.now() } };
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [view, viewKey, fitKey, flush]);
  useEffect(() => flush, [flush]);

  /** Zooms by `factor`, keeping the canvas point under (px, py) in place. */
  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    mode.current = "user";
    setView((current) => {
      const scale = clamp(current.scale * factor);
      const ratio = scale / current.scale;
      return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
  }, []);

  /** Pinch and ⌘/Ctrl-scroll zoom around the pointer; plain scroll pans. */
  const wheel = useCallback((gesture: { deltaX: number; deltaY: number; zoom: boolean; clientX: number; clientY: number }) => {
    const box = viewport.current?.getBoundingClientRect();
    if (!box) return;
    if (gesture.zoom) {
      // Pinches send small deltas; a mouse wheel's ~100 per notch is capped to one gentle step.
      const delta = Math.max(-WHEEL_ZOOM_CAP, Math.min(WHEEL_ZOOM_CAP, gesture.deltaY));
      zoomAt(Math.exp(-delta * 0.01), gesture.clientX - box.left, gesture.clientY - box.top);
      return;
    }
    mode.current = "user";
    setView((current) => ({ ...current, x: current.x - gesture.deltaX, y: current.y - gesture.deltaY }));
  }, [zoomAt]);

  useImperativeHandle(api, () => ({ wheel, setSpace }), [wheel]);

  // Non-passive so the page doesn't scroll.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheel({ deltaX: event.deltaX, deltaY: event.deltaY, zoom: event.ctrlKey || event.metaKey, clientX: event.clientX, clientY: event.clientY });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [wheel]);

  // Space outside text fields: drag the canvas from anywhere. Only with focus
  // on the canvas or on nothing, so it never eats a space typed elsewhere in BB.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || !hovered.current) return;
      if (isTypingTarget(event) || usesSpace(event.target) || !keyInScope(event.target, viewport.current)) return;
      event.preventDefault();
      setSpace(true);
    };
    const up = (event: KeyboardEvent) => { if (event.code === "Space") setSpace(false); };
    const blur = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  function zoomCentered(factor: number) {
    const box = viewport.current?.getBoundingClientRect();
    if (box) zoomAt(factor, box.width / 2, box.height / 2);
  }

  return (
    <div
      ref={viewport}
      aria-label="Canvas"
      className={cn("relative h-full touch-none select-none overflow-hidden bg-background", dragging ? "cursor-grabbing" : space ? "cursor-grab" : "cursor-default")}
      onPointerEnter={() => { hovered.current = true; }}
      onPointerLeave={() => { hovered.current = false; }}
      onPointerDown={(event) => {
        if (event.button !== 0 && event.button !== 1) return;
        if ((event.target as HTMLElement).closest("a, button, input")) return;
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        drag.current = { ...start, x: event.clientX, y: event.clientY };
        mode.current = "user";
        setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <div
        ref={content}
        className="absolute left-0 top-0 w-max origin-top-left will-change-transform"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {children}
      </div>
      {/* Over the screens while dragging or with Space held, so a drag never falls into one. */}
      {dragging || space ? <div aria-hidden className="absolute inset-0 z-[5]" /> : null}

      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
        <div className={PILL_BAR}>{leftTools}</div>
        <div className={PILL_BAR}>
          {rightTools}
          {rightTools ? <span aria-hidden className="mx-0.5 h-4 w-px bg-border" /> : null}
          <button type="button" aria-label="Zoom out" title="Zoom out" className={ICON_BUTTON} disabled={view.scale <= MIN_SCALE} onClick={() => zoomCentered(1 / STEP)}>
            <Icon name="Minus" className="size-4" />
          </button>
          {/* Fit is a choice: once fitted, the same control goes back to 100% on the first section. */}
          <button type="button" title={mode.current === "fit" ? "Zoom to 100%" : "Zoom to fit"} className="h-7 w-11 rounded text-center text-xs tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => (mode.current === "fit" ? actualSize() : fit())}>
            {Math.round(view.scale * 100)}%
          </button>
          <button type="button" aria-label="Zoom in" title="Zoom in" className={ICON_BUTTON} disabled={view.scale >= MAX_SCALE} onClick={() => zoomCentered(STEP)}>
            <Icon name="Plus" className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
