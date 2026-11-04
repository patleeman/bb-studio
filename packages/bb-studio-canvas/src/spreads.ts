// Spreads: the designed layouts a styled board is built on. The agent
// picks one spread per board and fills its named slots; it never places
// anything. Each spread is an asymmetric grid of its own (column ratios,
// rows, named areas) for wide, medium and narrow boards, with the style's
// margins and gutters, so edges and tops line up and the reading path is
// set by design. Styles restyle the same spreads (type, colour, rules).
//
// - A slot accepts some kinds of item (a gallery's pictures, a big
//   number's stat, ...). Unfilled optional slots collapse: a neighbour
//   named in absorb takes their cells when the result is still a
//   rectangle; otherwise the cells go blank, and rows and columns that end
//   up blank disappear.
// - Rows are fr (a share of the screen's height) or auto (as tall as what
//   sits in them). A piece taller than its slot grows the slot's last row;
//   the board scrolls only when that pushes it past the screen.
// - Pure: the same items, frame and heights always give the same rects.
//   Items keep their ids across spreads, so a new spread glides them from
//   their old slots to their new ones.
import type { CanvasKind } from "./shared";

/** What a slot takes, by kind. */
const GROUPS = {
  visual: ["line", "bar", "area", "pie", "map", "image", "multiples", "custom", "table"],
  picture: ["image", "custom"],
  chart: ["line", "bar", "area", "pie", "multiples", "custom", "table", "map"],
  number: ["stat", "progress", "custom"],
  words: ["headline", "caption", "quote", "list", "custom"],
  fact: ["stat", "progress", "caption", "quote", "list", "custom", "ticker"],
  any: ["headline", "caption", "stat", "line", "bar", "area", "pie", "table", "list", "ticker", "progress", "image", "custom", "quote", "timeline", "map", "multiples"],
} as const satisfies Record<string, readonly CanvasKind[]>;
type Group = keyof typeof GROUPS;

export interface SlotDef {
  name: string;
  /** What belongs there, for the agent. */
  role: string;
  accepts: Group;
  required?: boolean;
  /** The board's hero: drawn at hero scale. */
  hero?: boolean;
  /** Filled neighbours that may take this slot's cells when it's empty, in order. */
  absorb?: string[];
}
/** One grid: column ratios, rows (fr shares, or "auto": as tall as their content) and named areas, one string per row. */
export interface Grid { cols: number[]; rows: (number | "auto")[]; areas: string[] }
export interface Spread { id: string; name: string; use: string; slots: SlotDef[]; wide: Grid; medium?: Grid; narrow: Grid }

const s = (name: string, accepts: Group, role: string, extra: Partial<SlotDef> = {}): SlotDef => ({ name, accepts, role, ...extra });

