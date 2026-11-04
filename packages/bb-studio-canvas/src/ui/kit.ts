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
  states: Record<string, [number, number]>;
  render?(build: (data: unknown, options: Record<string, unknown>, state: unknown) => string): void;
  hydrate?(root?: unknown): void;
  width?(): number;
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

  const fmt = (value: unknown, options?: Record<string, unknown>): string => {
    const o = opt(options);
    const n = num(value);
    if (n === null) return esc(value);
    const abs = Math.abs(n);
    const decimals = num(o.decimals) ?? (abs >= 100 || Number.isInteger(n) ? 0 : abs >= 10 ? 1 : 2);
    const compact = o.compact === true || (o.compact !== false && abs >= 1e6);
    const body = new Intl.NumberFormat("en-US", compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: o.fixed ? decimals : 0, maximumFractionDigits: decimals }).format(abs);
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

  /** A line (or area) chart with direct labels at the line ends, in px. options: x, series, w, h, unit, area, zero, colors, highlight, marks [{x, label}]. */
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
    const W = 11 * (cell + gap), H = 8 * (cell + gap);
    let out = `<svg class="cv-tilemap" viewBox="0 0 ${round(W)} ${round(H)}" width="100%" style="max-width:${round(W * 1.6)}px" role="img" aria-label="US map">`;
    for (const [code, [cx, cy]] of Object.entries(states)) {
      const entry = entries.get(code) ?? { value: null, label: "", color: null };
      const { bg, strong } = fill(entry);
      const x = cx * (cell + gap), y = cy * (cell + gap);
      const shown = o.show === "value" && entry.value !== null ? fmt(entry.value, { decimals: 0 }) : entry.label && o.show === "label" ? entry.label.slice(0, 4) : code;
      out += `<g><rect x="${round(x)}" y="${round(y)}" width="${cell}" height="${cell}" rx="${round(cell * 0.12)}" style="fill:${bg}" class="${entries.has(code) ? "cv-tile" : "cv-tile cv-tile-empty"}"><title>${esc(code)}${entry.value !== null ? ` ${esc(fmt(entry.value))}` : ""}${entry.label ? ` ${esc(entry.label)}` : ""}</title></rect><text x="${round(x + cell / 2)}" y="${round(y + cell / 2 + cell * 0.13)}" text-anchor="middle" class="cv-tile-text" style="font-size:${round(cell * 0.34)}px;fill:${strong ? "#fff" : "var(--cv-ink-2)"}">${esc(shown)}</text></g>`;
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

  const kit: CanvasKit = { esc, num, paint, fmt, spark, bars, line, columns, hbars, split, donut, meter, tilemap, timeline, waffle, multiples, delta, legend, states };

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
    w.cv = kit;
    const ready = () => kit.hydrate!();
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", ready); else ready();
  }
  return kit;
}
