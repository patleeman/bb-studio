// The composition engine for the canvas styles (looks.ts). No grid, no
// lanes, no reading order: the board is composed for the screen it's on.
//
// - The frame is the visible board (width × height). One hero dominates it;
//   the rest sit around it at clearly different scales (scale: hero, large,
//   medium, small, tiny), as wide as a share of the frame, not of columns.
// - A composition (orbit, giant-number, map, spine, split, quote, close-up,
//   essay, gallery) gives the hero its spot and size and spreads targets for the
//   rest across both axes, so the board fills the screen instead of
//   flowing from the top-left. A hash of the hero mirrors it, so two boards
//   in a row don't land the same way.
// - The agent's rough placement wins: region ("top-right"), pinnedTo (an
//   item, a point on it, a side), bleed. The engine resolves each item to
//   the free spot nearest its target, at any x and y: items never overlap
//   (a hero may bleed off the board's edge), stay on the
//   screen when they fit, and spill below (the board scrolls) only when the
//   screen is full.
// - Nothing is drawn between items: no notes, leader lines or connectors.
//
// Deterministic: the same items, frame, heights and previous layout always
// give the same rects. Stable: an item keeps its spot from the last settled
// layout of this frame while it's still free and its width didn't change.
import type { OrganicLook } from "./looks";
import type { CanvasKind, Composition, Region, Scale, Side, SizeHint } from "./shared";

export interface OrganicItem {
  id: string;
  kind: CanvasKind;
  size: SizeHint;
  importance: number;
  createdAt: number;
  updatedAt: number;
  point?: { x: number; y: number } | null;
  /** A quote's accent (looks.ts accentOf). */
  accent?: string | null;
  scale?: Scale | null;
  region?: Region | null;
  pinnedTo?: string | null;
  side?: Side | null;
  bleed?: boolean | null;
  /** A chart, map or picture (not text). */
  visual?: boolean;
  /** Hand placement, as shares of the frame (reference boards only): exactly here, this wide. */
  fixed?: { x: number; y: number; w: number } | null;
}

export interface Frame { width: number; height: number }
export interface Placed { x: number; y: number; w: number; h: number; rotate: number; z: number; scale: Scale }
/** How the composed board sits on the screen: scaled about its top-left, then moved (screen = board × scale + (x, y)). */
export interface Fit { scale: number; x: number; y: number }
export interface OrganicLayout { rects: Map<string, Placed>; focusId: string | null; height: number; frame: Frame; composition: Composition; fit: Fit }

/** How far a bleeding item runs past the board's edge (the page's side padding). */
export const BLEED = 32;
/** Below this width the board composes for a narrow screen: bigger shares, and it scrolls. */
export const NARROW = 760;

const VISUAL_KINDS: ReadonlySet<CanvasKind> = new Set(["line", "bar", "area", "pie", "map", "image", "multiples"]);
export const isVisualKind = (kind: CanvasKind) => VISUAL_KINDS.has(kind);

interface Rules { gap: number; tilt: number }
const LOOK_RULES: Record<OrganicLook, Rules> = {
  editorial: { gap: 44, tilt: 0 },
  field: { gap: 38, tilt: 1.2 },
  instrument: { gap: 22, tilt: 0 },
};

/** Share of the frame's width per scale; on a narrow screen, per scale too. */
const SCALE_W: Record<Scale, number> = { hero: 0.56, large: 0.34, medium: 0.25, small: 0.185, tiny: 0.14 };
const NARROW_W: Record<Scale, number> = { hero: 1, large: 1, medium: 0.66, small: 0.5, tiny: 0.46 };
/** Suggested height per scale, as a share of the frame's height (charts and custom pieces size to it). */
const SCALE_ROOM: Record<Scale, number> = { hero: 0.66, large: 0.44, medium: 0.34, small: 0.26, tiny: 0.2 };
/** The hero's suggested height per composition: a full-width close-up or a spine leaves room under it. */
const HERO_ROOM: Record<Composition, number> = { orbit: 0.62, "giant-number": 0.56, map: 0.7, spine: 0.4, split: 0.56, quote: 0.5, "close-up": 0.5, essay: 0.66, gallery: 0.62 };
/** Narrowest readable width per kind, px. */
const MIN_W: Partial<Record<CanvasKind, number>> = {
  table: 380, map: 300, timeline: 320, multiples: 340, line: 300, area: 300, bar: 280, pie: 240, custom: 240, headline: 260,
  caption: 220, quote: 240, list: 240, stat: 150, image: 220, ticker: 400, progress: 200,
};

