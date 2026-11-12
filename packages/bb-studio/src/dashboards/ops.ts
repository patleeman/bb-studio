// Edits to a dashboard: add, move, resize, remove and update widgets. Pure
// functions over the document, shared by the app's edits, agent tools and
// tests. The grid compacts upward like react-grid-layout's vertical compactor,
// so a layout the server writes is the one the app shows.
import {
  BREAKPOINT_NAMES,
  COLS,
  LIMITS,
  WIDGETS,
  jsonBytes,
  normalizeSource,
  type Breakpoint,
  type DashboardDoc,
  type LayoutItem,
  type Layouts,
  type Op,
  type Widget,
  type WidgetType,
} from "./shared";

export interface OpContext {
  /** A new widget id. */
  newId(): string;
  /** Whether a library type exists. */
  hasType(id: string): boolean;
}

const collides = (a: LayoutItem, b: LayoutItem) => a.i !== b.i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Moves every item up as far as it goes, top to bottom. */
export function compact(layout: readonly LayoutItem[]): LayoutItem[] {
  const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: LayoutItem[] = [];
  for (const item of sorted) {
    const next = { ...item };
    while (next.y > 0 && !placed.some((other) => collides({ ...next, y: next.y - 1 }, other))) next.y -= 1;
    while (placed.some((other) => collides(next, other))) next.y += 1;
    placed.push(next);
  }
  return placed;
}

/** Keeps an item inside the grid's columns. */
function clampTo(item: LayoutItem, cols: number): LayoutItem {
  const w = Math.min(Math.max(1, item.w), cols);
  return { ...item, w, x: Math.min(Math.max(0, item.x), cols - w) };
}

