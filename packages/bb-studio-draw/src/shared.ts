// Names and paths the server and the app share.

export const PLUGIN_ID = "excalidraw";
/** The nav panel: /plugins/excalidraw/drawings, and drawings/<id> for one drawing. */
export const PANEL_PATH = "drawings";
export const DRAW_ICON = "excalidraw/draw";
/** Realtime channel: the server pushes scene updates to open editors. */
export const REALTIME_CHANNEL = "excalidraw";
export const DRAWING_UPDATE_TYPE = "drawing:updated";

export function drawingHref(id: string): string {
  return `/plugins/${PLUGIN_ID}/${PANEL_PATH}/${id}`;
}

/** `v` changes with every revision, so the thumbnail can cache forever. */
export function thumbnailUrl(id: string, updatedAt: number): string {
  return `/api/v1/plugins/${PLUGIN_ID}/http/thumbnail?drawing=${encodeURIComponent(id)}&v=${updatedAt}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDrawingId(value: string): boolean {
  return UUID.test(value);
}
