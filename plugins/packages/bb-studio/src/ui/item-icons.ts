// Icon names for item kinds, with no React: see item-row.tsx for the drawn icon.
export const THREAD_KIND = "thread";

/** BB icon names for kinds, for surfaces BB draws itself (its search palette). */
const HOST_GLYPH: Record<string, string> = { thread: "MessageSquare", page: "FileText", drawing: "Edit", mini: "AppWindow", design: "Palette" };

/** The icon BB should draw for a kind: an emoji when the item has one, else a BB icon name. */
export function hostIcon(kind: string, emoji?: string | null): string {
  return emoji || HOST_GLYPH[kind] || "FileText";
}

/**
 * A tab's icon from its params, where BB asks (`experimental_instanceIcon`):
 * the kind's glyph, so a page tab and a board tab look like what they hold.
 */
export function itemTabIcon(params: unknown): string | null {
  const kind = typeof params === "object" && params !== null && !Array.isArray(params) ? (params as { kind?: unknown }).kind : null;
  return typeof kind === "string" && HOST_GLYPH[kind] ? HOST_GLYPH[kind] : null;
}

/** Extra tab registration fields for a BB that takes them; a BB without them ignores the field. */
export const ITEM_TAB_ICON: object = { experimental_instanceIcon: itemTabIcon };
