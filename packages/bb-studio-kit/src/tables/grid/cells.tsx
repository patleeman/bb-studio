// How each column type reads in a cell: chips for options, people and
// items, a box for checkboxes, numbers aligned for comparison.
import type { MouseEvent, ReactNode } from "react";
import { Icon } from "../../ui/icon";
import { cn } from "../../ui/utils";
import { ItemLinkText } from "../../app/item-links";
import { studioItemProps } from "../../app/studio-item";
import { isRelation, type Cell, type Column } from "../model";
import { findItem, type TableHost } from "./host";

const TONES = [
  "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-orange-500/15 text-orange-700 dark:text-orange-300",
];

/** An option's colour: by its place in the column, so it stays put as rows change. */
export function optionTone(column: Pick<Column, "options">, option: string): string {
  const index = column.options.indexOf(option);
  return TONES[(index < 0 ? option.length : index) % TONES.length]!;
}

export function Chip({ children, className, icon }: { children: ReactNode; className?: string; icon?: string }) {
  return (
    <span className={cn("inline-flex h-5 max-w-full shrink-0 items-center gap-1 truncate rounded px-1.5 text-xs leading-5", className)}>
      {icon ? <Icon name={icon} className="size-3 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function OptionChip({ column, option }: { column: Pick<Column, "options">; option: string }) {
  return <Chip className={optionTone(column, option)}>{option}</Chip>;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function formatDate(day: string): string {
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(time) ? day : DATE_FORMAT.format(time);
}

function stop(event: MouseEvent) {
  event.stopPropagation();
}

/** A cell's value for reading; `wrap` lets text run onto more lines, as cards and the row dialog do. */
export function CellValue({ column, cell, host, wrap = false }: { column: Column; cell: Cell | undefined; host: TableHost; wrap?: boolean }) {
  if (column.type === "checkbox")
    return (
      <span
        role="checkbox"
        aria-checked={cell === true}
        aria-label={column.name}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
          cell === true ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
        )}
      >
        {cell === true ? <Icon name="Check" className="size-3" /> : null}
      </span>
    );
  if (cell == null || cell === "" || (Array.isArray(cell) && !cell.length)) return null;
  const chips = (children: ReactNode) => <span className={cn("flex min-w-0 gap-1", wrap ? "flex-wrap" : "overflow-hidden")}>{children}</span>;
  switch (column.type) {
    case "number":
      return <span className="ml-auto truncate tabular-nums">{typeof cell === "number" ? cell.toLocaleString() : String(cell)}</span>;
    case "select":
      return typeof cell === "string" ? chips(<OptionChip column={column} option={cell} />) : null;
    case "multi-select":
      return Array.isArray(cell) ? chips(cell.map((option) => <OptionChip key={option} column={column} option={option} />)) : null;
    case "date":
      return <span className="truncate">{typeof cell === "string" ? formatDate(cell) : String(cell)}</span>;
    case "person":
    case "bot":
      return chips(
        <Chip icon={column.type === "bot" ? "Bot" : "UserRound"} className="bg-muted text-foreground">
          {String(cell)}
        </Chip>,
      );
    case "url": {
      const url = String(cell);
      let label = url;
      try {
        const parsed = new URL(url);
        label = parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
      } catch {}
      return (
        <a
          href={url}
          title={url}
          className={cn("text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary", wrap ? "break-all" : "truncate")}
          onMouseDown={stop}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            host.openUrl(url);
          }}
        >
          {label}
        </a>
      );
    }
    case "relation": {
      if (!isRelation(cell)) return null;
      const item = findItem(host, cell);
      return chips(
        <button
          type="button"
          className="inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded bg-muted px-1.5 text-xs hover:bg-state-hover"
          title={item ? `${item.kindLabel ?? "Item"}: ${item.title}` : `${cell.pluginId}:${cell.itemId}`}
          {...studioItemProps(item?.href ? { href: item.href, title: item.title, icon: item.kindIcon } : null, { drag: false })}
          onMouseDown={stop}
          onClick={(event) => {
            event.stopPropagation();
            host.openItem?.(cell);
          }}
        >
          {item?.icon ? <span className="shrink-0">{item.icon}</span> : <Icon name={item?.kindIcon ?? "GridView"} className="size-3 shrink-0" />}
          <span className="truncate">{item?.title ?? cell.itemId}</span>
        </button>,
      );
    }
    case "text":
      // Item links typed with @ or pasted from Copy reference show as pills.
      return <ItemLinkText text={String(cell)} className={wrap ? "whitespace-pre-wrap break-words" : "truncate"} onPillMouseDown={stop} />;
    default:
      return <span className={wrap ? "whitespace-pre-wrap break-words" : "truncate"}>{String(cell)}</span>;
  }
}
