// The spreadsheet: select cells with the mouse or keyboard, type to edit,
// copy and paste ranges to and from other spreadsheets, and undo.
//
// Keys and clipboard events go to a hidden textarea that holds focus while
// the grid is active. Being a text field, it also keeps a page editor the
// grid is embedded in from treating those events as its own.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../../ui/context-menu";
import { Icon } from "../../ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { cn } from "../../ui/utils";
import { COLUMN_TYPE_INFO, DEFAULT_COLUMN_WIDTH, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, parseDelimited, toTsv, type Cell, type Column, type Row, type Table, type Values, type View } from "../model";
import { CellValue } from "./cells";
import { ColumnMenu, newColumn, TypeList } from "./column-menu";
import { CellEditor, type Exit } from "./editors";
import type { TableHost } from "./host";
import { bounds, clearPatch, copyGrid, inBounds, pastePatch, step, tab, type Direction, type Pos, type Selection } from "./sheet";
import { newRowId, type Change } from "./state";

const GUTTER = 44;
const ADD_COLUMN = 40;
const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const EXIT_DIRECTION: Partial<Record<Exit, Direction>> = { down: "down", up: "up", right: "right", left: "left" };

export interface GridProps {
  table: Table;
  view: View | undefined;
  /** The view's rows, filtered and sorted. */
  rows: Row[];
  /** The view's visible columns. */
  columns: Column[];
  host: TableHost;
  apply(change: Change, undoable?: boolean): boolean;
  undo(): void;
  redo(): void;
  onColumns(columns: Column[]): void;
  onView(view: View): void;
  onOpenRow(rowId: string): void;
  /** Values a new row starts with, so it matches the view's filters. */
  newRowValues(): Values;
  highlightRowId?: string | null;
  embedded?: boolean;
}