interface Pattern { hero: { x: number; y: number; w: number }; second?: { x: number; y: number; w: number }; slots: [number, number][] }
/** Each composition: the hero's center and width (shares of the frame), the second hero's (split), and targets for the rest, by rank. */
export const PATTERNS: Record<Composition, Pattern> = {
  orbit: { hero: { x: 0.37, y: 0.44, w: 0.58 }, slots: [[0.86, 0.13], [0.87, 0.52], [0.13, 0.9], [0.84, 0.9], [0.5, 0.93], [0.1, 0.08], [0.62, 0.06]] },
  "giant-number": { hero: { x: 0.25, y: 0.34, w: 0.38 }, slots: [[0.72, 0.3], [0.22, 0.84], [0.66, 0.84], [0.93, 0.62], [0.55, 0.06], [0.92, 0.1], [0.44, 0.6]] },
  map: { hero: { x: 0.5, y: 0.47, w: 0.5 }, slots: [[0.11, 0.15], [0.89, 0.17], [0.1, 0.8], [0.9, 0.82], [0.5, 0.96], [0.12, 0.48], [0.88, 0.5]] },
  spine: { hero: { x: 0.5, y: 0.52, w: 0.94 }, slots: [[0.15, 0.13], [0.52, 0.1], [0.87, 0.15], [0.27, 0.9], [0.63, 0.9], [0.92, 0.88], [0.06, 0.88]] },
  split: { hero: { x: 0.26, y: 0.42, w: 0.44 }, second: { x: 0.75, y: 0.42, w: 0.43 }, slots: [[0.5, 0.07], [0.23, 0.9], [0.77, 0.9], [0.5, 0.92], [0.06, 0.9], [0.95, 0.9]] },
  quote: { hero: { x: 0.33, y: 0.3, w: 0.56 }, slots: [[0.84, 0.2], [0.24, 0.8], [0.64, 0.76], [0.9, 0.62], [0.5, 0.96], [0.9, 0.92]] },
  "close-up": { hero: { x: 0.5, y: 0.36, w: 0.97 }, slots: [[0.14, 0.88], [0.45, 0.9], [0.77, 0.88], [0.94, 0.08], [0.06, 0.06]] },
  essay: { hero: { x: 0.26, y: 0.46, w: 0.42 }, slots: [[0.73, 0.18], [0.8, 0.58], [0.63, 0.9], [0.94, 0.9], [0.56, 0.5]] },
  gallery: { hero: { x: 0.25, y: 0.46, w: 0.4 }, slots: [[0.6, 0.24], [0.86, 0.3], [0.62, 0.78], [0.88, 0.8], [0.74, 0.52], [0.47, 0.06], [0.95, 0.06]] },
};
const REGION_AT: Record<Region, [number, number]> = {
  "top-left": [0.12, 0.1], top: [0.5, 0.08], "top-right": [0.88, 0.1], left: [0.1, 0.5], center: [0.5, 0.5], right: [0.9, 0.5],
  "bottom-left": [0.12, 0.9], bottom: [0.5, 0.92], "bottom-right": [0.88, 0.9],
};

/** A small stable number from an id, for per-item variety. */
export function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Items pinned to an item that's on the board: placed right next to it (nothing is drawn between them). */
function pinsOf(items: readonly OrganicItem[]): Map<string, string> {
  const ids = new Set(items.map((item) => item.id));
  const pins = new Map<string, string>();
  for (const item of items) {
    const target = item.pinnedTo ?? null;
    if (target && target !== item.id && ids.has(target)) pins.set(item.id, target);
  }
  // A pin loop (a pinned to b pinned to a) would have nowhere to start: the later one floats free.
  for (const [id, target] of pins) {
    const seen = new Set([id]);
    for (let at = target; pins.has(at); at = pins.get(at)!) { if (seen.has(at)) { pins.delete(id); break; } seen.add(at); }
  }
  return pins;
}

