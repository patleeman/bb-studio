// The built-in widgets. Each reads its data value and options leniently:
// shapes it doesn't know show a short note instead of failing the dashboard.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Icon, cn } from "../../kit/ui/index";
import { openAppPath, studioItemProps, studioThreadProps } from "../../kit/app/index";
import { ThreadTitle, useRpc } from "@get-bb/plugin-sdk/app";
import { resolveChart, SERIES_COLORS } from "../../pages/chart-spec";
import type { rpcContract as studioContract } from "../../contract";
import type { WidgetView, WidgetTypeView } from "../shared";
import { CustomFrame, type WidgetTheme } from "./custom-frame";
import { Markdown } from "./markdown";

export interface WidgetProps {
  widget: WidgetView;
  value: unknown;
  width: number;
  height: number;
  theme: WidgetTheme;
  /** Library types this dashboard uses. */
  types: readonly WidgetTypeView[];
}

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : fallback);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
const safeUrl = (value: unknown): string | null => {
  const url = str(value).trim();
  return /^https?:\/\//i.test(url) ? url : null;
};

/** A tile with nothing to show yet: an icon, a short title and what to do. Small tiles keep just the text. */
export function Empty({ children, icon, title, tone, spin, action }: { children?: ReactNode; icon?: string; title?: string; tone?: "error"; spin?: boolean; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-1 overflow-hidden p-3 text-center text-xs text-muted-foreground" data-tile-empty>
      {icon ? <Icon name={icon} className={cn("mb-0.5 size-4 shrink-0", tone === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground/70", spin && "animate-spin")} /> : null}
      {title ? <div className={cn("font-medium", tone === "error" ? "text-red-700 dark:text-red-300" : "text-foreground/80")}>{title}</div> : null}
      {children ? <div className="max-w-[28ch] leading-snug">{children}</div> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat

export interface StatValue { value: number | string | null; delta: string | null; trend: "up" | "down" | "flat" | null; series: number[]; caption: string | null }

/** Reads a stat from a number, a string, a series, rows, or {value, delta, trend, series, caption}. */
export function readStat(value: unknown, options: Row): StatValue {
  const field = str(options.field);
  const fromSeries = (series: number[]): StatValue => {
    const last = series.at(-1) ?? null;
    const prev = series.length > 1 ? series.at(-2)! : null;
    const change = last !== null && prev !== null ? last - prev : null;
    const pct = change !== null && prev ? (change / Math.abs(prev)) * 100 : null;
    return {
      value: last,
      delta: pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%` : change !== null ? `${change >= 0 ? "+" : ""}${change}` : null,
      trend: change === null ? null : change > 0 ? "up" : change < 0 ? "down" : "flat",
      series,
      caption: null,
    };
  };
  if (num(value) !== null) return { value: num(value), delta: null, trend: null, series: [], caption: null };
  if (typeof value === "string") return { value, delta: null, trend: null, series: [], caption: null };
  if (Array.isArray(value)) {
    const series = value.map((each) => num(isRow(each) && field ? each[field] : isRow(each) ? Object.values(each).find((v) => num(v) !== null) : each)).filter((each): each is number => each !== null);
    return fromSeries(series);
  }
  if (isRow(value)) {
    const series = Array.isArray(value.series) ? value.series.map(num).filter((each): each is number => each !== null) : [];
    const base = series.length && value.value === undefined ? fromSeries(series) : null;
    const trend = value.trend === "up" || value.trend === "down" || value.trend === "flat" ? value.trend : null;
    const delta = value.delta === undefined || value.delta === null ? base?.delta ?? null : typeof value.delta === "number" ? `${value.delta >= 0 ? "+" : ""}${value.delta}` : str(value.delta);
    return {
      value: base?.value ?? (num(value[field || "value"]) ?? (str(value[field || "value"]) || null)),
      delta,
      trend: trend ?? base?.trend ?? (delta?.startsWith("-") || delta?.startsWith("−") ? "down" : delta?.startsWith("+") ? "up" : null),
      series,
      caption: str(value.caption) || null,
    };
  }
  return { value: null, delta: null, trend: null, series: [], caption: null };
}

export function formatValue(value: number | string | null, options: Row): string {
  if (value === null) return "—";
  if (typeof value === "string") return `${str(options.prefix)}${value}${str(options.unit)}`;
  const decimals = num(options.decimals);
  const text = new Intl.NumberFormat(undefined, decimals === null ? { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 } : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return `${str(options.prefix)}${text}${str(options.unit)}`;
}

export function Sparkline({ series, label, className }: { series: number[]; label: string; className?: string }) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const points = series.map((value, index) => `${((index / (series.length - 1)) * 100).toFixed(2)},${(28 - ((value - min) / span) * 26 - 1).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label} className={cn("h-8 w-full overflow-visible", className)}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function StatWidget({ widget, value }: WidgetProps) {
  const stat = readStat(value, widget.options);
  const good = widget.options.invert ? stat.trend === "down" : stat.trend === "up";
  const bad = widget.options.invert ? stat.trend === "up" : stat.trend === "down";
  const label = str(widget.options.label) || widget.title || "";
  return (
    <div className="flex h-full min-h-0 flex-col justify-between gap-1 p-3" data-widget-body="stat">
      {label && !widget.title ? <div className="truncate text-xs text-muted-foreground">{label}</div> : null}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="truncate text-3xl font-semibold tabular-nums tracking-tight text-foreground">{formatValue(stat.value, widget.options)}</span>
        {stat.delta ? (
          <span className={cn("text-sm font-medium tabular-nums", good ? "text-emerald-600 dark:text-emerald-400" : bad ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            <span aria-hidden>{stat.trend === "up" ? "▲ " : stat.trend === "down" ? "▼ " : ""}</span>
            {stat.delta}
          </span>
        ) : null}
      </div>
      {stat.caption ? <div className="truncate text-xs text-muted-foreground">{stat.caption}</div> : null}
      {widget.options.sparkline !== false && stat.series.length > 1 ? (
        <Sparkline series={stat.series} label={`Trend: ${stat.series.join(", ")}`} className={good ? "text-emerald-500" : bad ? "text-red-500" : "text-primary/70"} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts (Pages' chart conventions and colors)

/** Rows a chart can plot, from an array of rows or {data|rows: [...]}. */
export function chartRows(value: unknown): Row[] | null {
  const rows = Array.isArray(value) ? value : isRow(value) && Array.isArray(value.data) ? value.data : isRow(value) && Array.isArray(value.rows) ? value.rows : null;
  if (!rows) return null;
  const clean = rows.filter(isRow).slice(0, 500);
  return clean.length ? clean : null;
}

function ChartWidget({ widget, value }: WidgetProps) {
  const rows = chartRows(value);
  if (!rows) return <Empty icon="ChartColumn" title="No rows to chart">Give it a list of rows in its settings.</Empty>;
  const type = widget.type as "line" | "bar" | "area" | "pie";
  const options = widget.options;
  const { x, series } = resolveChart({
    type,
    data: rows as never,
    ...(typeof options.x === "string" ? { x: options.x } : {}),
    ...(Array.isArray(options.series) ? { series: options.series.filter((each): each is string => typeof each === "string").slice(0, 8) } : {}),
  });
  const unit = str(options.unit);
  const axis = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false } as const;
  const tooltip = <Tooltip contentStyle={{ background: "var(--popover, #111)", border: "1px solid var(--border, #333)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground, inherit)" }} formatter={(v) => `${v}${unit}`} />;
  const common = { data: rows, margin: { top: 8, right: 8, bottom: 0, left: -16 } };
  let body: ReactNode;
  if (type === "pie") {
    const key = series[0] ?? "value";
    body = (
      <PieChart>
        <Pie data={rows} dataKey={key} nameKey={x} innerRadius="45%" outerRadius="80%" paddingAngle={2} isAnimationActive={false}>
          {rows.map((_, index) => <Cell key={index} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />)}
        </Pie>
        {tooltip}
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    );
  } else {
    const Chart = type === "line" ? LineChart : type === "area" ? AreaChart : BarChart;
    const stack = options.stacked ? "stack" : undefined;
    body = (
      <Chart {...common}>
        <CartesianGrid vertical={false} strokeOpacity={0.12} />
        <XAxis dataKey={x} {...axis} />
        <YAxis {...axis} />
        {tooltip}
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {series.map((key, index) => {
          const color = SERIES_COLORS[index % SERIES_COLORS.length]!;
          if (type === "line") return <Line key={key} dataKey={key} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />;
          if (type === "area") return <Area key={key} dataKey={key} stroke={color} fill={color} fillOpacity={0.18} stackId={stack} isAnimationActive={false} />;
          return <Bar key={key} dataKey={key} fill={color} radius={[3, 3, 0, 0]} stackId={stack} isAnimationActive={false} />;
        })}
      </Chart>
    );
  }
  const summary = `${type} chart of ${series.join(", ") || "values"} by ${x}, ${rows.length} rows`;
  return (
    <figure className="m-0 h-full min-h-0 p-2 text-muted-foreground" data-widget-body="chart" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%">{body as never}</ResponsiveContainer>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Table

export function tableOf(value: unknown, options: Row): { columns: string[]; rows: unknown[][] } | null {
  const max = Math.min(1000, Math.max(1, num(options.maxRows) ?? 200));
  if (isRow(value) && Array.isArray(value.columns) && Array.isArray(value.rows)) {
    const columns = (value.columns as unknown[]).map((each) => str(each));
    return { columns, rows: value.rows.slice(0, max).map((row): unknown[] => (Array.isArray(row) ? row : isRow(row) ? columns.map((column) => row[column]) : [row])) };
  }
  const rows = chartRows(value);
  if (!rows) return null;
  const wanted = Array.isArray(options.columns) ? options.columns.map((each) => str(each)).filter(Boolean) : null;
  const columns = wanted ?? [...new Set(rows.slice(0, 50).flatMap((row) => Object.keys(row)))].slice(0, 20);
  return { columns, rows: rows.slice(0, max).map((row) => columns.map((column) => row[column])) };
}

/** A column key as a header: "due_date" reads "Due date"; anything else stays as written. */
export const columnLabel = (key: string) => (/^[a-z][a-z0-9_]*$/.test(key) ? `${key[0]!.toUpperCase()}${key.slice(1).replace(/_/g, " ")}` : key);

const cellText = (value: unknown) => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : typeof value === "number" ? new Intl.NumberFormat().format(value) : String(value));

/**
 * A tile body that scrolls when its content is taller or wider than the tile,
 * with a fade at the bottom while more rows sit below the fold.
 */
export function ScrollBody({ kind, children }: { kind: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure, children]);
  return (
    <div className="absolute inset-0">
      <div ref={ref} className="h-full overflow-auto overscroll-contain [scrollbar-width:thin]" data-widget-body={kind} data-scroll-body onScroll={measure}>{children}</div>
      {more ? <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" data-scroll-more /> : null}
    </div>
  );
}

function TableWidget({ widget, value }: WidgetProps) {
  const table = tableOf(value, widget.options);
  if (!table) return <Empty icon="Rows2" title="No rows yet" />;
  const wrap = new Set(Array.isArray(widget.options.wrapColumns) ? widget.options.wrapColumns.map((each) => str(each)) : []);
  return (
    <ScrollBody kind="table">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-[1] bg-card">
          <tr>{table.columns.map((column) => <th key={column} scope="col" title={columnLabel(column)} className="max-w-[16rem] truncate whitespace-nowrap border-b border-border px-3 py-1.5 text-left font-medium text-muted-foreground">{columnLabel(column)}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className="hover:bg-state-hover">
              {row.map((cell, column) => {
                const text = cellText(cell);
                const wraps = wrap.has(table.columns[column] ?? "");
                return <td key={column} title={wraps ? undefined : text || undefined} className={cn("border-b border-border/50 px-3 py-1.5 text-foreground", wraps ? "min-w-[12rem] whitespace-normal break-words" : "max-w-[16rem] truncate whitespace-nowrap", typeof cell === "number" && "text-right tabular-nums")}>{text}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBody>
  );
}

// ---------------------------------------------------------------------------
// List / feed

export interface ListItem { title: string; link: string | null; summary: string | null; date: string | null }

export function listItems(value: unknown): ListItem[] | null {
  const items = Array.isArray(value) ? value : isRow(value) && Array.isArray(value.items) ? value.items : null;
  if (!items) return null;
  return items.slice(0, 200).flatMap((item): ListItem[] => {
    if (typeof item === "string" || typeof item === "number") return [{ title: String(item), link: null, summary: null, date: null }];
    if (!isRow(item)) return [];
    const title = str(item.title) || str(item.name) || str(item.label) || str(item.text);
    if (!title) return [];
    return [{ title, link: safeUrl(item.link ?? item.url ?? item.href), summary: str(item.summary ?? item.subtitle ?? item.description) || null, date: str(item.date ?? item.time ?? item.published) || null }];
  });
}

const shortDate = (text: string) => {
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return text;
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function ListWidget({ widget, value }: WidgetProps) {
  const items = listItems(value);
  if (!items) return <Empty icon="ListView" title="Nothing here yet">Point it at a feed or a JSON list in settings.</Empty>;
  if (!items.length) return <Empty icon="ListView" title="The list is empty" />;
  const max = Math.max(1, num(widget.options.maxItems) ?? 50);
  return (
    <ScrollBody kind="list">
    <ul className="divide-y divide-border/60">
      {items.slice(0, max).map((item, index) => (
        <li key={index} className="px-3 py-2">
          <div className="flex items-baseline gap-2">
            {item.link ? (
              <a href={item.link} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline">{item.title}</a>
            ) : <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.title}</span>}
            {item.date && widget.options.showDates !== false ? <time dateTime={item.date} className="shrink-0 text-xs tabular-nums text-muted-foreground">{shortDate(item.date)}</time> : null}
          </div>
          {item.summary ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.summary}</p> : null}
        </li>
      ))}
    </ul>
    </ScrollBody>
  );
}

// ---------------------------------------------------------------------------
// Ticker

function TickerWidget({ widget, value }: WidgetProps) {
  const raw = Array.isArray(value) ? value : listItems(value) ?? [];
  const entries = raw.slice(0, 100).flatMap((item) => {
    if (typeof item === "string" || typeof item === "number") return [{ label: String(item), value: "", delta: "" }];
    if (!isRow(item)) return [];
    return [{ label: str(item.label ?? item.title ?? item.name ?? item.symbol), value: str(item.value ?? item.price), delta: str(item.delta ?? item.change) }];
  }).filter((entry) => entry.label || entry.value);
  if (!entries.length) return <Empty title="Nothing to show yet" />;
  const seconds = Math.min(600, Math.max(5, num(widget.options.speed) ?? 30));
  const strip = (hidden: boolean) => (
    <div className="dashboard-ticker-strip flex shrink-0 items-center gap-8 pr-8" aria-hidden={hidden || undefined}>
      {entries.map((entry, index) => (
        <span key={index} className="flex items-baseline gap-1.5 whitespace-nowrap text-sm">
          <span className="font-medium text-foreground">{entry.label}</span>
          {entry.value ? <span className="tabular-nums text-foreground/80">{entry.value}</span> : null}
          {entry.delta ? <span className={cn("tabular-nums text-xs", entry.delta.startsWith("-") ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>{entry.delta}</span> : null}
        </span>
      ))}
    </div>
  );
  return (
    <div className="dashboard-ticker flex h-full items-center overflow-hidden" data-widget-body="ticker" role="region" aria-label={widget.title ?? "Ticker"}>
      <div className="dashboard-ticker-track flex" style={{ animationDuration: `${seconds}s` }}>
        {strip(false)}
        {strip(true)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Note, embed, clock, image, progress

function NoteWidget({ widget, value }: WidgetProps) {
  const source = typeof value === "string" ? value : str(widget.options.markdown);
  if (!source.trim()) return <Empty icon="FileText" title="Empty note">Write Markdown in its settings.</Empty>;
  return <div className="h-full min-h-0 overflow-auto px-3 py-2" data-widget-body="note"><Markdown source={source} /></div>;
}

function ItemEmbed({ href }: { href: string }) {
  const rpc = useRpc<typeof studioContract>();
  const [item, setItem] = useState<{ title: string; preview: string | null; href: string } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    rpc.call("itemAt", { path: href }).then((result) => live && setItem(result.item ? { title: result.item.title, preview: result.item.preview, href: result.item.href } : null), () => live && setItem(null));
    return () => { live = false; };
  }, [href, rpc]);
  if (item === undefined) return <Empty icon="Loading" spin />;
  if (!item) return <Empty icon="FileQuestion" title="Item not found">It may have been deleted or moved.</Empty>;
  return (
    <button type="button" className="flex h-full w-full flex-col items-start gap-1 p-3 text-left hover:bg-state-hover" onClick={() => openAppPath(item.href)} {...studioItemProps({ href: item.href, title: item.title })}>
      <span className="flex w-full items-center gap-1.5 text-sm font-medium text-foreground"><span className="truncate">{item.title || "Untitled"}</span><Icon name="ArrowUpRight" className="size-3.5 shrink-0 text-muted-foreground" /></span>
      {item.preview ? <span className="line-clamp-4 text-xs text-muted-foreground">{item.preview}</span> : null}
    </button>
  );
}

/** The sandbox for a web page: its own origin's storage, unless it's BB's origin. */
export function embedSandbox(url: string, origin = typeof window === "undefined" ? "" : window.location.origin): string {
  let same = false;
  try { same = new URL(url).origin === origin; } catch { /* not a URL */ }
  return same ? "allow-scripts allow-forms allow-popups" : "allow-scripts allow-same-origin allow-forms allow-popups";
}

function EmbedWidget({ widget }: WidgetProps) {
  const href = str(widget.options.href).trim();
  const threadId = str(widget.options.threadId).trim();
  const url = safeUrl(widget.options.url);
  if (href.startsWith("/plugins/")) return <ItemEmbed href={href} />;
  if (threadId) {
    return (
      <button type="button" className="flex h-full w-full items-start gap-2 p-3 text-left hover:bg-state-hover" onClick={() => openAppPath(`/threads/${encodeURIComponent(threadId)}`)} {...studioThreadProps(threadId)}>
        <Icon name="MessageSquare" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 text-sm font-medium text-foreground"><ThreadTitle threadId={threadId} /></span>
      </button>
    );
  }
  if (url) return <iframe title={widget.title ?? "Embedded page"} src={url} sandbox={embedSandbox(url)} referrerPolicy="no-referrer" loading="lazy" className="block h-full w-full border-0 bg-background" data-widget-body="embed" />;
  return <Empty icon="Layers" title="Nothing to embed">Set a Studio item, a thread or a web page in its settings.</Empty>;
}

function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export function countdown(target: number, now: number): string {
  const left = Math.max(0, Math.round((target - now) / 1000));
  if (!left) return "Now";
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function ClockWidget({ widget }: WidgetProps) {
  const now = useNow(1000);
  const options = widget.options;
  const label = str(options.label);
  if (options.mode === "countdown") {
    const target = Date.parse(str(options.target));
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center" data-widget-body="clock">
        <div className="text-2xl font-semibold tabular-nums text-foreground" role="timer" aria-live="off">{Number.isFinite(target) ? countdown(target, now) : "Set a target time"}</div>
        <div className="text-xs text-muted-foreground">{label || (Number.isFinite(target) ? new Date(target).toLocaleString() : "")}</div>
      </div>
    );
  }
  const timeZone = str(options.timeZone) || undefined;
  let time = "";
  let date = "";
  try {
    time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", ...(options.seconds ? { second: "2-digit" } : {}), hour12: typeof options.hour12 === "boolean" ? options.hour12 : undefined, timeZone }).format(now);
    date = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone }).format(now);
  } catch {
    return <Empty icon="Clock" tone="error" title="Unknown time zone">{timeZone}</Empty>;
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-0.5 p-2 text-center" data-widget-body="clock">
      <time className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">{time}</time>
      <div className="text-xs text-muted-foreground">{[label || timeZone?.split("/").pop()?.replace(/_/g, " "), date].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

/** Image sources: http(s), data:image, or one of BB's own file routes. */
export function imageSrc(value: unknown): string | null {
  const src = str(value).trim();
  if (/^https?:\/\//i.test(src) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(src) || src.startsWith("/api/v1/")) return src;
  return null;
}

function ImageWidget({ widget, value }: WidgetProps) {
  const src = imageSrc(typeof value === "string" ? value : widget.options.url);
  if (!src) return <Empty icon="Palette" title="No image">Set an image URL in its settings.</Empty>;
  return <img src={src} alt={str(widget.options.alt) || widget.title || ""} referrerPolicy="no-referrer" loading="lazy" className="block h-full w-full" style={{ objectFit: widget.options.fit === "contain" ? "contain" : "cover" }} data-widget-body="image" />;
}

export function readProgress(value: unknown, options: Row): { value: number; min: number; max: number; label: string } | null {
  const v = num(isRow(value) ? value.value : value);
  if (v === null) return null;
  const min = num(isRow(value) ? value.min : null) ?? num(options.min) ?? 0;
  const max = num(isRow(value) ? value.max : null) ?? num(options.max) ?? 100;
  return { value: v, min, max: max > min ? max : min + 1, label: str(isRow(value) ? value.label : "") || str(options.label) };
}

function ProgressWidget({ widget, value }: WidgetProps) {
  const progress = readProgress(value, widget.options);
  if (!progress) return <Empty icon="SlidersHorizontal" title="No value yet" />;
  const fraction = Math.min(1, Math.max(0, (progress.value - progress.min) / (progress.max - progress.min)));
  const unit = str(widget.options.unit);
  const text = `${new Intl.NumberFormat().format(progress.value)}${unit}`;
  const aria = { role: "progressbar", "aria-valuemin": progress.min, "aria-valuemax": progress.max, "aria-valuenow": progress.value, "aria-valuetext": `${text} of ${progress.max}${unit}`, "aria-label": progress.label || widget.title || "Progress" } as const;
  if (widget.options.style === "gauge") {
    const angle = Math.PI * (1 - fraction);
    const x = 50 + 40 * Math.cos(angle);
    const y = 50 - 40 * Math.sin(angle);
    return (
      <div className="flex h-full flex-col items-center justify-center p-2" data-widget-body="progress" {...aria}>
        <svg viewBox="0 0 100 56" className="w-full max-w-[220px]" aria-hidden>
          <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="8" strokeLinecap="round" />
          {fraction > 0 ? <path d={`M10 50 A40 40 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={SERIES_COLORS[0]} strokeWidth="8" strokeLinecap="round" /> : null}
        </svg>
        <div className="-mt-3 text-xl font-semibold tabular-nums text-foreground">{text}</div>
        {progress.label ? <div className="text-xs text-muted-foreground">{progress.label}</div> : null}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 p-3" data-widget-body="progress">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate text-muted-foreground">{progress.label}</span>
        <span className="font-semibold tabular-nums text-foreground">{text}<span className="font-normal text-muted-foreground"> / {progress.max}{unit}</span></span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/10" {...aria}>
        <div className="h-full rounded-full" style={{ width: `${(fraction * 100).toFixed(1)}%`, background: SERIES_COLORS[0] }} />
      </div>
    </div>
  );
}

function CustomWidget({ widget, value, theme, width, height, types }: WidgetProps) {
  const type = widget.customType ? types.find((each) => each.id === widget.customType) : undefined;
  const html = widget.html ?? type?.html;
  if (!html) return <Empty icon="Code" title={widget.customType ? "Library type missing" : "No HTML yet"}>{widget.customType ? "Its library type was deleted." : "Give it HTML in its settings."}</Empty>;
  return (
    <div className="h-full min-h-0 overflow-auto" data-widget-body="custom">
      <CustomFrame html={html} title={widget.title ?? type?.name ?? "Custom widget"} data={value} options={{ ...(type?.defaultOptions ?? {}), ...widget.options }} theme={theme} width={width} height={height} />
    </div>
  );
}

const RENDERERS: Record<WidgetView["type"], (props: WidgetProps) => ReactNode> = {
  stat: StatWidget,
  line: ChartWidget,
  bar: ChartWidget,
  area: ChartWidget,
  pie: ChartWidget,
  table: TableWidget,
  list: ListWidget,
  ticker: TickerWidget,
  note: NoteWidget,
  embed: EmbedWidget,
  clock: ClockWidget,
  image: ImageWidget,
  progress: ProgressWidget,
  custom: CustomWidget,
};

export function WidgetBody(props: WidgetProps) {
  const Render = RENDERERS[props.widget.type];
  return <Render {...props} />;
}
