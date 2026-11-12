// The board: items packed by layout.ts, absolutely placed, and animated on
// every change (motion.ts). Positions are computed, not measured, so FLIP
// needs no DOM reads: the last frame's rects are the "first" of each move.
// Removed items linger as ghosts while they fade out.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn, type WidgetTheme } from "./studio";
import { columnsFor, packBoard, type Cell } from "../layout";
import type { CanvasItem } from "../shared";
import { BARE_KINDS, ItemBody, itemLabel, tableColumns } from "./items";
import { enter, exit, fadeIn, fadeOut, highlight, move, type Rect } from "./motion";

export const GAP = 14;
const HEADER = 34;

/** Grid geometry for a board this wide. */
export function geometry(width: number, cols: number) {
  const colWidth = Math.max(40, (width - GAP * (cols - 1)) / cols);
  const rowHeight = Math.round(Math.min(100, Math.max(48, colWidth * 0.68)));
  const rect = (cell: Cell): Rect => ({
    left: Math.round(cell.x * (colWidth + GAP)),
    top: cell.y * (rowHeight + GAP),
    width: Math.round(cell.w * colWidth + (cell.w - 1) * GAP),
    height: cell.h * rowHeight + (cell.h - 1) * GAP,
  });
  return { colWidth, rowHeight, rect };
}

