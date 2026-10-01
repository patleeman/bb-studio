// Shared by server and app. Keep runtime-free of server-only imports.

export const PLUGIN_ID = "explore";
export const REALTIME_CHANNEL = "explore";
/** Where explainers are saved. */
export const PAGES_PLUGIN_ID = "pages";

/** An explainer or its job changed. */
export type RealtimeEvent = { type: "explainer"; explainerId: string; threadId: string; messageId: string; parentId: string | null };
