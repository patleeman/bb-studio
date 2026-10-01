// The spreadsheet's pure parts: where the active cell moves, which cells a
// selection covers, what a copy puts on the clipboard, and the row edits a
// paste, a clear or an undo turns into.
import { cellText, convertCell, type Cell, type Column, type Row, type RowPatch, type Table, type Values } from "../model";

/** A cell by its place in the view: row index and visible column index. */
export interface Pos {
  row: number;
  col: number;
}
export interface Selection {
  anchor: Pos;
  focus: Pos;
}
export interface Bounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function bounds({ anchor, focus }: Selection): Bounds {
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.col, focus.col),
  };
}

export function inBounds(box: Bounds, row: number, col: number): boolean {
  return row >= box.top && row <= box.bottom && col >= box.left && col <= box.right;
}

export function clamp(pos: Pos, rows: number, cols: number): Pos {
  return { row: Math.max(0, Math.min(rows - 1, pos.row)), col: Math.max(0, Math.min(cols - 1, pos.col)) };
}

export type Direction = "up" | "down" | "left" | "right";

/** One step, or with `toEdge` (⌘ + arrow) to the first or last row or column. */
export function step(pos: Pos, direction: Direction, rows: number, cols: number, toEdge = false): Pos {
  const next = { ...pos };
  if (direction === "up") next.row = toEdge ? 0 : pos.row - 1;
  if (direction === "down") next.row = toEdge ? rows - 1 : pos.row + 1;
  if (direction === "left") next.col = toEdge ? 0 : pos.col - 1;
  if (direction === "right") next.col = toEdge ? cols - 1 : pos.col + 1;
  return clamp(next, rows, cols);
}

/** Tab order: right along the row, then to the start of the next one. */
export function tab(pos: Pos, back: boolean, rows: number, cols: number): Pos {
  if (!back) return pos.col < cols - 1 ? { row: pos.row, col: pos.col + 1 } : pos.row < rows - 1 ? { row: pos.row + 1, col: 0 } : pos;
  return pos.col > 0 ? { row: pos.row, col: pos.col - 1 } : pos.row > 0 ? { row: pos.row - 1, col: cols - 1 } : pos;
}

/** The selected cells as text, a row per line. */
export function copyGrid(rows: readonly Row[], columns: readonly Column[], box: Bounds): string[][] {
  return rows.slice(box.top, box.bottom + 1).map((row) => columns.slice(box.left, box.right + 1).map((column) => cellText(row.values[column.id])));
}

/** What clearing a cell leaves: an unchecked box, or nothing. */
export function emptyCell(column: Column): Cell {
  return column.type === "checkbox" ? false : null;
}

export function clearPatch(rows: readonly Row[], columns: readonly Column[], box: Bounds): RowPatch {
  const cleared = columns.slice(box.left, box.right + 1);
  return {
    update: rows.slice(box.top, box.bottom + 1).map((row) => ({
      rowId: row.id,
      values: Object.fromEntries(cleared.map((column) => [column.id, emptyCell(column)])),
    })),
  };
}

/**
 * The edits a paste makes: the pasted grid laid over the view from the
 * active cell (or repeated to fill a larger selection, as spreadsheets do),
 * converted to each column's type, with new rows for whatever runs past
 * the end. Computed columns and extra pasted columns are dropped.
 */
export function pastePatch(rows: readonly Row[], columns: readonly Column[], box: Bounds, grid: readonly (readonly string[])[], newRowId: () => string): RowPatch {
  if (!grid.length || !grid[0]!.length) return {};
  const height = grid.length;
  const width = Math.max(...grid.map((line) => line.length));
  // A single value or a pattern that divides the selection fills it.
  const fill = (box.bottom - box.top + 1) % height === 0 && (box.right - box.left + 1) % width === 0;
  const rowCount = fill ? box.bottom - box.top + 1 : height;
  const colCount = Math.min(fill ? box.right - box.left + 1 : width, columns.length - box.left);
  const update: NonNullable<RowPatch["update"]> = [];
  const insert: NonNullable<RowPatch["insert"]> = [];
  for (let r = 0; r < rowCount; r++) {
    const values: Values = {};
    for (let c = 0; c < colCount; c++) {
      const column = columns[box.left + c]!;
      values[column.id] = convertCell(grid[r % height]![c % width] ?? "", column);
    }
    const row = rows[box.top + r];
    if (row) update.push({ rowId: row.id, values });
    else insert.push({ id: newRowId(), values });
  }
  return { update, insert };
}

/** The patch that undoes `patch` on `table`. */
export function invertPatch(table: Table, patch: RowPatch): RowPatch {
  const byId = new Map(table.rows.map((row) => [row.id, row]));
  const update = (patch.update ?? []).flatMap(({ rowId, values }) => {
    const row = byId.get(rowId);
    return row ? [{ rowId, values: Object.fromEntries(Object.keys(values).map((key) => [key, row.values[key] ?? null])) }] : [];
  });
  const removed = new Set(patch.remove ?? []);
  const insert = table.rows.flatMap((row, index) => {
    if (!removed.has(row.id)) return [];
    const before = table.rows.slice(index + 1).find((next) => !removed.has(next.id))?.id ?? null;
    return [{ id: row.id, values: row.values, before }];
  });
  return {
    update,
    insert,
    remove: (patch.insert ?? []).flatMap((each) => (each.id ? [each.id] : [])),
  };
}

export function isEmptyPatch(patch: RowPatch): boolean {
  return !patch.update?.length && !patch.insert?.length && !patch.remove?.length;
}