export const SPREADS: readonly Spread[] = [
  {
    id: "hero-sidebar", name: "Hero and sidebar", use: "news, results, a story: one lead piece with a column of supporting facts",
    slots: [
      s("hero", "visual", "the lead: a chart, map, picture or custom piece that answers the question", { required: true, hero: true }),
      s("deck", "words", "the headline or standfirst over the hero", { absorb: ["hero"] }),
      s("side1", "fact", "the strongest supporting fact", { absorb: ["side2"] }),
      s("side2", "fact", "a second fact", { absorb: ["side1", "side3"] }),
      s("side3", "fact", "a third fact", { absorb: ["side2", "side1"] }),
      s("footer", "any", "a strip under the hero: a table, timeline or small multiples", { absorb: ["hero"] }),
    ],
    wide: { cols: [3, 3, 2.2], rows: ["auto", 1, 1, "auto"], areas: ["deck deck side1", "hero hero side1", "hero hero side2", "footer footer side3"] },
    medium: { cols: [3, 2], rows: ["auto", 1, 1, "auto"], areas: ["deck side1", "hero side1", "hero side2", "footer side3"] },
    narrow: { cols: [1, 1], rows: ["auto", "auto", "auto", "auto", "auto"], areas: ["deck deck", "hero hero", "side1 side2", "side3 side3", "footer footer"] },
  },
  {
    id: "three-up", name: "Three-up feature", use: "an overview or explainer: three parallel parts under one idea",
    slots: [
      s("deck", "words", "the idea in a headline", { required: true, absorb: ["lead"] }),
      s("lead", "words", "a short standfirst beside the headline", { absorb: ["deck"] }),
      s("one", "any", "the first part", { required: true }),
      s("two", "any", "the second part", { required: true, absorb: ["one", "three"] }),
      s("three", "any", "the third part", { absorb: ["two"] }),
      s("footer", "any", "a strip across the bottom: what ties them together, or a table"),
    ],
    wide: { cols: [1, 1, 1], rows: ["auto", 1, "auto"], areas: ["deck deck lead", "one two three", "footer footer footer"] },
    narrow: { cols: [1], rows: ["auto", "auto", "auto", "auto", "auto", "auto"], areas: ["deck", "lead", "one", "two", "three", "footer"] },
  },
  {
    id: "gallery", name: "Gallery wall", use: "a showcase: products, games, places, people; pictures first, each with its name and rating",
    slots: [
      s("hero", "picture", "the standout picture (an image item, with its rating)", { required: true, hero: true }),
      s("deck", "words", "the headline over the wall"),
      s("p1", "picture", "a picture", { required: true }),
      s("p2", "picture", "a picture", { absorb: ["p1"] }),
      s("p3", "picture", "a picture", { absorb: ["p2"] }),
      s("p4", "picture", "a picture", { absorb: ["p1"] }),
      s("p5", "picture", "a picture", { absorb: ["p2", "p4"] }),
      s("p6", "picture", "a picture", { absorb: ["p3", "p5"] }),
      s("info", "fact", "a column of context: a ranked list, the price, a short note"),
    ],
    wide: { cols: [2.1, 1, 1, 1, 1.25], rows: ["auto", 1, 1], areas: ["hero deck deck deck info", "hero p1 p2 p3 info", "hero p4 p5 p6 info"] },
    medium: { cols: [1.6, 1, 1, 1], rows: ["auto", 1, 1, "auto"], areas: ["hero deck deck deck", "hero p1 p2 p3", "hero p4 p5 p6", "info info info info"] },
    narrow: { cols: [1, 1], rows: ["auto", "auto", "auto", "auto", "auto", "auto"], areas: ["deck deck", "hero hero", "p1 p2", "p3 p4", "p5 p6", "info info"] },
  },
  {
    id: "big-number", name: "Big number and evidence", use: "one key figure: a count, a result, a status, with the evidence beside it",
    slots: [
      s("number", "number", "the figure, set huge (a stat)", { required: true, hero: true }),
      s("deck", "words", "what the number means, in a headline", { absorb: ["number"] }),
      s("evidence", "chart", "the chart or table that backs it", { required: true }),
      s("fact1", "fact", "a supporting fact", { absorb: ["fact2"] }),
      s("fact2", "fact", "a supporting fact", { absorb: ["fact1", "fact3"] }),
      s("fact3", "fact", "a supporting fact", { absorb: ["fact2", "evidence"] }),
    ],
    wide: { cols: [1.1, 1.1, 2.6], rows: ["auto", 1, "auto"], areas: ["deck deck evidence", "number number evidence", "fact1 fact2 fact3"] },
    medium: { cols: [1, 1, 1.6], rows: ["auto", 1, "auto"], areas: ["deck deck evidence", "number number evidence", "fact1 fact2 fact3"] },
    narrow: { cols: [1, 1], rows: ["auto", "auto", "auto", "auto", "auto"], areas: ["deck deck", "number number", "evidence evidence", "fact1 fact2", "fact3 fact3"] },
  },
  {
    id: "split", name: "Split comparison", use: "two options, before and after, us and them: side by side, the verdict over them",
    slots: [
      s("verdict", "words", "the call, in a headline"),
      s("left", "any", "the first side (a big stat, a chart or a picture)", { required: true, hero: true }),
      s("right", "any", "the second side, the same kind as the left", { required: true, hero: true }),
      s("leftNote", "fact", "what goes with the left side", { absorb: ["left"] }),
      s("rightNote", "fact", "what goes with the right side", { absorb: ["right"] }),
      s("footer", "any", "what it would take, or the numbers in a table"),
    ],
    wide: { cols: [1, 1], rows: ["auto", 1, "auto", "auto"], areas: ["verdict verdict", "left right", "leftNote rightNote", "footer footer"] },
    narrow: { cols: [1], rows: ["auto", "auto", "auto", "auto", "auto", "auto"], areas: ["verdict", "left", "leftNote", "right", "rightNote", "footer"] },
  },
  {
    id: "spine", name: "Timeline spine", use: "a plan, a schedule, a history: the timeline across the board, moments above and below",
    slots: [
      s("timeline", "any", "the timeline (kind timeline, layout row)", { required: true, hero: true }),
      s("deck", "words", "the headline", { absorb: ["above1"] }),
      s("above1", "fact", "context before it", { absorb: ["deck", "above2"] }),
      s("above2", "fact", "context before it", { absorb: ["above1"] }),
      s("below1", "fact", "what follows from it", { absorb: ["below2"] }),
      s("below2", "fact", "what follows from it", { absorb: ["below1", "below3"] }),
      s("below3", "fact", "what follows from it", { absorb: ["below2"] }),
    ],
    wide: { cols: [1.2, 1, 1], rows: [1, "auto", 1], areas: ["deck above1 above2", "timeline timeline timeline", "below1 below2 below3"] },
    narrow: { cols: [1, 1], rows: ["auto", "auto", "auto", "auto", "auto"], areas: ["deck deck", "above1 above2", "timeline timeline", "below1 below2", "below3 below3"] },
  },
  {
    id: "map", name: "Map and legend", use: "where something happened: the map large, its key and the places that matter beside it",
    slots: [
      s("map", "visual", "the map (kind map, or a custom one)", { required: true, hero: true }),
      s("deck", "words", "the headline", { absorb: ["fact1"] }),
      s("legend", "fact", "how to read it, or the tally", { absorb: ["fact3"] }),
      s("fact1", "fact", "a place that matters", { absorb: ["fact2"] }),
      s("fact2", "fact", "a place that matters", { absorb: ["fact1"] }),
      s("fact3", "fact", "a place that matters", { absorb: ["legend"] }),
    ],
    wide: { cols: [2.6, 1, 1], rows: ["auto", 1, 1], areas: ["map deck deck", "map fact1 fact2", "map legend fact3"] },
    medium: { cols: [2, 1], rows: ["auto", 1, 1, 1], areas: ["map deck", "map fact1", "map fact2", "map legend"] },
    narrow: { cols: [1, 1], rows: ["auto", "auto", "auto", "auto"], areas: ["deck deck", "map map", "fact1 fact2", "legend fact3"] },
  },
  {
    id: "panel", name: "Instrument panel", use: "dense data and monitoring: a row of readouts, the main chart, details beside and under it",
    slots: [
      s("kpi1", "number", "a readout", { required: true }),
      s("kpi2", "number", "a readout", { absorb: ["kpi1"] }),
      s("kpi3", "number", "a readout", { absorb: ["kpi2"] }),
      s("kpi4", "number", "a readout", { absorb: ["kpi3"] }),
      s("main", "chart", "the main chart", { required: true, hero: true }),
      s("detail1", "any", "a detail beside it: small multiples, a table", { absorb: ["main"] }),
      s("detail2", "any", "a detail under it", { absorb: ["log"] }),
      s("log", "any", "events or a note under it", { absorb: ["detail2"] }),
    ],
    wide: { cols: [1, 1, 1, 1.15], rows: ["auto", 1.5, 1], areas: ["kpi1 kpi2 kpi3 kpi4", "main main main detail1", "detail2 detail2 log log"] },
    medium: { cols: [1, 1, 1, 1], rows: ["auto", 1.4, "auto", 1], areas: ["kpi1 kpi2 kpi3 kpi4", "main main main main", "detail1 detail1 detail1 detail1", "detail2 detail2 log log"] },
    narrow: { cols: [1, 1], rows: ["auto", "auto", "auto", "auto", "auto", "auto"], areas: ["kpi1 kpi2", "kpi3 kpi4", "main main", "detail1 detail1", "detail2 detail2", "log log"] },
  },
];