const recency = (a: OrganicItem, b: OrganicItem) => b.importance - a.importance || b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The hero: an item the agent made the hero, else the highest importance, most recently changed. */
export function organicFocus(items: readonly OrganicItem[]): OrganicItem | null {
  const heroes = items.filter((item) => item.scale === "hero");
  return [...(heroes.length ? heroes : items)].sort(recency)[0] ?? null;
}

/** The composition when the agent named none: from what the hero is. */
export function inferComposition(hero: OrganicItem | null, items: readonly OrganicItem[] = []): Composition {
  if (!hero) return "orbit";
  if (items.filter((item) => item.scale === "hero").length >= 2) return "split";
  switch (hero.kind) {
    case "stat": case "progress": return "giant-number";
    case "map": return "map";
    case "timeline": return "spine";
    case "quote": return "quote";
    case "headline": case "caption": case "list": return "essay";
    case "image": return "gallery";
    default: return "orbit";
  }
}

interface Sized { w: number; scale: Scale; room: number }

/**
 * Each item's width, scale and suggested height (room) before heights are
 * known: the page renders items at these widths and measures their heights.
 */
export function organicSizes(items: readonly OrganicItem[], frame: Frame, _look: OrganicLook, composition?: Composition | null): Map<string, Sized> {
  const sizes = new Map<string, Sized>();
  const W = Math.max(0, frame.width);
  const H = Math.max(320, frame.height);
  if (!W) return sizes;
  const narrow = W < NARROW;
  const hero = organicFocus(items);
  const comp = composition ?? inferComposition(hero, items);
  const pattern = PATTERNS[comp];
  const pins = pinsOf(items);
  const second = secondHero(items, hero, comp, pins);
  for (const item of items) {
    const hash = hashOf(item.id);
    if (item.fixed) { sizes.set(item.id, { w: Math.round(item.fixed.w * W), scale: item.id === hero?.id ? "hero" : scaleOf(item, false), room: Math.round(H * (item.id === hero?.id ? SCALE_ROOM.hero : SCALE_ROOM[scaleOf(item, false)])) }); continue; }
    const isHero = item.id === hero?.id;
    const scale: Scale = isHero || item.id === second?.id ? "hero" : scaleOf(item, false);
    const min = Math.min(W, MIN_W[item.kind] ?? 200);
    let w: number;
    if (narrow) w = W * NARROW_W[scale];
    else if (isHero) w = W * heroShare(item, pattern.hero.w, comp, W, H);
    else if (item.id === second?.id) w = W * (pattern.second?.w ?? SCALE_W.large);
    else w = W * SCALE_W[scale] * (0.92 + (hash % 17) / 100);
    if (item.bleed && !narrow) w += BLEED;
    w = Math.round(Math.max(min, Math.min(W + (item.bleed ? BLEED : 0), w)));
    sizes.set(item.id, { w, scale, room: Math.round(H * (isHero ? HERO_ROOM[comp] : SCALE_ROOM[scale])) });
  }
  // A sparse board would leave the screen mostly empty: its supporting pieces grow (up to half again) until
  // they'd cover about two fifths of it. From estimates only, so measuring never feeds back into widths.
  if (!narrow) {
    let area = 0;
    for (const item of items) { const s = sizes.get(item.id)!; area += s.w * estimateHeight(item.kind, s.w, s.room); }
    const boost = Math.max(1, Math.min(1.5, Math.sqrt((0.42 * W * H) / Math.max(1, area))));
    if (boost > 1.02) for (const item of items) {
      const s = sizes.get(item.id)!;
      if (item.fixed || s.scale === "hero") continue;
      sizes.set(item.id, { ...s, w: Math.round(Math.min(W * 0.48, s.w * boost)), room: Math.round(Math.min(H * 0.5, s.room * boost)) });
    }
  }
  return sizes;
}

/** The hero's share of the width: its composition's, kept short enough to fit the screen when its height follows its width. */
function heroShare(item: OrganicItem, share: number, comp: Composition, W: number, H: number): number {
  // A tile map is ~0.75 as tall as wide; a giant number or quote stays its composition's.
  if (item.kind === "map") return Math.min(share, (H * 0.86) / 0.76 / W);
  if (item.kind === "stat" || item.kind === "progress") return comp === "giant-number" ? share : Math.min(share, 0.4);
  if (item.kind === "table" || item.kind === "list" || item.kind === "caption") return Math.min(share, 0.5);
  return share;
}