export function Grid({ table, view, rows, columns, host, apply, undo, redo, onColumns, onView, onOpenRow, newRowValues, highlightRowId, embedded }: GridProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<(Pos & { initial?: string }) | null>(null);
  const [active, setActive] = useState(false);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const focusRow = useRef<{ id: string; edit: boolean } | null>(null);
  const box = selection ? bounds(selection) : null;
  /** The active cell, which typing edits; `focus` is the far end of the range. */
  const cursor = selection?.anchor ?? null;
  const focus = selection?.focus ?? null;
  const many = !!box && (box.bottom > box.top || box.right > box.left);
  const width = (column: Column) => widths[column.id] ?? column.width ?? DEFAULT_COLUMN_WIDTH;
  const totalWidth = GUTTER + columns.reduce((sum, column) => sum + width(column), 0) + ADD_COLUMN;

  const focusKeys = useCallback(() => {
    const field = keys.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    // A selected character lets the browser fire copy and cut.
    field.value = " ";
    field.select();
  }, []);

  const select = useCallback((anchor: Pos, focus = anchor) => setSelection({ anchor, focus }), []);

  // Keep the selection on the grid as rows and columns come and go.
  useEffect(() => {
    if (!selection) return;
    if (!rows.length || !columns.length) return setSelection(null);
    const fit = (pos: Pos) => ({ row: Math.min(pos.row, rows.length - 1), col: Math.min(pos.col, columns.length - 1) });
    const anchor = fit(selection.anchor);
    const next = fit(selection.focus);
    if (anchor.row !== selection.anchor.row || anchor.col !== selection.anchor.col || next.row !== selection.focus.row || next.col !== selection.focus.col)
      setSelection({ anchor, focus: next });
  }, [rows.length, columns.length, selection]);

  // A row just added is selected, and its first cell edited.
  useLayoutEffect(() => {
    const target = focusRow.current;
    if (!target) return;
    const index = rows.findIndex((row) => row.id === target.id);
    if (index < 0) return;
    focusRow.current = null;
    select({ row: index, col: 0 });
    if (target.edit && columns[0] && columns[0].type !== "checkbox") setEditing({ row: index, col: 0 });
    else focusKeys();
  }, [rows, columns, select, focusKeys]);

  // A link to a row selects it once it's on screen.
  useEffect(() => {
    if (!highlightRowId) return;
    const index = rows.findIndex((row) => row.id === highlightRowId);
    if (index < 0) return;
    select({ row: index, col: 0 }, { row: index, col: Math.max(0, columns.length - 1) });
    setFlash(highlightRowId);
    const timer = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(timer);
    // Only when the link changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRowId, rows.length > 0]);

  useEffect(() => {
    if (!focus) return;
    scroller.current?.querySelector(`[data-cell="${focus.row}:${focus.col}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus?.row, focus?.col]);

  useEffect(() => {
    const stop = () => (dragging.current = false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const update = (row: Row, column: Column, cell: Cell) => apply({ rows: { update: [{ rowId: row.id, values: { [column.id]: cell } }] } });

  const insertRow = (before: string | null, edit = true) => {
    const id = newRowId();
    focusRow.current = { id, edit };
    apply({ rows: { insert: [{ id, values: newRowValues(), before }] } });
  };
  /** The row after `row` in the table's own order, which inserts go before. */
  const after = (row: Row) => table.rows[table.rows.findIndex((each) => each.id === row.id) + 1]?.id ?? null;

  const selectedRows = () => (box ? rows.slice(box.top, box.bottom + 1) : []);
  const removeRows = () => {
    const ids = selectedRows().map((row) => row.id);
    if (!ids.length) return;
    apply({ rows: { remove: ids } });
    if (box) select({ row: box.top, col: box.left });
  };
  const clear = () => {
    if (box) apply({ rows: clearPatch(rows, columns, box) });
  };
  const copy = () => (box ? toTsv(copyGrid(rows, columns, box)) : "");
  const paste = (text: string) => {
    if (!box) return;
    const grid = parseDelimited(text.replace(/\r?\n$/, ""), "\t");
    const defaults = newRowValues();
    const patch = pastePatch(rows, columns, box, grid, newRowId);
    patch.insert = patch.insert?.map((each) => ({ ...each, values: { ...defaults, ...each.values } }));
    if (!apply({ rows: patch })) return;
    const height = (patch.update?.length ?? 0) + (patch.insert?.length ?? 0);
    const widthPasted = Math.max(...grid.map((line) => line.length));
    select({ row: box.top, col: box.left }, { row: box.top + height - 1, col: Math.min(columns.length - 1, box.left + Math.max(widthPasted, box.right - box.left + 1) - 1) });
  };
  const toggleChecks = () => {
    if (!box) return;
    const checks = columns.slice(box.left, box.right + 1).filter((column) => column.type === "checkbox");
    if (!checks.length) return;
    const targets = rows.slice(box.top, box.bottom + 1);
    const on = !targets.every((row) => checks.every((column) => row.values[column.id] === true));
    apply({ rows: { update: targets.map((row) => ({ rowId: row.id, values: Object.fromEntries(checks.map((column) => [column.id, on])) })) } });
  };

  const startEditing = (pos: Pos, initial?: string) => {
    const column = columns[pos.col];
    if (!column || !rows[pos.row]) return;
    if (column.type === "checkbox") {
      const row = rows[pos.row]!;
      update(row, column, row.values[column.id] !== true);
      return;
    }
    setEditing({ ...pos, initial });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (!selection || !focus || !cursor || event.nativeEvent.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    const handled = () => event.preventDefault();
    if (mod && key.toLowerCase() === "z") {
      handled();
      return event.shiftKey ? redo() : undo();
    }
    if (mod && key.toLowerCase() === "y") return handled(), redo();
    if (mod && key.toLowerCase() === "a") return handled(), select({ row: 0, col: 0 }, { row: rows.length - 1, col: columns.length - 1 });
    if (mod && (key === "c" || key === "x" || key === "v")) return; // The clipboard events handle these.
    if (ARROWS[key]) {
      handled();
      // Shift moves the far end of the range; otherwise the active cell moves.
      if (event.shiftKey) return setSelection({ anchor: selection.anchor, focus: step(focus, ARROWS[key]!, rows.length, columns.length, mod) });
      return select(step(cursor!, ARROWS[key]!, rows.length, columns.length, mod));
    }
    if (key === "Tab") return handled(), select(tab(cursor, event.shiftKey, rows.length, columns.length));
    if (key === "Home" || key === "End") {
      handled();
      return select({ row: mod ? (key === "Home" ? 0 : rows.length - 1) : cursor.row, col: key === "Home" ? 0 : columns.length - 1 });
    }
    if (key === "Enter") {
      handled();
      if (event.shiftKey) return select(step(cursor, "up", rows.length, columns.length));
      if (mod) return onOpenRow(rows[cursor.row]!.id);
      return startEditing(cursor);
    }
    if (key === "F2") return handled(), startEditing(cursor);
    if (key === "Escape") {
      handled();
      return many ? select(cursor) : (setSelection(null), keys.current?.blur());
    }
    if (key === "Backspace" || key === "Delete") return handled(), clear();
    if (key === " " && columns.slice(box!.left, box!.right + 1).some((column) => column.type === "checkbox")) return handled(), toggleChecks();
    if (key.length === 1 && !mod && !event.altKey) {
      handled();
      startEditing(cursor, key);
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.clipboardData.setData("text/plain", copy());
  };
  const onCut = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    onCopy(event);
    clear();
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    event.stopPropagation();
    paste(event.clipboardData.getData("text/plain"));
  };

  const cellDown = (event: MouseEvent, pos: Pos) => {
    if (event.button !== 0) {
      // A right click inside the selection keeps it for the menu.
      if (!box || !inBounds(box, pos.row, pos.col)) select(pos);
      focusKeys();
      return;
    }
    event.preventDefault();
    // Moving focus saves an open editor before the selection moves.
    focusKeys();
    setEditing(null);
    if (event.shiftKey && selection) setSelection({ anchor: selection.anchor, focus: pos });
    else select(pos);
    dragging.current = true;
    const column = columns[pos.col];
    const row = rows[pos.row];
    if (column?.type === "checkbox" && row && (event.target as Element).closest("[role=checkbox]")) update(row, column, row.values[column.id] !== true);
  };

  const commit = (pos: Pos) => (cell: Cell, exit: Exit = "stay") => {
    const row = rows[pos.row];
    const column = columns[pos.col];
    setEditing(null);
    if (row && column) update(row, column, cell);
    const direction = EXIT_DIRECTION[exit];
    if (direction) select(exit === "right" || exit === "left" ? tab(pos, exit === "left", rows.length, columns.length) : step(pos, direction, rows.length, columns.length));
    focusKeys();
  };

  const resize = (event: PointerEvent, column: Column) => {
    event.preventDefault();
    event.stopPropagation();
    const start = event.clientX;
    const initial = width(column);
    let next = initial;
    const move = (e: globalThis.PointerEvent) => {
      next = Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, initial + e.clientX - start)));
      setWidths((current) => ({ ...current, [column.id]: next }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (next !== initial) apply({ meta: { columns: table.columns.map((each) => (each.id === column.id ? { ...each, width: next } : each)) } }, false);
      setWidths((current) => {
        const { [column.id]: _, ...rest } = current;
        return rest;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sortOf = useMemo(() => new Map(view?.sorts.map((sort) => [sort.columnId, sort.direction])), [view]);
  const rowCount = box ? box.bottom - box.top + 1 : 0;

  return (
    <div className="relative flex min-h-0 flex-col">
      <textarea
        ref={keys}
        aria-label="Table cells"
        className="pointer-events-none fixed top-0 left-0 size-px resize-none opacity-0"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        onChange={() => {}}
      />
      <div ref={scroller} className={cn("relative min-h-0 overflow-auto overscroll-x-contain", embedded ? "max-h-[28rem]" : "flex-1")}>
        <ContextMenu>
          <table role="grid" aria-label={table.title} aria-rowcount={rows.length + 1} className="table-fixed border-separate border-spacing-0 text-sm select-none" style={{ width: totalWidth }}>
            <colgroup>
              <col style={{ width: GUTTER }} />
              {columns.map((column) => (
                <col key={column.id} style={{ width: width(column) }} />
              ))}
              <col style={{ width: ADD_COLUMN }} />
            </colgroup>
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 border-r border-b border-border bg-background" aria-label="Row" />
                {columns.map((column, index) => (
                  <th
                    key={column.id}
                    scope="col"
                    aria-colindex={index + 1}
                    className={cn("group/header sticky top-0 z-20 h-8 border-r border-b border-border bg-background p-0 text-left font-normal", box && index >= box.left && index <= box.right && "bg-muted")}
                  >
                    <ColumnMenu table={table} view={view} column={column} onColumns={onColumns} onView={onView}>
                      <button type="button" className="flex h-8 w-full min-w-0 items-center gap-1.5 px-2 text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active">
                        <Icon name={COLUMN_TYPE_INFO[column.type].icon} className="size-3.5 shrink-0" />
                        <span className="truncate text-[13px]">{column.name}</span>
                        {sortOf.get(column.id) ? <Icon name={sortOf.get(column.id) === "asc" ? "ArrowUp" : "ArrowDown"} className="ml-auto size-3.5 shrink-0 text-primary" /> : null}
                      </button>
                    </ColumnMenu>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${column.name}`}
                      className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-1 after:left-[3px] after:w-0.5 after:rounded after:bg-primary after:opacity-0 hover:after:opacity-100"
                      onPointerDown={(event) => resize(event, column)}
                    />
                  </th>
                ))}
                <th className="sticky top-0 z-20 border-b border-border bg-background p-0">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" aria-label="Add column" className="flex h-8 w-full items-center justify-center text-muted-foreground hover:bg-state-hover hover:text-foreground">
                        <Icon name="Plus" className="size-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52" align="end">
                      <p className="px-2 py-1 text-xs text-muted-foreground">New column</p>
                      <TypeList onPick={(type) => onColumns([...table.columns, newColumn(table.columns, type)])} />
                    </PopoverContent>
                  </Popover>
                </th>
              </tr>
            </thead>
            <ContextMenuTrigger asChild>
              <tbody>
                {rows.map((row, r) => {
                  const rowSelected = !!box && r >= box.top && r <= box.bottom;
                  return (
                    <tr key={row.id} aria-rowindex={r + 2} className={cn("group/row", flash === row.id && "animate-pulse")}>
                      <td
                        className={cn(
                          "sticky left-0 z-10 h-8 border-r border-b border-border bg-background p-0 text-right text-xs text-muted-foreground tabular-nums",
                          rowSelected && "bg-muted text-foreground",
                        )}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          focusKeys();
                          setEditing(null);
                          const first = { row: r, col: 0 };
                          const last = { row: r, col: columns.length - 1 };
                          if (event.shiftKey && selection) setSelection({ anchor: { row: selection.anchor.row, col: 0 }, focus: last });
                          else select(first, last);
                        }}
                      >
                        <span className="flex h-8 items-center justify-end gap-0.5 pr-2">
                          <button
                            type="button"
                            aria-label="Open row"
                            title="Open row"
                            className="hidden size-5 items-center justify-center rounded text-muted-foreground group-hover/row:flex hover:bg-state-hover hover:text-foreground"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => onOpenRow(row.id)}
                          >
                            <Icon name="ArrowUpRight" className="size-3.5" />
                          </button>
                          <span className="group-hover/row:hidden">{r + 1}</span>
                        </span>
                      </td>
                      {columns.map((column, c) => {
                        const selected = !!box && inBounds(box, r, c);
                        const isFocus = cursor?.row === r && cursor.col === c;
                        const isEditing = editing?.row === r && editing.col === c;
                        return (
                          <td
                            key={column.id}
                            role="gridcell"
                            data-cell={`${r}:${c}`}
                            aria-selected={selected}
                            className={cn(
                              "relative h-8 scroll-mt-8 scroll-ml-11 border-r border-b border-border p-0",
                              selected && many && "bg-primary/[0.07]",
                              isFocus && !isEditing && (active ? "ring-2 ring-primary ring-inset" : "ring-1 ring-primary/50 ring-inset"),
                            )}
                            onMouseDown={(event) => cellDown(event, { row: r, col: c })}
                            onMouseEnter={() => dragging.current && selection && setSelection({ anchor: selection.anchor, focus: { row: r, col: c } })}
                            onDoubleClick={() => startEditing({ row: r, col: c })}
                          >
                            <div className={cn("flex h-8 items-center overflow-hidden px-2", column.type === "checkbox" && "justify-center")}>
                              <CellValue column={column} cell={row.values[column.id]} host={host} />
                            </div>
                            {isEditing ? (
                              <CellEditor
                                column={column}
                                cell={row.values[column.id]}
                                host={host}
                                initial={editing.initial}
                                onCommit={commit({ row: r, col: c })}
                                onCancel={() => {
                                  setEditing(null);
                                  focusKeys();
                                }}
                              />
                            ) : null}
                          </td>
                        );
                      })}
                      <td className="border-b border-border" />
                    </tr>
                  );
                })}
              </tbody>
            </ContextMenuTrigger>
          </table>
          <ContextMenuContent className="w-52" onCloseAutoFocus={(event) => (event.preventDefault(), focusKeys())}>
            {box && rows[box.top] ? (
              <>
                <ContextMenuItem onSelect={() => insertRow(rows[box.top]!.id, false)}>
                  <Icon name="ArrowUp" /> Insert row above
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => insertRow(after(rows[box.bottom]!), false)}>
                  <Icon name="ArrowDown" /> Insert row below
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onOpenRow(rows[box.top]!.id)}>
                  <Icon name="ArrowUpRight" /> Open row
                </ContextMenuItem>
                {host.copyLink ? (
                  <ContextMenuItem onSelect={() => host.copyLink!({ ...(view ? { viewId: view.id } : {}), rowId: rows[box.top]!.id })}>
                    <Icon name="Paperclip" /> Copy link to row
                  </ContextMenuItem>
                ) : null}
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => void navigator.clipboard?.writeText(copy())}>
                  <Icon name="Copy" /> Copy
                </ContextMenuItem>
                <ContextMenuItem onSelect={clear}>
                  <Icon name="X" /> Clear {many ? "cells" : "cell"}
                </ContextMenuItem>
                <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={removeRows}>
                  <Icon name="Trash2" /> Delete {rowCount > 1 ? `${rowCount} rows` : "row"}
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
        <button
          type="button"
          className="sticky left-0 flex h-8 w-full max-w-[min(100%,24rem)] items-center gap-2 px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => insertRow(null)}
        >
          <Icon name="Plus" className="size-4" /> New row
        </button>
      </div>
    </div>
  );
}
