// Shared by server and app. Keep runtime-free of server-only imports.

/**
 * Pages' item namespace: it was the Studio Pages plugin's id, so pages stay
 * `pages:<id>` in Studio's tables, mentions and backups.
 */
export const PLUGIN_ID = "pages";
/** The plugin that serves Pages now: Studio (docs/merging-add-ons.md). */
export const HOST_PLUGIN_ID = "studio";
/** Where a page opens: a Studio tab. The old /plugins/pages/pages/<id> still resolves. */
export const PAGES_ROOT = "/plugins/studio/studio/pages";
export const pagePath = (pageId: string) => `${PAGES_ROOT}/${encodeURIComponent(pageId)}`;
export const REALTIME_CHANNEL = "pages";
export const SYNC_PATH = "/pages/sync";
export const FILES_PATH = "/pages/files";
export const UPLOAD_PATH = "/pages/upload";
/** Mermaid's browser build, fetched the first time a page shows a diagram. */
export const MERMAID_PATH = "/pages/mermaid.js";
/** Studio's HTTP routes for Pages, e.g. `${HTTP_ROOT}/files?id=…`. */
export const HTTP_ROOT = `/api/v1/plugins/${HOST_PLUGIN_ID}/http`;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const HUMAN_USER_ID = "user";
/**
 * Who a `replaceMarkdown` RPC call edits as. RPC calls carry no caller
 * identity, and agent-style keys are what the rest of Pages shows as "an agent".
 */
export const PLUGIN_RPC_ACTOR = "agent:plugin";

export type RealtimeEvent =
  | { type: "tree"; projectId: string | null }
  | { type: "page"; pageId: string }
  | { type: "requests"; pageId: string }
  | { type: "chats"; pageId: string; threadId: string }
  | { type: "deleted"; pageIds: string[] }
  /** A thread's note was made, added to, sent, kept or discarded (src/pages/notes.ts). */
  | { type: "note"; pageId: string; threadId: string };
