// A table being edited: changes show at once, save in order, and undo.
// The server's copy is adopted whenever nothing is waiting to save, so a
// slow save never flickers back to an older value.
import { useCallback, useEffect, useRef, useState } from "react";
import { applyRowPatch, withColumns, type Column, type RowPatch, type Table, type Values, type View } from "../model";
import { invertPatch, isEmptyPatch } from "./sheet";

export interface TableMeta {
  title?: string;
  columns?: Column[];
  views?: View[];
}

/** What a table view saves through: Tables' RPCs, or Pages' proxy of them. */
export interface TableApi {
  update(meta: TableMeta): Promise<{ table: Table }>;
  patchRows(patch: RowPatch): Promise<{ table: Table }>;
}

/** One undoable step: table settings first, then rows. */
export interface Change {
  meta?: TableMeta;
  rows?: RowPatch;
}

export function newRowId(): string {
  return `row_${crypto.randomUUID()}`;
}

/** The table with `change` applied, as the server will apply it. */
function applyChange(table: Table, change: Change): Table {
  let next = table;
  if (change.meta) {
    const { columns, views, title } = change.meta;
    if (columns) next = { ...next, ...withColumns(next, columns) };
    if (views) next = { ...next, views };
    if (title) next = { ...next, title };
  }
  if (change.rows && !isEmptyPatch(change.rows)) {
    const { columns, rows } = applyRowPatch(next, change.rows, Date.now(), newRowId);
    next = { ...next, columns, rows };
  }
  return next;
}

/** The change that takes `table` back from `change`. */
function invertChange(table: Table, change: Change): Change {
  const inverse: Change = {};
  if (change.meta) {
    inverse.meta = {};
    if (change.meta.title) inverse.meta.title = table.title;
    if (change.meta.views || change.meta.columns) inverse.meta.views = table.views;
    if (change.meta.columns) {
      inverse.meta.columns = table.columns;
      // A removed or retyped column takes its values with it; put them back.
      const after = new Map(change.meta.columns.map((column) => [column.id, column]));
      const lost = table.columns.filter((column) => JSON.stringify(after.get(column.id)) !== JSON.stringify(column));
      if (lost.length)
        inverse.rows = {
          update: table.rows.map((row) => ({
            rowId: row.id,
            values: Object.fromEntries(lost.map((column) => [column.id, row.values[column.id] ?? null])) as Values,
          })),
        };
    }
  }
  if (change.rows) {
    const rows = invertPatch(table, change.rows);
    inverse.rows = inverse.rows ? { ...rows, update: [...(rows.update ?? []), ...(inverse.rows.update ?? [])] } : rows;
  }
  return inverse;
}

/** Inserted rows get their ids here, so the row on screen is the row saved. */
function withRowIds(change: Change): Change {
  if (!change.rows?.insert?.length) return change;
  return { ...change, rows: { ...change.rows, insert: change.rows.insert.map((each) => ({ ...each, id: each.id ?? newRowId() })) } };
}

export function useTableState(source: Table, api: TableApi, onError: (error: unknown) => void) {
  const [table, setTable] = useState(source);
  const current = useRef(source);
  const saved = useRef(source);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const undoStack = useRef<Change[]>([]);
  const redoStack = useRef<Change[]>([]);
  const show = useCallback((next: Table) => {
    current.current = next;
    setTable(next);
  }, []);

  useEffect(() => {
    saved.current = source;
    if (!pending.current) show(source);
  }, [source, show]);

  const send = useCallback(
    (change: Change) => {
      pending.current++;
      queue.current = queue.current
        .then(async () => {
          let result: Table | null = null;
          if (change.meta && Object.keys(change.meta).length) result = (await api.update(change.meta)).table;
          if (change.rows && !isEmptyPatch(change.rows)) result = (await api.patchRows(change.rows)).table;
          return result;
        })
        .then(
          (result) => {
            if (result) saved.current = result;
            if (--pending.current === 0) show(saved.current);
          },
          (error) => {
            if (--pending.current === 0) show(saved.current);
            onError(error);
          },
        );
    },
    [api, onError, show],
  );

  /** Shows and saves `change`; `undoable` changes go on the undo stack. */
  const apply = useCallback(
    (raw: Change, undoable = true) => {
      const change = withRowIds(raw);
      let next: Table;
      try {
        next = applyChange(current.current, change);
      } catch (error) {
        onError(error);
        return false;
      }
      if (undoable) {
        undoStack.current = [...undoStack.current.slice(-99), invertChange(current.current, change)];
        redoStack.current = [];
      }
      show(next);
      send(change);
      return true;
    },
    [onError, send, show],
  );

  const travel = useCallback(
    (from: { current: Change[] }, to: { current: Change[] }) => {
      const change = from.current.at(-1);
      if (!change) return null;
      from.current = from.current.slice(0, -1);
      const inverse = invertChange(current.current, change);
      if (!apply(change, false)) return null;
      to.current = [...to.current, inverse];
      return change;
    },
    [apply],
  );
  const undo = useCallback(() => travel(undoStack, redoStack), [travel]);
  const redo = useCallback(() => travel(redoStack, undoStack), [travel]);

  return { table, apply, undo, redo };
}

export type TableState = ReturnType<typeof useTableState>;