/** The scale an item takes when the agent gave none: from its size hint and importance. */
function scaleOf(item: OrganicItem, isHero: boolean): Scale {
  if (isHero) return "hero";
  if (item.scale && item.scale !== "hero") return item.scale;
  if (item.scale === "hero") return "large";
  switch (item.size) {
    case "xl": return "large";
    case "l": return item.importance >= 4 ? "large" : "medium";
    case "m": return item.importance <= 2 ? "small" : "medium";
    default: return item.importance <= 2 ? "tiny" : "small";
  }
}

/** split's second side: the other item marked hero, else the next most important. */
function secondHero(items: readonly OrganicItem[], hero: OrganicItem | null, comp: Composition, pins: ReadonlyMap<string, string>): OrganicItem | null {
  if (comp !== "split" || !hero) return null;
  const rest = items.filter((item) => item.id !== hero.id && !pins.has(item.id) && !item.fixed);
  const marked = rest.filter((item) => item.scale === "hero");
  return [...(marked.length ? marked : rest)].sort(recency)[0] ?? null;
}

/** A height to place an item at before it's measured. */
export function estimateHeight(kind: CanvasKind, width: number, room = 400): number {
  switch (kind) {
    case "headline": return Math.round(Math.min(260, 60 + 9000 / Math.max(200, width)) + width * 0.08);
    case "caption": return Math.round(Math.max(70, 26000 / Math.max(160, width)));
    case "stat": return Math.round(Math.max(110, Math.min(room, width * 0.5)));
    case "quote": return Math.round(Math.max(120, 40000 / Math.max(200, width)));
    case "ticker": return 52;
    case "progress": return 80;
    case "map": return Math.round(Math.min(width * 0.76, room + 60));
    case "image": return Math.round(width * 1.15 + 50);
    case "timeline": return 220;
    case "table": case "list": return 300;
    default: return Math.round(Math.max(140, Math.min(room, width * 0.6)));
  }
}

interface Box { id: string; x: number; y: number; w: number; h: number; gap: number }
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/**
 * Composes the board. frame: the visible board. heights: measured px per
 * item (estimates for the rest). previous: the last settled layout of this
 * frame, the stability hint. composition: the agent's, or inferred.
 */
