// One row as a form: every field, including the ones its view hides, with
// steps to the previous and next row of the view.
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog";
import { Icon } from "../../ui/icon";
import { cn } from "../../ui/utils";
import { COLUMN_TYPE_INFO, titleColumn, type Cell, type Column, type Row, type Table } from "../model";
import { tableHref } from "../contract";
import { CellValue } from "./cells";
import { CellEditor, PICKED_TYPES } from "./editors";
import type { TableHost } from "./host";
import type { Change } from "./state";

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function Field({ column, cell, host, selfHref, onChange }: { column: Column; cell: Cell | undefined; host: TableHost; selfHref: string; onChange(cell: Cell): void }) {
  const [editing, setEditing] = useState(false);
  const empty = cell == null || cell === "" || (Array.isArray(cell) && !cell.length);
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-2 max-sm:grid-cols-1 max-sm:gap-0.5">
      <span className="flex h-8 items-center gap-1.5 truncate text-sm text-muted-foreground">
        <Icon name={COLUMN_TYPE_INFO[column.type].icon} className="size-3.5 shrink-0" />
        <span className="truncate">{column.name}</span>
      </span>
      <div className="relative min-w-0">
        {editing && !PICKED_TYPES.has(column.type) ? (
          <CellEditor
            mode="field"
            selfHref={selfHref}
            column={column}
            cell={cell}
            host={host}
            onCommit={(next) => {
              setEditing(false);
              onChange(next);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            type="button"
            aria-label={`Edit ${column.name}`}
            className="flex min-h-8 w-full items-center rounded-md px-2 py-1 text-left text-sm hover:bg-state-hover"
            onClick={() => (column.type === "checkbox" ? onChange(cell !== true) : setEditing(true))}
          >
            {empty && column.type !== "checkbox" ? <span className="text-muted-foreground">Empty</span> : <CellValue column={column} cell={cell} host={host} wrap />}
          </button>
        )}
        {editing && PICKED_TYPES.has(column.type) ? (
          <CellEditor
            mode="field"
            selfHref={selfHref}
            column={column}
            cell={cell}
            host={host}
            onCommit={(next) => {
              setEditing(false);
              onChange(next);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

export function RowDialog({
  table,
  row,
  rows,
  host,
  apply,
  onOpenRow,
  onClose,
}: {
  table: Table;
  row: Row;
  /** The view's rows, to step through. */
  rows: Row[];
  host: TableHost;
  apply(change: Change): boolean;
  onOpenRow(rowId: string): void;
  onClose(): void;
}) {
  const title = titleColumn(table);
  const index = rows.findIndex((each) => each.id === row.id);
  const update = (column: Column, cell: Cell) => apply({ rows: { update: [{ rowId: row.id, values: { [column.id]: cell } }] } });
  const stepTo = (by: number) => {
    const next = rows[index + by];
    if (next) onOpenRow(next.id);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl gap-0 overflow-y-auto p-0" hideCloseButton>
        <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-background px-3 py-2">
          <button type="button" aria-label="Previous row" disabled={index <= 0} className="rounded p-1.5 text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-30" onClick={() => stepTo(-1)}>
            <Icon name="ArrowUp" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next row"
            disabled={index < 0 || index >= rows.length - 1}
            className="rounded p-1.5 text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-30"
            onClick={() => stepTo(1)}
          >
            <Icon name="ArrowDown" className="size-4" />
          </button>
          <span className="px-1 text-xs text-muted-foreground tabular-nums">{index >= 0 ? `${index + 1} of ${rows.length}` : table.title}</span>
          <div className="ml-auto flex items-center gap-1">
            {host.copyLink ? (
              <button type="button" className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => host.copyLink!({ rowId: row.id })}>
                <Icon name="studio/link" fallback="Copy" className="size-3.5" /> Copy link
              </button>
            ) : null}
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-destructive"
              onClick={() => {
                if (apply({ rows: { remove: [row.id] } })) onClose();
              }}
            >
              <Icon name="Trash2" className="size-3.5" /> Delete
            </button>
            <button type="button" aria-label="Close" className="rounded p-1.5 text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={onClose}>
              <Icon name="X" className="size-4" />
            </button>
          </div>
        </div>
        <div className="space-y-1 px-6 pt-5 pb-6">
          <DialogTitle asChild>
            {title?.type === "text" ? (
              <input
                key={`${row.id}-${String(row.values[title.id] ?? "")}`}
                aria-label={title.name}
                defaultValue={String(row.values[title.id] ?? "")}
                placeholder="Untitled"
                className="mb-3 w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/60"
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                onBlur={(event) => {
                  const value = event.currentTarget.value.trim() || null;
                  if (value !== (row.values[title.id] ?? null)) update(title, value);
                }}
              />
            ) : (
              <h2 className="mb-3 text-2xl font-semibold">{table.title}</h2>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">Every field of this row in {table.title}.</DialogDescription>
          {table.columns
            .filter((column) => column.id !== (title?.type === "text" ? title.id : null))
            .map((column) => (
              <Field key={`${row.id}-${column.id}`} column={column} cell={row.values[column.id]} host={host} selfHref={tableHref({ tableId: table.id })} onChange={(cell) => update(column, cell)} />
            ))}
          <p className={cn("pt-4 text-xs text-muted-foreground")}>
            Added {TIME.format(row.createdAt)} · Edited {TIME.format(row.updatedAt)}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
