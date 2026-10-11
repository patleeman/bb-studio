// Names and paths the server and the app share.

/**
 * Drawings are built into Studio, but keep the id of the plugin they came
 * from: items stay `excalidraw:<id>` in Studio's tables, mentions and links.
 */
export const PLUGIN_ID = "excalidraw";
/** Studio's panel sub-path: /plugins/studio/studio/drawings/<id> shows one drawing. */
export const ROUTE_SEGMENT = "drawings";
export const DRAW_ICON = "studio/draw";
/** Realtime channel: the server pushes scene updates to open editors. */
export const REALTIME_CHANNEL = "excalidraw";
export const DRAWING_UPDATE_TYPE = "drawing:updated";
/** The Drawings workbench tab's action id; reply cards open it with `{ drawingId }`. */
export const DRAWINGS_TAB = "excalidraw";
/** The composer `+` menu's picker, rendered in place of the composer. */
export const PICKER_ID = "excalidraw-picker";

export function drawingHref(id: string): string {
  return `/plugins/studio/studio/${ROUTE_SEGMENT}/${encodeURIComponent(id)}`;
}

/** `v` changes with every revision, so the thumbnail can cache forever. */
export function thumbnailUrl(id: string, updatedAt: number): string {
  return `/api/v1/plugins/studio/http/${ROUTE_SEGMENT}/thumbnail?drawing=${encodeURIComponent(id)}&v=${updatedAt}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDrawingId(value: string): boolean {
  return UUID.test(value) || /^drw_[0-9a-f]{16}$/.test(value);
}
