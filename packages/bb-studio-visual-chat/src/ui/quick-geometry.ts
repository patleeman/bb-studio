// Where the quick card sits and how big it is. The position is kept as a
// share of the free space on each axis (0 = the left or top edge, 1 = the
// right or bottom edge), so the card keeps its corner when the window
// resizes and can never end up off screen. The size is kept in pixels once
// the user has resized it; until then it follows the window (about 40% of
// it). Each window remembers its own (sessionStorage); a new window starts
// from the last one saved anywhere (localStorage).
// Until it's been moved or resized, the card sits at the right edge and
// never touches a BB composer on screen (BB marks each with
// data-app-composer): above a thread's composer at the bottom, below the
// home page's near the top, else beside or shorter; with no composer on
// screen it keeps a safe margin from the bottom. Where the user put it
// always wins.

export interface Viewport { width: number; height: number }
export interface Rect { left: number; top: number; width: number; height: number }
export interface QuickGeometry {
  x: number;
  y: number;
  /** null: not resized yet, so the size follows the window. */
  width: number | null;
  height: number | null;
}
/** Which edges a resize moves: -1 the left or top edge, 1 the right or bottom one, 0 neither. */
export interface Edge { x: -1 | 0 | 1; y: -1 | 0 | 1 }

export const QUICK_GEOMETRY_KEY = "bb-studio-visual-chat:quick-card";
export const MARGIN = 12;
export const MIN_WIDTH = 340;
export const MIN_HEIGHT = 320;
/** Bottom right, sized to the window. */
export const DEFAULT_GEOMETRY: QuickGeometry = { x: 1, y: 1, width: null, height: null };
/** The space between the card and the top of a composer it sits above. */
export const COMPOSER_GAP = 12;
/** The default place stays below the page's header bar (its title and buttons) when there's room. */
export const SAFE_TOP = 56;
/** How short the default place may get, below MIN_HEIGHT, before it would cover a composer: a header and the chat line. */
export const SQUEEZED_HEIGHT = 200;
/** How far above the window's bottom the card's default place ends when no composer is on screen. */
export const SAFE_BOTTOM = 72;
/** BB's composers (its own APP_COMPOSER_SELECTOR); a follow-up composer's queue banner is inside it. */
export const COMPOSER_SELECTOR = "[data-app-composer]";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const clamp01 = (value: number) => (Number.isFinite(value) ? clamp(value, 0, 1) : 1);

/** The size the card takes before it's resized: about 40% of the window. */
export function defaultSize(viewport: Viewport): { width: number; height: number } {
  return {
    width: Math.round(clamp(viewport.width * 0.4, 380, 760)),
    height: Math.round(clamp(viewport.height * 0.7, 420, 900)),
  };
}

/** A size that fits the window: at least the minimum (unless the window is smaller), at most the window less its margins. */
function fit(width: number, height: number, viewport: Viewport) {
  const roomW = Math.max(0, viewport.width - 2 * MARGIN);
  const roomH = Math.max(0, viewport.height - 2 * MARGIN);
  return { width: Math.round(clamp(width, Math.min(MIN_WIDTH, roomW), roomW)), height: Math.round(clamp(height, Math.min(MIN_HEIGHT, roomH), roomH)) };
}

/** The card's rectangle in this window. */
export function cardRect(geometry: QuickGeometry, viewport: Viewport): Rect {
  const base = defaultSize(viewport);
  const { width, height } = fit(geometry.width ?? base.width, geometry.height ?? base.height, viewport);
  const freeW = Math.max(0, viewport.width - 2 * MARGIN - width);
  const freeH = Math.max(0, viewport.height - 2 * MARGIN - height);
  return { left: Math.round(MARGIN + clamp01(geometry.x) * freeW), top: Math.round(MARGIN + clamp01(geometry.y) * freeH), width, height };
}