const versionOf = (item: CanvasItem) => `${item.rev}:${item.updatedAt}`;

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** An item's content, cross-faded when it changes: the old copy fades out over the new one. */
function Content({ item, width, height, theme }: { item: CanvasItem; width: number; height: number; theme: WidgetTheme }) {
  const version = versionOf(item);
  const [layers, setLayers] = useState<{ version: string; item: CanvasItem }[]>([{ version, item }]);
  useLayoutEffect(() => {
    setLayers((current) => (current.at(-1)!.version === version ? current : [...current.slice(-1), { version, item }]));
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = layers.map((layer, index) => (index === layers.length - 1 ? { ...layer, item } : layer));
  return (
    <div className="relative min-h-0 flex-1">
      {shown.map((layer, index) => {
        const leaving = index < shown.length - 1;
        return (
          <div
            key={layer.version}
            className={cn("absolute inset-0", leaving && "pointer-events-none")}
            data-canvas-layer={leaving ? "leaving" : "current"}
            ref={(element) => {
              // A layer is animated once as it arrives and once as it leaves (it was the current one before).
              const role = leaving ? "out" : "in";
              if (!element || element.dataset.animated === role || (role === "in" && element.dataset.animated === "out")) return;
              element.dataset.animated = role;
              if (leaving) {
                const drop = () => setLayers((current) => current.filter((each) => each.version !== layer.version));
                fadeOut(element, drop);
                // A hidden tab doesn't run animations: don't leave the old copy behind.
                setTimeout(drop, 900);
              } else if (shown.length > 1) fadeIn(element);
            }}
          >
            <ItemBody item={layer.item} width={width} height={height} theme={theme} />
          </div>
        );
      })}
    </div>
  );
}

function Tile({ item, rect, focus, theme, register }: { item: CanvasItem; rect: Rect; focus: boolean; theme: WidgetTheme; register?: (element: HTMLElement | null) => void }) {
  const bare = BARE_KINDS.has(item.kind);
  const label = itemLabel(item);
  const bodyHeight = rect.height - (label ? HEADER : 0);
  return (
    <section
      ref={register}
      aria-label={label ?? item.title ?? item.id}
      data-canvas-item={item.id}
      data-canvas-kind={item.kind}
      data-focus={focus || undefined}
      className={cn(
        "canvas-tile absolute flex flex-col overflow-hidden",
        bare ? "rounded-xl" : "rounded-xl border border-border/70 bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.12)]",
        focus && !bare && "border-border shadow-[0_1px_2px_rgb(0_0_0/0.05),0_18px_40px_-16px_rgb(0_0_0/0.22)]",
      )}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {label ? <header className="flex h-[34px] shrink-0 items-center px-3.5 pt-1 text-[13px] font-medium text-muted-foreground"><span className="truncate">{label}</span></header> : null}
      <Content item={item} width={rect.width} height={bodyHeight} theme={theme} />
    </section>
  );
}

/** A removed item, drawn where it was until it has faded out. */
function Ghost({ item, rect, index, theme, onDone }: { item: CanvasItem; rect: Rect; index: number; theme: WidgetTheme; onDone(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { exit(ref.current, onDone, index); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="pointer-events-none absolute" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: 0 }} aria-hidden data-canvas-ghost={item.id}>
      <Tile item={item} rect={{ ...rect, left: 0, top: 0 }} focus={false} theme={theme} />
    </div>
  );
}

export function Board({ items, theme, empty, bottomPad = 160 }: { items: readonly CanvasItem[]; theme: WidgetTheme; empty?: ReactNode; bottomPad?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const cols = columnsFor(width);
  // The last layout per column count: the stability hint for the next.
  const previous = useRef(new Map<number, Map<string, Cell>>());
  const packed = useMemo(() => packBoard(items.map((item) => ({ id: item.id, kind: item.kind, size: item.size, importance: item.importance, createdAt: item.createdAt, updatedAt: item.updatedAt, columns: tableColumns(item) })), cols, previous.current.get(cols)), [items, cols]);
  const { rect, rowHeight } = geometry(width, cols);

  const elements = useRef(new Map<string, HTMLElement>());
  const last = useRef<{ rects: Map<string, Rect>; versions: Map<string, string>; items: Map<string, CanvasItem>; width: number } | null>(null);
  const [ghosts, setGhosts] = useState<{ key: string; item: CanvasItem; rect: Rect }[]>([]);

  useLayoutEffect(() => {
    if (!width) return;
    previous.current.set(cols, packed.cells);
    const rects = new Map<string, Rect>();
    for (const [id, cell] of packed.cells) rects.set(id, rect(cell));
    const before = last.current;
    let entering = 0;
    // New items come in in reading order.
    const order = [...items].sort((a, b) => { const ca = packed.cells.get(a.id)!; const cb = packed.cells.get(b.id)!; return ca.y - cb.y || ca.x - cb.x; });
    for (const item of order) {
      const element = elements.current.get(item.id) ?? null;
      const to = rects.get(item.id)!;
      const from = before?.rects.get(item.id);
      if (!from) { enter(element, entering++); continue; }
      // A window resize re-flows without gliding.
      if (before!.width === width) move(element, from, to);
      if (before!.versions.get(item.id) !== versionOf(item)) highlight(element);
    }
    if (before) {
      const gone = [...before.items.values()].filter((item) => !rects.has(item.id));
      if (gone.length) setGhosts((current) => [...current, ...gone.map((item) => ({ key: `${item.id}:${versionOf(item)}:${Date.now()}`, item, rect: before.rects.get(item.id)! }))]);
    }
    last.current = { rects, versions: new Map(items.map((item) => [item.id, versionOf(item)])), items: new Map(items.map((item) => [item.id, item])), width };
  }, [packed, width]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ghosts never outlive a second of animation, even if one is missed.
  useEffect(() => {
    if (!ghosts.length) return;
    const timer = setTimeout(() => setGhosts([]), 1500);
    return () => clearTimeout(timer);
  }, [ghosts]);

  const height = packed.rows ? packed.rows * (rowHeight + GAP) - GAP : 0;
  const ghostHeight = ghosts.reduce((max, ghost) => Math.max(max, ghost.rect.top + ghost.rect.height), 0);
  return (
    <div ref={ref} className="canvas-board relative w-full" style={{ height: Math.max(height, ghostHeight) + bottomPad }} data-canvas-board data-cols={cols} data-items={items.length}>
      {width ? (
        <>
          {ghosts.map((ghost, index) => (
            <Ghost key={ghost.key} item={ghost.item} rect={ghost.rect} index={index} theme={theme} onDone={() => setGhosts((current) => current.filter((each) => each.key !== ghost.key))} />
          ))}
          {items.map((item) => {
            const cell = packed.cells.get(item.id);
            if (!cell) return null;
            return (
              <Tile
                key={item.id}
                item={item}
                rect={rect(cell)}
                focus={packed.focusId === item.id}
                theme={theme}
                register={(element) => { if (element) elements.current.set(item.id, element); else elements.current.delete(item.id); }}
              />
            );
          })}
        </>
      ) : null}
      {!items.length && !ghosts.length && empty ? <div className="pointer-events-none absolute inset-x-0 top-[28vh] flex justify-center">{empty}</div> : null}
    </div>
  );
}
