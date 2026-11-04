// The organic layout for the canvas looks (looks.ts). No slide grid: items
// are as tall as their content (the page measures them), take widths by
// kind, size and look, and settle into lanes like a skyline, so edges don't
// line up into rows. Per look:
//
// - editorial: the focus is the lead, wide on the left; the rest fill a
//   narrow rail beside it and flow below. Quotes hang into the gutter.
// - field: the focus sits in the middle and the rest orbit it, with loose,
//   varied gaps, a small offset and tilt per item.
// - instrument: tight lanes and small gaps; the focus is a wide panel.
//
// Notes with an anchor float beside the item they annotate (overlapping its
// edge in some looks), and relatedTo becomes connectors.
//
// The user never arranges anything. Deterministic: the same items, width,
// heights and previous layout always give the same rects. Stable: an item
// keeps its lane from the previous layout when that costs little height, so
// items that didn't change stay where they were.
import type { OrganicLook } from "./looks";
import type { CanvasKind, SizeHint } from "./shared";

export interface OrganicItem {
  id: string;
  kind: CanvasKind;
  size: SizeHint;
  importance: number;
  createdAt: number;
  updatedAt: number;
  relatedTo?: readonly string[];
  anchor?: string | null;
  point?: { x: number; y: number } | null;
  /** A note's or quote's accent (looks.ts accentOf): a sticky tilts in any style. */
  accent?: string | null;
}

export interface Placed { x: number; y: number; w: number; h: number; rotate: number; z: number; floating: boolean; lane: number; units: number }
export interface Link { from: string; to: string; kind: "related" | "anchor"; point: { x: number; y: number } | null }
export interface OrganicLayout { rects: Map<string, Placed>; focusId: string | null; height: number; units: number; links: Link[] }

const ORDER: readonly SizeHint[] = ["s", "m", "l", "xl"];
/** Related-item connectors drawn per board, at most. */
export const MAX_RELATED = 4;

interface Rules {
  gutter: number;
  /** Space below an item. */
  gap(item: OrganicItem, focus: boolean, hash: number): number;
  /** 12-unit widths per size hint, and per kind where it differs. */
  widths: Record<SizeHint, number>;
  kinds: Partial<Record<CanvasKind, Partial<Record<SizeHint, number>>>>;
  /** The focus is at least this wide (12-unit). */
  focusMin: number;
  focusAt: "left" | "center";
  /** px of offset and degrees of tilt, at most, per item (from its id). */
  jitter: number;
  tilt: number;
  noteTilt: number;
  noteWidth: number;
  /** How far a floating note overlaps its anchor's edge. */
  noteOverlap: number;
  /** Quotes hang this share of a unit into the gutter on their left. */
  quoteHang: number;
}