/** The stretches of [low, high] that none of `blocked` covers, top to bottom. */
function freeSpans(low: number, high: number, blocked: readonly [number, number][]): [number, number][] {
  const spans: [number, number][] = [];
  let from = low;
  for (const [top, bottom] of [...blocked].sort((a, b) => a[0] - b[0])) {
    if (top > from) spans.push([from, Math.min(top, high)]);
    from = Math.max(from, bottom);
    if (from >= high) break;
  }
  if (from < high) spans.push([from, high]);
  return spans.filter(([top, bottom]) => bottom > top);
}

const overlaps = (a: Rect, b: Rect) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

/**
 * The card's place before the user has moved or resized it. It never
 * touches a composer on screen (`composers`, their rectangles), keeping
 * COMPOSER_GAP from each, and stays below the page's header (SAFE_TOP). In order:
 * 1. Full size at the right edge, as low as it fits: under a composer that
 *    sits high (the home page's), above one at the bottom (a thread's).
 * 2. Full height at the bottom right, narrower, to the right of every composer.
 * 3. Shorter, in the tallest free stretch of the right edge (down to
 *    SQUEEZED_HEIGHT, below its usual minimum, rather than cover a composer).
 * With no composer on screen it ends SAFE_BOTTOM above the window's bottom.
 * Only a window too small for any of these gets the plain bottom-right place.
 */
export function defaultRect(viewport: Viewport, composers: readonly Rect[]): Rect {
  const base = cardRect(DEFAULT_GEOMETRY, viewport);
  const visible = composers.filter((each) => each.width > 0 && each.height > 0 && each.top < viewport.height && each.top + each.height > 0 && each.left < viewport.width && each.left + each.width > 0);
  const minH = Math.min(MIN_HEIGHT, Math.max(0, viewport.height - 2 * MARGIN));
  const minW = Math.min(MIN_WIDTH, Math.max(0, viewport.width - 2 * MARGIN));
  const right = viewport.width - MARGIN;
  const top = Math.min(SAFE_TOP, Math.max(MARGIN, viewport.height - MARGIN - minH));
  const bottom = viewport.height - (visible.length ? MARGIN : SAFE_BOTTOM);
  // Each composer with its gap around it.
  const keepOut = visible.map((each) => ({ left: each.left - COMPOSER_GAP, top: each.top - COMPOSER_GAP, width: each.width + 2 * COMPOSER_GAP, height: each.height + 2 * COMPOSER_GAP }));
  const column = { left: base.left, top: 0, width: base.width, height: viewport.height };
  const spans = freeSpans(top, bottom, keepOut.filter((each) => overlaps(each, column)).map((each) => [each.top, each.top + each.height]));
  // 1. Full size, as low as it fits.
  const fits = spans.filter(([from, to]) => to - from >= base.height).at(-1);
  if (fits) return { left: base.left, top: Math.round(fits[1] - base.height), width: base.width, height: base.height };
  // 2. To the right of the composers, full height.
  const height = Math.max(minH, Math.min(base.height, bottom - top));
  const tall = { left: 0, top: bottom - height, width: viewport.width, height };
  const beside = keepOut.filter((each) => overlaps(each, tall));
  const edge = beside.length ? Math.max(...beside.map((each) => each.left + each.width)) : right - base.width;
  const width = Math.min(base.width, right - edge);
  if (width >= minW) return { left: Math.round(right - width), top: Math.round(bottom - height), width: Math.round(width), height: Math.round(height) };
  // 3. Shorter, in the tallest free stretch (the lower one on a tie).
  const roomiest = spans.reduce<[number, number] | null>((best, span) => (!best || span[1] - span[0] >= best[1] - best[0] ? span : best), null);
  if (roomiest && roomiest[1] - roomiest[0] >= Math.min(minH, SQUEEZED_HEIGHT)) return { left: base.left, top: Math.round(roomiest[0]), width: base.width, height: Math.round(roomiest[1] - roomiest[0]) };
  // A window too small for any of these.
  return { left: base.left, top: Math.max(MARGIN, viewport.height - MARGIN - minH), width: base.width, height: minH };
}

