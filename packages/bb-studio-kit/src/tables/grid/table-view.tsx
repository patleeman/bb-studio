// A table with its views: the spreadsheet, a board or a calendar, the bar
// that switches and shapes them, and the row form. Tables shows it full
// size; Pages embeds it in a document.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { cn } from "../../ui/utils";
import { queryRows, type Column, type Row, type Table, type Values, type View } from "../model";
import { Board } from "./board";
import { Calendar } from "./calendar";
import { Grid } from "./grid";
import type { TableHost } from "./host";
import { RowDialog } from "./row-dialog";
import { useTableState, type TableApi, type TableMeta } from "./state";
import { Toolbar } from "./toolbar";

/** Values that keep a new row in a filtered view. */
export function filterDefaults(table: Table, view: View | undefined): Values {
  const values: Values = {};
  for (const filter of view?.filters ?? []) {
    const column = table.columns.find((each) => each.id === filter.columnId);
    if (!column || filter.op !== "eq" || filter.value == null || filter.value === "") continue;
    values[column.id] = column.type === "multi-select" && typeof filter.value === "string" ? [filter.value] : filter.value;
  }
  return values;
}

function viewRows(table: Table, view: View | undefined): Row[] {
  try {
    return queryRows(table, view);
  } catch {
    // A view saved against an older set of columns shows every row.
    return table.rows;
  }
}

export function TableView({
  table: source,
  api,
  host,
  viewId: controlledView,
  onViewChange,
  rowId: controlledRow,
  onRowChange,
  embedded = false,
  leading,
  trailing,
  className,
}: {
  table: Table;
  api: TableApi;
  host: TableHost;
  /** The open view; the first when unset. */
  viewId?: string | null;
  onViewChange?(viewId: string): void;
  /** The row open in the row form, as a link to it sets. */
  rowId?: string | null;
  onRowChange?(rowId: string | null): void;
  /** Sized to sit in a page rather than fill a panel. */
  embedded?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const onError = useCallback((error: unknown) => host.onError(error), [host]);
  const { table, apply, undo, redo } = useTableState(source, api, onError);
  const [localView, setLocalView] = useState<string | null>(null);
  const [localRow, setLocalRow] = useState<string | null>(null);
  const [linkedRow] = useState(controlledRow ?? null);
  const viewId = controlledView ?? localView;
  const view = table.views.find((each) => each.id === viewId) ?? table.views[0];
  const rows = useMemo(() => viewRows(table, view), [table, view]);
  const columns = useMemo(() => table.columns.filter((column) => !view?.hidden.includes(column.id)), [table.columns, view]);
  const openRowId = onRowChange ? (controlledRow ?? null) : localRow;
  const openRow = openRowId ? table.rows.find((row) => row.id === openRowId) : undefined;
  const setRow = (rowId: string | null) => (onRowChange ? onRowChange(rowId) : setLocalRow(rowId));
  const selectView = (id: string) => (onViewChange ? onViewChange(id) : setLocalView(id));
  const onMeta = (meta: TableMeta, undoable = true) => apply({ meta }, undoable);
  const onColumns = (next: Column[]) => apply({ meta: { columns: next } });
  const onView = (next: View) => apply({ meta: { views: table.views.map((each) => (each.id === next.id ? next : each)) } }, false);
  const newRowValues = () => filterDefaults(table, view);
  const copyLink = host.copyLink;

  return (
    <div className={cn("flex min-h-0 flex-col", embedded ? "rounded-lg border border-border" : "h-full", className)}>
      <Toolbar
        table={table}
        view={view}
        shown={rows.length}
        onSelectView={selectView}
        onMeta={onMeta}
        onCopyLink={copyLink ? (id) => copyLink({ viewId: id }) : undefined}
        leading={leading}
        trailing={trailing}
      />
      {view?.type === "board" ? (
        <Board table={table} view={view} rows={rows} host={host} apply={apply} onOpenRow={setRow} newRowValues={newRowValues} />
      ) : view?.type === "calendar" ? (
        <Calendar table={table} view={view} rows={rows} apply={apply} onOpenRow={setRow} newRowValues={newRowValues} />
      ) : (
        <Grid
          table={table}
          view={view}
          rows={rows}
          columns={columns}
          host={host}
          apply={apply}
          undo={undo}
          redo={redo}
          onColumns={onColumns}
          onView={onView}
          onOpenRow={setRow}
          newRowValues={newRowValues}
          highlightRowId={linkedRow}
          embedded={embedded}
        />
      )}
      {openRow ? <RowDialog table={table} row={openRow} rows={rows} host={host} apply={apply} onOpenRow={setRow} onClose={() => setRow(null)} /> : null}
    </div>
  );
}
