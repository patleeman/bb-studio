// The inline whiteboard: a Studio Draw drawing shown as SVG in the page, with
// a pen and an eraser for quick sketches. Strokes are saved to the drawing as
// Excalidraw elements, so "Open in Draw" shows them in the full editor.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { errorMessage } from "@bb-studio/kit/format";
import { Icon } from "@bb-studio/kit/ui";
import { cn } from "@bb-studio/kit/ui";
import { WHITEBOARD_COLORS, type WhiteboardStroke, type WhiteboardView } from "../whiteboard";
import { usePagesUi } from "./context";

type Tool = "pen" | "eraser";
const EMPTY_VIEWBOX: [number, number, number, number] = [0, 0, 800, 360];
const POLL_MS = 5_000;
const SAVE_DELAY_MS = 350;

/** Asked by a newly made whiteboard so it opens ready to draw. */
const startInEditMode = new Set<string>();
export function editWhiteboardWhenShown(id: string) {
  startInEditMode.add(id);
}

export function Whiteboard({ id, onOpen }: { id: string; onOpen(): void }) {
  const ui = usePagesUi();
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
  // Picks up edits made in Draw or by agents, unless a stroke is on its way.
  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && !saving.current && !queue.current.add.length && !queue.current.erase.length) load();
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  const flush = useCallback(async () => {
    timer.current = null;
    if (saving.current) return;
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
      setPending((current) => current.filter((stroke) => !batch.add.includes(stroke)));
      setErased(new Set());
    } finally {
      saving.current = false;
      if (queue.current.add.length || queue.current.erase.length) void flush();
    }
  }, [ui, id]);
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

  const viewBox = (editing ? frame : null) ?? view?.viewBox ?? EMPTY_VIEWBOX;
  const startEditing = () => {
    setFrame(view?.viewBox ? fitWide(view.viewBox) : EMPTY_VIEWBOX);
    setEditing(true);
  };
  useEffect(() => {
    if (editing && !frame && view !== undefined) setFrame(view?.viewBox ? fitWide(view.viewBox) : EMPTY_VIEWBOX);
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
    const stroke: WhiteboardStroke = { points: drawing.slice(0, 5000), color: color as WhiteboardStroke["color"], width: 2 };
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
    return <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{error ?? "This drawing is gone."}</p>;
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
        <ToolButton label="Open in Draw" icon="ArrowUpRight" onClick={onOpen} />
      </div>
      <svg
        ref={svg}
        data-whiteboard={id}
        viewBox={viewBox.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        className={cn(
          "block h-[320px] w-full touch-none select-none bg-white dark:invert-[0.9] dark:hue-rotate-180",
          editing ? (tool === "eraser" ? "cursor-cell" : "cursor-crosshair") : "cursor-default",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
            {editing ? "Draw here" : view === undefined ? "Loading…" : "Empty whiteboard: double-click to sketch"}
          </text>
        ) : null}
      </svg>
      {error ? <p className="px-3 py-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** Widens a drawing's frame to the whiteboard's shape, so there's room to add to it. */
function fitWide([x, y, width, height]: [number, number, number, number]): [number, number, number, number] {
  const ratio = EMPTY_VIEWBOX[2] / EMPTY_VIEWBOX[3];
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
