// The Spaces panel: /plugins/studio/spaces/<spaceId> opens a Space (its lead,
// with the page and overview in the workbench).
export const SPACES_PANEL = "spaces";

export function spaceViewHref(spaceId: string): string {
  return `/plugins/studio/${SPACES_PANEL}/${encodeURIComponent(spaceId)}`;
}

export function spaceIdOf(subPath: string): string | null {
  const first = subPath.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
  if (!first) return null;
  try { return decodeURIComponent(first); } catch { return first; }
}