/** Where the card goes: where the user put it (`saved`), else its default place, clear of the composers. */
export function placeCard(saved: QuickGeometry | null, viewport: Viewport, composers: readonly Rect[]): Rect {
  return saved ? cardRect(saved, viewport) : defaultRect(viewport, composers);
}

/** The geometry to keep for a rectangle on screen; `sized`: the user has resized it, so its size is kept too. */
export function geometryOf(rect: Rect, viewport: Viewport, sized: boolean): QuickGeometry {
  const freeW = viewport.width - 2 * MARGIN - rect.width;
  const freeH = viewport.height - 2 * MARGIN - rect.height;
  return {
    x: freeW <= 0 ? 1 : clamp01((rect.left - MARGIN) / freeW),
    y: freeH <= 0 ? 1 : clamp01((rect.top - MARGIN) / freeH),
    width: sized ? rect.width : null,
    height: sized ? rect.height : null,
  };
}

/** The card dragged by (dx, dy) from where it started, kept inside the window. */
export function movedRect(start: Rect, dx: number, dy: number, viewport: Viewport): Rect {
  return {
    ...start,
    left: Math.round(clamp(start.left + dx, MARGIN, Math.max(MARGIN, viewport.width - MARGIN - start.width))),
    top: Math.round(clamp(start.top + dy, MARGIN, Math.max(MARGIN, viewport.height - MARGIN - start.height))),
  };
}

/** The card resized by dragging `edge` by (dx, dy): the opposite edges stay put, and it stays inside the window and above the minimum. */
export function resizedRect(start: Rect, edge: Edge, dx: number, dy: number, viewport: Viewport): Rect {
  let { left, top, width, height } = start;
  const right = left + width;
  const bottom = top + height;
  const minW = Math.min(MIN_WIDTH, viewport.width - 2 * MARGIN);
  const minH = Math.min(MIN_HEIGHT, viewport.height - 2 * MARGIN);
  if (edge.x === 1) width = clamp(width + dx, minW, viewport.width - MARGIN - left);
  if (edge.x === -1) { left = clamp(left + dx, MARGIN, right - minW); width = right - left; }
  if (edge.y === 1) height = clamp(height + dy, minH, viewport.height - MARGIN - top);
  if (edge.y === -1) { top = clamp(top + dy, MARGIN, bottom - minH); height = bottom - top; }
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
function stores(): StorageLike[] {
  const found: StorageLike[] = [];
  try { if (typeof sessionStorage !== "undefined") found.push(sessionStorage); } catch { /* storage off */ }
  try { if (typeof localStorage !== "undefined") found.push(localStorage); } catch { /* storage off */ }
  return found;
}

function parse(raw: string | null): QuickGeometry | null {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<QuickGeometry> | null;
    if (typeof value?.x !== "number" || typeof value.y !== "number" || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
    const size = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null);
    const width = size(value.width);
    const height = size(value.height);
    return { x: clamp01(value.x), y: clamp01(value.y), width: width && height ? width : null, height: width && height ? height : null };
  } catch {
    return null;
  }
}

/** This window's geometry, else the last one saved in any window; null: never moved or resized (the default place). */
export function loadGeometry(storages: StorageLike[] = stores()): QuickGeometry | null {
  for (const storage of storages) {
    try {
      const found = parse(storage.getItem(QUICK_GEOMETRY_KEY));
      if (found) return found;
    } catch { /* storage off */ }
  }
  return null;
}

export function saveGeometry(geometry: QuickGeometry, storages: StorageLike[] = stores()): void {
  const raw = JSON.stringify(geometry);
  for (const storage of storages) {
    try { storage.setItem(QUICK_GEOMETRY_KEY, raw); } catch { /* unsaved: it still applies until the window closes */ }
  }
}