export function layoutOrganic(items: readonly OrganicItem[], frame: Frame, look: OrganicLook, heights: ReadonlyMap<string, number>, previous?: ReadonlyMap<string, Placed> | null, composition?: Composition | null): OrganicLayout {
  const rects = new Map<string, Placed>();
  const W = frame.width;
  const H = Math.max(320, frame.height);
  const hero = organicFocus(items);
  const comp = composition ?? inferComposition(hero, items);
  if (!items.length || W <= 0) return { rects, focusId: null, height: 0, frame, composition: comp, fit: { scale: 1, x: 0, y: 0 } };
  const rules = LOOK_RULES[look];
  const narrow = W < NARROW;
  const sizes = organicSizes(items, frame, look, comp);
  const pins = pinsOf(items);
  const second = secondHero(items, hero, comp, pins);
  const byId = new Map(items.map((item) => [item.id, item]));
  const heightOf = (item: OrganicItem) => heights.get(item.id) ?? estimateHeight(item.kind, sizes.get(item.id)!.w, sizes.get(item.id)!.room);
  // A mirror image of the composition for some heroes, so boards in a row vary, unless
  // the agent's regions and pins ask for room on one side of the hero.
  const pattern0 = PATTERNS[comp];
  const conflicts = (flip: boolean) => {
    const hx = flip ? 1 - pattern0.hero.x : pattern0.hero.x;
    let n = 0;
    for (const item of items) {
      if (item.id === hero?.id) continue;
      // A region the hero would cover (its footprint, plus room for the item).
      if (item.region && hero) {
        const [rx, ry] = REGION_AT[item.region];
        const hw = sizes.get(hero.id)!.w / W / 2, hh = heightOf(hero) / H / 2;
        if (Math.abs(rx - hx) < hw + 0.1 && Math.abs(ry - pattern0.hero.y) < hh + 0.15) n++;
      }
      if (hero && item.pinnedTo === hero.id && item.side !== "above" && item.side !== "below") {
        const right = item.side === "right" || (!item.side && (item.point?.x ?? 1) >= 0.5);
        if (right ? hx > 0.5 : hx < 0.5) n++;
      }
    }
    return n;
  };
  const plain = conflicts(false), flipped = conflicts(true);
  const mirror = !!hero && comp !== "spine" && (plain === flipped ? hashOf(hero.id) % 2 === 1 : flipped < plain);
  const mx = (x: number) => (mirror ? 1 - x : x);
  const pattern = PATTERNS[comp];

  // The composition's height: the screen, or taller when everything can't fit on it (it scrolls).
  let area = 0;
  for (const item of items) { const s = sizes.get(item.id)!; area += s.w * heightOf(item); }
  // Composed for the screen; only a board too full for it (after the fit's shrink) is composed taller, to scroll.
  const Hv = Math.round(Math.max(H, narrow ? area / (W * 0.78) : area / (W * 0.82 * minFit(H))));
  // How far toward the composition's targets pieces reach from the hero: a sparse board stays a tight cluster
  // (the fit then scales it up to the screen), a full one spreads to the edges.
  const pull = Math.max(0.45, Math.min(1, 0.2 + (area / (W * H)) * 1.2));

  const boxes: Box[] = [];
  const gapOf = (item: OrganicItem) => Math.round(rules.gap * (narrow ? 0.7 : 1) * (0.78 + (hashOf(item.id) % 9) / 16));
  const minX = (item: OrganicItem) => (item.bleed && !narrow ? -BLEED : 0);
  const maxX = (item: OrganicItem, w: number) => W - w + (item.bleed && !narrow ? BLEED : 0);
  /** Free: clear of every box by the gaps between them (a pinned item may sit closer to its target). */
  const free = (rect: { x: number; y: number; w: number; h: number }, gap: number, pin: { target: string; near: number } | null) => {
    for (const box of boxes) {
      if (pin && box.id === pin.target) {
        if (overlaps(rect, box, pin.near)) return false;
        continue;
      }
      if (overlaps(rect, box, Math.round((Math.max(gap, box.gap) + Math.min(gap, box.gap)) / 2 * 0.8))) return false;
    }
    return true;
  };
  const place = (item: OrganicItem, x: number, y: number) => {
    const s = sizes.get(item.id)!;
    const h = heightOf(item);
    const isHero = item.id === hero?.id;
    const hash = hashOf(item.id);
    boxes.push({ id: item.id, x, y, w: s.w, h, gap: gapOf(item) });
    rects.set(item.id, { x: Math.round(x), y: Math.round(y), w: s.w, h, rotate: tiltOf(item, rules, isHero, s.scale, hash), z: isHero ? 2 : item.kind === "quote" ? 3 : 1, scale: s.scale });
  };
  /** The free spot nearest a target center, searched around everything placed, the frame's edges and a coarse sweep. */
  const search = (item: OrganicItem, tx: number, ty: number) => {
    const { w } = sizes.get(item.id)!;
    const h = heightOf(item);
    const gap = gapOf(item);
    const lo = minX(item), hi = maxX(item, w);
    const xs = new Set<number>([tx - w / 2, lo, hi]);
    const ys = new Set<number>([ty - h / 2, 0, Hv - h]);
    const tries: [number, number][] = [];
    for (const x of xs) for (const y of ys) tries.push([x, y]);
    for (const box of boxes) {
      const g = Math.round((Math.max(gap, box.gap) + Math.min(gap, box.gap)) / 2 * 0.8) + 1;
      for (const y of [box.y, box.y + box.h - h, box.y + (box.h - h) / 2, ty - h / 2]) { tries.push([box.x + box.w + g, y], [box.x - w - g, y]); }
      for (const x of [box.x, box.x + box.w - w, box.x + (box.w - w) / 2, tx - w / 2]) { tries.push([x, box.y + box.h + g], [x, box.y - h - g]); }
    }
    for (let i = 0; i <= 14; i++) for (let j = 0; j <= 10; j++) tries.push([lo + (i / 14) * (hi - lo), (j / 10) * Math.max(0, Hv - h)]);
    let best: [number, number] | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const [rx, ry] of tries) {
      const x = Math.round(Math.max(lo, Math.min(hi, rx))), y = Math.round(Math.max(0, ry));
      const rect = { x, y, w, h };
      if (!free(rect, gap, null)) continue;
      const dx = (x + w / 2 - tx) / W, dy = (y + h / 2 - ty) / Hv;
      const cost = Math.hypot(dx, dy * 0.9) * 100 + (Math.max(0, y + h - Hv) / Hv) * 600 + (Math.max(0, y + h - H) / H) * 260;
      if (cost < bestCost - 1e-9) { bestCost = cost; best = [x, y]; }
    }
    if (best) return best;
    const bottom = boxes.reduce((max, box) => Math.max(max, box.y + box.h + box.gap), 0);
    return [Math.round(Math.max(lo, Math.min(hi, tx - w / 2))), Math.round(bottom)] as [number, number];
  };
  /** An item's previous spot, when it's the same width and still free. */
  const kept = (item: OrganicItem, pin: { target: string; near: number } | null) => {
    const was = previous?.get(item.id);
    const s = sizes.get(item.id)!;
    if (!was || Math.abs(was.w - s.w) > 1 || was.x < minX(item) - 1 || was.x > maxX(item, s.w) + 1) return null;
    const rect = { x: was.x, y: was.y, w: s.w, h: heightOf(item) };
    return free(rect, gapOf(item), pin) ? ([was.x, was.y] as [number, number]) : null;
  };

  // Pinned items come right after what they're pinned to.
  const pinned = new Map<string, OrganicItem[]>();
  for (const [id, target] of pins) { const list = pinned.get(target) ?? []; list.push(byId.get(id)!); pinned.set(target, list); }
  const pinOf = (item: OrganicItem) => {
    const target = pins.get(item.id);
    const t = target ? boxes.find((box) => box.id === target) : undefined;
    if (!target || !t) return null;
    return { target, near: Math.round(gapOf(item) * 0.6) };
  };
  const placePinned = (item: OrganicItem, target: OrganicItem) => {
    const t = boxes.find((box) => box.id === target.id)!;
    const { w } = sizes.get(item.id)!;
    const h = heightOf(item);
    const point = item.point ?? { x: 1, y: 0.5 };
    const px = t.x + point.x * t.w, py = t.y + point.y * t.h;
    const pin = pinOf(item)!;
    const side: Side = item.side ? item.side : point.y <= 0.12 ? "above" : point.y >= 0.88 ? "below" : point.x < 0.5 ? "left" : "right";
    const g = pin.near + 4;
    const tries: { x: number; y: number; side: Side; far: number }[] = [];
    for (const far of [0, 1, 2.5]) {
      const d = g + far * 24;
      for (const y of [py - h / 2, py - h * 0.2, py - h * 0.8, t.y, t.y + t.h - h]) { tries.push({ x: t.x + t.w + d, y, side: "right", far }, { x: t.x - w - d, y, side: "left", far }); }
      for (const x of [px - w / 2, px - w * 0.15, px - w * 0.85, t.x, t.x + t.w - w]) { tries.push({ x, y: t.y - h - d, side: "above", far }, { x, y: t.y + t.h + d, side: "below", far }); }
    }
    let best: { x: number; y: number } | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const each of tries) {
      const x = Math.round(Math.max(minX(item), Math.min(maxX(item, w), each.x))), y = Math.round(Math.max(0, each.y));
      const rect = { x, y, w, h };
      if (!free(rect, gapOf(item), pin)) continue;
      // Nearest the point, on the side asked for, on the screen.
      const nx = Math.max(x, Math.min(x + w, px)), ny = Math.max(y, Math.min(y + h, py));
      const cost = Math.hypot(nx - px, ny - py) + (each.side === side ? 0 : 90) + each.far * 30 + Math.max(0, y + h - Hv) * 2;
      if (cost < bestCost - 1e-9) { bestCost = cost; best = { x, y }; }
    }
    const spot = best ?? (() => { const [x, y] = search(item, px, py); return { x, y }; })();
    place(item, spot.x, spot.y);
  };

  // Hand-placed items (reference boards) first, exactly where they were put.
  for (const item of items.filter((each) => each.fixed).sort(recency)) place(item, Math.round(item.fixed!.x * W), Math.round(item.fixed!.y * H));

  // The order: the hero (and split's second side), then the rest by rank, each followed by what's pinned to it.
  const order: OrganicItem[] = [];
  const queued = new Set<string>();
  const queue = (item: OrganicItem) => {
    if (queued.has(item.id)) return;
    queued.add(item.id);
    if (!item.fixed) order.push(item);
    for (const each of (pinned.get(item.id) ?? []).sort(recency)) queue(each);
  };
  for (const item of [hero, second]) if (item) queue(item);
  for (const item of items.filter((each) => !pins.has(each.id)).sort(recency)) queue(item);
  for (const item of items.filter((each) => !queued.has(each.id)).sort(recency)) queue(item);

  // Each free item's target: its region, else the composition's next spot, by rank.
  const targets = new Map<string, [number, number]>();
  let slot = 0;
  for (const item of order) {
    if (pins.has(item.id)) continue;
    const isHero = item.id === hero?.id || item.id === second?.id;
    if (item.region && !isHero) {
      // A region is a direction from the hero, drawn in like the composition's own targets.
      const [x, y] = REGION_AT[item.region];
      const hx = mx(pattern.hero.x), hy = pattern.hero.y;
      targets.set(item.id, [(hx + (x - hx) * pull) * W, (hy + (y - hy) * pull) * Hv]);
    } else if (item.region) targets.set(item.id, [REGION_AT[item.region][0] * W, REGION_AT[item.region][1] * Hv]);
    else if (isHero) { const spot = item.id === hero?.id ? pattern.hero : pattern.second ?? { x: 0.75, y: 0.42 }; targets.set(item.id, [mx(spot.x) * W, spot.y * Hv]); }
    else if (narrow) {
      // A narrow screen: down the page, alternating sides, so it still reads as composed.
      targets.set(item.id, [slot++ % 2 ? W - sizes.get(item.id)!.w / 2 : sizes.get(item.id)!.w / 2, 0]);
    } else if (slot < pattern.slots.length) {
      // On a sparse board the targets draw in toward the hero, so the pieces cluster instead of sitting alone in the corners.
      const [x, y] = pattern.slots[slot++]!;
      const hx = mx(pattern.hero.x), hy = pattern.hero.y;
      targets.set(item.id, [(hx + (mx(x) - hx) * pull) * W, (hy + (y - hy) * pull) * Hv]);
    }
  }

  let keptAny = false;
  // Pass 1, stability: whatever kept its width keeps its spot while it's free (a pin only beside a target that stayed too).
  for (const item of order) {
    const target = pins.get(item.id);
    if (target && !rects.has(target)) continue;
    const was = kept(item, pinOf(item));
    if (was) { place(item, was[0], was[1]); keptAny = true; }
  }
  // Pass 2: the rest, composed.
  for (const item of order) {
    if (rects.has(item.id)) continue;
    const target = pins.get(item.id);
    if (target && rects.has(target)) { placePinned(item, byId.get(target)!); continue; }
    const s = sizes.get(item.id)!;
    const h = heightOf(item);
    const [tx, ty] = targets.get(item.id) ?? emptiest(boxes, W, Hv);
    if (item.id === hero?.id || item.id === second?.id) {
      // The hero goes right on its spot when it's free, kept on the screen (or bleeding off its edge).
      let x = narrow ? (W - s.w) / 2 : tx - s.w / 2;
      if (item.bleed && !narrow) x = tx < W / 2 ? -BLEED : W - s.w + BLEED;
      x = Math.round(Math.max(minX(item), Math.min(maxX(item, s.w), x)));
      const y = Math.round(narrow && item.id === hero?.id ? 0 : Math.max(0, Math.min(Math.max(0, H - h), ty - h / 2)));
      if (free({ x, y, w: s.w, h }, gapOf(item), null)) { place(item, x, y); continue; }
    }
    const [x, y] = search(item, tx, ty);
    place(item, x, y);
  }

  // A fresh composition (nothing kept from the last one) is stretched to the screen; kept spots already were.
  if (!narrow && !keptAny && !items.some((item) => item.fixed)) stretch(rects, W, H);
  let height = 0;
  for (const rect of rects.values()) height = Math.max(height, rect.y + rect.h);
  return { rects, focusId: hero?.id ?? null, height: Math.ceil(height), frame, composition: comp, fit: fitTo(rects, W, H, narrow || items.some((item) => item.fixed)) };
}