export const LOOK_RULES: Record<OrganicLook, Rules> = {
  editorial: {
    gutter: 34,
    gap: (item, focus) => (focus ? 40 : item.kind === "headline" ? 14 : 28),
    widths: { s: 3, m: 4, l: 6, xl: 8 },
    kinds: { headline: { s: 6, m: 8, l: 8, xl: 12 }, ticker: { s: 12, m: 12, l: 12, xl: 12 }, stat: { s: 3, m: 4, l: 4, xl: 6 }, quote: { s: 4, m: 4, l: 6, xl: 8 }, table: { s: 4, m: 6, l: 8, xl: 12 }, multiples: { s: 6, m: 8, l: 8, xl: 12 }, timeline: { s: 4, m: 4, l: 8, xl: 12 } },
    focusMin: 8,
    focusAt: "left",
    jitter: 0,
    tilt: 0,
    noteTilt: 0,
    noteWidth: 210,
    noteOverlap: 0,
    quoteHang: 0,
  },
  field: {
    gutter: 30,
    gap: (_item, focus, hash) => (focus ? 40 : 22 + (hash % 5) * 6),
    widths: { s: 3, m: 4, l: 5, xl: 6 },
    kinds: { headline: { s: 4, m: 5, l: 6, xl: 7 }, ticker: { s: 8, m: 10, l: 12, xl: 12 }, table: { s: 4, m: 5, l: 5, xl: 7 }, multiples: { s: 4, m: 5, l: 5, xl: 7 }, timeline: { s: 3, m: 3, l: 5, xl: 7 }, stat: { s: 3, m: 3, l: 4, xl: 4 } },
    focusMin: 6,
    focusAt: "center",
    jitter: 0,
    tilt: 1.4,
    noteTilt: 3.2,
    noteWidth: 190,
    noteOverlap: 34,
    quoteHang: 0,
  },
  instrument: {
    gutter: 8,
    gap: () => 8,
    widths: { s: 2, m: 3, l: 6, xl: 8 },
    kinds: { headline: { s: 4, m: 6, l: 6, xl: 12 }, ticker: { s: 12, m: 12, l: 12, xl: 12 }, stat: { s: 2, m: 3, l: 4, xl: 4 }, table: { s: 4, m: 6, l: 6, xl: 12 }, multiples: { s: 6, m: 6, l: 8, xl: 12 }, timeline: { s: 4, m: 6, l: 12, xl: 12 }, map: { s: 4, m: 4, l: 6, xl: 8 } },
    focusMin: 6,
    focusAt: "left",
    jitter: 0,
    tilt: 0,
    noteTilt: 0,
    noteWidth: 200,
    noteOverlap: 10,
    quoteHang: 0,
  },
};

/** An item's tilt, in degrees: stickies tilt in every style; other accents never; cards as the style says (the focus less). */
function tiltOf(item: OrganicItem, rules: Rules, isFocus: boolean, hash: number): number {
  const range = item.accent === "sticky" ? 3.2 : item.accent ? 0 : isFocus ? rules.tilt * 0.4 : rules.tilt;
  return range ? Math.round((((hash >>> 20) % 1000) / 1000 - 0.5) * 2 * range * 100) / 100 : 0;
}

/** Lanes for a board this wide. */
export function unitsFor(width: number): number {
  return width >= 1100 ? 12 : width >= 700 ? 8 : 4;
}

/** A small stable number from an id, for per-item offsets. */
export function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Highest importance, then most recently changed, then id. Floating notes are never the focus. */
export function organicFocus(items: readonly OrganicItem[]): OrganicItem | null {
  let best: OrganicItem | null = null;
  for (const item of items) {
    if (item.kind === "note" && item.anchor) continue;
    if (!best || item.importance > best.importance || (item.importance === best.importance && (item.updatedAt > best.updatedAt || (item.updatedAt === best.updatedAt && item.id < best.id)))) best = item;
  }
  return best;
}