export const SPREAD_IDS = SPREADS.map((spread) => spread.id) as [string, ...string[]];
export const spreadOf = (id: string | null | undefined): Spread | null => SPREADS.find((spread) => spread.id === id) ?? null;
export const accepts = (slot: SlotDef, kind: CanvasKind) => (GROUPS[slot.accepts] as readonly string[]).includes(kind);
export const acceptedKinds = (slot: SlotDef): readonly string[] => GROUPS[slot.accepts];

/** Widths at which a board takes its spread's medium and narrow grids. */
export const MEDIUM = 1300;
export const NARROW = 760;
export const gridFor = (spread: Spread, width: number): Grid => (width < NARROW ? spread.narrow : width < MEDIUM ? spread.medium ?? spread.wide : spread.wide);

/** Gutters and the board's inner margin per style, px. */
export const GUTTER: Record<string, number> = { editorial: 40, field: 34, instrument: 16 };

/**
 * The spread's grid for the slots that are filled: empty slots handed to a
 * neighbour (when that keeps it a rectangle) or blanked, then blank rows
 * and columns dropped.
 */
export function resolveGrid(spread: Spread, grid: Grid, filled: ReadonlySet<string>): Grid {
  const cells = grid.areas.map((row) => row.trim().split(/\s+/));
  const cellsOf = (name: string) => cells.flatMap((row, r) => row.flatMap((cell, c) => (cell === name ? [[r, c] as const] : [])));
  const rect = (list: readonly (readonly [number, number])[]) => {
    if (!list.length) return false;
    const rs = list.map(([r]) => r), cs = list.map(([, c]) => c);
    const r0 = Math.min(...rs), r1 = Math.max(...rs), c0 = Math.min(...cs), c1 = Math.max(...cs);
    return (r1 - r0 + 1) * (c1 - c0 + 1) === list.length;
  };
  for (let pass = 0, changed = true; changed && pass < 8; pass++) {
    changed = false;
    for (const slot of spread.slots) {
      if (filled.has(slot.name)) continue;
      const mine = cellsOf(slot.name);
      if (!mine.length) continue;
      const target = (slot.absorb ?? []).find((other) => filled.has(other) && cellsOf(other).length && rect([...cellsOf(other), ...mine]));
      if (!target && pass < 7) continue; // a later pass may grow a neighbour that fits
      for (const [r, c] of mine) cells[r]![c] = target ?? ".";
      changed = true;
    }
  }
  // Anything left over is blank.
  for (const row of cells) row.forEach((cell, c) => { if (cell !== "." && !filled.has(cell)) row[c] = "."; });
  const keepRows = cells.map((row) => row.some((cell) => cell !== "."));
  const keepCols = cells[0]!.map((_, c) => cells.some((row) => row[c] !== "."));
  return {
    cols: grid.cols.filter((_, c) => keepCols[c]),
    rows: grid.rows.filter((_, r) => keepRows[r]),
    areas: cells.filter((_, r) => keepRows[r]).map((row) => row.filter((_, c) => keepCols[c]).join(" ")),
  };
}

