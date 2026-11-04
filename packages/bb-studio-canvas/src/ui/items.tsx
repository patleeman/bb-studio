// What each board item looks like. Widgets are Dashboards' renderers
// (src/dashboards/ui/widgets.tsx), fed the item's data as a static value; a
// headline is big type straight on the board, a caption is Studio's markdown.
import type { ReactNode } from "react";
import { cn, columnLabel, Markdown, ScrollBody, tableOf, WidgetBody, type WidgetTheme, type WidgetType, type WidgetView } from "./studio";
import { captionOf, headlineOf, type CanvasItem } from "../shared";

/** A canvas item as Dashboards' renderers read a widget. */
export function asWidget(item: CanvasItem): WidgetView {
  return {
    id: item.id,
    type: item.kind as WidgetType,
    // A stat draws its own small label, which leaves room for its caption and sparkline.
    title: item.kind === "stat" ? null : item.title,
    options: item.kind === "stat" && item.title ? { ...item.options, label: item.title } : item.options,
    source: { kind: "static", data: item.data },
    customType: null,
    html: item.html,
    script: null,
  };
}

/** Kinds drawn straight on the board, without a card. */
export const BARE_KINDS: ReadonlySet<string> = new Set(["headline", "caption"]);
/** Kinds that draw their own label inside the card. */
const SELF_LABELLED: ReadonlySet<string> = new Set(["stat"]);

const TONE: Record<string, string> = {
  neutral: "text-foreground",
  good: "text-emerald-700 dark:text-emerald-300",
  bad: "text-red-700 dark:text-red-300",
  accent: "text-primary",
};

function Headline({ item, height }: { item: CanvasItem; height: number }) {
  const headline = headlineOf(item.data);
  if (!headline) return null;
  // Big when there's room: the headline is read from across the room.
  const size = height >= 190 ? "text-5xl" : height >= 130 ? "text-4xl" : "text-3xl";
  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-1.5 px-1" data-canvas-body="headline">
      {headline.kicker ? <div className="truncate text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{headline.kicker}</div> : null}
      <h2 className={cn("line-clamp-2 text-balance font-semibold leading-[1.05] tracking-tight", size, TONE[headline.tone])}>{headline.text}</h2>
      {headline.subtitle ? <p className="line-clamp-2 text-base text-muted-foreground">{headline.subtitle}</p> : null}
    </div>
  );
}

function Caption({ item }: { item: CanvasItem }) {
  const text = captionOf(item.data);
  if (!text) return null;
  return (
    <div className="h-full min-h-0 overflow-hidden px-1 text-[15px] leading-relaxed text-foreground/85" data-canvas-body="caption">
      {item.title ? <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{item.title}</div> : null}
      <Markdown source={text} />
    </div>
  );
}

/** Narrowest a table column gets before the table scrolls sideways instead. */
export const MIN_COLUMN_PX = 78;

/** How many columns a table item shows (0 for other kinds), for the layout. */
export function tableColumns(item: CanvasItem): number {
  return item.kind === "table" ? tableOf(item.data, item.options)?.columns.length ?? 0 : 0;
}

/** Common long header words, shortened when a table is tight; the full header stays in the tooltip. */
const SHORT: Record<string, string> = {
  estimated: "Est.", estimate: "Est.", population: "Pop.", percentage: "%", percent: "%", number: "No.", reporting: "Rptg.", reported: "Rptd.",
  opponent: "Opp.", candidate: "Cand.", average: "Avg.", maximum: "Max", minimum: "Min", temperature: "Temp.", difference: "Diff.",
  previous: "Prev.", outstanding: "Outst.", conditions: "Cond.", residents: "Res.", approximately: "Approx.", government: "Govt.", international: "Intl.",
};

/** A header as short as it can be while it still reads: only when the table is tight and the header long. */
export function shortHeader(label: string, perColumn: number): string {
  if (label.length <= Math.max(8, Math.floor(perColumn / 8))) return label;
  // Word by word, punctuation kept: "Margin (percentage)" reads "Margin (%)".
  return label.replace(/[A-Za-z]+/g, (word) => SHORT[word.toLowerCase()] ?? word);
}

/**
 * A table that fits its card: fixed columns sharing the width, cells and
 * headers wrapping, long headers shortened. It scrolls sideways only when
 * even MIN_COLUMN_PX a column won't fit.
 */
function CanvasTable({ item, width }: { item: CanvasItem; width: number }) {
  const table = tableOf(item.data, item.options);
  if (!table) return null;
  const inner = Math.max(0, width - 2);
  const fits = table.columns.length * MIN_COLUMN_PX <= inner;
  const perColumn = (fits ? inner : table.columns.length * MIN_COLUMN_PX) / Math.max(1, table.columns.length);
  const text = (value: unknown) => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : typeof value === "number" ? new Intl.NumberFormat().format(value) : String(value));
  return (
    <ScrollBody kind="table">
      <table className="w-full table-fixed border-collapse text-xs" style={fits ? undefined : { width: table.columns.length * MIN_COLUMN_PX }} data-canvas-table={fits ? "fits" : "scrolls"}>
        <thead className="sticky top-0 z-[1] bg-card">
          <tr>{table.columns.map((column) => {
            const label = columnLabel(column);
            return <th key={column} scope="col" title={label} className="whitespace-normal break-words border-b border-border px-2.5 py-1.5 text-left align-bottom font-medium leading-tight text-muted-foreground">{shortHeader(label, perColumn)}</th>;
          })}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column} className={cn("whitespace-normal break-words border-b border-border/50 px-2.5 py-1.5 align-top leading-snug text-foreground [overflow-wrap:anywhere]", typeof cell === "number" && "text-right tabular-nums")}>{text(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBody>
  );
}

/** The item's content, sized to its cell. */
export function ItemBody({ item, width, height, theme }: { item: CanvasItem; width: number; height: number; theme: WidgetTheme }): ReactNode {
  if (item.kind === "headline") return <Headline item={item} height={height} />;
  if (item.kind === "caption") return <Caption item={item} />;
  if (item.kind === "table" && tableOf(item.data, item.options)) return <CanvasTable item={item} width={width} />;
  return <WidgetBody widget={asWidget(item)} value={item.data} width={width} height={height} theme={theme} types={[]} />;
}

/** The small title over a card, when the item has one. */
export function itemLabel(item: CanvasItem): string | null {
  if (BARE_KINDS.has(item.kind) || SELF_LABELLED.has(item.kind)) return null;
  return item.title;
}