const byImportance = (a: OrganicItem, b: OrganicItem) => b.importance - a.importance || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Notes that float beside their anchor (it's on the board). */
function floats(items: readonly OrganicItem[]): Set<string> {
  const ids = new Set(items.map((item) => item.id));
  return new Set(items.filter((item) => item.kind === "note" && item.anchor && ids.has(item.anchor) && item.anchor !== item.id).map((item) => item.id));
}

function unitWidth(width: number, units: number, gutter: number) {
  return Math.max(30, (width - gutter * (units - 1)) / units);
}

/** Lane units for an item: its kind and size in this look, scaled to the board's lanes. */
function laneUnits(item: OrganicItem, rules: Rules, units: number, focus: boolean): number {
  let w12 = rules.kinds[item.kind]?.[item.size] ?? rules.widths[item.size];
  if (focus) {
    // The focus dominates: a size up, and at least focusMin.
    const up = ORDER[Math.min(3, ORDER.indexOf(item.size) + 1)]!;
    w12 = Math.max(w12, rules.kinds[item.kind]?.[up] ?? rules.widths[up], rules.focusMin);
  }
  if (units >= 12) return Math.min(12, w12);
  if (units >= 8) return Math.min(8, Math.max(2, Math.round((w12 * 8) / 12)));
  return w12 <= 3 && !focus ? 2 : 4;
}

/**
 * Lane looks put a rail beside the focus. When nothing on the board fits
 * that rail (everything else is wide, and no note), the focus takes the
 * whole width instead of leaving the rail empty.
 */
function focusUnitsFor(items: readonly OrganicItem[], rules: Rules, units: number, focus: OrganicItem | null, floating: ReadonlySet<string>): number | null {
  if (!focus) return null;
  const own = laneUnits(focus, rules, units, true);
  if (rules.focusAt !== "left" || own >= units) return own;
  const rail = units - own;
  const fits = items.some((item) => item.id !== focus.id && (floating.has(item.id) || laneUnits(item, rules, units, false) <= rail));
  return fits ? own : units;
}

/**
 * Each item's width in px, before heights are known: the page renders items
 * at these widths and measures their heights.
 */
export function organicWidths(items: readonly OrganicItem[], width: number, look: OrganicLook): Map<string, number> {
  const rules = LOOK_RULES[look];
  const units = unitsFor(width);
  const unit = unitWidth(width, units, rules.gutter);
  const focus = organicFocus(items);
  const floating = floats(items);
  const widths = new Map<string, number>();
  const focusUnits = focusUnitsFor(items, rules, units, focus, floating);
  for (const item of items) {
    if (floating.has(item.id)) { widths.set(item.id, Math.min(rules.noteWidth, width)); continue; }
    const u = item.id === focus?.id ? focusUnits! : laneUnits(item, rules, units, false);
    widths.set(item.id, Math.round(u * unit + (u - 1) * rules.gutter));
  }
  return widths;
}

/** A height to place an item at before it's measured. */
export function estimateHeight(kind: CanvasKind, width: number): number {
  switch (kind) {
    case "headline": return 130;
    case "caption": case "note": return 90;
    case "stat": return 120;
    case "quote": return 150;
    case "ticker": return 52;
    case "progress": return 80;
    case "map": return Math.round(width * 0.78);
    case "timeline": return 220;
    default: return Math.round(Math.min(420, Math.max(160, width * 0.62)));
  }
}

const area = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Lays the board out. heights: measured px per item (estimates for the rest).
 * previous: the last layout at this width, the stability hint.
 */
export function layoutOrganic(items: readonly OrganicItem[], width: number, look: OrganicLook, heights: ReadonlyMap<string, number>, previous?: ReadonlyMap<string, Placed> | null): OrganicLayout {
  const rects = new Map<string, Placed>();
  const units = unitsFor(width);
  if (!items.length || width <= 0) return { rects, focusId: null, height: 0, units, links: [] };
  const rules = LOOK_RULES[look];
  const unit = unitWidth(width, units, rules.gutter);
  const focus = organicFocus(items);
  const floating = floats(items);
  const widths = organicWidths(items, width, look);
  const heightOf = (item: OrganicItem) => heights.get(item.id) ?? estimateHeight(item.kind, widths.get(item.id)!);
  const laneX = (lane: number) => lane * (unit + rules.gutter);
  const tops = new Array<number>(units).fill(0);
  const flow = items.filter((item) => !floating.has(item.id));
  const ordered = focus ? [focus, ...flow.filter((item) => item.id !== focus.id).sort(byImportance)] : [...flow].sort(byImportance);

  if (rules.focusAt === "center") placeAround(ordered, focus, rects, { width, units, unit, rules, widths, heightOf, previous, notes: items.filter((item) => floating.has(item.id)) });
  else for (const item of ordered) {
    const isFocus = item.id === focus?.id;
    const u = isFocus ? focusUnitsFor(items, rules, units, focus, floating)! : laneUnits(item, rules, units, false);
    const h = heightOf(item);
    const hash = hashOf(item.id);
    const topAt = (lane: number) => Math.max(...tops.slice(lane, lane + u));
    let lane: number;
    if (isFocus) lane = 0;
    else {
      lane = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let candidate = 0; candidate + u <= units; candidate++) {
        const y = topAt(candidate);
        if (y < best - 0.5) { best = y; lane = candidate; }
      }
      // Stability: keep the old lane when it costs little.
      const was = previous?.get(item.id);
      if (was && !was.floating && was.units === u && was.lane + u <= units && topAt(was.lane) <= best + 32) lane = was.lane;
    }
    const y = topAt(lane);
    let x = laneX(lane);
    let dy = 0;
    if (rules.jitter) {
      x += ((hash % 1000) / 1000 - 0.5) * 2 * rules.jitter;
      dy = (((hash >>> 10) % 1000) / 1000) * rules.jitter;
    }
    if (item.kind === "quote" && rules.quoteHang && lane > 0) x -= (rules.gutter + unit * rules.quoteHang) * 0.6;
    const w = widths.get(item.id)!;
    x = Math.max(0, Math.min(width - w, x));
    const rotate = tiltOf(item, rules, isFocus, hash);
    rects.set(item.id, { x: Math.round(x), y: Math.round(y + dy), w, h, rotate, z: isFocus ? 2 : item.kind === "quote" ? 3 : 1, floating: false, lane, units: u });
    const bottom = y + dy + h + rules.gap(item, isFocus, hash);
    for (let k = lane; k < lane + u; k++) tops[k] = bottom;
    // Its notes take real room in the lanes beside it (or under it), never over another card.
    for (const note of items.filter((each) => floating.has(each.id) && each.anchor === item.id).sort(byImportance)) {
      const nw = widths.get(note.id)!;
      const nu = Math.max(1, Math.min(units, Math.ceil((nw + rules.gutter) / (unit + rules.gutter))));
      const nh = heightOf(note);
      const point = note.point ?? { x: 1, y: 0.25 };
      const want = point.x >= 0.5 ? lane + u : lane - nu;
      let best = -1, bestY = Number.POSITIVE_INFINITY, bestDistance = Number.POSITIVE_INFINITY;
      for (let candidate = Math.max(0, lane - nu); candidate <= Math.min(units - nu, lane + u); candidate++) {
        const ty = Math.max(...tops.slice(candidate, candidate + nu));
        const distance = Math.abs(candidate - want);
        if (ty < bestY - 0.5 || (Math.abs(ty - bestY) <= 0.5 && distance < bestDistance)) { best = candidate; bestY = ty; bestDistance = distance; }
      }
      // At the top of the free room beside it, but never above the anchor itself: a note on the lead
      // starts the rail, and a note on a lower item stays level with it.
      const ny = Math.max(bestY, y);
      rects.set(note.id, { x: Math.round(laneX(best)), y: Math.round(ny), w: nw, h: nh, rotate: tiltOf(note, rules, false, hashOf(note.id)), z: 5, floating: true, lane: best, units: nu });
      for (let k = best; k < best + nu; k++) tops[k] = ny + nh + rules.gap(note, false, hashOf(note.id));
    }
  }

  // Floating notes: beside their anchor, on the side the point is nearer,
  // where they cover the least of everything else.
  const notes = items.filter((item) => floating.has(item.id) && !rects.has(item.id)).sort(byImportance);
  for (const note of notes) {
    const anchor = rects.get(note.anchor!)!;
    const w = widths.get(note.id)!;
    const h = heightOf(note);
    const point = note.point ?? { x: 1, y: 0.25 };
    const py = anchor.y + point.y * anchor.h;
    const ov = rules.noteOverlap;
    const right = { x: anchor.x + anchor.w - ov, y: py - h / 2 };
    const left = { x: anchor.x - w + ov, y: py - h / 2 };
    const below = { x: anchor.x + point.x * anchor.w - w / 2, y: anchor.y + anchor.h - ov * 0.5 };
    const above = { x: anchor.x + point.x * anchor.w - w / 2, y: anchor.y - h + ov * 0.5 };
    const candidates = point.x < 0.5 ? [left, right, below, above] : [right, left, below, above];
    let best: { x: number; y: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const [index, spot] of candidates.entries()) {
      const fits = spot.x >= -1 && spot.x + w <= width + 1 && spot.y >= 0;
      const at = { x: Math.max(0, Math.min(width - w, spot.x)), y: Math.max(0, spot.y), w, h };
      let score = (fits ? 0 : 1e7) + index * 400;
      for (const [id, other] of rects) if (id !== note.anchor) score += area(at, other) * (other.floating ? 3 : 1);
      if (score < bestScore) { bestScore = score; best = at; }
    }
    const hash = hashOf(note.id);
    const rotate = tiltOf(note, rules, false, hash);
    rects.set(note.id, { x: Math.round(best!.x), y: Math.round(best!.y), w, h, rotate, z: 5, floating: true, lane: -1, units: 0 });
  }

  const ids = new Set(rects.keys());
  const links: Link[] = [];
  for (const item of items) {
    if (!ids.has(item.id)) continue;
    if (item.anchor && ids.has(item.anchor)) links.push({ from: item.id, to: item.anchor, kind: "anchor", point: item.point ?? null });
    for (const other of item.relatedTo ?? []) if (other !== item.id && other !== item.anchor && ids.has(other)) links.push({ from: item.id, to: other, kind: "related", point: null });
  }
  links.sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : 1));
  // Related items that already touch need no line between them.
  // A few lines say more than many: at most MAX_RELATED related lines, two per item,
  // the most important pairs first; leader lines from notes always draw.
  const importance = new Map(items.map((item) => [item.id, item.importance]));
  const degree = new Map<string, number>();
  let related = 0;
  const ranked = [...links].sort((a, b) => (importance.get(b.from)! + importance.get(b.to)!) - (importance.get(a.from)! + importance.get(a.to)!) || (a.from + a.to < b.from + b.to ? -1 : 1));
  const keep = new Set<Link>();
  for (const link of ranked) {
    if (link.kind === "anchor") { keep.add(link); continue; }
    const ends = linkEnds(rects.get(link.from)!, rects.get(link.to)!, null);
    if (Math.hypot(ends.x2 - ends.x1, ends.y2 - ends.y1) < 96) continue;
    if (related >= MAX_RELATED || (degree.get(link.from) ?? 0) >= 2 || (degree.get(link.to) ?? 0) >= 2) continue;
    keep.add(link);
    related++;
    degree.set(link.from, (degree.get(link.from) ?? 0) + 1);
    degree.set(link.to, (degree.get(link.to) ?? 0) + 1);
  }
  const drawn = links.filter((link) => keep.has(link));
  let height = 0;
  for (const rect of rects.values()) height = Math.max(height, rect.y + rect.h);
  return { rects, focusId: focus?.id ?? null, height: Math.ceil(height), units, links: drawn };
}

