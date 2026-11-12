// Where the design canvas opens and how it remembers the view, with no React
// in it (canvas-view.test.ts). A design opens at 100% on its first section
// (the newest round, at the top); "Fit" is a choice the user makes. The zoom
// and position the user leaves a design at are kept per design in this
// browser, for the last VIEWS_MAX designs, and restored when it opens again.

export type View = { x: number; y: number; scale: number };
export type Size = { width: number; height: number };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 2;
export const FIT_PADDING = 64;
/** Room for the floating controls above the content. */
export const FIT_TOP = 72;

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/**
 * How the canvas places its content when the content or the viewport changes:
 * "first" keeps the first section at the top-left at its scale (the default),
 * "fit" keeps everything in view, and "user" leaves the view where the user put it.
 */
export type ViewMode = "first" | "fit" | "user";

/** The whole board in view, never above 100%. */
export function fitView(box: Size, content: Size): View {
  const scale = clampScale(Math.min(1, (box.width - FIT_PADDING * 2) / content.width, (box.height - FIT_TOP - FIT_PADDING) / content.height));
  return {
    scale,
    x: Math.max(FIT_PADDING, (box.width - content.width * scale) / 2),
    y: Math.max(FIT_TOP, (box.height - content.height * scale) / 2),
  };
}

/** The first section (the top of the board) at `scale`, 100% by default: at the left, or centred when the board is narrower than the viewport. */
export function firstSectionView(box: Size, content: Size, scale = 1): View {
  const width = content.width * scale;
  return { scale, x: width + FIT_PADDING * 2 <= box.width ? (box.width - width) / 2 : FIT_PADDING, y: FIT_TOP };
}

/** A design's remembered view. `layout` is the board's shape when it was saved (the canvas's fitKey). */
export type SavedView = View & { fit: boolean; layout: string; at: number };

export const VIEWS_KEY = "studio.design.views";
/** Designs whose view is remembered; the least recently saved go first. */
export const VIEWS_MAX = 50;

/** Where a design opens: its remembered view, else 100% on the first section. */
export function openingView(saved: SavedView | undefined, layout: string, box: Size, content: Size): { mode: ViewMode; view: View } {
  if (!saved) return { mode: "first", view: firstSectionView(box, content) };
  if (saved.fit) return { mode: "fit", view: fitView(box, content) };
  const scale = clampScale(saved.scale);
  // Rounds were added or removed since: the old position points elsewhere, so keep only the zoom.
  if (saved.layout !== layout) return { mode: "user", view: firstSectionView(box, content, scale) };
  return { mode: "user", view: { scale, x: saved.x, y: saved.y } };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function parseSaved(value: unknown): SavedView | null {
  if (!value || typeof value !== "object") return null;
  const each = value as Record<string, unknown>;
  if (!finite(each.scale) || each.scale <= 0 || !finite(each.x) || !finite(each.y) || !finite(each.at)) return null;
  return { scale: each.scale, x: each.x, y: each.y, fit: each.fit === true, layout: typeof each.layout === "string" ? each.layout : "", at: each.at };
}

/** The stored views by design id; entries that don't parse are dropped. */
export function parseSavedViews(raw: string | null | undefined): Record<string, SavedView> {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const views: Record<string, SavedView> = {};
    for (const [id, each] of Object.entries(value)) {
      const saved = parseSaved(each);
      if (saved) views[id] = saved;
    }
    return views;
  } catch { return {}; }
}

/** `views` with `id`'s view set, keeping the `max` most recently saved. */
export function rememberView(views: Record<string, SavedView>, id: string, saved: SavedView, max = VIEWS_MAX): Record<string, SavedView> {
  const entries = Object.entries({ ...views, [id]: saved }).sort((a, b) => b[1].at - a[1].at).slice(0, max);
  return Object.fromEntries(entries);
}

export function readSavedView(id: string): SavedView | undefined {
  try { return parseSavedViews(localStorage.getItem(VIEWS_KEY))[id]; } catch { return undefined; }
}

export function storeSavedView(id: string, saved: SavedView): void {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(rememberView(parseSavedViews(localStorage.getItem(VIEWS_KEY)), id, saved))); } catch { /* storage refused */ }
}
