// A whiteboard in a page: shown as SVG, with a pen and an eraser for quick
// sketches. Strokes are saved as Excalidraw elements, so "Open full size"
// shows them in the full editor. The bottom handle sets its height in this
// page, saved on the page's embed block.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { errorMessage } from "../../kit/format";
import { Icon } from "../../kit/ui/index";
import { cn } from "../../kit/ui/index";
import { WHITEBOARD_COLORS, type WhiteboardStroke, type WhiteboardView } from "../whiteboard";
import { usePagesUi } from "./context";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { DRAWING_UPDATE_TYPE, REALTIME_CHANNEL } from "../../draw/shared";

type Tool = "pen" | "eraser";
const EMPTY_VIEWBOX: [number, number, number, number] = [0, 0, 800, 360];
export const WHITEBOARD_HEIGHT = { default: 320, min: 160, max: 1200, step: 40 } as const;
const clampHeight = (value: number) => Math.round(Math.min(WHITEBOARD_HEIGHT.max, Math.max(WHITEBOARD_HEIGHT.min, value)));
/** A fallback: edits arrive live over realtime; the poll catches a missed signal. */
const POLL_MS = 15_000;
const SAVE_DELAY_MS = 350;

/** Asked by a newly made whiteboard so it opens ready to draw. */
const startInEditMode = new Set<string>();
export function editWhiteboardWhenShown(id: string) {
  startInEditMode.add(id);
}