/**
 * Field notes: the focus in the middle, then each item at the free spot
 * nearest the focus among spots touching what's already placed (beside,
 * under or over each card, aligned to its edges), so the board grows as a
 * cluster around the focus instead of in rows. An item keeps its old spot
 * when it's still free.
 */
function placeAround(ordered: readonly OrganicItem[], focus: OrganicItem | null, rects: Map<string, Placed>, ctx: { width: number; units: number; unit: number; rules: Rules; widths: Map<string, number>; heightOf(item: OrganicItem): number; previous?: ReadonlyMap<string, Placed> | null; notes: readonly OrganicItem[] }) {
  const { width, units, unit, rules, widths, heightOf, previous } = ctx;
  const boxes: { id: string; x: number; y: number; w: number; h: number; gap: number }[] = [];
  /** Free of every card; `except` (a note's anchor) may be overlapped by up to `allow` px each way. */
  const free = (x: number, y: number, w: number, h: number, gap: number, except?: string, allow = 0) => x >= 0 && x + w <= width + 0.5 && y >= 0 && boxes.every((box) => {
    if (box.id === except) return Math.min(x + w, box.x + box.w) - Math.max(x, box.x) <= allow || Math.min(y + h, box.y + box.h) - Math.max(y, box.y) <= allow;
    const g = Math.max(gap, box.gap) * 0.6;
    return x + w + g <= box.x || box.x + box.w + g <= x || y + h + g <= box.y || box.y + box.h + g <= y;
  });
  // A sticky note goes right after its anchor, beside the spot it points at, overlapping only the anchor's edge.
  const placeNotes = (anchor: { id: string; x: number; y: number; w: number; h: number }) => {
    for (const note of ctx.notes.filter((each) => each.anchor === anchor.id).sort(byImportance)) {
      const w = widths.get(note.id)!;
      const h = heightOf(note);
      const point = note.point ?? { x: 1, y: 0.25 };
      const px = anchor.x + point.x * anchor.w, py = anchor.y + point.y * anchor.h;
      const ov = rules.noteOverlap;
      let spot: { x: number; y: number } | null = null;
      let best = Number.POSITIVE_INFINITY;
      // Beside, under or over it, overlapping only its padding (14 px): a sticky never covers a row or a label.
      const o = Math.min(ov, 12);
      const tries = [
        [anchor.x + anchor.w - o, py - h / 2], [anchor.x - w + o, py - h / 2], [px - w / 2, anchor.y + anchor.h - o], [px - w / 2, anchor.y - h + o],
        [anchor.x + anchor.w - o, anchor.y - h * 0.3], [anchor.x - w + o, anchor.y - h * 0.3], [anchor.x + anchor.w - o, anchor.y + anchor.h - h * 0.7], [anchor.x - w + o, anchor.y + anchor.h - h * 0.7],
        [anchor.x + anchor.w + 18, py - h / 2], [anchor.x - w - 18, py - h / 2], [px - w / 2, anchor.y + anchor.h + 18],
      ];
      for (const [tx, ty] of tries) {
        const x = Math.round(Math.max(0, Math.min(width - w, tx!))), y = Math.round(Math.max(0, ty!));
        if (!free(x, y, w, h, 14, anchor.id, 14)) continue;
        const score = Math.hypot(x + w / 2 - px, y + h / 2 - py);
        if (score < best) { best = score; spot = { x, y }; }
      }
      if (!spot) continue; // no room beside it: it floats later
      const hash = hashOf(note.id);
      const rotate = tiltOf(note, rules, false, hash);
      boxes.push({ id: note.id, x: spot.x, y: spot.y, w, h, gap: 14 });
      rects.set(note.id, { x: spot.x, y: spot.y, w, h, rotate, z: 5, floating: true, lane: -1, units: 0 });
    }
  };
  let center = { x: width / 2, y: 0 };
  for (const item of ordered) {
    const isFocus = item.id === focus?.id;
    const w = widths.get(item.id)!;
    const h = heightOf(item);
    const hash = hashOf(item.id);
    const gap = rules.gap(item, isFocus, hash);
    let spot: { x: number; y: number } | null = null;
    if (isFocus) spot = { x: Math.round((width - w) / 2), y: 0 };
    else {
      const was = previous?.get(item.id);
      if (was && !was.floating && was.w === w && free(was.x, was.y, w, h, gap)) spot = { x: was.x, y: was.y };
    }
    if (!spot) {
      let best = Number.POSITIVE_INFINITY;
      const consider = (x: number, y: number) => {
        x = Math.round(Math.max(0, Math.min(width - w, x)));
        y = Math.round(Math.max(0, y));
        if (!free(x, y, w, h, gap)) return;
        // Nearest the focus; going down costs a little more than going sideways.
        const dx = x + w / 2 - center.x, dy = y + h / 2 - center.y;
        const score = Math.hypot(dx * 0.55, dy * 1.25) + (hash % 13);
        if (score < best) { best = score; spot = { x, y }; }
      };
      for (const box of boxes) {
        const g = Math.max(gap, box.gap) * 0.75;
        for (const y of [box.y, box.y + box.h - h, box.y + (box.h - h) / 2]) { consider(box.x + box.w + g, y); consider(box.x - w - g, y); }
        for (const x of [box.x, box.x + box.w - w, box.x + (box.w - w) / 2, 0, width - w]) { consider(x, box.y + box.h + g); consider(x, box.y - h - g); }
      }
      if (!spot) { const bottom = Math.max(0, ...boxes.map((box) => box.y + box.h + box.gap)); spot = { x: Math.round((width - w) / 2), y: bottom }; }
    }
    const placed = spot as { x: number; y: number };
    if (isFocus) center = { x: placed.x + w / 2, y: placed.y + h / 2 };
    boxes.push({ id: item.id, x: placed.x, y: placed.y, w, h, gap });
    const rotate = tiltOf(item, rules, isFocus, hash);
    const lane = Math.max(0, Math.min(units - 1, Math.round(placed.x / (unit + rules.gutter))));
    rects.set(item.id, { x: placed.x, y: placed.y, w, h, rotate, z: isFocus ? 2 : item.kind === "quote" ? 3 : 1, floating: false, lane, units: Math.round((w + rules.gutter) / (unit + rules.gutter)) });
    placeNotes(boxes.at(-1)!);
  }
}

