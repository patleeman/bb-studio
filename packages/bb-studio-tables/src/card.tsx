// `::table{id="tbl_…"}` in a reply: the table's first rows, read-only, under a
// header that opens it in the thread's workbench, beside the chat.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard, remember, openAppPath } from "@bb-studio/kit/app";
import { relativeTime } from "@bb-studio/kit/format";
import { cellText, queryRows, TABLES_CHANNEL, TABLES_PANEL, type Row, type Table, type TablesContract } from "@bb-studio/kit/tables";
import { useBbNavigate, useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";

/** The workbench tab's action id; reply cards open it with `{ tableId }`. */
export const TABLES_TAB = "tables";

/** Rows a card shows before it points at the rest. */
export const PREVIEW_ROWS = 20;

export const isTableId = (value: string) => /^tbl_[\w-]+$/.test(value);

/** The table, kept current as it changes. Null once it's gone. */
function useTable(id: string): Table | null | undefined {
  const rpc = useRpc<TablesContract>();
  const [table, setTable] = useState<Table | null | undefined>(undefined);
  const load = useCallback(() => {
    if (!id) return;
    rpc.call("get", { id }).then(
      ({ table }) => setTable(table),
      () => setTable(null),
    );
  }, [rpc, id]);
  useEffect(load, [load]);
  useRealtime(TABLES_CHANNEL, (event) => {
    const changed = (event as { tableId?: string } | null)?.tableId;
    if (changed === id) load();
  });
  return table;
}

/** The first view's rows in the order and columns it shows them. */
export function previewRows(table: Table): { columns: Table["columns"]; rows: Row[]; total: number } {
  const view = table.views[0];
  let rows: Row[];
  try {
    rows = queryRows(table, view);
  } catch {
    // A view saved against an older set of columns shows every row.
    rows = table.rows;
  }
  const columns = table.columns.filter((column) => !view?.hidden.includes(column.id));
  return { columns, rows: rows.slice(0, PREVIEW_ROWS), total: rows.length };
}

function TablePreview({ table }: { table: Table }) {
  const { columns, rows, total } = previewRows(table);
  if (!columns.length || !total) return <p className="px-3 py-2 text-sm text-muted-foreground">This table has no rows yet.</p>;
  return (
    <>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
          <tr>{columns.map((column) => <th key={column.id} className="max-w-60 truncate px-3 py-1.5 font-medium">{column.name}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border/70">
              {columns.map((column) => <td key={column.id} className="max-w-60 truncate px-3 py-1.5">{cellText(row.values[column.id])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length ? <p className="border-t border-border/70 px-3 py-1.5 text-xs text-muted-foreground">{total - rows.length} more rows</p> : null}
    </>
  );
}

export function TableCard({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const id = attributes.id ?? "";
  const valid = isTableId(id);
  const table = remember(`table:${id}`, useTable(valid ? id : ""));
  if (!valid || table === null) return <ItemDirectiveCard state="deleted" kind="table" icon="Rows2" />;
  if (!table) return <ItemDirectiveCard state="loading" kind="table" icon="Rows2" />;
  const title = table.title.trim() || "Untitled table";
  return (
    <ItemDirectiveCard
      state="ready"
      kind="table"
      icon="Rows2"
      title={title}
      details={`Table · ${table.rows.length} rows · ${relativeTime(table.updatedAt)}`}
      body={<TablePreview table={table} />}
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: TABLES_TAB, title, params: { tableId: id } }))
          openAppPath(`/plugins/studio-tables/${TABLES_PANEL}/${encodeURIComponent(id)}`);
      }}
    />
  );
}