export interface Area { name: string; r0: number; r1: number; c0: number; c1: number }
export function areasOf(grid: Grid): Area[] {
  const out = new Map<string, Area>();
  grid.areas.forEach((row, r) => row.trim().split(/\s+/).forEach((name, c) => {
    if (name === ".") return;
    const a = out.get(name);
    if (!a) out.set(name, { name, r0: r, r1: r, c0: c, c1: c });
    else { a.r0 = Math.min(a.r0, r); a.r1 = Math.max(a.r1, r); a.c0 = Math.min(a.c0, c); a.c1 = Math.max(a.c1, c); }
  }));
  return [...out.values()];
}

export interface SlotRect { x: number; y: number; w: number; h: number }

/**
 * The slots' rects on a board this wide and tall. heights: the content
 * height per slot (what sits in it), for auto rows and for growing a slot
 * whose content is taller than its share of the screen.
 */
export function placeSlots(grid: Grid, width: number, height: number, gutter: number, heights: ReadonlyMap<string, number>): Map<string, SlotRect> {
  const areas = areasOf(grid);
  const nc = grid.cols.length, nr = grid.rows.length;
  const fr = grid.cols.reduce((sum, c) => sum + c, 0);
  const colW = grid.cols.map((c) => ((width - gutter * (nc - 1)) * c) / fr);
  const colX = colW.map((_, i) => colW.slice(0, i).reduce((sum, w) => sum + w, 0) + gutter * i);
  // Auto rows: as tall as the tallest piece that sits only in them; empty ones collapse with their gutter.
  const rowH = grid.rows.map((row, r) => (row === "auto" ? Math.max(0, ...areas.filter((a) => a.r0 === r && a.r1 === r).map((a) => heights.get(a.name) ?? 0)) : 0));
  const live = (r: number) => grid.rows[r] !== "auto" || rowH[r]! > 0;
  const gaps = Math.max(0, grid.rows.filter((_, r) => live(r)).length - 1) * gutter;
  const autoSum = rowH.reduce((sum, h) => sum + h, 0);
  const frSum = grid.rows.reduce<number>((sum, row) => sum + (row === "auto" ? 0 : row), 0);
  const free = Math.max(0, height - autoSum - gaps);
  grid.rows.forEach((row, r) => { if (row !== "auto") rowH[r] = frSum ? (free * row) / frSum : 0; });
  const span = (a: Area) => {
    let h = 0, first = true;
    for (let r = a.r0; r <= a.r1; r++) { if (!live(r)) continue; h += rowH[r]! + (first ? 0 : gutter); first = false; }
    return h;
  };
  // A piece taller than its slot grows the slot's last row (top to bottom, so growth carries down).
  for (const a of [...areas].sort((x, y) => x.r1 - y.r1 || x.c0 - y.c0)) {
    const need = (heights.get(a.name) ?? 0) - span(a);
    if (need > 0.5) rowH[a.r1] = rowH[a.r1]! + need;
  }
  const rowY: number[] = [];
  let y = 0;
  grid.rows.forEach((_, r) => { rowY[r] = y; if (live(r)) y += rowH[r]! + gutter; });
  const out = new Map<string, SlotRect>();
  for (const a of areas) {
    const x = colX[a.c0]!;
    const w = colX[a.c1]! + colW[a.c1]! - x;
    out.set(a.name, { x: Math.round(x), y: Math.round(rowY[a.r0]!), w: Math.round(w), h: Math.round(span(a)) });
  }
  return out;
}