/**
 * When the composition is much wider than tall for the screen (a spine, a
 * close-up), its pieces spread apart downward from its top, up to half
 * again, so after the fit it reaches the screen's top and bottom.
 * Positions only: spacing every pair further apart keeps them clear.
 */
function stretch(rects: Map<string, Placed>, W: number, H: number): void {
  if (rects.size < 2) return;
  let x0 = Number.POSITIVE_INFINITY, y0 = Number.POSITIVE_INFINITY, x1 = Number.NEGATIVE_INFINITY, y1 = Number.NEGATIVE_INFINITY;
  for (const r of rects.values()) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  const fit = Math.min(W / Math.max(1, x1 - x0), MAX_FIT);
  const want = H / fit; // the height that fills the screen once fitted
  const bh = y1 - y0;
  if (want <= bh * 1.08) return;
  const reach = Math.max(...[...rects.values()].map((r) => r.y - y0));
  if (reach <= 0) return;
  const f = Math.min(1.5, 1 + (want - bh) / reach);
  for (const [id, r] of rects) rects.set(id, { ...r, y: Math.round(y0 + (r.y - y0) * f) });
}

/** Bigger than this, a sparse board's type and charts would read as blown up. */
export const MAX_FIT = 1.4;
/** A board this much taller than the screen shrinks to fit it rather than scroll (more on a short screen). */
export const MIN_FIT = 0.86;
export const minFit = (H: number) => (H < 700 ? 0.74 : MIN_FIT);