export function Whiteboard({ id, onOpen, height: saved, onResize }: {
  id: string;
  onOpen(): void;
  /** Its height in this page; 0 or absent is the default. */
  height?: number;
  /** Saves a new height on the page's block; absent when the page is read-only. */
  onResize?: (height: number) => void;
}) {
  const ui = usePagesUi();
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const height = dragHeight ?? (saved ? clampHeight(saved) : WHITEBOARD_HEIGHT.default);
  const [boxWidth, setBoxWidth] = useState(800);
  const [view, setView] = useState<WhiteboardView | null | undefined>(undefined);
  const [editing, setEditing] = useState(() => startInEditMode.delete(id));
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(WHITEBOARD_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  // While editing, the frame stays put so strokes land where they're drawn.
  const [frame, setFrame] = useState<[number, number, number, number] | null>(null);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [pending, setPending] = useState<WhiteboardStroke[]>([]);
  const [erased, setErased] = useState<Set<string>>(new Set());
  const queue = useRef<{ add: WhiteboardStroke[]; erase: string[] }>({ add: [], erase: [] });
  const failedBatch = useRef<{ add: WhiteboardStroke[]; erase: string[] } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const svg = useRef<SVGSVGElement | null>(null);

  const load = useCallback(() => {
    ui.whiteboard(id).then(setView, (cause) => {
      setView((current) => current ?? null);
      setError(errorMessage(cause));
    });
  }, [ui, id]);
  useEffect(load, [load]);
  // Live: an agent, the CLI, or the full editor saved this whiteboard. A stroke on its way waits for its own save.
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; drawingId?: string };
    if (event.type !== DRAWING_UPDATE_TYPE || event.drawingId !== id) return;
    if (!saving.current && !failedBatch.current && !queue.current.add.length && !queue.current.erase.length) load();
  });
  // Picks up edits made full size or by agents if a realtime signal was missed, unless a stroke is on its way.
  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && !saving.current && !failedBatch.current && !queue.current.add.length && !queue.current.erase.length) load();
    }, POLL_MS);
    // Coming back from the full-size editor (another tab, or this window) shows its edits at once.
    const refresh = () => {
      if (document.visibilityState === "visible" && !saving.current && !queue.current.add.length && !queue.current.erase.length) load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  // The frame follows the box's shape, so a taller whiteboard gives more room to draw.
  useEffect(() => {
    const element = svg.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setBoxWidth(Math.max(1, Math.round(entry.contentRect.width))); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [view === null]);
  const ratio = boxWidth / height;
  // While sketching, the frame is fixed (so strokes land where they're drawn) and only reshaped around its centre when resized.
  const viewBox = (editing && frame ? fitWide(frame, ratio) : null) ?? view?.viewBox ?? EMPTY_VIEWBOX;

  const flush = useCallback(async () => {
    timer.current = null;
    if (saving.current || failedBatch.current) return;
    const batch = queue.current;
    if (!batch.add.length && !batch.erase.length) return;
    queue.current = { add: [], erase: [] };
    saving.current = true;
    try {
      const next = await ui.saveWhiteboard({ id, add: batch.add, erase: batch.erase });
      setView(next);
      setPending((current) => current.filter((stroke) => !batch.add.includes(stroke)));
      setErased((current) => new Set([...current].filter((each) => !batch.erase.includes(each))));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
      failedBatch.current = batch;
      setSaveFailed(true);
    } finally {
      saving.current = false;
      if (!failedBatch.current && (queue.current.add.length || queue.current.erase.length)) void flush();
    }
  }, [ui, id]);
  const retry = useCallback(() => {
    const failed = failedBatch.current;
    if (!failed) return;
    failedBatch.current = null;
    setSaveFailed(false);
    queue.current = {
      add: [...failed.add, ...queue.current.add],
      erase: [...failed.erase, ...queue.current.erase],
    };
    void flush();
  }, [flush]);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      void flush();
    }
  }, [flush]);


  const startEditing = () => {
    setFrame(view?.viewBox ?? EMPTY_VIEWBOX);
    setEditing(true);
  };
  useEffect(() => {
    if (editing && !frame && view !== undefined) setFrame(view?.viewBox ?? EMPTY_VIEWBOX);
  }, [editing, frame, view]);


  const point = (event: ReactPointerEvent): [number, number] | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!svg.current || !matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  };
  const eraseAt = (event: ReactPointerEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("g[data-id]");
    const elementId = target?.getAttribute("data-id");
    if (!elementId || erased.has(elementId) || !svg.current?.contains(target!)) return;
    setErased((current) => new Set(current).add(elementId));
    queue.current.erase.push(elementId);
    schedule();
  };
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!editing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "eraser") return eraseAt(event);
    const p = point(event);
    if (p) setDrawing([p]);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!editing || !(event.buttons & 1)) return;
    event.stopPropagation();
    if (tool === "eraser") return eraseAt(event);
    const p = point(event);
    if (p) setDrawing((current) => (current ? [...current, p] : current));
  };
  const onPointerUp = () => {
    if (!drawing) return;
    const stroke: WhiteboardStroke = {
      id: `pg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      points: drawing.slice(0, 5000), color: color as WhiteboardStroke["color"], width: 2,
    };
    setDrawing(null);
    setPending((current) => [...current, stroke]);
    queue.current.add.push(stroke);
    schedule();
  };
  const undo = () => {
    // Only strokes not yet sent can be taken back here; Draw has full history.
    const last = queue.current.add.pop();
    if (last) setPending((current) => current.filter((stroke) => stroke !== last));
  };

  if (view === null) {
    return <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{error ?? "This whiteboard was deleted."}</p>;
  }
  const hidden = [...erased].map((each) => `g[data-id="${CSS.escape(each)}"]`).join(",");
  return (
    <div className="border-t border-border" contentEditable={false} onKeyDown={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-1 px-2 py-1 text-xs">
        {editing ? (
          <>
            <ToolButton active={tool === "pen"} label="Pen" icon="Edit" onClick={() => setTool("pen")} />
            <ToolButton active={tool === "eraser"} label="Eraser" icon="Clean" onClick={() => setTool("eraser")} />
            <span className="mx-1 h-4 w-px bg-border" />
            {WHITEBOARD_COLORS.map((each) => (
              <button
                key={each}
                type="button"
                aria-label={`Color ${each}`}
                aria-pressed={color === each}
                className={cn("size-4 cursor-pointer rounded-full border border-border", color === each && "ring-2 ring-primary ring-offset-1")}
                style={{ background: each }}
                onClick={() => {
                  setColor(each);
                  setTool("pen");
                }}
              />
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <ToolButton label="Undo" icon="RotateCcw" onClick={undo} />
            <span className="flex-1" />
            <ToolButton label="Done" icon="Check" onClick={() => {
              setEditing(false);
              setFrame(null);
            }} />
          </>
        ) : (
          <>
            <ToolButton label="Sketch" icon="Edit" onClick={startEditing} />
            <span className="flex-1" />
          </>
        )}
        <ToolButton label="Open full size" icon="ArrowUpRight" onClick={onOpen} />
      </div>
      <svg
        ref={svg}
        data-whiteboard={id}
        viewBox={viewBox.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        className={cn(
          "block w-full touch-none select-none bg-white dark:invert-[0.9] dark:hue-rotate-180",
          editing ? (tool === "eraser" ? "cursor-cell" : "cursor-crosshair") : "cursor-default",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ height }}
        onDoubleClick={editing ? undefined : startEditing}
      >
        {hidden ? <style>{`${hidden}{display:none}`}</style> : null}
        <g dangerouslySetInnerHTML={{ __html: view?.markup ?? "" }} />
        {[...pending, ...(drawing ? [{ points: drawing, color, width: 2 }] : [])].map((stroke, index) => (
          <polyline
            key={index}
            points={(stroke.points.length === 1 ? [...stroke.points, [stroke.points[0]![0] + 0.01, stroke.points[0]![1]]] : stroke.points).map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {!view?.markup && !pending.length && !drawing ? (
          <text x={viewBox[0] + viewBox[2] / 2} y={viewBox[1] + viewBox[3] / 2} textAnchor="middle" fontSize="16" fill="#999">
            {editing ? "Draw here" : view === undefined ? "Loading…" : "Empty whiteboard"}
          </text>
        ) : null}
      </svg>
      {onResize ? (
        <ResizeHandle
          height={height}
          onPreview={setDragHeight}
          onCommit={(next) => {
            setDragHeight(null);
            const value = next === WHITEBOARD_HEIGHT.default ? 0 : clampHeight(next);
            if (value !== (saved ?? 0)) onResize(value);
          }}
        />
      ) : null}
      {saveFailed ? (
        <div role="alert" className="flex items-center gap-2 border-t border-border px-2 py-1 text-xs">
          <Icon name="AlertCircle" className="ml-1 size-3.5 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={error ?? undefined}>
            <span className="text-foreground">Changes weren’t saved.</span>{error ? ` ${error.replace(/[.\s]+$/, "")}.` : ""}
          </span>
          <ToolButton label="Retry save" icon="RotateCcw" onClick={retry} />
        </div>
      ) : error ? <p role="alert" className="border-t border-border px-3 py-1.5 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * The bottom edge: drag it, or focus it and use the arrow keys (Shift for
 * bigger steps, Home and End for the smallest and largest). Double-click
 * puts back the default height. The height is saved when the drag ends.
 */
function ResizeHandle({ height, onPreview, onCommit }: { height: number; onPreview(height: number | null): void; onCommit(height: number): void }) {
  const start = useRef<{ y: number; height: number } | null>(null);
  const keyed = useRef<number | null>(null);
  const commitKeys = () => {
    if (keyed.current !== null) onCommit(keyed.current);
    keyed.current = null;
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Whiteboard height"
      aria-valuemin={WHITEBOARD_HEIGHT.min}
      aria-valuemax={WHITEBOARD_HEIGHT.max}
      aria-valuenow={height}
      aria-valuetext={`${height} pixels tall`}
      tabIndex={0}
      title="Resize"
      data-whiteboard-resize=""
      className="group flex h-3 cursor-row-resize touch-none items-center justify-center border-t border-border bg-card/60 outline-none hover:bg-state-hover focus-visible:bg-state-hover focus-visible:ring-2 focus-visible:ring-primary"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { y: event.clientY, height };
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        onPreview(clampHeight(start.current.height + event.clientY - start.current.y));
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        const next = clampHeight(start.current.height + event.clientY - start.current.y);
        start.current = null;
        onCommit(next);
      }}
      onPointerCancel={() => {
        start.current = null;
        onPreview(null);
      }}
      onDoubleClick={() => onCommit(WHITEBOARD_HEIGHT.default)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? WHITEBOARD_HEIGHT.step * 4 : WHITEBOARD_HEIGHT.step;
        const base = keyed.current ?? height;
        const next =
          event.key === "ArrowDown" ? base + step :
          event.key === "ArrowUp" ? base - step :
          event.key === "Home" ? WHITEBOARD_HEIGHT.min :
          event.key === "End" ? WHITEBOARD_HEIGHT.max : null;
        if (next === null) return;
        event.preventDefault();
        keyed.current = clampHeight(next);
        onPreview(keyed.current);
      }}
      onKeyUp={commitKeys}
      onBlur={commitKeys}
    >
      <span className="h-1 w-10 rounded-full bg-muted-foreground/40 group-hover:bg-muted-foreground group-focus-visible:bg-muted-foreground" />
    </div>
  );
}

/** Widens or heightens a frame around its centre to the whiteboard's shape, so there's room to add to it. */
function fitWide([x, y, width, height]: [number, number, number, number], ratio: number): [number, number, number, number] {
  if (width / height < ratio) {
    const wide = height * ratio;
    return [x - (wide - width) / 2, y, wide, height];
  }
  const tall = width / ratio;
  return [x, y - (tall - height) / 2, width, tall];
}

function ToolButton({ label, icon, active, onClick }: { label: string; icon: string; active?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-muted-foreground hover:bg-state-hover hover:text-foreground",
        active && "bg-state-hover text-foreground",
      )}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} className="size-3.5" /> {label}
    </button>
  );
}
