// The canvas helper kit: small chart and layout builders that return HTML or
// SVG strings, styled only with the look's --cv-* tokens. One source, two
// places:
//
// - Every custom frame gets it as `window.cv` (the function's own source is
//   injected, so it must stay self-contained: no imports, nothing from
//   outside its body), plus cv.render and cv.hydrate.
// - The page renders the built-in kinds (map, timeline, multiples, charts)
//   with the same builders, so built-ins and the agent's components match.
//
// Every value from data is escaped (text with esc, numbers through Number,
// colors only from a safe list), because the page puts the strings in its
// own DOM. kit.test.ts checks hostile labels.

export interface CanvasKit {
  esc(value: unknown): string;
  num(value: unknown): number | null;
  paint(color: unknown, index?: number): string;
  fmt(value: unknown, options?: Record<string, unknown>): string;
  spark(values: unknown, options?: Record<string, unknown>): string;
  bars(values: unknown, options?: Record<string, unknown>): string;
  line(rows: unknown, options?: Record<string, unknown>): string;
  columns(rows: unknown, options?: Record<string, unknown>): string;
  hbars(rows: unknown, options?: Record<string, unknown>): string;
  split(parts: unknown, options?: Record<string, unknown>): string;
  donut(parts: unknown, options?: Record<string, unknown>): string;
  meter(value: unknown, options?: Record<string, unknown>): string;
  tilemap(values: unknown, options?: Record<string, unknown>): string;
  timeline(events: unknown, options?: Record<string, unknown>): string;
  waffle(groups: unknown, options?: Record<string, unknown>): string;
  multiples(items: unknown, options?: Record<string, unknown>): string;
  delta(value: unknown, options?: Record<string, unknown>): string;
  legend(items: unknown): string;
  bignum(value: unknown, options?: Record<string, unknown>): string;
  quote(text: unknown, options?: Record<string, unknown>): string;
  callout(text: unknown, options?: Record<string, unknown>): string;
  stars(value: unknown, options?: Record<string, unknown>): string;
  states: Record<string, [number, number]>;
  render?(build: (data: unknown, options: Record<string, unknown>, state: unknown) => string): void;
  hydrate?(root?: unknown): void;
  width?(): number;
  height?(): number;
  /** Draws every [data-chart] under root from its data-rows / data-value and data-options (fresh: only ones not drawn yet). */
  charts?(root?: unknown, fresh?: boolean): void;
  /** Shows a new page in root, animating parts by data-cv-id (or, when an id changed, by the same picture or text). */
  morph?(root: unknown, html: string, animate?: boolean, options?: { fit?: boolean; scripts?: boolean }): void;
  /**
   * Shows a page as it's being written (src/stream.ts): finished parts already on screen stay as they are,
   * newly finished ones come in, and parts still being written stay hidden. `final` lands the finished page
   * the same way, runs its scripts and fits it.
   */
  stream?(root: unknown, html: string, final?: boolean): void;
  /** The screen the page has, in px. */
  viewport?(): { width: number; height: number };
  /** Zooms a page that stops short of the screen up to fill it (at most 1.4x). Returns the zoom. */
  fit?(root?: unknown): number;
  /** Reports where each committed embed placeholder ([data-embed]) sits, to Visual Chat's UI, which frames it (src/ui/embeds.ts). */
  embeds?(): void;
  /** One building block's HTML (card, stat, step, side, quote, placeholder) from its data-* attributes, then the element's own children. */
  block(kind: unknown, attrs: Record<string, string | undefined>, inner?: string): string;
  /** Expands every [data-block] under root in place. */
  blocks?(root?: unknown): void;
}

