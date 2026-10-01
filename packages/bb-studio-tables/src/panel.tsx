import { useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { AddOnCollection, FLOATING_BUTTON, Icon, ItemHeader, useAddOnPanel } from "@bb-studio/kit/app";
import { Button, Input } from "@bb-studio/kit/ui";
import { errorMessage } from "@bb-studio/kit/format";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import {
  cellText,
  queryRows,
  type Cell,
  type Column,
  type Row,
  type Table,
  type View,
} from "./model";

const pluginId = "studio-tables";
const channel = "studio-tables-changed";
function valueFromInput(column: Column, raw: string): Cell {
  if (!raw) return null;
  if (column.type === "number") return Number(raw);
  if (column.type === "checkbox") return raw === "true";
  if (column.type === "multi-select")
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  if (column.type === "relation") {
    const [pluginId, itemId] = raw.split(":");
    return { pluginId: pluginId ?? "", itemId: itemId ?? "" };
  }
  return raw;
}
function CellInput({
  column,
  value,
  onChange,
}: {
  column: Column;
  value: Cell | undefined;
  onChange(value: Cell): void;
}) {
  const [draft, setDraft] = useState(cellText(value));
  useEffect(() => setDraft(cellText(value)), [value]);
  if (column.type === "checkbox")
    return (
      <input
        aria-label={column.name}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  if (column.type === "select")
    return (
      <select
        aria-label={column.name}
        className="w-full bg-transparent text-sm"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Empty</option>
        {column.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  return (
    <input
      aria-label={column.name}
      className="w-full min-w-32 bg-transparent px-1 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
      type={
        column.type === "number"
          ? "number"
          : column.type === "date"
            ? "date"
            : column.type === "url"
              ? "url"
              : "text"
      }
      value={draft}
      onBlur={() => {
        if (draft !== cellText(value)) onChange(valueFromInput(column, draft));
      }}
      placeholder={column.type === "relation" ? "plugin:item" : ""}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}
function CalendarView({
  rows,
  table,
  dateColumn,
}: {
  rows: Row[];
  table: Table;
  dateColumn: string;
}) {
  const initial = rows.find((row) => typeof row.values[dateColumn] === "string")
    ?.values[dateColumn];
  const [month, setMonth] = useState(() =>
    typeof initial === "string"
      ? initial.slice(0, 7)
      : new Date().toISOString().slice(0, 7),
  );
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year!, monthNumber! - 1, 1));
  const offset = first.getUTCDay();
  const days = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  const move = (by: number) =>
    setMonth(
      new Date(Date.UTC(year!, monthNumber! - 1 + by, 1))
        .toISOString()
        .slice(0, 7),
    );
  return (
    <section aria-label="Calendar view" className="min-w-[640px]">
      <header className="mb-3 flex items-center gap-3">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <h3 className="font-medium">
          {new Intl.DateTimeFormat(undefined, {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(first)}
        </h3>
        <button type="button" aria-label="Next month" onClick={() => move(1)}>
          ›
        </button>
      </header>
      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="py-2">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-l border-t border-border">
        {Array.from(
          { length: Math.ceil((offset + days) / 7) * 7 },
          (_, index) => {
            const date = index - offset + 1;
            const day =
              date > 0 && date <= days
                ? `${month}-${String(date).padStart(2, "0")}`
                : null;
            return (
              <div
                key={index}
                className="min-h-28 border-b border-r border-border p-2"
              >
                <span className="text-xs text-muted-foreground">
                  {day ? date : ""}
                </span>
                {day &&
                  rows
                    .filter((row) => row.values[dateColumn] === day)
                    .map((row) => (
                      <div
                        key={row.id}
                        className="mt-1 truncate rounded bg-muted px-1.5 py-1 text-xs"
                        title={table.columns
                          .map((column) => cellText(row.values[column.id]))
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        {table.columns
                          .filter((column) => column.id !== dateColumn)
                          .map((column) => cellText(row.values[column.id]))
                          .find(Boolean) ?? "Untitled row"}
                      </div>
                    ))}
              </div>
            );
          },
        )}
      </div>
    </section>
  );
}

function Editor({ tableId, backLabel, onBack }: { tableId: string; backLabel: string; onBack(): void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [table, setTable] = useState<Table | null>(null);
  const [viewId, setViewId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useRealtime(channel, () => setVersion((n) => n + 1));
  useEffect(() => {
    void rpc
      .call("get", { id: tableId })
      .then(({ table }) => {
        setTable(table);
        setViewId((current) => current || table?.views[0]?.id || "");
      })
      .catch((error) => setError(errorMessage(error)));
  }, [rpc, tableId, version]);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
      setVersion((n) => n + 1);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  if (error || !table)
    return (
      <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
        <ItemHeader className="relative shrink-0 items-center border-b border-border/70" backLabel={backLabel} onBack={() => onBack()} />
        <p role={error ? "alert" : "status"} className={`p-6 text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
          {error || "Loading table…"}
        </p>
      </div>
    );
  const view = table.views.find((item) => item.id === viewId) ?? table.views[0];
  const rows = queryRows(table, view);
  const setColumn = (column: Column) =>
    void run(async () => {
      await rpc.call("update", {
        id: table.id,
        columns: [...table.columns, column],
      });
    });
  const saveView = (next: View) =>
    void run(async () => {
      await rpc.call("update", {
        id: table.id,
        views: table.views.map((item) => (item.id === next.id ? next : item)),
      });
    });
  const editCell = (row: Row, column: Column, value: Cell) => {
    setTable({
      ...table,
      rows: table.rows.map((item) =>
        item.id === row.id
          ? { ...item, values: { ...item.values, [column.id]: value } }
          : item,
      ),
    });
    void run(() =>
      rpc.call("updateRow", {
        id: table.id,
        rowId: row.id,
        values: { [column.id]: value },
      }),
    );
  };
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <ItemHeader
        className="relative shrink-0 items-center border-b border-border/70"
        backLabel={backLabel}
        onBack={() => onBack()}
        leading={
          <input
            aria-label="Table title"
            key={table.title}
            defaultValue={table.title}
            maxLength={200}
            className="h-8 min-w-24 max-w-md rounded-md bg-transparent px-2 text-sm font-medium outline-none [field-sizing:content] hover:bg-state-hover focus:bg-state-hover max-md:max-w-32"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.currentTarget.value = table.title;
                event.currentTarget.blur();
              }
            }}
            onBlur={(event) => {
              const title = event.currentTarget.value.trim();
              if (title && title !== table.title) void run(() => rpc.call("update", { id: table.id, title }));
              else event.currentTarget.value = table.title;
            }}
          />
        }
        thread={{ title: table.title, href: `/plugins/${pluginId}/tables/${table.id}` }}
        trailing={
          <button
            type="button"
            className={FLOATING_BUTTON}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { csv } = await rpc.call("exportCsv", {
                  id: table.id,
                  ...(view ? { viewId: view.id } : {}),
                });
                const url = URL.createObjectURL(
                  new Blob([csv], { type: "text/csv" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `${table.title}.csv`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              })
            }
          >
            <Icon name="Download" /> Export CSV
          </button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2">
        <label className="text-xs text-muted-foreground" htmlFor="table-view">
          View
        </label>
        <select
          id="table-view"
          className="rounded border border-border bg-background px-2 py-1 text-sm"
          value={view?.id ?? ""}
          onChange={(event) => setViewId(event.target.value)}
        >
          {table.views.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const name = window.prompt("View name");
              if (!name) return;
              const type = window.prompt(
                "View type: table, board, or calendar",
                "table",
              );
              if (type !== "table" && type !== "board" && type !== "calendar")
                return;
              const target =
                type === "board"
                  ? table.columns.find((column) => column.type === "select")
                  : type === "calendar"
                    ? table.columns.find((column) => column.type === "date")
                    : undefined;
              if (type !== "table" && !target)
                throw new Error(
                  `Add a ${type === "board" ? "select" : "date"} column first.`,
                );
              await rpc.call("update", {
                id: table.id,
                views: [
                  ...table.views,
                  {
                    id: `view_${crypto.randomUUID()}`,
                    name,
                    type,
                    groupBy: type === "board" ? target!.id : null,
                    dateBy: type === "calendar" ? target!.id : null,
                    filters: [],
                    sorts: [],
                  },
                ],
              });
            })
          }
        >
          Add view
        </Button>
        {view && (
          <>
            <select
              aria-label="Sort column"
              className="rounded border border-border bg-background px-2 py-1 text-sm"
              value={view.sorts[0]?.columnId ?? ""}
              onChange={(event) =>
                saveView({
                  ...view,
                  sorts: event.target.value
                    ? [{ columnId: event.target.value, direction: "asc" }]
                    : [],
                })
              }
            >
              <option value="">No sort</option>
              {table.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  Sort: {column.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter column"
              className="rounded border border-border bg-background px-2 py-1 text-sm"
              value={view.filters[0]?.columnId ?? ""}
              onChange={(event) =>
                saveView({
                  ...view,
                  filters: event.target.value
                    ? [
                        {
                          columnId: event.target.value,
                          op: "contains",
                          value: "",
                        },
                      ]
                    : [],
                })
              }
            >
              <option value="">No filter</option>
              {table.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  Filter: {column.name}
                </option>
              ))}
            </select>
            {view.filters[0] && (
              <Input
                aria-label="Filter value"
                className="h-8 w-36"
                value={String(view.filters[0].value ?? "")}
                onChange={(event) =>
                  setTable({
                    ...table,
                    views: table.views.map((item) =>
                      item.id === view.id
                        ? {
                            ...view,
                            filters: [
                              {
                                ...view.filters[0]!,
                                value: event.target.value,
                              },
                            ],
                          }
                        : item,
                    ),
                  })
                }
                onBlur={() => saveView(view)}
              />
            )}
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {view?.type === "board" ? (
          <div className="flex gap-3 overflow-x-auto">
            {[
              ...(table.columns.find((column) => column.id === view.groupBy)
                ?.options ?? []),
              "Unassigned",
            ].map((option) => (
              <section
                key={option}
                className="w-64 shrink-0 rounded-md border border-border p-3"
              >
                <h3 className="mb-3 text-sm font-medium">{option}</h3>
                {rows
                  .filter(
                    (row) =>
                      (row.values[view.groupBy!] ?? "Unassigned") === option,
                  )
                  .map((row) => (
                    <div
                      key={row.id}
                      className="mb-2 rounded border border-border bg-background p-2 text-sm"
                    >
                      {table.columns.map((column) => (
                        <div key={column.id}>
                          {cellText(row.values[column.id])}
                        </div>
                      ))}
                    </div>
                  ))}
              </section>
            ))}
          </div>
        ) : view?.type === "calendar" ? (
          <CalendarView
            key={view.id}
            rows={rows}
            table={table}
            dateColumn={view.dateBy!}
          />
        ) : (
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    className="min-w-40 border border-border bg-muted/40 px-2 py-2 font-medium"
                  >
                    {column.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {column.type}
                    </span>
                  </th>
                ))}
                <th className="w-10 border border-border" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {table.columns.map((column) => (
                    <td key={column.id} className="border border-border px-2">
                      <CellInput
                        column={column}
                        value={row.values[column.id]}
                        onChange={(value) => editCell(row, column, value)}
                      />
                    </td>
                  ))}
                  <td className="border border-border text-center">
                    <button
                      type="button"
                      aria-label="Delete row"
                      onClick={() => {
                        if (window.confirm("Delete this row?"))
                          void run(() =>
                            rpc.call("deleteRow", {
                              id: table.id,
                              rowId: row.id,
                            }),
                          );
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() => rpc.call("insert", { id: table.id, values: {} }))
            }
          >
            Add row
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              const name = window.prompt("Column name");
              if (!name) return;
              const type = window.prompt(
                "Type: text, number, select, multi-select, date, checkbox, person, bot, url, relation",
                "text",
              );
              if (!type) return;
              const options =
                type === "select" || type === "multi-select"
                  ? (window.prompt("Options, separated by commas") ?? "")
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean)
                  : [];
              setColumn({
                id: `col_${crypto.randomUUID()}`,
                name,
                type: type as Column["type"],
                options,
              });
            }}
          >
            Add column
          </Button>
          <label className="inline-flex cursor-pointer items-center rounded border border-border px-3 text-sm">
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void file
                    .text()
                    .then((csv) =>
                      run(() => rpc.call("importCsv", { id: table.id, csv })),
                    );
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
export function TablesPanel({ subPath }: { subPath: string }) {
  const { call, refreshKey, studio, toCollection } = useAddOnPanel(channel, "tables", "table");
  const id = subPath.split("/").filter(Boolean)[0];
  if (id)
    return (
      <Editor
        tableId={id}
        backLabel={studio ? "Studio" : "Tables"}
        onBack={toCollection}
      />
    );
  return (
    <AddOnCollection
      pluginId={pluginId}
      title="Tables"
      kind="table"
      call={call}
      refreshKey={refreshKey}
    />
  );
}
