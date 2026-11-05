// Where the quick card sits and how big it is. The position is kept as a
// share of the free space on each axis (0 = the left or top edge, 1 = the
// right or bottom edge), so the card keeps its corner when the window
// resizes and can never end up off screen. The size is kept in pixels once
// the user has resized it; until then it follows the window (about 40% of
// it). Each window remembers its own (sessionStorage); a new window starts
// from the last one saved anywhere (localStorage).
// Until it's been moved or resized, the card sits bottom right but above
// any BB composer under it (BB marks each with data-app-composer), so it
// never covers the thread's composer; with no composer on screen it keeps
// a safe margin from the bottom. Where the user put it always wins.

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

/**
 * The card's place before the user has moved or resized it: bottom right,
 * ending above the highest composer it would overlap (`composers`, their
 * rectangles on screen), else SAFE_BOTTOM above the window's bottom. It
 * gets shorter to fit, down to its minimum.
 */
export function defaultRect(viewport: Viewport, composers: readonly Rect[]): Rect {
  const base = cardRect(DEFAULT_GEOMETRY, viewport);
  const visible = composers.filter((each) => each.width > 0 && each.height > 0 && each.top < viewport.height && each.top + each.height > 0);
  const under = visible.filter((each) => each.left < base.left + base.width && each.left + each.width > base.left);
  const minH = Math.min(MIN_HEIGHT, Math.max(0, viewport.height - 2 * MARGIN));
  const floor = under.length ? Math.min(...under.map((each) => each.top)) - COMPOSER_GAP : visible.length ? viewport.height - MARGIN : viewport.height - SAFE_BOTTOM;
  const bottom = clamp(Math.round(floor), MARGIN + minH, viewport.height - MARGIN);
  const height = clamp(base.height, minH, bottom - MARGIN);
  return { left: base.left, top: bottom - height, width: base.width, height };
}

/** Where the card goes: where the user put it (`saved`), else its default place above the composers. */
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