/**
 * Fits the composed board to the screen: a sparse board is scaled up (to
 * MAX_FIT) and centered so it fills the screen instead of leaving dead
 * zones; one a little taller than the screen shrinks to fit (to MIN_FIT);
 * a taller one scrolls at full size. Narrow screens and hand-placed boards
 * aren't fitted.
 */
export function fitTo(rects: ReadonlyMap<string, Placed>, W: number, H: number, off = false): Fit {
  if (off || !rects.size) return { scale: 1, x: 0, y: 0 };
  let x0 = Number.POSITIVE_INFINITY, y0 = Number.POSITIVE_INFINITY, x1 = Number.NEGATIVE_INFINITY, y1 = Number.NEGATIVE_INFINITY;
  for (const r of rects.values()) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  let scale = Math.min(W / bw, H / bh, MAX_FIT);
  if (scale < minFit(H)) return { scale: 1, x: 0, y: 0 };
  scale = Math.round(scale * 1000) / 1000;
  return { scale, x: Math.round((W - bw * scale) / 2 - x0 * scale), y: Math.round((H - bh * scale) / 2 - y0 * scale) };
}

/** The point of the frame farthest from everything placed: where the next item helps balance most. */
function emptiest(boxes: readonly Box[], W: number, H: number): [number, number] {
  let best: [number, number] = [W / 2, H / 2];
  let bestD = -1;
  for (let i = 1; i < 12; i++) for (let j = 1; j < 9; j++) {
    const x = (i / 12) * W, y = (j / 9) * H;
    let d = Number.POSITIVE_INFINITY;
    for (const box of boxes) {
      const nx = Math.max(box.x, Math.min(box.x + box.w, x)), ny = Math.max(box.y, Math.min(box.y + box.h, y));
      d = Math.min(d, Math.hypot((nx - x) / W, (ny - y) / H));
    }
    if (d > bestD + 1e-9) { bestD = d; best = [x, y]; }
  }
  return best;
}

/** An item's tilt, in degrees: small text pieces a little in field notes; nothing else. */
function tiltOf(item: OrganicItem, rules: Rules, isHero: boolean, scale: Scale, hash: number): number {
  const range = item.accent || isHero || item.visual || isVisualKind(item.kind) || item.kind === "table" || item.kind === "custom" ? 0 : scale === "small" || scale === "tiny" ? rules.tilt : 0;
  return range ? Math.round((((hash >>> 20) % 1000) / 1000 - 0.5) * 2 * range * 100) / 100 : 0;
}
