// The canvas's auto-layout. The user never arranges the board: items are
// packed on a column grid by importance and size hint.
//
// - The focus item (highest importance, then the most recently changed) is
//   the biggest and sits top-left.
// - Stable: an item that keeps its cell size keeps its place when it can
//   (the previous layout is the hint). Items go in by importance, level by
//   level: at each level, kept items take their old spots, then new,
//   resized and displaced ones fill in first fit. Then everything floats up
//   into the gaps removals left, in reading order, so nothing jumps sideways.
// - Responsive: 12 columns when wide, 8 at medium widths, 4 when narrow.
// - Deterministic: the same items, columns and previous layout always give
//   the same cells, whatever order the items come in.
import type { CanvasKind, SizeHint } from "./shared";

export interface LayoutItem {
  id: string;
  kind: CanvasKind;
  size: SizeHint;
  importance: number;
  createdAt: number;
  updatedAt: number;
  /** A table's column count: a wide table gets a wider cell, so it fits instead of scrolling. */
  columns?: number;
}

export interface Cell { x: number; y: number; w: number; h: number }

export interface Packed {
  cells: Map<string, Cell>;
  focusId: string | null;
  /** Rows the board uses. */
  rows: number;
  cols: number;
}

export const COLUMN_STEPS = [12, 8, 4] as const;
export type Columns = (typeof COLUMN_STEPS)[number];

/** Columns for a board this wide (px). */
export function columnsFor(width: number): Columns {
  return width >= 1100 ? 12 : width >= 640 ? 8 : 4;
}

const ORDER: readonly SizeHint[] = ["s", "m", "l", "xl"];

/** Cells on the 12-column grid: [w, h] per size hint. */
const BASE: Record<SizeHint, [number, number]> = { s: [3, 2], m: [4, 3], l: [6, 4], xl: [8, 5] };
/** Kinds whose shape differs: wide and short, or one line. */
const SHAPES: Partial<Record<CanvasKind, Record<SizeHint, [number, number]>>> = {
  headline: { s: [6, 2], m: [8, 2], l: [12, 2], xl: [12, 3] },
  caption: { s: [3, 2], m: [4, 2], l: [6, 2], xl: [8, 3] },
  stat: { s: [3, 2], m: [4, 2], l: [4, 3], xl: [6, 3] },
  ticker: { s: [6, 1], m: [8, 1], l: [12, 1], xl: [12, 1] },
  progress: { s: [3, 2], m: [4, 2], l: [6, 2], xl: [8, 3] },
  table: { s: [4, 3], m: [6, 4], l: [6, 5], xl: [12, 5] },
};

/** The 12-column width a table needs to show this many columns without scrolling. */
export function tableWidth(columns: number): number {
  return Math.min(12, Math.ceil(columns * 1.4));
}

/** An item's cell size for the column count; a table is at least as wide as its columns need. */
export function cellSize(kind: CanvasKind, size: SizeHint, cols: number, columns = 0): { w: number; h: number } {
  const [hinted, h] = SHAPES[kind]?.[size] ?? BASE[size];
  const w12 = kind === "table" && columns ? Math.max(hinted, tableWidth(columns)) : hinted;
  if (cols >= 12) return { w: Math.min(cols, w12), h };
  if (cols >= 8) return { w: Math.min(cols, Math.max(2, Math.round((w12 * 8) / 12))), h };
  // Narrow: small things two to a row, everything else full width.
  return { w: w12 <= 3 ? 2 : cols, h };
}

const bigger = (size: SizeHint): SizeHint => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(size) + 1)]!;

/** Highest importance, then most recently changed, then id (so ties are deterministic). */
export function focusOf(items: readonly LayoutItem[]): LayoutItem | null {
  let best: LayoutItem | null = null;
  for (const item of items) {
    if (!best || item.importance > best.importance || (item.importance === best.importance && (item.updatedAt > best.updatedAt || (item.updatedAt === best.updatedAt && item.id < best.id)))) best = item;
  }
  return best;
}

/** Importance first, then the order items arrived, then id. */
const byImportance = (a: LayoutItem, b: LayoutItem) => b.importance - a.importance || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

