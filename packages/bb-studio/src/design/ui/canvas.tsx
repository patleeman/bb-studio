// The design canvas: a surface you drag to pan and pinch (or ⌘/Ctrl-scroll)
// to zoom, like Claude Design's. Content is laid out at its real size and
// moved with one transform. Screens on it are live; gestures they don't use
// come back through `api` (see the screen script), and holding Space drags
// the canvas from anywhere, screens included.
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ICON_BUTTON, Icon, cn } from "@bb-studio/kit/app";

type View = { x: number; y: number; scale: number };

const MIN_SCALE = 0.05;
const MAX_SCALE = 2;
const FIT_PADDING = 64;
/** Room for the floating controls above the content when fitted. */
const FIT_TOP = 72;
const STEP = 1.25;
/** Largest wheel delta one zoom event uses: e^0.25, about one STEP. */
const WHEEL_ZOOM_CAP = 25;

const clamp = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** A small floating bar of canvas controls. */
const PILL_BAR = "pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border bg-background/90 p-0.5 shadow-sm backdrop-blur";

/** Moves the canvas from outside it: for gestures that start inside a screen. */
export type CanvasApi = {
  /** Applies a wheel gesture at a point in page coordinates. */
  wheel(gesture: { deltaX: number; deltaY: number; zoom: boolean; clientX: number; clientY: number }): void;
  /** Space pressed or released inside a screen. */
  setSpace(down: boolean): void;
};

/** Targets that use Space themselves: text fields and controls. */
const usesSpace = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("input, textarea, select, button, a, [role='button'], [contenteditable='true'], [contenteditable='']"));

export function Canvas({ children, leftTools, rightTools, fitKey, api }: {
  children: ReactNode;
  leftTools?: ReactNode;
  rightTools?: ReactNode;
  /** Refits when this changes, until the user has moved the view. */
  fitKey: string;
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
  /** Set once the user pans or zooms; after that, new content doesn't refit. */
  const moved = useRef(false);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const fit = useCallback(() => {
    const box = viewport.current?.getBoundingClientRect();
    const inner = content.current;
    if (!box || !inner || !box.width || !inner.offsetWidth) return;
    const scale = clamp(Math.min(1, (box.width - FIT_PADDING * 2) / inner.offsetWidth, (box.height - FIT_TOP - FIT_PADDING) / inner.offsetHeight));
    const width = inner.offsetWidth * scale;
    const height = inner.offsetHeight * scale;
    setView({ scale, x: Math.max(FIT_PADDING, (box.width - width) / 2), y: Math.max(FIT_TOP, (box.height - height) / 2) });
  }, []);

  // Fit on first layout and whenever the content changes, until the user takes over.
  useLayoutEffect(() => {
    if (!moved.current) fit();
  }, [fit, fitKey]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (!moved.current) fit(); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  /** Zooms by `factor`, keeping the canvas point under (px, py) in place. */
  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    moved.current = true;
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
    moved.current = true;
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

  // Space outside text fields: drag the canvas from anywhere.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || !hovered.current || usesSpace(event.target)) return;
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
      aria-label="Canvas: drag the background or hold Space to pan, pinch or hold ⌘ and scroll to zoom"
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
        moved.current = true;
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
          <button type="button" title="Zoom to fit" className="h-7 w-11 rounded text-center text-xs tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => { moved.current = false; fit(); }}>
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
