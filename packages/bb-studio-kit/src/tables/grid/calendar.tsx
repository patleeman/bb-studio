// A calendar view: rows on the day in the view's date column. Drag a row
// to another day to move it, or add one on a day.
import { useState } from "react";
import { Icon } from "../../ui/icon";
import { cn } from "../../ui/utils";
import { rowTitle, type Row, type Table, type Values, type View } from "../model";
import { newRowId, type Change } from "./state";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PAGE_SIZE = 10;
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function Calendar({
  table,
  view,
  rows,
  apply,
  onOpenRow,
  newRowValues,
}: {
  table: Table;
  view: View;
  rows: Row[];
  apply(change: Change): boolean;
  onOpenRow(rowId: string): void;
  newRowValues(): Values;
}) {
  const dateBy = view.dateBy;
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [over, setOver] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<string, number>>({});
  if (!dateBy) return <p className="p-6 text-sm text-muted-foreground">Choose a date column for this calendar.</p>;
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const offset = first.getUTCDay();
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const shift = (by: number) => setMonth(new Date(Date.UTC(year, monthNumber - 1 + by, 1)).toISOString().slice(0, 7));
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const day = row.values[dateBy];
    if (typeof day === "string") {
      const entries = byDay.get(day);
      if (entries) entries.push(row);
      else byDay.set(day, [row]);
    }
  }
  const undated = rows.length - [...byDay.values()].reduce((sum, each) => sum + each.length, 0);
  const now = today();
  const add = (day: string) => {
    const id = newRowId();
    if (apply({ rows: { insert: [{ id, values: { ...newRowValues(), [dateBy]: day } }] } })) onOpenRow(id);
  };
  return (
    <section aria-label="Calendar" className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
      <header className="mb-2 flex items-center gap-1">
        <h3 className="mr-2 text-sm font-medium">{MONTH.format(first)}</h3>
        <button type="button" aria-label="Previous month" className="rounded p-1 text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => shift(-1)}>
          <Icon name="ChevronLeft" className="size-4" />
        </button>
        <button type="button" className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => setMonth(now.slice(0, 7))}>
          Today
        </button>
        <button type="button" aria-label="Next month" className="rounded p-1 text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => shift(1)}>
          <Icon name="ChevronRight" className="size-4" />
        </button>
        {undated ? <span className="ml-auto text-xs text-muted-foreground">{undated} without a date</span> : null}
      </header>
      <div className="grid min-w-[42rem] grid-cols-7 text-xs text-muted-foreground">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-1">
            {day}
          </div>
        ))}
      </div>
      <div className="grid min-w-[42rem] grid-cols-7 overflow-hidden rounded-md border-t border-l border-border">
        {Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
          const date = index - offset + 1;
          const day = date > 0 && date <= days ? `${month}-${String(date).padStart(2, "0")}` : null;
          const entries = day ? (byDay.get(day) ?? []) : [];
          const pageKey = `${view.id}:${day}`;
          const lastPage = Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1);
          const page = Math.min(pages[pageKey] ?? 0, lastPage);
          const start = page * PAGE_SIZE;
          const setPage = (next: number) => setPages((current) => ({ ...current, [pageKey]: next }));
          return (
            <div
              key={index}
              className={cn("group/day relative min-h-24 border-r border-b border-border p-1", !day && "bg-muted/30", day && over === day && "bg-primary/10")}
              onDragOver={(event) => {
                if (!day || !event.dataTransfer.types.includes("application/x-table-row")) return;
                event.preventDefault();
                setOver(day);
              }}
              onDragLeave={() => setOver((current) => (current === day ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const rowId = event.dataTransfer.getData("application/x-table-row");
                if (day && rowId) apply({ rows: { update: [{ rowId, values: { [dateBy]: day } }] } });
              }}
            >
              {day ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className={cn("flex size-6 items-center justify-center rounded-full text-xs text-muted-foreground", day === now && "bg-primary font-medium text-primary-foreground")}>{date}</span>
                    <button
                      type="button"
                      aria-label={`Add a row on ${day}`}
                      className="hidden rounded p-0.5 text-muted-foreground group-hover/day:block hover:bg-state-hover hover:text-foreground"
                      onClick={() => add(day)}
                    >
                      <Icon name="Plus" className="size-3.5" />
                    </button>
                  </div>
                  {entries.slice(start, start + PAGE_SIZE).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      draggable
                      className="mt-0.5 block w-full truncate rounded bg-muted px-1.5 py-0.5 text-left text-xs hover:bg-state-hover"
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-table-row", row.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => onOpenRow(row.id)}
                    >
                      {rowTitle(table, row)}
                    </button>
                  ))}
                  {entries.length > PAGE_SIZE ? (
                    <nav aria-label={`Rows on ${day}`} className="mt-1 grid grid-cols-2 gap-0.5 text-[10px] text-muted-foreground">
                      <span className="col-span-2 tabular-nums">{start + 1}–{Math.min(start + PAGE_SIZE, entries.length)} of {entries.length}</span>
                      {([
                        ["First", 0, page === 0, "ChevronLeft"],
                        ["Previous", page - 1, page === 0, "ChevronLeft"],
                        ["Next", page + 1, page === lastPage, "ChevronRight"],
                        ["Last", lastPage, page === lastPage, "ChevronRight"],
                      ] as const).map(([name, next, disabled, icon]) => (
                        <button key={name} type="button" aria-label={`${name} rows on ${day}`} disabled={disabled} className="flex justify-center rounded p-1.5 hover:bg-state-hover disabled:opacity-30" onClick={() => setPage(next)}>
                          <Icon name={icon} className="size-4" />
                          {name === "First" || name === "Last" ? <Icon name={icon} className="-ml-2 size-4" /> : null}
                        </button>
                      ))}
                    </nav>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
