// What each item looks like in an organic look: denser, typographic
// renderers styled only with the look's tokens and the kit's classes, at
// their natural height (the board measures them). Charts, maps, timelines
// and small multiples are the kit's builders (kit.ts), the same ones custom
// frames get, so built-ins and the agent's components match.
import { Fragment, useState, type ReactNode } from "react";
import type { OrganicLook } from "../looks";
import { captionOf, headlineOf, quoteOf, type CanvasItem } from "../shared";
import { CanvasFrame } from "./frame";
import { canvasKit } from "./kit";
import { columnLabel, imageSrc, listItems, readProgress, readStat, tableOf } from "./studio";

export const kit = canvasKit();

/** Inner padding of a tile, per look and kind (px, each side). */
export function tilePadding(_look: OrganicLook, _kind: CanvasItem["kind"], accent: string | null = null): number {
  // No boxes: only a bar quote (a rule beside the text) is inset.
  return accent === "bar" ? 10 : 0;
}

const Html = ({ html, className }: { html: string; className?: string }) => (html ? <div className={className} dangerouslySetInnerHTML={{ __html: html }} /> : null);
const str = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/**
 * Short text with a little Markdown (paragraphs, - lists, **bold**, *italic*)
 * and inline marks: {spark:3,5,4} draws a sparkline, {delta:+2.1} a chip,
 * ==words== highlights, [text](https://…) links.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const inline = (line: string, key: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const pattern = /\{spark:([^}]*)\}|\{delta:([^}]*)\}|\*\*([^*]+)\*\*|\*([^*]+)\*|==([^=]+)==|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = pattern.exec(line))) {
      if (match.index > last) parts.push(line.slice(last, match.index));
      const k = `${key}.${index++}`;
      if (match[1] !== undefined) parts.push(<span key={k} dangerouslySetInnerHTML={{ __html: kit.spark(match[1], { w: 52, h: 14 }) }} />);
      else if (match[2] !== undefined) parts.push(<span key={k} dangerouslySetInnerHTML={{ __html: kit.delta(match[2].trim()) }} />);
      else if (match[3] !== undefined) parts.push(<strong key={k} style={{ color: "var(--cv-ink)", fontWeight: 650 }}>{match[3]}</strong>);
      else if (match[4] !== undefined) parts.push(<em key={k}>{match[4]}</em>);
      else if (match[5] !== undefined) parts.push(<mark key={k} className="cv-hl" style={{ color: "inherit" }}>{match[5]}</mark>);
      // A link: its text, opening the http(s) address in a new tab.
      else if (match[6] !== undefined) parts.push(<a key={k} href={match[7]} target="_blank" rel="noreferrer noopener" style={{ color: "var(--cv-accent)", textDecoration: "underline", textUnderlineOffset: "0.15em" }}>{match[6]}</a>);
      last = pattern.lastIndex;
    }
    if (last < line.length) parts.push(line.slice(last));
    return parts;
  };
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        if (lines.length && lines.every((line) => /^[-*•]\s/.test(line))) {
          return <ul key={index} style={{ margin: "0 0 var(--cv-s-3)", paddingLeft: "1.1em" }}>{lines.map((line, row) => <li key={row} style={{ marginBottom: 2 }}>{inline(line.replace(/^[-*•]\s+/, ""), `${index}.${row}`)}</li>)}</ul>;
        }
        if (lines.length === 1 && /^#{1,3}\s/.test(lines[0]!)) return <div key={index} className="cv-h3" style={{ marginBottom: "var(--cv-s-2)" }}>{inline(lines[0]!.replace(/^#+\s+/, ""), `${index}`)}</div>;
        return <p key={index}>{lines.map((line, row) => <Fragment key={row}>{row ? " " : null}{inline(line.replace(/^#+\s+/, ""), `${index}.${row}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}

const TONE: Record<string, string> = { neutral: "var(--cv-ink)", good: "var(--cv-good)", bad: "var(--cv-bad)", accent: "var(--cv-accent)" };

function Headline({ item, width, focus, look }: { item: CanvasItem; width: number; focus: boolean; look: OrganicLook }) {
  const headline = headlineOf(item.data);
  if (!headline) return null;
  // Big when there's room: a headline is read from across the room; the hero's is set huge.
  const px = Math.round(Math.max(24, Math.min(focus ? (look === "instrument" ? 64 : 92) : 44, width / (focus ? 9 : 12.5))));
  return (
    <header className="cvi-headline" data-canvas-body="headline">
      {headline.kicker ? <div className="cv-kicker" style={{ marginBottom: 8 }}>{headline.kicker}</div> : null}
      <h2 className="cv-h1" style={{ fontSize: px, color: TONE[headline.tone] }}>{look === "field" ? <span className="cvi-underline">{headline.text}</span> : headline.text}</h2>
      {headline.subtitle ? <p className="cv-dek" style={{ marginTop: 10, maxWidth: "62ch" }}>{headline.subtitle}</p> : null}
    </header>
  );
}

function Stat({ item, width, room, focus, look }: { item: CanvasItem; width: number; room: number; focus: boolean; look: OrganicLook }) {
  const stat = readStat(item.data, item.options);
  const o = item.options;
  const value = typeof stat.value === "number" ? kit.fmt(stat.value, { decimals: o.decimals, compact: o.compact }) : kit.esc(stat.value ?? "—");
  const deltaNumber = stat.delta ? kit.num(stat.delta) : null;
  const good = stat.trend === "flat" || deltaNumber === null || deltaNumber === 0 ? null : (deltaNumber > 0) !== (o.invert === true);
  // A number in huge type when it's the hero; big enough to read from afar otherwise.
  const size = Math.round(focus ? Math.max(64, Math.min(room * 0.6, width / 2.9, 260)) : Math.max(28, Math.min(72, width / 4)));
  return (
    <div className="cvi-stat" data-canvas-body="stat">
      {item.title && look !== "instrument" ? <div className="cv-label cv-stat-label" style={{ marginBottom: 6 }}>{item.title}</div> : null}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <span className="cv-num" style={{ fontSize: size }}>
          {o.prefix ? <span className="cv-unit" style={{ marginLeft: 0, marginRight: "0.08em" }}>{str(o.prefix)}</span> : null}
          <span dangerouslySetInnerHTML={{ __html: value }} />
          {o.unit ? <span className="cv-unit">{str(o.unit)}</span> : null}
        </span>
        {stat.delta ? <span className={`cv-delta ${good === null ? "" : good ? "cv-up" : "cv-down"}`} style={{ marginBottom: size * 0.12 }}>{deltaNumber !== null && deltaNumber > 0 ? "▲" : deltaNumber !== null && deltaNumber < 0 ? "▼" : ""} {stat.delta.replace(/^[+-−]/, "")}</span> : null}
      </div>
      {stat.series.length > 1 ? <Html className="cvi-stat-spark" html={kit.spark(stat.series, { w: Math.max(60, Math.min(width, 260)), h: 30, color: good === false ? "bad" : good ? "good" : "accent" })} /> : null}
      {stat.caption ? <div className="cv-small" style={{ marginTop: 6 }}>{stat.caption}</div> : null}
    </div>
  );
}

function Table({ item }: { item: CanvasItem }) {
  const table = tableOf(item.data, item.options);
  if (!table) return null;
  const numeric = table.columns.map((_, column) => table.rows.some((row) => typeof row[column] === "number"));
  const max = Number(item.options.maxRows) > 0 ? Number(item.options.maxRows) : 14;
  const bars = typeof item.options.bars === "string" ? table.columns.indexOf(item.options.bars) : -1;
  const barMax = bars >= 0 ? Math.max(...table.rows.map((row) => Math.abs(Number(row[bars]) || 0)), 1) : 1;
  return (
    <table className="cv-table" data-canvas-body="table">
      <thead><tr>{table.columns.map((column, index) => <th key={column} className={numeric[index] ? "n" : undefined}>{columnLabel(column)}</th>)}</tr></thead>
      <tbody>
        {table.rows.slice(0, max).map((row, index) => (
          <tr key={index}>{row.map((cell, column) => (
            <td key={column} className={typeof cell === "number" ? "n" : undefined}>
              {column === bars && typeof cell === "number" ? <span style={{ display: "inline-block", width: 44, height: 7, marginRight: 6, background: "var(--cv-rule)", borderRadius: 2, verticalAlign: "0.05em", position: "relative", overflow: "hidden" }}><span style={{ position: "absolute", inset: 0, width: `${(Math.abs(cell) / barMax) * 100}%`, background: cell < 0 ? "var(--cv-bad)" : "var(--cv-accent)" }} /></span> : null}
              {cell === null || cell === undefined ? "" : typeof cell === "number" ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(cell) : typeof cell === "object" ? JSON.stringify(cell) : String(cell)}
            </td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}

function List({ item }: { item: CanvasItem }) {
  const list = listItems(item.data) ?? [];
  const max = Number(item.options.maxItems) > 0 ? Number(item.options.maxItems) : 8;
  return (
    <ol className="cvi-list" data-canvas-body="list">
      {list.slice(0, max).map((entry, index) => (
        <li key={index}>
          <span className="cvi-list-n">{index + 1}</span>
          <span>
            <span className="cvi-list-title">{entry.title}</span>
            {entry.summary ? <span className="cv-small" style={{ display: "block" }}>{entry.summary}</span> : null}
            {entry.date && item.options.showDates !== false ? <span className="cv-label" style={{ display: "block", marginTop: 2 }}>{entry.date}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Ticker({ item }: { item: CanvasItem }) {
  const entries = (Array.isArray(item.data) ? item.data : []).slice(0, 24).map((entry) => (typeof entry === "string" ? { label: entry } : rec(entry)));
  return (
    <div className="cvi-ticker" data-canvas-body="ticker">
      {entries.map((entry, index) => (
        <span key={index} className="cvi-ticker-item">
          <span className="cv-label">{str(entry.label)}</span>
          {entry.value !== undefined ? <b className="cv-num-sm" style={{ fontSize: "var(--cv-t-lg)" }}>{str(entry.value)}</b> : null}
          {entry.delta !== undefined ? <span dangerouslySetInnerHTML={{ __html: kit.delta(entry.delta) }} /> : null}
        </span>
      ))}
    </div>
  );
}

/**
 * A picture: cropped to its aspect (focus picks what stays), with its name,
 * a rating drawn as stars, and a caption. When the address fails, a tile in
 * the style's colors with the name set large stands in, so a gallery never
 * shows a hole.
 */
