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
  /** A quote's accent (looks.ts accentOf): accented items never tilt. */
  accent?: string | null;
}

export interface Placed { x: number; y: number; w: number; h: number; rotate: number; z: number; lane: number; units: number }
export interface OrganicLayout { rects: Map<string, Placed>; focusId: string | null; height: number; units: number }

const ORDER: readonly SizeHint[] = ["s", "m", "l", "xl"];

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
    quoteHang: 0,
  },
};

/** An item's tilt, in degrees: accented items never; cards as the style says (the focus less). */
function tiltOf(item: OrganicItem, rules: Rules, isFocus: boolean, hash: number): number {
  const range = item.accent ? 0 : isFocus ? rules.tilt * 0.4 : rules.tilt;
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

/** Highest importance, then most recently changed, then id. */
export function organicFocus(items: readonly OrganicItem[]): OrganicItem | null {
  let best: OrganicItem | null = null;
  for (const item of items) {
    if (!best || item.importance > best.importance || (item.importance === best.importance && (item.updatedAt > best.updatedAt || (item.updatedAt === best.updatedAt && item.id < best.id)))) best = item;
  }
  return best;
}

const byImportance = (a: OrganicItem, b: OrganicItem) => b.importance - a.importance || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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
 * that rail (everything else is wide), the focus takes the
 * whole width instead of leaving the rail empty.
 */
function focusUnitsFor(items: readonly OrganicItem[], rules: Rules, units: number, focus: OrganicItem | null): number | null {
  if (!focus) return null;
  const own = laneUnits(focus, rules, units, true);
  if (rules.focusAt !== "left" || own >= units) return own;
  const rail = units - own;
  const fits = items.some((item) => item.id !== focus.id && laneUnits(item, rules, units, false) <= rail);
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
  const widths = new Map<string, number>();
  const focusUnits = focusUnitsFor(items, rules, units, focus);
  for (const item of items) {
    const u = item.id === focus?.id ? focusUnits! : laneUnits(item, rules, units, false);
    widths.set(item.id, Math.round(u * unit + (u - 1) * rules.gutter));
  }
  return widths;
}

/** A height to place an item at before it's measured. */
export function estimateHeight(kind: CanvasKind, width: number): number {
  switch (kind) {
    case "headline": return 130;
    case "caption": return 90;
    case "stat": return 120;
    case "quote": return 150;
    case "ticker": return 52;
    case "progress": return 80;
    case "map": return Math.round(width * 0.78);
    case "timeline": return 220;
    default: return Math.round(Math.min(420, Math.max(160, width * 0.62)));
  }
}

/**
 * Lays the board out. heights: measured px per item (estimates for the rest).
 * previous: the last layout at this width, the stability hint.
 */
export function layoutOrganic(items: readonly OrganicItem[], width: number, look: OrganicLook, heights: ReadonlyMap<string, number>, previous?: ReadonlyMap<string, Placed> | null): OrganicLayout {
  const rects = new Map<string, Placed>();
  const units = unitsFor(width);
  if (!items.length || width <= 0) return { rects, focusId: null, height: 0, units };
  const rules = LOOK_RULES[look];
  const unit = unitWidth(width, units, rules.gutter);
  const focus = organicFocus(items);
  const widths = organicWidths(items, width, look);
  const heightOf = (item: OrganicItem) => heights.get(item.id) ?? estimateHeight(item.kind, widths.get(item.id)!);
  const laneX = (lane: number) => lane * (unit + rules.gutter);
  const tops = new Array<number>(units).fill(0);
  const ordered = focus ? [focus, ...items.filter((item) => item.id !== focus.id).sort(byImportance)] : [...items].sort(byImportance);

  if (rules.focusAt === "center") placeAround(ordered, focus, rects, { width, units, unit, rules, widths, heightOf, previous });
  else for (const item of ordered) {
    const isFocus = item.id === focus?.id;
    const u = isFocus ? focusUnitsFor(items, rules, units, focus)! : laneUnits(item, rules, units, false);
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
      if (was && was.units === u && was.lane + u <= units && topAt(was.lane) <= best + 32) lane = was.lane;
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
    rects.set(item.id, { x: Math.round(x), y: Math.round(y + dy), w, h, rotate, z: isFocus ? 2 : item.kind === "quote" ? 3 : 1, lane, units: u });
    const bottom = y + dy + h + rules.gap(item, isFocus, hash);
    for (let k = lane; k < lane + u; k++) tops[k] = bottom;
  }

  let height = 0;
  for (const rect of rects.values()) height = Math.max(height, rect.y + rect.h);
  return { rects, focusId: focus?.id ?? null, height: Math.ceil(height), units };
}

/**
 * Field notes: the focus in the middle, then each item at the free spot
 * nearest the focus among spots touching what's already placed (beside,
 * under or over each card, aligned to its edges), so the board grows as a
 * cluster around the focus instead of in rows. An item keeps its old spot
 * when it's still free.
 */
function placeAround(ordered: readonly OrganicItem[], focus: OrganicItem | null, rects: Map<string, Placed>, ctx: { width: number; units: number; unit: number; rules: Rules; widths: Map<string, number>; heightOf(item: OrganicItem): number; previous?: ReadonlyMap<string, Placed> | null }) {
  const { width, units, unit, rules, widths, heightOf, previous } = ctx;
  const boxes: { id: string; x: number; y: number; w: number; h: number; gap: number }[] = [];
  /** Free of every card, with a gap around each. */
  const free = (x: number, y: number, w: number, h: number, gap: number) => x >= 0 && x + w <= width + 0.5 && y >= 0 && boxes.every((box) => {
    const g = Math.max(gap, box.gap) * 0.6;
    return x + w + g <= box.x || box.x + box.w + g <= x || y + h + g <= box.y || box.y + box.h + g <= y;
  });
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
      if (was && was.w === w && free(was.x, was.y, w, h, gap)) spot = { x: was.x, y: was.y };
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
    rects.set(item.id, { x: placed.x, y: placed.y, w, h, rotate, z: isFocus ? 2 : item.kind === "quote" ? 3 : 1, lane, units: Math.round((w + rules.gutter) / (unit + rules.gutter)) });
  }
}