class Grid {
  private rows: boolean[][] = [];
  constructor(readonly cols: number) {}
  private row(y: number) {
    while (this.rows.length <= y) this.rows.push(new Array<boolean>(this.cols).fill(false));
    return this.rows[y]!;
  }
  fits(x: number, y: number, w: number, h: number): boolean {
    if (x < 0 || y < 0 || x + w > this.cols) return false;
    for (let dy = 0; dy < h; dy++) {
      const row = this.rows[y + dy];
      if (!row) continue;
      for (let dx = 0; dx < w; dx++) if (row[x + dx]) return false;
    }
    return true;
  }
  set(cell: Cell, value: boolean) {
    for (let dy = 0; dy < cell.h; dy++) {
      const row = this.row(cell.y + dy);
      for (let dx = 0; dx < cell.w; dx++) row[cell.x + dx] = value;
    }
  }
  /** Top-most, then left-most free spot. */
  firstFit(w: number, h: number): { x: number; y: number } {
    for (let y = 0; ; y++) {
      for (let x = 0; x + w <= this.cols; x++) if (this.fits(x, y, w, h)) return { x, y };
    }
  }
}

/**
 * Packs the board. `previous` is the last layout at this column count (the
 * stability hint); without it, items go in importance order.
 */
export function packBoard(items: readonly LayoutItem[], cols: number, previous?: ReadonlyMap<string, Cell> | null): Packed {
  const cells = new Map<string, Cell>();
  if (!items.length) return { cells, focusId: null, rows: 0, cols };
  const focus = focusOf(items)!;
  const sizes = new Map(items.map((item) => [item.id, cellSize(item.kind, item.size, cols, item.columns)]));
  // The focus is the biggest: one size up, and up again until no other item
  // covers more cells (or it's as big as it gets).
  {
    let size = bigger(focus.size);
    let cell = cellSize(focus.kind, size, cols, focus.columns);
    const largest = Math.max(0, ...items.filter((item) => item.id !== focus.id).map((item) => { const s = sizes.get(item.id)!; return s.w * s.h; }));
    while (cell.w * cell.h < largest && size !== "xl") {
      size = bigger(size);
      cell = cellSize(focus.kind, size, cols, focus.columns);
    }
    sizes.set(focus.id, cell);
  }
  const grid = new Grid(cols);
  const place = (id: string, at: { x: number; y: number }) => {
    const size = sizes.get(id)!;
    const cell = { x: at.x, y: at.y, w: size.w, h: size.h };
    cells.set(id, cell);
    grid.set(cell, true);
  };
  place(focus.id, { x: 0, y: 0 });

  // By importance, most important first. Within each level, items that keep
  // their cell size try their old spot first (stability); the rest, and any
  // whose old spot is taken, go to the first free spot. So a displaced
  // important item lands near the top, never under less important ones.
  const rest = items.filter((item) => item.id !== focus.id);
  const levels = [...new Set(rest.map((item) => item.importance))].sort((a, b) => b - a);
  for (const level of levels) {
    const tier = rest.filter((item) => item.importance === level);
    const keepers = tier
      .filter((item) => {
        const was = previous?.get(item.id);
        const size = sizes.get(item.id)!;
        return !!was && was.w === size.w && was.h === size.h;
      })
      .sort((a, b) => {
        const pa = previous!.get(a.id)!;
        const pb = previous!.get(b.id)!;
        return pa.y - pb.y || pa.x - pb.x || (a.id < b.id ? -1 : 1);
      });
    for (const item of keepers) {
      const was = previous!.get(item.id)!;
      if (grid.fits(was.x, was.y, was.w, was.h)) place(item.id, was);
    }
    for (const item of tier.filter((each) => !cells.has(each.id)).sort(byImportance)) {
      const size = sizes.get(item.id)!;
      place(item.id, grid.firstFit(size.w, size.h));
    }
  }

  // Float up into gaps, in reading order; the focus stays at the top.
  const order = [...cells.entries()].filter(([id]) => id !== focus.id).sort(([ia, a], [ib, b]) => a.y - b.y || a.x - b.x || (ia < ib ? -1 : 1));
  for (const [id, cell] of order) {
    grid.set(cell, false);
    let y = cell.y;
    while (y > 0 && grid.fits(cell.x, y - 1, cell.w, cell.h)) y--;
    const next = { ...cell, y };
    cells.set(id, next);
    grid.set(next, true);
  }
  let rows = 0;
  for (const cell of cells.values()) rows = Math.max(rows, cell.y + cell.h);
  return { cells, focusId: focus.id, rows, cols };
}

/** Whether two cells overlap (for checks and tests). */
export function overlaps(a: Cell, b: Cell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