function Photo({ item, width, focus, look }: { item: CanvasItem; width: number; focus: boolean; look: OrganicLook }) {
  const src = imageSrc(typeof item.data === "string" ? item.data : item.options.url);
  const [failed, setFailed] = useState<string | null>(null);
  const broken = !src || failed === src;
  const headline = str(item.options.headline) || item.title || "";
  const kicker = str(item.options.kicker);
  const credit = str(item.options.credit);
  const caption = str(item.options.caption);
  const rating = kit.num(item.options.rating);
  const overlay = look !== "editorial" && headline && !broken && item.options.overlay !== false;
  const name = Math.max(16, Math.min(focus ? 44 : 28, width / (focus ? 12 : 11)));
  return (
    <figure className="cvi-photo" data-canvas-body="image" data-image-state={broken ? "fallback" : "image"} style={{ margin: 0 }}>
      <div style={{ position: "relative", aspectRatio: str(item.options.aspect) || "3 / 2", overflow: "hidden", borderRadius: "var(--cv-radius-sm)", background: "linear-gradient(135deg, color-mix(in oklab, var(--cv-accent) 30%, var(--cv-surface)), color-mix(in oklab, var(--cv-blue) 35%, var(--cv-surface)))" }}>
        {!broken ? <img src={src!} alt={str(item.options.alt) || headline} referrerPolicy="no-referrer" loading="eager" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: item.options.fit === "contain" ? "contain" : "cover", objectPosition: str(item.options.focus) || "50% 40%" }} onError={() => setFailed(src)} /> : null}
        {broken && headline ? <div aria-hidden style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", padding: Math.round(width * 0.06), fontFamily: "var(--cv-font-display)", fontWeight: "var(--cv-display-weight)" as never, fontSize: Math.max(18, Math.min(64, width / 6)), lineHeight: 1, color: "var(--cv-ink)", opacity: 0.85, textWrap: "balance" as never }}>{headline}</div> : null}
        {overlay ? (
          <figcaption style={{ position: "absolute", inset: "auto 0 0 0", padding: "40px 14px 12px", background: "linear-gradient(transparent, rgb(0 0 0 / 0.72))", color: "#fff" }}>
            {kicker ? <div className="cv-kicker" style={{ color: "#fff", opacity: 0.85 }}>{kicker}</div> : null}
            <div className="cv-h3" style={{ color: "#fff", fontSize: name }}>{headline}</div>
          </figcaption>
        ) : null}
      </div>
      {(!overlay && headline && !broken) || rating !== null || caption ? (
        <figcaption style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {!overlay && kicker && !broken ? <div className="cv-kicker">{kicker}</div> : null}
          {!overlay && headline && !broken ? <div className="cv-h3" style={{ fontSize: name }}>{headline}</div> : null}
          {rating !== null ? <Html html={kit.stars(rating, { max: item.options.ratingMax, size: focus ? 22 : 15, source: item.options.ratingSource })} /> : null}
          {caption ? <div className="cv-small">{caption}</div> : null}
        </figcaption>
      ) : null}
      {credit ? <div className="cv-caption">{credit}</div> : null}
    </figure>
  );
}