/** The first free spot for a w×h item, scanning rows top to bottom. */
export function firstFit(layout: readonly LayoutItem[], w: number, h: number, cols: number): { x: number; y: number } {
  const width = Math.min(w, cols);
  const bottom = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + width <= cols; x++) {
      const probe = { i: "\u0000", x, y, w: width, h };
      if (!layout.some((item) => collides(probe, item))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/** Puts `item` where it is, pushing anything it overlaps below it, then compacts. */
export function placeAt(layout: readonly LayoutItem[], item: LayoutItem, cols: number): LayoutItem[] {
  const moved = clampTo(item, cols);
  const others = layout.filter((each) => each.i !== moved.i).map((each) => ({ ...each }));
  // Push overlapping items down, repeatedly, so a push never lands on another item.
  const fixed = [moved];
  const queue = others.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const other of queue) {
    while (fixed.some((each) => collides(other, each))) {
      const blocker = fixed.find((each) => collides(other, each))!;
      other.y = blocker.y + blocker.h;
    }
    fixed.push(other);
  }
  // The moved item keeps its row; the rest compact around it.
  return compactAround(fixed, moved.i);
}

/** Compacts, but keeps `pinned` exactly where it is. */
function compactAround(layout: LayoutItem[], pinned: string): LayoutItem[] {
  const anchor = layout.find((item) => item.i === pinned)!;
  const rest = layout.filter((item) => item.i !== pinned).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: LayoutItem[] = [anchor];
  for (const item of rest) {
    const next = { ...item };
    while (next.y > 0 && !placed.some((other) => collides({ ...next, y: next.y - 1 }, other))) next.y -= 1;
    while (placed.some((other) => collides(next, other))) next.y += 1;
    placed.push(next);
  }
  return placed;
}

/**
 * A size on the 12-column grid, at another breakpoint: on md a tile is at
 * least half the width (rounded up), on sm every tile is full width.
 */
export function scaleWidth(w: number, breakpoint: Breakpoint): number {
  const cols = COLS[breakpoint];
  if (breakpoint === "lg") return Math.min(cols, w);
  if (breakpoint === "sm") return cols;
  return Math.min(cols, Math.max(Math.ceil(cols / 2), Math.ceil((w * cols) / COLS.lg)));
}

/** The width older versions derived md and sm tiles with (a straight scale). */
const legacyWidth = (w: number, breakpoint: Breakpoint) => Math.min(COLS[breakpoint], Math.max(breakpoint === "sm" ? 2 : 1, Math.round((w * COLS[breakpoint]) / COLS.lg)));

/** An md or sm layout derived from lg: tiles in lg reading order, widened, packed top to bottom. */
export function deriveLayout(lg: readonly LayoutItem[], breakpoint: Breakpoint): LayoutItem[] {
  if (breakpoint === "lg") return lg.map((item) => ({ ...item }));
  const cols = COLS[breakpoint];
  const placed: LayoutItem[] = [];
  for (const item of [...lg].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const w = scaleWidth(item.w, breakpoint);
    // Never above the tile before it, so reading order holds.
    const last = placed.at(-1);
    const fit = firstFit(placed, w, item.h, cols);
    const pos = last && (fit.y < last.y || (fit.y === last.y && fit.x < last.x)) ? firstFitFrom(placed, w, item.h, cols, last) : fit;
    placed.push({ i: item.i, ...pos, w, h: item.h });
  }
  return placed;
}

function firstFitFrom(layout: readonly LayoutItem[], w: number, h: number, cols: number, after: LayoutItem): { x: number; y: number } {
  const bottom = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (let y = after.y; y <= bottom; y++) {
    for (let x = y === after.y ? after.x + after.w : 0; x + w <= cols; x++) {
      const probe = { i: "\u0000", x, y, w, h };
      if (!layout.some((item) => collides(probe, item))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/**
 * The layouts to show. md and sm layouts that older versions derived from lg
 * by straight scaling (narrow, squeezed tiles) are derived again; a layout
 * the user arranged stays as it is.
 */
export function viewLayouts(layouts: Layouts): Layouts {
  const lg = new Map(layouts.lg.map((item) => [item.i, item]));
  const next = { ...layouts };
  for (const breakpoint of ["md", "sm"] as const) {
    const items = layouts[breakpoint];
    const legacy = items.length > 0 && items.every((item) => {
      const source = lg.get(item.i);
      return source !== undefined && item.w === legacyWidth(source.w, breakpoint);
    }) && items.some((item) => item.w !== scaleWidth(lg.get(item.i)!.w, breakpoint));
    if (legacy || (!items.length && layouts.lg.length)) next[breakpoint] = deriveLayout(layouts.lg, breakpoint);
  }
  return next;
}

/** Widgets in grid order: the lg layout, top to bottom, left to right. */
export function gridOrder(doc: DashboardDoc): Widget[] {
  const at = new Map(doc.layouts.lg.map((item) => [item.i, item]));
  return [...doc.widgets].sort((a, b) => {
    const pa = at.get(a.id);
    const pb = at.get(b.id);
    if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
    return pa.y - pb.y || pa.x - pb.x;
  });
}

/** Every widget has exactly one item in each breakpoint's layout, inside the grid. */
export function repairLayouts(doc: DashboardDoc): Layouts {
  const ids = new Set(doc.widgets.map((widget) => widget.id));
  const next = {} as Layouts;
  for (const breakpoint of BREAKPOINT_NAMES) {
    const cols = COLS[breakpoint];
    const seen = new Set<string>();
    const kept: LayoutItem[] = [];
    if (breakpoint !== "lg" && !(doc.layouts[breakpoint] ?? []).length && next.lg.length) {
      next[breakpoint] = deriveLayout(next.lg, breakpoint);
      continue;
    }
    for (const item of doc.layouts[breakpoint] ?? []) {
      if (!ids.has(item.i) || seen.has(item.i)) continue;
      seen.add(item.i);
      kept.push(clampTo(item, cols));
    }
    // Missing items go where they fit, in the order the lg layout has them.
    for (const widget of doc.widgets) {
      if (seen.has(widget.id)) continue;
      const lg = breakpoint === "lg" ? undefined : (next.lg ?? doc.layouts.lg).find((item) => item.i === widget.id);
      const info = WIDGETS[widget.type];
      const w = scaleWidth(lg?.w ?? info.w, breakpoint);
      const h = lg?.h ?? info.h;
      kept.push({ i: widget.id, ...firstFit(kept, w, h, cols), w, h });
    }
    next[breakpoint] = compact(kept);
  }
  return next;
}

function checkWidget(widget: Widget, ctx: OpContext): Widget {
  if (jsonBytes(widget.options) > LIMITS.optionsBytes) throw new Error(`Options are over ${LIMITS.optionsBytes / 1024} KB.`);
  if (widget.html !== null && new TextEncoder().encode(widget.html).length > LIMITS.htmlBytes) throw new Error(`HTML is over ${LIMITS.htmlBytes / 1024} KB.`);
  if (widget.type === "custom") {
    if (widget.customType && !ctx.hasType(widget.customType)) throw new Error(`No widget type ${widget.customType} in the library; define it with widget_define first.`);
    if (!widget.customType && !widget.html?.trim()) throw new Error("A custom widget needs customType (a library type) or html.");
  }
  return { ...widget, source: normalizeSource(widget.source) };
}

/** Merges options: a null value removes the key. */
function mergeOptions(current: Record<string, unknown>, change: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(change)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

export interface OpResult {
  doc: DashboardDoc;
  /** One line per op, for agents. */
  results: string[];
  /** Widgets whose source changed (their cached data no longer applies). */
  sourceChanged: string[];
  added: string[];
  removed: string[];
}

/** Applies ops in order. Throws on the first invalid one, naming it; nothing is applied then. */
export function applyOps(input: DashboardDoc, ops: readonly Op[], ctx: OpContext): OpResult {
  let doc: DashboardDoc = { widgets: input.widgets.map((widget) => ({ ...widget })), layouts: repairLayouts(input) };
  const results: string[] = [];
  const sourceChanged = new Set<string>();
  const added: string[] = [];
  const removed: string[] = [];
  const find = (id: string | undefined, index: number) => {
    const widget = id ? doc.widgets.find((each) => each.id === id) : undefined;
    if (!widget) throw new Error(`Op ${index + 1}: no widget ${id ?? "(widgetId missing)"} on this dashboard.`);
    return widget;
  };
  ops.forEach((op, index) => {
    const fail = (message: string): never => { throw new Error(`Op ${index + 1} (${op.op}): ${message}`); };
    try {
      switch (op.op) {
        case "add": {
          if (!op.type) fail("type is required.");
          if (doc.widgets.length >= LIMITS.widgets) fail(`a dashboard holds at most ${LIMITS.widgets} widgets.`);
          const type = op.type as WidgetType;
          const widget = checkWidget({
            id: ctx.newId(),
            type,
            title: op.title?.trim() || null,
            options: op.options ?? {},
            source: op.source ?? (!WIDGETS[type].usesData ? { kind: "none" } : { kind: "push" }),
            customType: op.customType ?? null,
            html: op.html ?? null,
          }, ctx);
          doc = { ...doc, widgets: [...doc.widgets, widget] };
          const info = WIDGETS[type];
          const layouts = { ...doc.layouts };
          for (const breakpoint of BREAKPOINT_NAMES) {
            const cols = COLS[breakpoint];
            const w = scaleWidth(op.w ?? info.w, breakpoint);
            const h = op.h ?? info.h;
            const explicit = breakpoint === "lg" && op.x !== undefined && op.y !== undefined;
            const item: LayoutItem = { i: widget.id, ...(explicit ? { x: op.x!, y: op.y! } : firstFit(layouts[breakpoint], w, h, cols)), w, h };
            layouts[breakpoint] = explicit ? placeAt(layouts[breakpoint], item, cols) : compact([...layouts[breakpoint], clampTo(item, cols)]);
          }
          doc = { ...doc, layouts };
          added.push(widget.id);
          const lg = layouts.lg.find((item) => item.i === widget.id)!;
          results.push(`Added ${type} widget ${widget.id}${widget.title ? ` "${widget.title}"` : ""} at ${lg.x},${lg.y} (${lg.w}×${lg.h}).`);
          break;
        }
        case "move":
        case "resize": {
          const widget = find(op.widgetId, index);
          const breakpoint = op.breakpoint ?? "lg";
          const cols = COLS[breakpoint];
          const current = doc.layouts[breakpoint].find((item) => item.i === widget.id)!;
          if (op.op === "move" && (op.x === undefined || op.y === undefined)) fail("x and y are required.");
          if (op.op === "resize" && op.w === undefined && op.h === undefined) fail("w or h is required.");
          const item = op.op === "move" ? { ...current, x: op.x!, y: op.y! } : { ...current, w: op.w ?? current.w, h: op.h ?? current.h };
          const layout = placeAt(doc.layouts[breakpoint], item, cols);
          doc = { ...doc, layouts: { ...doc.layouts, [breakpoint]: layout } };
          const now = layout.find((each) => each.i === widget.id)!;
          results.push(`${op.op === "move" ? "Moved" : "Resized"} ${widget.id} in ${breakpoint} to ${now.x},${now.y} (${now.w}×${now.h}).`);
          break;
        }
        case "remove": {
          const widget = find(op.widgetId, index);
          doc = {
            widgets: doc.widgets.filter((each) => each.id !== widget.id),
            layouts: Object.fromEntries(BREAKPOINT_NAMES.map((breakpoint) => [breakpoint, compact(doc.layouts[breakpoint].filter((item) => item.i !== widget.id))])) as Layouts,
          };
          removed.push(widget.id);
          results.push(`Removed ${widget.id}.`);
          break;
        }
        case "update": {
          const widget = find(op.widgetId, index);
          const next = checkWidget({
            ...widget,
            type: op.type ?? widget.type,
            title: op.title === undefined ? widget.title : op.title?.trim() || null,
            options: op.options === undefined ? widget.options : op.replaceOptions ? op.options : mergeOptions(widget.options, op.options),
            source: op.source ?? widget.source,
            customType: op.customType === undefined ? widget.customType : op.customType,
            html: op.html === undefined ? widget.html : op.html,
          }, ctx);
          if (op.source !== undefined && JSON.stringify(next.source) !== JSON.stringify(widget.source)) sourceChanged.add(widget.id);
          doc = { ...doc, widgets: doc.widgets.map((each) => (each.id === widget.id ? next : each)) };
          const changed = (["type", "title", "options", "source", "customType", "html"] as const).filter((key) => op[key] !== undefined);
          results.push(`Updated ${widget.id}: ${changed.join(", ") || "nothing"}.`);
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.startsWith("Op ") ? message : `Op ${index + 1} (${op.op}): ${message}`);
    }
  });
  doc = { ...doc, layouts: repairLayouts(doc) };
  doc = { ...doc, widgets: gridOrder(doc) };
  return { doc, results, sourceChanged: [...sourceChanged], added, removed };
}

/** A layout the app saved after a drag or resize, checked against the widgets. */
export function acceptLayouts(doc: DashboardDoc, layouts: Layouts): DashboardDoc {
  const next = { ...doc, layouts: repairLayouts({ ...doc, layouts }) };
  return { ...next, widgets: gridOrder(next) };
}