/** Where the segment from a point outside a rect toward a point inside it crosses the rect's edge. */
export function edgeToward(rect: { x: number; y: number; w: number; h: number }, outside: { x: number; y: number }, inside: { x: number; y: number }): { x: number; y: number } {
  const dx = inside.x - outside.x, dy = inside.y - outside.y;
  let t = 0;
  const hits = [
    dx ? (rect.x - outside.x) / dx : -1, dx ? (rect.x + rect.w - outside.x) / dx : -1,
    dy ? (rect.y - outside.y) / dy : -1, dy ? (rect.y + rect.h - outside.y) / dy : -1,
  ];
  for (const hit of hits.filter((value) => value >= 0 && value <= 1).sort((a, b) => a - b)) {
    const x = outside.x + dx * hit, y = outside.y + dy * hit;
    if (x >= rect.x - 0.5 && x <= rect.x + rect.w + 0.5 && y >= rect.y - 0.5 && y <= rect.y + rect.h + 0.5) { t = hit; break; }
  }
  return { x: Math.round(outside.x + dx * t), y: Math.round(outside.y + dy * t) };
}

/** Where a line between two rects leaves each one: the centers' line, clipped to the edges (or the anchor's point). */
export function linkEnds(from: Placed, to: Placed, point: { x: number; y: number } | null): { x1: number; y1: number; x2: number; y2: number } {
  const ca = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const cb = point ? { x: to.x + point.x * to.w, y: to.y + point.y * to.h } : { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const clip = (rect: Placed, inside: { x: number; y: number }, toward: { x: number; y: number }) => {
    const dx = toward.x - inside.x, dy = toward.y - inside.y;
    if (!dx && !dy) return inside;
    const tx = dx ? ((dx > 0 ? rect.x + rect.w : rect.x) - inside.x) / dx : Number.POSITIVE_INFINITY;
    const ty = dy ? ((dy > 0 ? rect.y + rect.h : rect.y) - inside.y) / dy : Number.POSITIVE_INFINITY;
    const t = Math.max(0, Math.min(1, Math.min(tx, ty)));
    return { x: inside.x + dx * t, y: inside.y + dy * t };
  };
  const start = clip(from, ca, cb);
  const end = point ? cb : clip(to, cb, ca);
  return { x1: Math.round(start.x), y1: Math.round(start.y), x2: Math.round(end.x), y2: Math.round(end.y) };
}