function Quote({ item, width, focus }: { item: CanvasItem; width: number; focus: boolean }) {
  const quote = quoteOf(item.data);
  if (!quote) return null;
  // No frame: the words are the shape. A leading quote is set large.
  const px = focus ? Math.round(Math.max(28, Math.min(64, width / 13))) : undefined;
  return (
    <blockquote className="cv-quote cvi-quote" data-canvas-body="quote" style={{ margin: 0, fontSize: px }}>
      {quote.text}
      {quote.by ? <cite>— {quote.by}{quote.role ? `, ${quote.role}` : ""}</cite> : null}
    </blockquote>
  );
}

/** The item's content at its natural height, for a content box this wide. */
export function OrganicBody({ item, width, room = 320, focus, look, mode, onFrameHeight }: { item: CanvasItem; width: number; room?: number; focus: boolean; look: OrganicLook; mode: "light" | "dark"; onFrameHeight?(height: number): void }): ReactNode {
  const o = item.options;
  // Charts take the height their place in the composition gives them (room), not a fixed one.
  const chartHeight = Math.round(Math.max(130, Math.min(room - (item.title ? 30 : 0), width * (focus ? 0.62 : 0.6))));
  switch (item.kind) {
    case "headline": return <Headline item={item} width={width} focus={focus} look={look} />;
    case "caption": { const text = captionOf(item.data); return text ? <RichText text={text} className="cv-body" /> : null; }
    case "stat": return <Stat item={item} width={width} room={room} focus={focus} look={look} />;
    case "line": case "area": return <Html className="cvi-chart" html={kit.line(item.data, { ...o, w: width, h: chartHeight, area: item.kind === "area" || o.area })} />;
    case "bar": {
      const rows = Array.isArray(item.data) ? item.data : [];
      const series = Array.isArray(o.series) ? o.series : null;
      const horizontal = o.horizontal === true || (o.horizontal !== false && rows.length <= 12 && (!series || series.length <= 1) && !o.stacked);
      return <Html className="cvi-chart" html={horizontal ? kit.hbars(rows, { ...o, sort: o.sort ?? false }) : kit.columns(rows, { ...o, w: width, h: chartHeight })} />;
    }
    case "pie": return <Html className="cvi-chart" html={kit.donut(Array.isArray(item.data) ? item.data.map((row) => { const r = rec(row); const label = typeof o.x === "string" ? r[o.x] : r.label; const value = Array.isArray(o.series) && typeof o.series[0] === "string" ? r[o.series[0]] : r.value; return { ...r, label: label ?? Object.values(r)[0], value: value ?? Object.values(r).find((v) => typeof v === "number") }; }) : [], { size: Math.min(160, Math.max(90, width * 0.42)), center: o.center, sub: o.sub })} />;
    case "table": return <Table item={item} />;
    case "list": return <List item={item} />;
    case "ticker": return <Ticker item={item} />;
    case "progress": { const progress = readProgress(item.data, o); return progress ? <Html html={kit.meter(progress.value, { min: progress.min, max: progress.max, label: progress.label || undefined, unit: o.unit, marks: o.marks })} /> : null; }
    case "image": return <Photo item={item} width={width} focus={focus} look={look} />;
    case "quote": return <Quote item={item} width={width} focus={focus} />;
    case "timeline": return <Html html={kit.timeline(item.data, { ...o, layout: o.layout ?? (look === "instrument" && width >= 520 ? "row" : "column") })} />;
    case "map": return <Html html={kit.tilemap(item.data, { ...o, cell: Math.max(14, Math.min(focus ? 72 : 46, width / 11.9, (room - 40) / 8.6)) })} />;
    case "multiples": return <Html html={kit.multiples(item.data, { ...o, min: o.min ?? (look === "instrument" ? 104 : 124) })} />;
    case "custom": return item.html ? <CanvasFrame html={item.html} title={item.title ?? item.id} data={item.data} options={item.options} look={look} mode={mode} width={width} room={room} onHeight={onFrameHeight} /> : null;
    default: return null;
  }
}

/** The label over an item's content, when its kind shows one. */
export function organicLabel(item: CanvasItem): string | null {
  if (item.kind === "headline" || item.kind === "stat" || item.kind === "quote") return null;
  if (item.kind === "image") return null;
  return item.title;
}
