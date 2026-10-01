// A board view: a lane for each option of the view's select column, with
// cards dragged between lanes to change it.
import { useState } from "react";
import { Icon } from "../../ui/icon";
import { cn } from "../../ui/utils";
import { isEmpty, rowTitle, titleColumn, type Column, type Row, type Table, type Values, type View } from "../model";
import { CellValue, OptionChip } from "./cells";
import type { TableHost } from "./host";
import { newRowId, type Change } from "./state";

const NONE = "";

export function Board({
  table,
  view,
  rows,
  host,
  apply,
  onOpenRow,
  newRowValues,
}: {
  table: Table;
  view: View;
  rows: Row[];
  host: TableHost;
  apply(change: Change): boolean;
  onOpenRow(rowId: string): void;
  newRowValues(): Values;
}) {
  const [over, setOver] = useState<string | null>(null);
  const group = table.columns.find((column) => column.id === view.groupBy);
  if (!group) return <p className="p-6 text-sm text-muted-foreground">Group this board by a select column.</p>;
  const title = titleColumn(table);
  const shown = table.columns.filter((column) => column.id !== group.id && column.id !== title?.id && !view.hidden.includes(column.id)).slice(0, 4);
  const lanes = [...group.options, NONE];
  const laneOf = (row: Row) => {
    const value = row.values[group.id];
    return typeof value === "string" && group.options.includes(value) ? value : NONE;
  };
  const move = (rowId: string, lane: string) =>
    apply({ rows: { update: [{ rowId, values: { [group.id]: lane === NONE ? null : lane } }] } });
  const add = (lane: string) => {
    const id = newRowId();
    if (apply({ rows: { insert: [{ id, values: { ...newRowValues(), [group.id]: lane === NONE ? null : lane } }] } })) onOpenRow(id);
  };
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {lanes.map((lane) => {
        const cards = rows.filter((row) => laneOf(row) === lane);
        if (lane === NONE && !cards.length) return null;
        return (
          <section
            key={lane || "none"}
            aria-label={lane || `No ${group.name}`}
            className={cn("flex w-64 shrink-0 flex-col rounded-lg bg-muted/40 p-2", over === lane && "bg-primary/10 ring-1 ring-primary/40")}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("application/x-table-row")) return;
              event.preventDefault();
              setOver(lane);
            }}
            onDragLeave={() => setOver((current) => (current === lane ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const rowId = event.dataTransfer.getData("application/x-table-row");
              const row = rows.find((each) => each.id === rowId);
              if (row && laneOf(row) !== lane) move(rowId, lane);
            }}
          >
            <header className="flex items-center gap-2 px-1 pb-2">
              {lane ? <OptionChip column={group} option={lane} /> : <span className="text-xs text-muted-foreground">No {group.name}</span>}
              <span className="text-xs text-muted-foreground tabular-nums">{cards.length}</span>
            </header>
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
              {cards.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  draggable
                  className="flex w-full flex-col gap-1.5 rounded-md border border-border bg-background p-2 text-left text-sm shadow-xs hover:border-foreground/20"
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-table-row", row.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => onOpenRow(row.id)}
                >
                  <span className="font-medium break-words">{rowTitle(table, row)}</span>
                  {shown.map((column: Column) =>
                    isEmpty(row.values[column.id]) ? null : (
                      <span key={column.id} className="flex min-w-0 items-center text-xs text-muted-foreground">
                        <CellValue column={column} cell={row.values[column.id]} host={host} wrap />
                      </span>
                    ),
                  )}
                </button>
              ))}
              <button type="button" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => add(lane)}>
                <Icon name="Plus" className="size-4" /> New
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