/** What's wrong with these slots for this spread, or null: unknown names (or too many pieces), kinds a slot doesn't take, required slots left empty. */
export function checkSlots(spread: Spread, slots: Record<string, { kind: CanvasKind }>, requireAll = true): string | null {
  const names = new Set(spread.slots.map((slot) => slot.name));
  const given = Object.keys(slots);
  const unknown = given.filter((name) => !names.has(name));
  if (unknown.length) {
    if (given.length > spread.slots.length || unknown.every((name) => /\d+$/.test(name))) {
      const roomier = SPREADS.filter((other) => other.slots.length >= given.length && other.id !== spread.id).map((other) => `${other.id} (${other.slots.length} slots)`);
      return `${spread.id} has room for ${spread.slots.length} pieces (${[...names].join(", ")}); this board has more (${unknown.join(", ")}). Cut it down, or use a roomier spread: ${roomier.join(", ") || "none: cut it down"}.`;
    }
    return `${spread.id} has no slot ${unknown.map((name) => `"${name}"`).join(", ")}. Its slots: ${spread.slots.map((slot) => `${slot.name}${slot.required ? " (required)" : ""}`).join(", ")}.`;
  }
  for (const [name, item] of Object.entries(slots)) {
    const slot = spread.slots.find((each) => each.name === name)!;
    if (!accepts(slot, item.kind)) return `${spread.id}'s ${name} slot takes ${acceptedKinds(slot).join(", ")}, not ${item.kind}.`;
  }
  if (requireAll) {
    const missing = spread.slots.filter((slot) => slot.required && !slots[slot.name]).map((slot) => slot.name);
    if (missing.length) return `${spread.id} needs ${missing.join(" and ")} filled (${missing.map((name) => spread.slots.find((slot) => slot.name === name)!.role).join("; ")}).`;
  }
  return null;
}

/** The spreads for the agent: each one's use and its slots. */
export function spreadHelp(): string {
  return SPREADS.map((spread) => `- ${spread.id} (${spread.name}): ${spread.use}. Slots: ${spread.slots.map((slot) => `${slot.name}${slot.required ? "*" : ""} (${slot.role}; ${slot.accepts})`).join(", ")}.`).join("\n");
}