/** Builds the kit. With a window, it also becomes window.cv with render and hydrate. Self-contained: its source runs in frames. */
export function canvasKit(win?: unknown): CanvasKit {
  const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value: unknown): string => String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (c) => ENT[c]!);
  const num = (value: unknown): number | null => {
    const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value.replace(/[,%$\s+]/g, "")) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const opt = (options: unknown): Record<string, unknown> => (isObj(options) ? options : {});
  const HUES = ["blue", "red", "green", "amber", "purple", "teal", "gray", "good", "bad", "warn", "accent", "muted", "ink", "ink-2", "rule", "highlight", "surface", "paper", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
  const SAFE = /^(#[0-9a-fA-F]{3,8}|var\(--cv-[a-z0-9-]+\)|(rgb|hsl)a?\([0-9.,%\s/deg]+\)|[a-zA-Z]{3,20})$/;
  const paint = (color: unknown, index = 0): string => {
    if (typeof color === "string") {
      const c = color.trim();
      if (HUES.includes(c)) return `var(--cv-${c})`;
      if (/^(dem|democrat|democratic|d)$/i.test(c)) return "var(--cv-blue)";
      if (/^(rep|republican|gop|r)$/i.test(c)) return "var(--cv-red)";
      if (SAFE.test(c)) return c;
    }
    return `var(--cv-c${(((index % 8) + 8) % 8) + 1})`;
  };
  const px = (value: unknown, fallback: number, min = 0, max = 4000) => {
    const n = num(value);
    return n === null ? fallback : Math.max(min, Math.min(max, n));
  };
  const round = (n: number) => Math.round(n * 10) / 10;
  const str = (value: unknown) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));

  // A currency symbol given as the unit goes in front: $30, not 30$.
  const CURRENCY = /^(?:[$€£¥₹₩₽₪฿]|US\$|C\$|A\$|NZ\$|HK\$|R\$)$/;
  const currencyFirst = (o: Record<string, unknown>): Record<string, unknown> => {
    const unit = typeof o.unit === "string" ? o.unit.trim() : "";
    return CURRENCY.test(unit) && !o.prefix ? { ...o, prefix: unit, unit: undefined } : o;
  };

  const fmt = (value: unknown, options?: Record<string, unknown>): string => {
    const o = currencyFirst(opt(options));
    const n = num(value);
    if (n === null) return esc(value);
    const abs = Math.abs(n);
    const decimals = num(o.decimals) ?? (abs >= 100 || Number.isInteger(n) ? 0 : abs >= 10 ? 1 : 2);
    const compact = o.compact === true || (o.compact !== false && abs >= 1e6);
    // year: true (bignum without a unit or currency) prints a year as a year: 1998, not 1,998.
    const year = o.year === true && Number.isInteger(n) && n >= 1900 && n <= 2100;
    const body = new Intl.NumberFormat("en-US", compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: o.fixed ? decimals : 0, maximumFractionDigits: decimals, useGrouping: !year }).format(abs);
    const sign = n < 0 ? "−" : o.signed && n > 0 ? "+" : "";
    return `${sign}${esc(o.prefix ?? "")}${body}${esc(o.unit ?? "")}`;
  };

  const values = (input: unknown): number[] => (Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,]+/) : []).map((v) => num(isObj(v) ? v.value : v)).filter((v): v is number => v !== null);

  const spark = (input: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const vals = values(input);
    if (vals.length < 2) return "";
    const w = px(o.w, 72, 8), h = px(o.h, 18, 6);
    const min = num(o.min) ?? Math.min(...vals), max = num(o.max) ?? Math.max(...vals);
    const span = max - min || 1;
    const pad = 2.5;
    const pts = vals.map((v, i) => [round(pad + (i / (vals.length - 1)) * (w - pad * 2)), round(h - pad - ((v - min) / span) * (h - pad * 2))] as const);
    const color = paint(o.color ?? "accent");
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
    const area = o.area === false ? "" : `<path d="${d}L${pts.at(-1)![0]} ${h}L${pts[0]![0]} ${h}Z" fill="${color}" fill-opacity="0.13" stroke="none"/>`;
    const last = pts.at(-1)!;
    return `<svg class="cv-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="trend ${esc(vals.join(", "))}">${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="${px(o.stroke, 1.6, 0.5, 6)}" stroke-linecap="round" stroke-linejoin="round"/>${o.dot === false ? "" : `<circle cx="${last[0]}" cy="${last[1]}" r="2.3" fill="${color}"/>`}</svg>`;
  };

  const bars = (input: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const vals = values(input);
    if (!vals.length) return "";
    const h = px(o.h, 18, 6), gap = px(o.gap, 1.5, 0, 10);
    const w = px(o.w, Math.max(28, vals.length * 6), 8);
    const bw = (w - gap * (vals.length - 1)) / vals.length;
    const max = Math.max(...vals.map(Math.abs)) || 1;
    const signed = vals.some((v) => v < 0);
    const base = signed ? h / 2 : h;
    const rects = vals.map((v, i) => {
      const bh = Math.max(1, (Math.abs(v) / max) * (signed ? h / 2 : h));
      const color = signed && v < 0 ? paint("bad") : paint(Array.isArray(o.colors) ? o.colors[i] : o.color ?? "accent");
      const last = i === vals.length - 1 && o.highlightLast !== false;
      return `<rect x="${round(i * (bw + gap))}" y="${round(v < 0 ? base : base - bh)}" width="${round(Math.max(0.5, bw))}" height="${round(bh)}" fill="${color}" fill-opacity="${last ? 1 : 0.55}"/>`;
    }).join("");
    return `<svg class="cv-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="bars ${esc(vals.join(", "))}">${rects}</svg>`;
  };

  /** Rows, the category key and the numeric series keys, like Dashboards' charts read them. */
  const chartShape = (rows: unknown, o: Record<string, unknown>) => {
    const list = (Array.isArray(rows) ? rows : []).filter(isObj).slice(0, 400);
    const keys = list.length ? Object.keys(list[0]!) : [];
    const x = typeof o.x === "string" ? o.x : keys.find((key) => list.some((row) => num(row[key]) === null)) ?? keys[0] ?? "x";
    const series = (Array.isArray(o.series) ? o.series.filter((key): key is string => typeof key === "string") : keys.filter((key) => key !== x && list.some((row) => num(row[key]) !== null))).slice(0, 8);
    return { list, x, series };
  };
  const niceTicks = (min: number, max: number, count = 4): number[] => {
    const span = max - min || Math.abs(max) || 1;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10;
    const ticks: number[] = [];
    // From the first step at or below min, through the first at or above max, so every value is on the axis.
    for (let t = Math.floor(min / step + 1e-9) * step; ticks.length < 50; t += step) {
      ticks.push(Math.round(t / step) * step);
      if (t >= max - step * 1e-6) break;
    }
    return ticks;
  };
  const seriesColor = (o: Record<string, unknown>, key: string, index: number) => {
    const colors = isObj(o.colors) ? o.colors : null;
    if (colors && key in colors) return paint(colors[key], index);
    if (Array.isArray(o.colors)) return paint(o.colors[index], index);
    if (typeof o.highlight === "string" && o.highlight !== key) return "var(--cv-gray)";
    return paint(null, index);
  };

  /** Words for a label in SVG, broken into short lines. */
  const wrap = (text: unknown, chars = 24): string[] => {
    const words = str(text).replace(/\s+/g, " ").trim().slice(0, 140).split(" ");
    const lines: string[] = [];
    for (const word of words) { const last = lines.at(-1); if (last !== undefined && (last + " " + word).length <= chars) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word); }
    return lines.slice(0, 4);
  };
  /**
   * An annotation drawn on a chart itself: a dot on the spot, a short leader
   * and a label, kept inside the chart's box. (px, py) is the spot; dx, dy
   * where the label goes from it (default: up and toward the middle).
   */
  const annotation = (px: number, py: number, text: unknown, note: Record<string, unknown>, box: { w: number; h: number; l?: number; t?: number }): string => {
    const lines = wrap(text, num(note.chars) ?? 24);
    if (!lines.length) return "";
    const lh = 13;
    const dx = num(note.dx) ?? (px > (box.l ?? 0) + (box.w - (box.l ?? 0)) * 0.55 ? -46 : 46);
    const dy = num(note.dy) ?? (py - lines.length * lh - 30 > (box.t ?? 0) ? -34 : 30);
    const anchor = dx < 0 ? "end" : "start";
    const tw = Math.max(...lines.map((line) => line.length)) * 6.6;
    let lx = px + dx, ly = py + dy;
    lx = anchor === "end" ? Math.max(tw + 2, Math.min(box.w - 2, lx)) : Math.max(2, Math.min(box.w - tw - 2, lx));
    ly = Math.max((box.t ?? 0) + 11, Math.min(box.h - lines.length * lh, ly));
    const color = paint(note.color ?? "ink");
    const tspans = lines.map((line, i) => `<tspan x="${round(lx)}" dy="${i ? lh : 0}">${esc(line)}</tspan>`).join("");
    const ey = dy < 0 ? ly + (lines.length - 1) * lh + 4 : ly - 11;
    return `<g class="cv-anno-g"><line x1="${round(px)}" y1="${round(py)}" x2="${round(lx - (anchor === "end" ? -3 : 3))}" y2="${round(ey)}" class="cv-anno-line" style="stroke:${color}"/><circle cx="${round(px)}" cy="${round(py)}" r="3.4" class="cv-anno-dot" style="fill:${color}"/><text x="${round(lx)}" y="${round(ly)}" text-anchor="${anchor}" class="cv-anno" style="fill:${color}">${tspans}</text></g>`;
  };

  /** A line (or area) chart with direct labels at the line ends, in px. options: x, series, w, h, unit, area, zero, colors, highlight, marks [{x, label}], callouts [{x, series?, text, dx?, dy?, color?}] (labels drawn on the chart). */
  const line = (rows: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const { list, x, series } = chartShape(rows, o);
    if (list.length < 2 || !series.length) return "";
    const w = px(o.w, 480, 120), h = px(o.h, Math.round(Math.min(320, Math.max(150, w * 0.46))), 80);
    const labelSpace = o.labels === false ? 8 : Math.min(120, Math.max(56, w * 0.16));
    const m = { t: 12, r: labelSpace, b: 22, l: 36 };
    const all = list.flatMap((row) => series.map((key) => num(row[key]))).filter((v): v is number => v !== null);
    let lo = Math.min(...all), hi = Math.max(...all);
    if (o.zero !== false && lo > 0 && lo < hi * 0.5) lo = 0;
    const ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]!); hi = Math.max(hi, ticks.at(-1)!);
    const X = (i: number) => m.l + (i / (list.length - 1)) * (w - m.l - m.r);
    const Y = (v: number) => m.t + (1 - (v - lo) / (hi - lo || 1)) * (h - m.t - m.b);
    const unit = { unit: o.unit, compact: o.compact };
    let out = `<svg class="cv-chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`line chart of ${series.join(", ")} by ${x}`)}">`;
    for (const t of ticks) out += `<line x1="${m.l}" x2="${w - m.r + 4}" y1="${round(Y(t))}" y2="${round(Y(t))}" class="cv-grid-line"/><text x="${m.l - 6}" y="${round(Y(t)) + 3.5}" text-anchor="end" class="cv-axis">${fmt(t, unit)}</text>`;
    const step = Math.max(1, Math.ceil(list.length / Math.max(2, Math.floor((w - m.l - m.r) / 64))));
    list.forEach((row, i) => { if (i % step === 0 || i === list.length - 1) out += `<text x="${round(X(i))}" y="${h - 6}" text-anchor="${i === 0 ? "start" : i === list.length - 1 ? "end" : "middle"}" class="cv-axis">${esc(str(row[x]).slice(0, 14))}</text>`; });
    for (const mark of Array.isArray(o.marks) ? o.marks.filter(isObj).slice(0, 6) : []) {
      const i = list.findIndex((row) => str(row[x]) === str(mark.x));
      if (i < 0) continue;
      out += `<line x1="${round(X(i))}" x2="${round(X(i))}" y1="${m.t}" y2="${h - m.b}" class="cv-mark-line"/><text x="${round(X(i)) + 4}" y="${m.t + 9}" class="cv-mark-text">${esc(str(mark.label).slice(0, 40))}</text>`;
    }
    const ends: { y: number; text: string; color: string }[] = [];
    series.forEach((key, index) => {
      const color = seriesColor(o, key, index);
      const pts = list.map((row, i) => { const v = num(row[key]); return v === null ? null : [round(X(i)), round(Y(v))] as const; }).filter((p): p is readonly [number, number] => !!p);
      if (!pts.length) return;
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
      if (o.area || (series.length === 1 && o.area !== false)) out += `<path d="${d}L${pts.at(-1)![0]} ${round(Y(Math.max(lo, 0)))}L${pts[0]![0]} ${round(Y(Math.max(lo, 0)))}Z" fill="${color}" fill-opacity="${series.length === 1 ? 0.12 : 0.08}"/>`;
      const strong = typeof o.highlight !== "string" || o.highlight === key;
      out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strong ? 2.2 : 1.4}" stroke-linejoin="round" stroke-linecap="round" class="cv-series"/>`;
      const last = pts.at(-1)!;
      out += `<circle cx="${last[0]}" cy="${last[1]}" r="3" fill="${color}"/>`;
      const lastValue = [...list].reverse().map((row) => num(row[key])).find((v) => v !== null);
      ends.push({ y: last[1], text: `${series.length > 1 ? `${key} ` : ""}${lastValue === undefined || lastValue === null ? "" : fmt(lastValue, unit)}`, color });
    });
    if (o.labels !== false) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 13) ends[i]!.y = ends[i - 1]!.y + 13;
      for (const end of ends) out += `<text x="${w - m.r + 8}" y="${round(end.y) + 4}" class="cv-end-label" fill="${end.color}">${esc(end.text.slice(0, 22))}</text>`;
    }
    for (const note of Array.isArray(o.callouts) ? o.callouts.filter(isObj).slice(0, 6) : []) {
      const i = list.findIndex((row) => str(row[x]) === str(note.x));
      const key = typeof note.series === "string" && series.includes(note.series) ? note.series : series[0]!;
      const v = i < 0 ? null : num(list[i]![key]);
      if (v === null) continue;
      out += annotation(X(i), Y(v), note.text ?? note.label, note, { w: w - m.r, h: h - m.b, l: m.l, t: m.t });
    }
    return `${out}</svg>`;
  };

  /** Vertical bars by category, in px. options: x, series, w, h, unit, stacked, colors, highlight (a category). */
  const columns = (rows: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const { list, x, series } = chartShape(rows, o);
    if (!list.length || !series.length) return "";
    const w = px(o.w, 480, 120), h = px(o.h, Math.round(Math.min(300, Math.max(140, w * 0.42))), 80);
    const m = { t: 16, r: 8, b: 22, l: 36 };
    const totals = list.map((row) => (o.stacked ? series.reduce((sum, key) => sum + Math.max(0, num(row[key]) ?? 0), 0) : Math.max(...series.map((key) => num(row[key]) ?? 0))));
    const mins = list.map((row) => Math.min(0, ...series.map((key) => num(row[key]) ?? 0)));
    // Honest: the axis always includes zero, and options.max sets a meaningful top (so 0.1 doesn't fill the chart).
    const ticks = niceTicks(Math.min(0, ...mins), Math.max(...totals, num(o.max) ?? 0, 0), 4);
    const lo = ticks[0]!, hi = ticks.at(-1)!;
    const Y = (v: number) => m.t + (1 - (v - lo) / (hi - lo || 1)) * (h - m.t - m.b);
    const band = (w - m.l - m.r) / list.length;
    const inner = band * 0.72;
    const unit = { unit: o.unit, compact: o.compact };
    let out = `<svg class="cv-chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`bar chart of ${series.join(", ")} by ${x}`)}">`;
    for (const t of ticks) out += `<line x1="${m.l}" x2="${w - m.r}" y1="${round(Y(t))}" y2="${round(Y(t))}" class="cv-grid-line"/><text x="${m.l - 6}" y="${round(Y(t)) + 3.5}" text-anchor="end" class="cv-axis">${fmt(t, unit)}</text>`;
    const showValues = band / series.length >= 26;
    list.forEach((row, i) => {
      const x0 = m.l + i * band + (band - inner) / 2;
      let stack = 0;
      const dim = typeof o.highlight === "string" && str(row[x]) !== o.highlight;
      series.forEach((key, index) => {
        const v = num(row[key]) ?? 0;
        const color = series.length === 1 && dim ? "var(--cv-gray)" : seriesColor({ ...o, highlight: undefined }, key, index);
        const bw = o.stacked ? inner : inner / series.length;
        const bx = o.stacked ? x0 : x0 + index * bw;
        const top = o.stacked ? Y(stack + Math.max(0, v)) : Y(Math.max(0, v));
        const bottom = o.stacked ? Y(stack) : Y(Math.min(0, v));
        out += `<rect x="${round(bx)}" y="${round(top)}" width="${round(Math.max(1, bw - 1))}" height="${round(Math.max(1, bottom - top))}" fill="${color}" rx="1"/>`;
        if (showValues) out += `<text x="${round(bx + bw / 2)}" y="${round(top) - 4}" text-anchor="middle" class="cv-value">${fmt(v, unit)}</text>`;
        if (o.stacked) stack += Math.max(0, v);
      });
      const step = Math.max(1, Math.ceil(list.length / Math.max(2, Math.floor((w - m.l - m.r) / 44))));
      if (i % step === 0) out += `<text x="${round(x0 + inner / 2)}" y="${h - 6}" text-anchor="middle" class="cv-axis">${esc(str(row[x]).slice(0, 10))}</text>`;
    });
    if (lo < 0 || o.baseline !== false) out += `<line x1="${m.l}" x2="${w - m.r}" y1="${round(Y(0))}" y2="${round(Y(0))}" class="cv-zero-line"/>`;
    for (const note of Array.isArray(o.callouts) ? o.callouts.filter(isObj).slice(0, 6) : []) {
      const i = list.findIndex((row) => str(row[x]) === str(note.x));
      if (i < 0) continue;
      const top = o.stacked ? totals[i]! : Math.max(...series.map((key) => num(list[i]![key]) ?? 0));
      out += annotation(m.l + i * band + band / 2, Y(Math.max(0, top)) - (showValues ? 14 : 2), note.text ?? note.label, note, { w: w - m.r, h: h - m.b, l: m.l, t: 0 });
    }
    return `${out}</svg>`;
  };

  /** Horizontal bars as HTML rows (they wrap with their card): [{label, value, color?, note?}] or chart rows. options: max, unit, decimals, sort, colors, x, series. */
  const hbars = (rows: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    let items = (Array.isArray(rows) ? rows : []).filter(isObj).map((row, index) => {
      const keys = Object.keys(row);
      const labelKey = typeof o.x === "string" ? o.x : "label" in row ? "label" : keys.find((key) => num(row[key]) === null) ?? keys[0]!;
      const valueKey = Array.isArray(o.series) && typeof o.series[0] === "string" ? o.series[0] : "value" in row ? "value" : keys.find((key) => key !== labelKey && num(row[key]) !== null) ?? "value";
      return { label: str(row[labelKey]), value: num(row[valueKey]) ?? 0, color: paint(row.color ?? (isObj(o.colors) ? o.colors[str(row[labelKey])] : undefined), index), note: str(row.note) };
    }).slice(0, 40);
    if (o.sort === true || o.sort === "desc") items = [...items].sort((a, b) => b.value - a.value);
    const max = num(o.max) ?? Math.max(...items.map((item) => Math.abs(item.value)), 0) ?? 1;
    const unit = { unit: o.unit, decimals: o.decimals, prefix: o.prefix };
    return `<div class="cv-hbars">${items.map((item) => `<div class="cv-hbar"><span class="cv-hbar-label">${esc(item.label)}</span><span class="cv-hbar-track"><span class="cv-hbar-fill" style="width:${round((Math.abs(item.value) / (max || 1)) * 100)}%;background:${item.color}"></span></span><span class="cv-hbar-value">${fmt(item.value, unit)}</span>${item.note ? `<span class="cv-hbar-note">${esc(item.note)}</span>` : ""}</div>`).join("")}</div>`;
  };

  /** One bar split into parts, like seats in a chamber: [{label, value, color?}]. options: total, mark (a value, e.g. a majority), markLabel, unit. */
  const split = (parts: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const list = (Array.isArray(parts) ? parts : []).filter(isObj).map((part, index) => ({ label: str(part.label), value: Math.max(0, num(part.value) ?? 0), color: paint(part.color ?? part.label, index) })).slice(0, 10);
    const total = num(o.total) ?? list.reduce((sum, part) => sum + part.value, 0);
    if (!total) return "";
    const mark = num(o.mark);
    const unit = { unit: o.unit };
    const segments = list.map((part) => `<span class="cv-split-seg" style="width:${round((part.value / total) * 100)}%;background:${part.color}" title="${esc(part.label)}"></span>`).join("");
    const labels = list.map((part) => `<span class="cv-split-label"><i class="cv-swatch" style="background:${part.color}"></i>${esc(part.label)} <b>${fmt(part.value, unit)}</b></span>`).join("");
    return `<div class="cv-split"><div class="cv-split-labels">${labels}</div><div class="cv-split-bar">${segments}${mark !== null ? `<span class="cv-split-mark" style="left:${round((mark / total) * 100)}%"></span>` : ""}</div>${mark !== null ? `<div class="cv-split-mark-label" style="left:${round((mark / total) * 100)}%">${esc(o.markLabel ?? `${fmt(mark)} to win`)}</div>` : ""}</div>`;
  };

  /** A donut: [{label, value, color?}]. options: size, thickness, center, sub. */
  const donut = (parts: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const list = (Array.isArray(parts) ? parts : []).filter(isObj).map((part, index) => {
      const keys = Object.keys(part);
      const labelKey = "label" in part ? "label" : keys.find((key) => num(part[key]) === null) ?? keys[0]!;
      const valueKey = "value" in part ? "value" : keys.find((key) => key !== labelKey && num(part[key]) !== null) ?? "value";
      return { label: str(part[labelKey]), value: Math.max(0, num(part[valueKey]) ?? 0), color: paint(part.color, index) };
    }).slice(0, 10);
    const total = list.reduce((sum, part) => sum + part.value, 0);
    if (!total) return "";
    const size = px(o.size, 132, 40, 600), t = px(o.thickness, size * 0.16, 2, size / 2);
    const r = (size - t) / 2, c = size / 2, circ = 2 * Math.PI * r;
    let at = 0;
    const arcs = list.map((part) => {
      const len = (part.value / total) * circ;
      const arc = `<circle cx="${c}" cy="${c}" r="${round(r)}" fill="none" stroke="${part.color}" stroke-width="${round(t)}" stroke-dasharray="${round(Math.max(0, len - 1.5))} ${round(circ)}" stroke-dashoffset="${round(-at)}" transform="rotate(-90 ${c} ${c})"/>`;
      at += len;
      return arc;
    }).join("");
    const center = o.center === undefined ? "" : `<text x="${c}" y="${c + (o.sub ? 0 : 6)}" text-anchor="middle" class="cv-donut-center">${esc(o.center)}</text>${o.sub ? `<text x="${c}" y="${c + 16}" text-anchor="middle" class="cv-axis">${esc(o.sub)}</text>` : ""}`;
    const legend = o.legend === false ? "" : `<div class="cv-legend">${list.map((part) => `<span><i class="cv-swatch" style="background:${part.color}"></i>${esc(part.label)} <b>${fmt((part.value / total) * 100, { decimals: 0 })}%</b></span>`).join("")}</div>`;
    return `<div class="cv-donut"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="donut">${arcs}${center}</svg>${legend}</div>`;
  };

  /** A meter: value of max. options: min, max, label, color, unit, marks [{at, label}]. */
  const meter = (value: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const v = num(value) ?? 0, min = num(o.min) ?? 0, max = num(o.max) ?? 100;
    const pct = Math.max(0, Math.min(100, ((v - min) / (max - min || 1)) * 100));
    const marks = (Array.isArray(o.marks) ? o.marks : []).filter(isObj).slice(0, 6).map((mark) => {
      const at = Math.max(0, Math.min(100, (((num(mark.at) ?? 0) - min) / (max - min || 1)) * 100));
      return `<span class="cv-meter-mark" style="left:${round(at)}%"><em>${esc(mark.label)}</em></span>`;
    }).join("");
    return `<div class="cv-meter">${o.label ? `<div class="cv-meter-head"><span class="cv-label">${esc(o.label)}</span><b>${fmt(v, { unit: o.unit })}</b></div>` : ""}<div class="cv-meter-track"><span class="cv-meter-fill" style="width:${round(pct)}%;background:${paint(o.color ?? "accent")}"></span>${marks}</div></div>`;
  };

  // A US tile grid: [column, row] per state.
  const states: Record<string, [number, number]> = {
    AK: [0, 0], ME: [10, 0], WI: [5, 1], VT: [9, 1], NH: [10, 1],
    WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], IL: [5, 2], MI: [6, 2], NY: [8, 2], MA: [9, 2],
    OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IN: [5, 3], OH: [6, 3], PA: [7, 3], NJ: [8, 3], CT: [9, 3], RI: [10, 3],
    CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
    AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5],
    OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
    HI: [0, 7], TX: [3, 7], FL: [8, 7],
  };
  const NAMES: Record<string, string> = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC", "washington dc": "DC", "washington, d.c.": "DC",
  };
  const stateCode = (value: unknown) => { const s = str(value).trim(); const up = s.toUpperCase(); return states[up] ? up : NAMES[s.toLowerCase()] ?? null; };

  /**
   * A US tile map. values: {PA: 2.1, ...} or {PA: {value, label?, color?}} or [{state, value, label?, color?}].
   * options: cell, scale (diverging|sequential), min, max, low, high (colors), legend [lowLabel, highLabel], show (value|abbr).
   */
  const tilemap = (input: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const entries = new Map<string, { value: number | null; label: string; color: string | null }>();
    const take = (key: unknown, entry: unknown) => {
      const code = stateCode(key);
      if (!code) return;
      const row = isObj(entry) ? entry : { value: entry };
      entries.set(code, { value: num(row.value ?? row.margin ?? row.v), label: str(row.label ?? ""), color: row.color === undefined ? null : paint(row.color) });
    };
    if (Array.isArray(input)) input.filter(isObj).forEach((row) => take(row.state ?? row.code ?? row.name, row));
    else if (isObj(input)) for (const [key, entry] of Object.entries(input)) take(key, entry);
    const cell = px(o.cell, 30, 10, 80), gap = Math.max(1.5, cell * 0.07);
    const nums = [...entries.values()].map((entry) => entry.value).filter((v): v is number => v !== null);
    const diverging = o.scale === "diverging" || (o.scale !== "sequential" && nums.some((v) => v < 0) && nums.some((v) => v > 0));
    const lim = Math.max(...nums.map(Math.abs), 0) || 1;
    const min = num(o.min) ?? (diverging ? -lim : Math.min(...nums, 0)), max = num(o.max) ?? (diverging ? lim : Math.max(...nums, 1));
    const low = paint(o.low ?? "blue"), high = paint(o.high ?? (diverging ? "red" : "accent"));
    const fill = (entry: { value: number | null; color: string | null }) => {
      if (entry.color) return { bg: entry.color, strong: true };
      if (entry.value === null) return { bg: "var(--cv-rule)", strong: false };
      if (diverging) {
        const t = Math.max(-1, Math.min(1, entry.value < 0 ? entry.value / Math.abs(min || 1) : entry.value / Math.abs(max || 1)));
        const pct = Math.round(18 + Math.abs(t) * 82);
        return { bg: `color-mix(in oklab, ${t < 0 ? low : high} ${pct}%, var(--cv-surface))`, strong: pct > 58 };
      }
      const t = Math.max(0, Math.min(1, (entry.value - min) / (max - min || 1)));
      const pct = Math.round(12 + t * 88);
      return { bg: `color-mix(in oklab, ${high} ${pct}%, var(--cv-surface))`, strong: pct > 58 };
    };
    const callouts = Array.isArray(o.callouts) ? o.callouts.filter(isObj).filter((note) => stateCode(note.state)).slice(0, 6) : [];
    // Callouts sit in a margin beside the map, on the side nearer their state, with a leader to the tile.
    const margin = callouts.length ? (cell + gap) * 3.2 : 0;
    const W = 11 * (cell + gap) + margin * 2, H = 8 * (cell + gap);
    let out = `<svg class="cv-tilemap" viewBox="${round(-margin)} 0 ${round(W)} ${round(H)}" width="100%" style="max-width:${round(W * 1.6)}px" role="img" aria-label="US map">`;
    for (const [code, [cx, cy]] of Object.entries(states)) {
      const entry = entries.get(code) ?? { value: null, label: "", color: null };
      const { bg, strong } = fill(entry);
      const x = cx * (cell + gap), y = cy * (cell + gap);
      const shown = o.show === "value" && entry.value !== null ? fmt(entry.value, { decimals: 0 }) : entry.label && o.show === "label" ? entry.label.slice(0, 4) : code;
      out += `<g><rect x="${round(x)}" y="${round(y)}" width="${cell}" height="${cell}" rx="${round(cell * 0.12)}" style="fill:${bg}" class="${entries.has(code) ? "cv-tile" : "cv-tile cv-tile-empty"}"><title>${esc(code)}${entry.value !== null ? ` ${esc(fmt(entry.value))}` : ""}${entry.label ? ` ${esc(entry.label)}` : ""}</title></rect><text x="${round(x + cell / 2)}" y="${round(y + cell / 2 + cell * 0.13)}" text-anchor="middle" class="cv-tile-text" style="font-size:${round(cell * 0.34)}px;fill:${strong ? "#fff" : "var(--cv-ink-2)"}">${esc(shown)}</text></g>`;
    }
    const used: Record<string, number[]> = { left: [], right: [] };
    for (const note of callouts) {
      const code = stateCode(note.state)!;
      const [cx, cy] = states[code] ?? [0, 0];
      const tx = cx * (cell + gap) + cell / 2, ty = cy * (cell + gap) + cell / 2;
      const side = note.side === "left" || (note.side !== "right" && cx < 5.5) ? "left" : "right";
      const fs = Math.max(9, cell * 0.36), lh = fs * 1.2;
      const lines = wrap(note.text ?? note.label, Math.max(10, Math.round(margin / (fs * 0.55))));
      let ly = Math.max(fs, Math.min(H - lines.length * lh, ty - (lines.length - 1) * lh / 2));
      for (const taken of used[side]!) if (Math.abs(taken - ly) < lines.length * lh + 4) ly = taken + lines.length * lh + 6;
      used[side]!.push(ly);
      const lx = side === "left" ? -margin + 2 : 11 * (cell + gap) + gap * 2;
      const ex = side === "left" ? -gap * 2 : 11 * (cell + gap);
      const color = paint(note.color ?? "ink");
      out += `<g class="cv-anno-g"><polyline points="${round(ex)},${round(ly - fs * 0.35)} ${round(side === "left" ? Math.min(ex + gap * 2, tx - cell * 0.3) : Math.max(ex - gap * 2, tx + cell * 0.3))},${round(ly - fs * 0.35)} ${round(tx)},${round(ty)}" class="cv-anno-line" style="stroke:${color};fill:none"/><circle cx="${round(tx)}" cy="${round(ty)}" r="${round(cell * 0.12)}" class="cv-anno-dot" style="fill:${color}"/><text x="${round(side === "left" ? ex - gap : lx)}" y="${round(ly)}" text-anchor="${side === "left" ? "end" : "start"}" class="cv-anno" style="fill:${color};font-size:${round(fs)}px">${lines.map((line, i) => `<tspan x="${round(side === "left" ? ex - gap : lx)}" dy="${i ? round(lh) : 0}">${esc(line)}</tspan>`).join("")}</text></g>`;
    }
    out += "</svg>";
    const legend = Array.isArray(o.legend) ? `<div class="cv-map-legend"><span>${esc(o.legend[0])}</span><i style="background:linear-gradient(90deg, ${diverging ? `${low}, var(--cv-surface), ${high}` : `var(--cv-surface), ${high}`})"></i><span>${esc(o.legend[1] ?? "")}</span></div>` : "";
    return `<div class="cv-map">${out}${legend}</div>`;
  };

  /** A timeline: [{date, label, note?, tone?|color?}]. options: layout (column|row), highlight (index or date). */
  const timeline = (events: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const list = (Array.isArray(events) ? events : []).filter(isObj).slice(0, 40);
    if (!list.length) return "";
    const layout = o.layout === "row" ? "row" : "column";
    const items = list.map((event, index) => {
      const tone = paint(event.color ?? (event.tone === "good" || event.tone === "bad" || event.tone === "accent" || event.tone === "warn" ? event.tone : null), index === list.length - 1 ? 0 : 6);
      const hot = o.highlight === index || (o.highlight !== undefined && str(o.highlight) === str(event.date)) || event.highlight === true;
      return `<li class="cv-tl-item${hot ? " cv-tl-hot" : ""}" style="--cv-tl-dot:${tone}"><span class="cv-tl-dot"></span><span class="cv-tl-date">${esc(event.date ?? event.time ?? "")}</span><span class="cv-tl-label">${esc(event.label ?? event.title ?? "")}</span>${event.note ? `<span class="cv-tl-note">${esc(event.note)}</span>` : ""}</li>`;
    }).join("");
    return `<ol class="cv-timeline cv-tl-${layout}">${items}</ol>`;
  };

  /** Dots, one per unit (seats, people): [{label, n, color?}]. options: cols, size. */
  const waffle = (groups: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const list = (Array.isArray(groups) ? groups : []).filter(isObj).map((group, index) => ({ label: str(group.label), n: Math.max(0, Math.min(1000, Math.round(num(group.n ?? group.value) ?? 0))), color: paint(group.color ?? group.label, index) })).slice(0, 10);
    const total = list.reduce((sum, group) => sum + group.n, 0);
    if (!total) return "";
    const cols = px(o.cols, Math.ceil(Math.sqrt(total * 2.2)), 2, 120), size = px(o.size, 7, 2, 30), gap = Math.max(1, size * 0.3);
    const rows = Math.ceil(total / cols);
    let i = 0, dots = "";
    for (const group of list) for (let k = 0; k < group.n; k++, i++) dots += `<circle cx="${round((i % cols) * (size + gap) + size / 2)}" cy="${round(Math.floor(i / cols) * (size + gap) + size / 2)}" r="${size / 2}" fill="${group.color}"/>`;
    const w = cols * (size + gap), h = rows * (size + gap);
    return `<div class="cv-waffle"><svg width="${round(w)}" height="${round(h)}" viewBox="0 0 ${round(w)} ${round(h)}" role="img" aria-label="dots">${dots}</svg><div class="cv-legend">${list.map((group) => `<span><i class="cv-swatch" style="background:${group.color}"></i>${esc(group.label)} <b>${group.n}</b></span>`).join("")}</div></div>`;
  };

  /** Small multiples: [{label, values: number[], value?, delta?, note?, color?}]. options: unit, min (px per panel), shared (one y scale). */
  const multiples = (items: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const list = (Array.isArray(items) ? items : []).filter(isObj).slice(0, 48);
    const all = list.flatMap((item) => values(item.values ?? item.series));
    const shared = o.shared === true && all.length ? { min: Math.min(...all), max: Math.max(...all) } : {};
    const cells = list.map((item, index) => {
      const vals = values(item.values ?? item.series);
      const value = item.value ?? vals.at(-1);
      const d = num(item.delta);
      const color = paint(item.color ?? (d === null ? "accent" : d >= 0 === (o.invert !== true) ? "good" : "bad"), index);
      return `<div class="cv-mult"><div class="cv-mult-label">${esc(item.label ?? "")}</div><div class="cv-mult-row"><span class="cv-mult-value">${fmt(value, { unit: o.unit ?? item.unit })}</span>${d !== null ? delta(d, { invert: o.invert, unit: o.deltaUnit }) : ""}</div>${vals.length > 1 ? spark(vals, { w: 120, h: 26, color, ...shared }).replace('class="cv-spark"', 'class="cv-spark cv-mult-spark" preserveAspectRatio="none"') : ""}${item.note ? `<div class="cv-mult-note">${esc(item.note)}</div>` : ""}</div>`;
    }).join("");
    return `<div class="cv-multiples" style="--cv-mult-min:${px(o.min, 118, 60, 400)}px">${cells}</div>`;
  };

  /** A change chip: ▲ 2.1. options: invert (down is good), unit, decimals. */
  const delta = (value: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const n = num(value);
    if (n === null) return value ? `<span class="cv-delta">${esc(value)}</span>` : "";
    const good = n === 0 ? null : (n > 0) !== (o.invert === true);
    return `<span class="cv-delta ${good === null ? "" : good ? "cv-up" : "cv-down"}">${n > 0 ? "▲" : n < 0 ? "▼" : "■"} ${fmt(Math.abs(n), { unit: o.unit, decimals: o.decimals })}</span>`;
  };

  const legend = (items: unknown): string => `<div class="cv-legend">${(Array.isArray(items) ? items : []).filter(isObj).slice(0, 12).map((item, index) => `<span><i class="cv-swatch" style="background:${paint(item.color, index)}"></i>${esc(item.label)}</span>`).join("")}</div>`;

  /** One number set huge, with its label above and a line under: the shape is the type. options: label, unit, prefix, decimals, delta, invert, sub, size (px; default: a third of the width), color. */
  const bignum = (value: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const size = num(o.size);
    const color = o.color ? paint(o.color) : "var(--cv-ink)";
    const n = num(value);
    // A whole number from 1900 to 2100 with no unit or currency is a year: no thousands comma.
    const c = currencyFirst(o);
    const body = n === null ? esc(value) : fmt(n, { decimals: c.decimals, compact: c.compact, year: !c.unit && !c.prefix });
    return `<div class="cv-bignum">${o.label ? `<div class="cv-bignum-label">${esc(o.label)}</div>` : ""}<div class="cv-bignum-n" style="color:${color}${size ? `;font-size:${size}px` : ""}">${c.prefix ? `<span class="cv-bignum-unit">${esc(c.prefix)}</span>` : ""}${body}${c.unit ? `<span class="cv-bignum-unit">${esc(c.unit)}</span>` : ""}</div>${o.delta !== undefined ? delta(o.delta, { invert: o.invert, unit: o.deltaUnit }) : ""}${o.sub ? `<div class="cv-bignum-sub">${esc(o.sub)}</div>` : ""}</div>`;
  };

  /** A quote with no frame: big type, a hanging mark, the speaker under it. options: by, role, size (px). */
  const quote = (text: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const size = num(o.size);
    return `<figure class="cv-bare-quote"><blockquote${size ? ` style="font-size:${size}px"` : ""}>${esc(text)}</blockquote>${o.by ? `<figcaption>${esc(o.by)}${o.role ? `, <span>${esc(o.role)}</span>` : ""}</figcaption>` : ""}</figure>`;
  };

  /**
   * A callout with a leader line, over a figure: put it inside an element
   * with class cv-annotated, after the figure. x, y: the spot (0–1 of the
   * figure); dx, dy: where the label sits from it, in px. options: x, y, dx, dy, color, w (label width).
   */
  const callout = (text: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const x = Math.max(0, Math.min(1, num(o.x) ?? 0.5)), y = Math.max(0, Math.min(1, num(o.y) ?? 0.5));
    const dx = num(o.dx) ?? (x > 0.55 ? -60 : 60), dy = num(o.dy) ?? (y > 0.35 ? -44 : 44);
    const color = paint(o.color ?? "ink");
    const lw = px(o.w, 160, 60, 400);
    const left = dx < 0 ? dx - lw : dx;
    const top = dy < 0 ? dy - 6 : dy - 6;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    return `<div class="cv-callout-pin" style="left:${round(x * 100)}%;top:${round(y * 100)}%;--cv-callout-color:${color}"><svg class="cv-callout-leader" width="${ax + 2}" height="${ay + 2}" style="left:${dx < 0 ? -ax - 1 : -1}px;top:${dy < 0 ? -ay - 1 : -1}px" aria-hidden="true"><line x1="${dx < 0 ? ax + 1 : 1}" y1="${dy < 0 ? ay + 1 : 1}" x2="${dx < 0 ? 1 : ax + 1}" y2="${dy < 0 ? 1 : ay + 1}"/></svg><i class="cv-callout-dot"></i><span class="cv-callout-text" style="left:${round(left)}px;top:${round(top)}px;width:${round(lw)}px;text-align:${dx < 0 ? "right" : "left"};${dy < 0 ? "transform:translateY(-100%)" : ""}">${esc(text)}</span></div>`;
  };

  /**
   * A rating as five stars (partly filled), from a score out of max (5, 10 or 100). options: max, size (px),
   * color, label (false: no number), source (who gave the score, shown beside it). Without a source the stars
   * say "my pick" (or options.note): a score nobody published is labelled as the agent's own.
   */
  const stars = (value: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const n = num(value);
    if (n === null) return "";
    const max = num(o.max) ?? (n > 10 ? 100 : n > 5 ? 10 : 5);
    const share = Math.max(0, Math.min(1, n / (max || 5)));
    const size = px(o.size, 16, 8, 64);
    const color = paint(o.color ?? "amber");
    const star = "M10 1.5l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L10 15l-5.3 2.8 1.1-5.9L1.4 7.8l6-.8z";
    const id = `cvs${Math.round(share * 1000)}${Math.round(size)}`;
    let shapes = "";
    for (let i = 0; i < 5; i++) shapes += `<path d="${star}" transform="translate(${i * 21} 0)"/>`;
    const w = 5 * 21 - 1;
    const label = o.label === false ? "" : `<b class="cv-stars-n">${esc(fmt(n, { decimals: max === 100 ? 0 : 1 }))}<small>/${esc(max)}</small></b>`;
    const source = typeof o.source === "string" && o.source.trim() ? o.source.trim() : null;
    const note = source ?? (o.note === false ? null : typeof o.note === "string" && o.note.trim() ? o.note.trim() : "my pick");
    const tail = note ? `<small class="cv-stars-note">${esc(note)}</small>` : "";
    return `<span class="cv-stars" role="img" aria-label="${esc(`${fmt(n)} out of ${max}${source ? `, ${source}` : note ? `, ${note}` : ""}`)}"><svg width="${round((size * w) / 20)}" height="${size}" viewBox="0 0 ${w} 20"><defs><clipPath id="${id}"><rect width="${round(w * share)}" height="20"/></clipPath></defs><g fill="var(--cv-rule)">${shapes}</g><g fill="${color}" clip-path="url(#${id})">${shapes}</g></svg>${label}${tail}</span>`;
  };

  /**
   * Building blocks for the common shapes, declared in a few attributes so a page needs little markup:
   * <div data-block="card" data-img data-title data-rating data-max data-source data-line data-tag>, and
   * stat (data-value, data-unit, data-label, data-line, data-delta, data-source), step (data-when, data-title,
   * data-line, data-tone="key"), side (data-label, data-title, data-value, data-unit, data-points "a | b",
   * data-verdict), quote (data-text, data-by, data-role) and placeholder (data-label). The element keeps its
   * own attributes (data-cv-id, class, style); what it holds comes after the block's parts. Every value is
   * escaped, and a picture must be https.
   */
  const block = (kind: unknown, attrs: Record<string, string | undefined>, inner = ""): string => {
    const a = (name: string) => { const v = attrs[name]; return typeof v === "string" && v.trim() ? v.trim() : null; };
    const text = (name: string, cls: string, tag = "div") => (a(name) ? `<${tag} class="${cls}">${esc(a(name))}</${tag}>` : "");
    const list = (raw: string | null): string[] => {
      if (!raw) return [];
      if (raw.startsWith("[")) { try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean).slice(0, 12); } catch { /* as text */ } }
      return raw.split("|").map((v) => v.trim()).filter(Boolean).slice(0, 12);
    };
    const src = a("img");
    const safe = src && /^https:\/\//i.test(src) ? src : null;
    switch (kind) {
      case "card": {
        const picture = safe
          ? `<div class="cv-card-pic"><img src="${esc(safe)}" alt="${esc(a("alt") ?? a("title") ?? "")}" loading="eager" decoding="async"></div>`
          : `<div class="cv-card-pic cv-card-ph" aria-hidden="true"></div>`;
        const rating = a("rating") !== null ? stars(a("rating"), { max: a("max") ?? 10, size: 20, ...(a("source") ? { source: a("source") } : {}) }) : "";
        return `${picture}<div class="cv-card-text">${a("tag") ? `<span class="cv-chip">${esc(a("tag"))}</span>` : ""}${text("title", "cv-card-title")}${rating ? `<div class="cv-card-rating">${rating}</div>` : ""}${text("line", "cv-card-line", "p")}${inner}</div>`;
      }
      case "stat":
        return `${bignum(a("value") ?? "–", { label: a("label") ?? undefined, unit: a("unit") ?? undefined, ...(a("delta") !== null ? { delta: a("delta") } : {}) })}${text("line", "cv-stat-line", "p")}${inner}${text("source", "cv-stat-source")}`;
      case "step":
        return `${text("when", "cv-step-when")}${text("title", "cv-step-title")}${text("line", "cv-step-line", "p")}${inner}`;
      case "side": {
        const points = list(a("points"));
        return `<div class="cv-side-head">${text("label", "cv-side-label")}${a("verdict") ? `<span class="cv-chip">${esc(a("verdict"))}</span>` : ""}</div>${text("title", "cv-side-title")}${a("value") !== null ? bignum(a("value"), { unit: a("unit") ?? undefined }) : ""}${points.length ? `<ul class="cv-side-points">${points.map((point) => `<li>${esc(point)}</li>`).join("")}</ul>` : ""}${inner}`;
      }
      case "quote":
        return `<blockquote>${esc(a("text") ?? "")}${a("by") ? `<cite>${esc(a("by"))}${a("role") ? `, ${esc(a("role"))}` : ""}</cite>` : ""}</blockquote>${inner}`;
      case "placeholder":
        return `<div class="cv-ph-box" aria-hidden="true"></div>${text("label", "cv-ph-label")}${inner}`;
      default:
        return inner;
    }
  };

  const kit: CanvasKit = { esc, num, paint, fmt, spark, bars, line, columns, hbars, split, donut, meter, tilemap, timeline, waffle, multiples, delta, legend, bignum, quote, callout, stars, states, block };

  const w = win as (Window & { cv?: CanvasKit; bbWidget?: { data: unknown; options: Record<string, unknown> } }) | undefined;
  if (w && typeof w.document !== "undefined") {
    const doc = w.document;
    // data-spark="1,2,3", data-bars="…", data-meter="62" (data-max), data-delta="2.1": filled in place.
    kit.hydrate = (root?: unknown) => {
      const scope = (root as ParentNode | undefined) ?? doc;
      scope.querySelectorAll<HTMLElement>("[data-spark]").forEach((el) => { el.innerHTML = spark(el.dataset.spark, { color: el.dataset.color, w: el.dataset.w, h: el.dataset.h }); });
      scope.querySelectorAll<HTMLElement>("[data-bars]").forEach((el) => { el.innerHTML = bars(el.dataset.bars, { color: el.dataset.color, w: el.dataset.w, h: el.dataset.h }); });
      scope.querySelectorAll<HTMLElement>("[data-meter]").forEach((el) => { el.innerHTML = meter(el.dataset.meter, { max: el.dataset.max, label: el.dataset.label, color: el.dataset.color }); });
      scope.querySelectorAll<HTMLElement>("[data-delta]").forEach((el) => { el.innerHTML = delta(el.dataset.delta, { invert: el.dataset.invert === "true" }); });
    };
    // data-block="card" (and the rest): expanded in place once; the element gets class cv-<kind> and keeps its children after the parts.
    kit.blocks = (root?: unknown) => {
      const scope = (root as ParentNode | undefined) ?? doc;
      scope.querySelectorAll<HTMLElement>("[data-block]").forEach((el) => {
        if (el.dataset.blockDone) return;
        const kind = el.dataset.block ?? "";
        const attrs: Record<string, string | undefined> = {};
        for (const name of Object.keys(el.dataset)) attrs[name] = el.dataset[name];
        el.innerHTML = block(kind, attrs, el.innerHTML);
        el.classList.add(`cv-${kind.replace(/[^a-z]/g, "")}`);
        el.dataset.blockDone = "1";
      });
    };
    // cv.render((data, options) => html): redraws #cv-app on every state the canvas sends.
    kit.render = (build) => {
      const draw = () => {
        const target = doc.getElementById("cv-app") ?? doc.body;
        try { target.innerHTML = build(w.bbWidget?.data ?? null, w.bbWidget?.options ?? {}, w.bbWidget); } catch (error) { target.innerHTML = `<p class="cv-label">Couldn't draw: ${esc((error as Error)?.message ?? error)}</p>`; }
        kit.hydrate!(target);
      };
      w.addEventListener("bbwidget", draw);
      if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", draw); else draw();
    };
    kit.width = () => Math.max(120, doc.documentElement.clientWidth || w.innerWidth || 480);

    // Declarative charts for pages: <div data-chart="line" data-rows='[…]' data-options='{…}'></div>.
    // data-value for one number (stars, meter, bignum, spark). Sized to the element's width (and its
    // CSS height, when it has one); redrawn when the page's width changes.
    const parse = (text: string | undefined, fallback: unknown) => { if (!text) return fallback; try { return JSON.parse(text); } catch { return fallback; } };
    const CHARTS: Record<string, (el: HTMLElement, rows: unknown, o: Record<string, unknown>) => string> = {
      line: (el, rows, o) => line(rows, { w: el.clientWidth, h: el.clientHeight > 40 ? el.clientHeight : undefined, ...o }),
      area: (el, rows, o) => line(rows, { w: el.clientWidth, h: el.clientHeight > 40 ? el.clientHeight : undefined, area: true, ...o }),
      columns: (el, rows, o) => columns(rows, { w: el.clientWidth, h: el.clientHeight > 40 ? el.clientHeight : undefined, ...o }),
      bars: (_el, rows, o) => hbars(rows, o),
      donut: (_el, rows, o) => donut(rows, o),
      split: (_el, rows, o) => split(rows, o),
      waffle: (_el, rows, o) => waffle(rows, o),
      map: (el, rows, o) => tilemap(rows, { cell: Math.max(12, Math.min(64, el.clientWidth / (o.callouts ? 18 : 11.9))), ...o }),
      timeline: (_el, rows, o) => timeline(rows, o),
      multiples: (_el, rows, o) => multiples(rows, o),
      legend: (_el, rows) => legend(rows),
      spark: (el, rows, o) => spark(rows, { w: el.clientWidth || 80, h: el.clientHeight > 8 ? el.clientHeight : 20, ...o }),
      stars: (_el, value, o) => stars(value, o),
      meter: (_el, value, o) => meter(value, o),
      bignum: (_el, value, o) => bignum(value, o),
      delta: (_el, value, o) => delta(value, o),
    };
    kit.charts = (root?: unknown, fresh = false) => {
      const scope = (root as ParentNode | undefined) ?? doc;
      scope.querySelectorAll<HTMLElement>("[data-chart]").forEach((el) => {
        if (fresh && el.dataset.drawnWidth !== undefined) return;
        const draw = CHARTS[el.dataset.chart ?? ""];
        if (!draw) return;
        const data = el.dataset.value !== undefined ? el.dataset.value : parse(el.dataset.rows, []);
        try { el.innerHTML = draw(el, data, parse(el.dataset.options, {}) as Record<string, unknown>); } catch (error) { el.textContent = `Couldn't draw: ${(error as Error)?.message ?? error}`; }
        el.dataset.drawnWidth = String(el.clientWidth);
      });
    };
    const RO = (w as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof RO === "function") {
      let lastWidth = 0;
      new RO(() => {
        const width = doc.documentElement.clientWidth;
        if (Math.abs(width - lastWidth) < 2) return;
        lastWidth = width;
        kit.charts!();
      }).observe(doc.documentElement);
    }

    // The screen the page has: its width and height in px (also --cv-vw and --cv-vh on <html>).
    kit.viewport = () => ({ width: doc.documentElement.clientWidth || w.innerWidth || 0, height: w.innerHeight || doc.documentElement.clientHeight || 0 });
    const setViewport = () => { const v = kit.viewport!(); doc.documentElement.style?.setProperty("--cv-vw", `${v.width}px`); doc.documentElement.style?.setProperty("--cv-vh", `${v.height}px`); };
    setViewport();
    w.addEventListener("resize", setViewport);

    /**
     * A safety net for a page that stops short of the screen: its content (the boxes that hold text, pictures
     * or charts) is zoomed up, at most 1.4x, as far as it still fits, so the screen isn't left with an empty
     * bottom or right side. A page that already reaches the bottom, or scrolls, is left alone.
     */
    const extent = (root: HTMLElement) => {
      let right = 0, bottom = 0;
      const top = w.scrollY || 0;
      root.querySelectorAll<HTMLElement>("*").forEach((el) => {
        const tag = el.tagName.toLowerCase();
        if (el.closest("svg") && tag !== "svg") return;
        const leaf = tag === "svg" || tag === "img" || tag === "canvas" || Array.from(el.childNodes).some((node) => node.nodeType === 3 && node.textContent!.trim());
        if (!leaf) return;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom + top);
      });
      return { right, bottom };
    };
    kit.fit = (rootArg?: unknown) => {
      const root = (rootArg as HTMLElement | undefined) ?? doc.getElementById("cv-page");
      if (!root) return 1;
      // A page still being written is short by nature: it's fitted once it's finished, so it never jumps.
      if (root.hasAttribute("data-cv-streaming")) { root.style.zoom = ""; return 1; }
      root.style.zoom = "";
      const view = kit.viewport!();
      const roomW = view.width - 24, roomH = view.height - 24;
      const at1 = extent(root);
      // Already reaching the bottom (or scrolling) and most of the width: nothing to fill.
      if (!at1.bottom || at1.bottom > roomH || (at1.bottom > roomH * 0.8 && at1.right > roomW * 0.75)) { root.dataset.cvZoom = "1"; return 1; }
      const fits = (z: number) => { root.style.zoom = String(z); const e = extent(root); return e.bottom <= roomH && e.right <= roomW + 1; };
      let lo = 1, hi = 1.4;
      if (fits(hi)) lo = hi;
      else for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      const z = Math.round(lo * 100) / 100;
      root.style.zoom = z > 1.02 ? String(z) : "";
      root.dataset.cvZoom = String(z > 1.02 ? z : 1);
      if (z > 1.02) kit.charts!(root);
      kit.embeds?.();
      return z;
    };
    // A card's picture that fails to load gives way to its placeholder (the title), never a broken image.
    doc.addEventListener?.("error", (event) => {
      const img = event.target as HTMLImageElement | null;
      const pic = img?.tagName === "IMG" ? img.closest<HTMLElement>(".cv-card-pic") : null;
      if (!pic) return;
      const title = pic.closest<HTMLElement>("[data-block]")?.dataset.title ?? img!.alt ?? "";
      pic.classList.add("cv-card-ph", "cv-card-failed");
      pic.innerHTML = `<span>${esc(title)}</span>`;
    }, true);
    // Pictures change the page's height as they load: fit again.
    doc.addEventListener?.("load", (event) => { if ((event.target as Element | null)?.tagName === "IMG") { w.clearTimeout((kit as { _fitTimer?: number })._fitTimer); (kit as { _fitTimer?: number })._fitTimer = w.setTimeout(() => kit.fit!(), 120); } }, true);
    w.addEventListener("resize", () => { w.clearTimeout((kit as { _fitTimer?: number })._fitTimer); (kit as { _fitTimer?: number })._fitTimer = w.setTimeout(() => kit.fit!(), 150); });

    // Scripts in the page run (innerHTML doesn't run them) once the page, or the part they're in, is committed:
    // never while it streams. They run in order, as in a parsed page: a classic script with a src loads before
    // the next one runs, so code after it can use the library. A classic inline script runs in a block of its
    // own, so running it again on a new version can't fail on its own let or const. A newer run stops an older one.
    const ran = new WeakSet<Element>();
    let scriptRun = 0;
    const RUNS = /^(|text\/javascript|application\/javascript|module)$/;
    const origin = new WeakMap<Element, string>();
    const runScripts = (root: HTMLElement) => {
      const run = ++scriptRun;
      const queue = Array.from(root.querySelectorAll("script")).filter((old) => !ran.has(old));
      const next = (): void => {
        if (run !== scriptRun) return;
        const old = queue.shift();
        if (!old) return;
        if (!old.isConnected) return next();
        const type = (old.getAttribute("type") ?? "").trim().toLowerCase();
        if (!RUNS.test(type)) { ran.add(old); return next(); } // data (application/json and the like)
        const script = doc.createElement("script");
        ran.add(script);
        origin.set(script, old.outerHTML);
        for (const a of Array.from(old.attributes)) script.setAttribute(a.name, a.value);
        const src = old.getAttribute("src");
        if (!src) script.textContent = type === "module" ? old.textContent : `{\n${old.textContent ?? ""}\n}`;
        const wait = !!src && type !== "module" && !old.hasAttribute("async");
        if (wait) {
          script.async = false;
          script.addEventListener("load", () => next(), { once: true });
          script.addEventListener("error", () => next(), { once: true });
        }
        old.replaceWith(script);
        if (!wait) next();
      };
      next();
    };
    /** A part with its own script (a map, say): its live element, kept when the next version leaves it unchanged. */
    const scripted = (root: HTMLElement) => {
      const live = new Map<string, HTMLElement>();
      root.querySelectorAll<HTMLElement>("[data-cv-id]").forEach((el) => { if (el.querySelector("script") && !live.has(el.dataset.cvId!)) live.set(el.dataset.cvId!, el); });
      return live;
    };
    const keepScripted = (root: HTMLElement, live: Map<string, HTMLElement>) => {
      if (!live.size) return;
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-cv-id]"))) {
        if (!el.isConnected || !el.querySelector("script")) continue;
        const was = live.get(el.dataset.cvId!);
        if (was && sourceOf.get(was) === sourceOf.get(el)) el.replaceWith(was);
      }
    };
    /** Page-level scripts (outside any part) that ran on the page on screen, by their source. */
    const pageScripts = (root: HTMLElement) => new Set(Array.from(root.querySelectorAll("script")).filter((s) => origin.has(s) && !s.closest("[data-cv-id]")).map((s) => origin.get(s)!));

    // What a part shows, to match a part that was given a new id: its picture, else its text.
    const contentKey = (el: Element): string | null => {
      const img = el.tagName === "IMG" ? el : el.querySelector("img");
      const src = img?.getAttribute("src");
      if (src) return `img:${src}`;
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      return text.length >= 8 && text.length <= 400 ? `text:${text}` : null;
    };

    // Embeds (src/ui/embeds.ts): placeholders marked data-embed, framed by Visual Chat's own UI over them. The
    // page never frames anything; it reports each committed placeholder's fields and where it sits (in the
    // frame's viewport, after scroll and zoom), and whether a version is gliding (the UI hides them until it
    // settles). Nothing is reported for a part still being written.
    const EMBED_FIELDS = ["embed", "q", "lat", "lon", "zoom", "label", "id", "kind", "start", "url"];
    const committedEmbeds = new WeakSet<Element>();
    let embedsMoving = false, embedQueued = false, lastEmbeds = "", settling = 0;
    const reportEmbeds = () => {
      embedQueued = false;
      const page = doc.getElementById("cv-page");
      if (!page || !w.parent || w.parent === w) return;
      const embeds: { id: string; fields: Record<string, string>; rect: { x: number; y: number; w: number; h: number } }[] = [];
      page.querySelectorAll<HTMLElement>("[data-embed]").forEach((el, i) => {
        if (!committedEmbeds.has(el) || el.closest("[data-cv-pending],[data-cv-open]")) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        const fields: Record<string, string> = {};
        for (const f of EMBED_FIELDS) { const v = el.dataset[f]; if (v !== undefined) fields[f] = v; }
        const id = el.dataset.cvId ?? el.parentElement?.closest<HTMLElement>("[data-cv-id]")?.dataset.cvId ?? `embed-${i}`;
        embeds.push({ id, fields, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
      });
      const message = { type: "bb-canvas-embeds", moving: embedsMoving, embeds };
      const json = JSON.stringify(message);
      if (json === lastEmbeds) return;
      lastEmbeds = json;
      w.parent.postMessage(message, "*");
    };
    kit.embeds = () => {
      if (embedQueued) return;
      embedQueued = true;
      if (typeof w.requestAnimationFrame === "function") w.requestAnimationFrame(reportEmbeds); else w.setTimeout(reportEmbeds, 16);
    };
    /** A page (or the finished stream) is committed: its placeholders can be framed, once its parts stop gliding. */
    const commitEmbeds = (root: HTMLElement) => {
      root.querySelectorAll("[data-embed]").forEach((el) => committedEmbeds.add(el));
      const run = ++settling;
      // After this call's animations are made (same task): wait for the finite ones (not a pending tile's pulse).
      void Promise.resolve().then(() => {
        const all = typeof doc.getAnimations === "function" ? doc.getAnimations() : [];
        const gliding = all.filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)) && a.playState !== "finished");
        if (!gliding.length) { embedsMoving = false; kit.embeds!(); return; }
        embedsMoving = true;
        reportEmbeds();
        const done = () => { if (run !== settling) return; embedsMoving = false; kit.embeds!(); };
        void Promise.race([Promise.all(gliding.map((a) => a.finished.catch(() => undefined))), new Promise((resolve) => w.setTimeout(resolve, 2000))]).then(() => w.setTimeout(done, 40));
      });
    };
    w.addEventListener("scroll", () => kit.embeds!(), { passive: true });
    w.addEventListener("resize", () => kit.embeds!());
    if (typeof RO === "function") new RO(() => kit.embeds!()).observe(doc.body ?? doc.documentElement);

    // A new page, animated by part: parts (data-cv-id) that stay glide from where they were, relative to the
    // part they sit in; new ones come in; gone ones leave from where they were. FLIP, with the Web Animations API.
    const reduced = () => typeof w.matchMedia === "function" && w.matchMedia("(prefers-reduced-motion: reduce)").matches;
    kit.morph = (rootArg: unknown, html: string, animate = true, options: { fit?: boolean; scripts?: boolean } = {}) => {
      const root = rootArg as HTMLElement;
      root.removeAttribute("data-cv-streaming");
      root.removeAttribute("data-cv-streamed");
      root.removeAttribute("data-cv-over");
      const before = new Map<string, { r: DOMRect; html: string; clone: HTMLElement; parent: string | null; key: string | null }>();
      const sx = w.scrollX || 0, sy = w.scrollY || 0;
      if (animate) root.querySelectorAll<HTMLElement>("[data-cv-id]").forEach((el) => {
        const parent = el.parentElement?.closest<HTMLElement>("[data-cv-id]")?.dataset.cvId ?? null;
        before.set(el.dataset.cvId!, { r: el.getBoundingClientRect(), html: el.innerHTML, clone: el.cloneNode(true) as HTMLElement, parent, key: contentKey(el) });
      });
      const live = options.scripts === false ? new Map<string, HTMLElement>() : scripted(root);
      root.innerHTML = html;
      // Each part's source as written, so a later stream can tell which parts it changes.
      root.querySelectorAll("[data-cv-id]").forEach((el) => sourceOf.set(el, el.outerHTML));
      if (options.scripts === false) root.querySelectorAll("script").forEach((script) => script.remove());
      else { keepScripted(root, live); runScripts(root); }
      kit.blocks!(root);
      kit.hydrate!(root);
      kit.charts!(root);
      if (options.fit === false) root.style.zoom = ""; else kit.fit!(root);
      if (options.scripts !== false) commitEmbeds(root);
      if (!animate || reduced() || typeof root.animate !== "function") return;
      const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";
      const after = new Map<string, DOMRect>();
      const els = Array.from(root.querySelectorAll<HTMLElement>("[data-cv-id]"));
      for (const el of els) after.set(el.dataset.cvId!, el.getBoundingClientRect());
      // Parts that lost their id but show the same picture or text: matched by content, so they glide too.
      const byContent = new Map<string, string>();
      for (const [id, entry] of before) if (!after.has(id) && entry.key && !byContent.has(entry.key)) byContent.set(entry.key, id);
      const matched = new Set<string>();
      let entering = 0;
      for (const el of els) {
        const id = el.dataset.cvId!;
        let was = before.get(id);
        if (!was) {
          const key = contentKey(el);
          const old = key ? byContent.get(key) : undefined;
          if (old && !matched.has(old)) { matched.add(old); was = before.get(old); }
        }
        const now = after.get(id)!;
        if (!was) {
          // Inside a part that's new too, the part's own entrance carries it.
          const host = el.parentElement?.closest<HTMLElement>("[data-cv-id]");
          if (host && !before.has(host.dataset.cvId!)) continue;
          el.animate([{ opacity: 0, transform: "translateY(14px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 460, delay: 120 + entering++ * 60, easing: ease, fill: "backwards" });
          continue;
        }
        let dx = was.r.left - now.left, dy = was.r.top - now.top;
        // Relative to the part it sits in, which moves too.
        const hostId = el.parentElement?.closest<HTMLElement>("[data-cv-id]")?.dataset.cvId;
        if (hostId && before.has(hostId) && after.has(hostId)) { dx -= before.get(hostId)!.r.left - after.get(hostId)!.left; dy -= before.get(hostId)!.r.top - after.get(hostId)!.top; }
        const scaleX = now.width ? was.r.width / now.width : 1, scaleY = now.height ? was.r.height / now.height : 1;
        const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(scaleX - 1) > 0.02 || Math.abs(scaleY - 1) > 0.02;
        if (moved) el.animate([{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` }, { transformOrigin: "0 0", transform: "none" }], { duration: 620, easing: ease });
        if (was.html !== el.innerHTML) el.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 520, delay: moved ? 200 : 0, easing: "ease-out", fill: "backwards" });
      }
      // Gone parts leave from where they were (only the outermost one of a gone group).
      for (const [id, was] of before) {
        if (after.has(id) || matched.has(id) || (was.parent && !after.has(was.parent) && before.has(was.parent))) continue;
        const ghost = was.clone;
        ghost.removeAttribute("data-cv-id");
        Object.assign(ghost.style, { position: "absolute", left: `${was.r.left + sx}px`, top: `${was.r.top + sy}px`, width: `${was.r.width}px`, height: `${was.r.height}px`, margin: "0", pointerEvents: "none", zIndex: "50", boxSizing: "border-box" });
        doc.body.appendChild(ghost);
        const out = ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.96)" }], { duration: 360, easing: "ease-in", fill: "forwards" });
        out.onfinish = () => ghost.remove();
        w.setTimeout(() => ghost.remove(), 1200);
      }
    };
    // A page as it's written. Each version is the whole page so far, with open parts marked (data-cv-pending:
    // hidden, its space kept; data-cv-open: shown, it holds finished parts). A finished part whose source is
    // the same as last time is kept as it is on screen (its picture, chart and entrance carry on), an open
    // part keeps its element and takes the new children, and a part that's just finished comes in.
    const sourceOf = new WeakMap<Element, string>();
    /** The finished streamed page on screen, to tell a later version that only adds pictures to it. */
    let lastStreamed: string | null = null;
    const withoutPictures = (html: string) => html.replace(/\sdata-(?:img|alt)\s*=\s*(?:"[^"]*"|'[^']*')/g, "");
    const innerOf = new WeakMap<Element, string>();
    const PENDING = "data-cv-pending", OPEN = "data-cv-open";
    kit.stream = (rootArg: unknown, html: string, final = false) => {
      const root = rootArg as HTMLElement;
      const tpl = doc.createElement("template");
      tpl.innerHTML = html;
      const frag = tpl.content;
      if (!final) frag.querySelectorAll("script").forEach((script) => script.remove());
      const parts = Array.from(frag.querySelectorAll<HTMLElement>("[data-cv-id]"));
      const finished = (el: Element) => !el.hasAttribute(PENDING) && !el.hasAttribute(OPEN);
      const sources = new Map<HTMLElement, string>();
      for (const el of parts) if (finished(el)) sources.set(el, el.outerHTML);
      if (!root.hasAttribute("data-cv-streaming")) {
        // The finished page with no stream on screen: the usual morph, unless it's the streamed page again with
        // only its pictures filled in, which updates in place (each picture fades in; nothing else moves).
        const same = root.hasAttribute("data-cv-streamed") && lastStreamed !== null && withoutPictures(lastStreamed) === withoutPictures(html);
        if (final && !same) { kit.morph!(root, html, true); return; }
      }
      // A follow-up on a board that already shows a page: the board stays, and each part the new page has
      // finished that's on the board too takes its new content in place; the finished page then morphs from it
      // (parts glide, enter and leave), as any new version does.
      if (!final && (root.hasAttribute("data-cv-over") || (!root.hasAttribute("data-cv-streaming") && root.querySelector("[data-cv-id]")))) {
        root.setAttribute("data-cv-over", "");
        root.removeAttribute("data-cv-streamed");
        const leaf = (el: Element) => !el.querySelector("[data-cv-id]");
        let changed = 0;
        for (const [el, source] of sources) {
          if (!leaf(el)) continue;
          const id = el.dataset.cvId!;
          const was = Array.from(root.querySelectorAll<HTMLElement>("[data-cv-id]")).find((each) => each.dataset.cvId === id);
          // A part that runs its own script (a map) stays as it is until the page is committed.
          if (!was || !leaf(was) || sourceOf.get(was) === source || was.querySelector("script")) continue;
          const next = el.cloneNode(true) as HTMLElement;
          was.replaceWith(next);
          sourceOf.set(next, source);
          kit.blocks!(next.parentElement ?? root);
          kit.hydrate!(next);
          kit.charts!(next.parentElement ?? root, true);
          if (!reduced() && typeof next.animate === "function") next.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 480, delay: Math.min(changed++, 3) * 60, easing: "ease-out", fill: "backwards" });
        }
        kit.embeds!();
        return;
      }
      if (!root.hasAttribute("data-cv-streaming") && !final) {
        // The stream's first version on an empty board.
        kit.morph!(root, html, root.childElementCount > 0, { fit: false, scripts: false });
        root.setAttribute("data-cv-streaming", "");
        const byId = new Map<string, { source: string; inner: string }>();
        for (const [el, source] of sources) byId.set(el.dataset.cvId!, { source, inner: el.innerHTML });
        root.querySelectorAll<HTMLElement>("[data-cv-id]").forEach((el) => { const known = byId.get(el.dataset.cvId!); if (known && finished(el)) { sourceOf.set(el, known.source); innerOf.set(el, known.inner); } });
        kit.embeds!();
        return;
      }
      const shown = new Set<string>();
      const onScreen = new Map<string, HTMLElement>();
      root.querySelectorAll<HTMLElement>("[data-cv-id]").forEach((el) => {
        if (el.closest(`[${PENDING}]`)) return;
        const id = el.dataset.cvId!;
        shown.add(id);
        if (!onScreen.has(id)) onScreen.set(id, el);
      });
      const fresh: HTMLElement[] = [];
      for (const el of parts) {
        if (!frag.contains(el)) continue; // inside a part kept from the screen
        const id = el.dataset.cvId!;
        const was = onScreen.get(id);
        const source = sources.get(el);
        if (source !== undefined && was && sourceOf.get(was) === source) { el.replaceWith(was); continue; }
        // A finished block whose attributes changed but not its children (a card that got its picture): rebuilt in
        // place, so the card stays and only what's new in it (the picture) fades in.
        if (source !== undefined && was && was.dataset.block && was.tagName === el.tagName && innerOf.get(was) === el.innerHTML && finished(was)) {
          for (const attr of Array.from(was.attributes)) if (!el.hasAttribute(attr.name)) was.removeAttribute(attr.name);
          for (const attr of Array.from(el.attributes)) if (was.getAttribute(attr.name) !== attr.value) was.setAttribute(attr.name, attr.value);
          const before = new Set(Array.from(was.querySelectorAll("img")).map((img) => img.getAttribute("src")));
          was.innerHTML = el.innerHTML;
          kit.blocks!(was.parentElement ?? was);
          sourceOf.set(was, source);
          innerOf.set(was, el.innerHTML);
          el.replaceWith(was);
          if (!reduced() && typeof was.animate === "function") was.querySelectorAll("img").forEach((img) => { if (!before.has(img.getAttribute("src"))) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: "ease-out" }); });
          continue;
        }
        // A part that's still the same kind of element keeps it (open or finished): its attributes and children
        // follow the new version, and the parts inside it are matched in turn. Blocks are rebuilt from their
        // attributes instead, below.
        if (was && was.tagName === el.tagName && !was.dataset.block && !el.dataset.block) {
          for (const attr of Array.from(was.attributes)) if (!el.hasAttribute(attr.name)) was.removeAttribute(attr.name);
          for (const attr of Array.from(el.attributes)) if (was.getAttribute(attr.name) !== attr.value) was.setAttribute(attr.name, attr.value);
          was.replaceChildren(...Array.from(el.childNodes));
          el.replaceWith(was);
          if (source !== undefined) { sourceOf.set(was, source); innerOf.set(was, was.innerHTML); } else sourceOf.delete(was);
          continue;
        }
        if (source !== undefined) { sourceOf.set(el, source); innerOf.set(el, el.innerHTML); }
        if (source !== undefined || el.hasAttribute(OPEN)) fresh.push(el);
      }
      // The same finished page landing again (with its pictures): page-level scripts that already ran don't run again.
      const already = final ? pageScripts(root) : null;
      root.replaceChildren(frag);
      if (final) {
        root.removeAttribute("data-cv-streaming");
        root.setAttribute("data-cv-streamed", "");
        lastStreamed = html;
        root.querySelectorAll("script").forEach((script) => { if (!ran.has(script) && !script.closest("[data-cv-id]") && already!.has(script.outerHTML)) { ran.add(script); origin.set(script, script.outerHTML); } });
        runScripts(root);
      }
      kit.blocks!(root);
      kit.hydrate!(root);
      kit.charts!(root, true);
      if (final) { kit.fit!(root); commitEmbeds(root); } else kit.embeds!();
      if (reduced() || typeof root.animate !== "function") return;
      const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";
      let entering = 0;
      for (const el of fresh) {
        if (!el.isConnected) continue;
        const id = el.dataset.cvId!;
        if (shown.has(id)) {
          // Already on screen in an earlier form (a part that changed when the page finished): its new content fades in.
          if (finished(el)) el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 360, easing: "ease-out" });
          continue;
        }
        // Inside a part that's coming in too, that part's entrance carries it.
        const host = el.parentElement?.closest<HTMLElement>("[data-cv-id]");
        if (host && !shown.has(host.dataset.cvId!) && fresh.includes(host)) continue;
        el.animate([{ opacity: 0, transform: "translateY(12px) scale(0.985)" }, { opacity: 1, transform: "none" }], { duration: 440, delay: Math.min(entering++, 3) * 70, easing: ease, fill: "backwards" });
      }
    };
    // The height its place in the composition suggests: size the figure to it (never set it on the outer element).
    kit.height = () => { const room = num((w.bbWidget as { size?: { room?: unknown } } | undefined)?.size?.room); return Math.max(90, room && room > 0 ? room - 40 : Math.round(kit.width!() * 0.55)); };
    w.cv = kit;
    const ready = () => kit.hydrate!();
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", ready); else ready();
  }
  return kit;
}
