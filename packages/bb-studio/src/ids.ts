// Constants the UI imports at runtime. Kept apart from contract.ts, which
// imports @get-bb/plugin-sdk: BB installs plugins without devDependencies, so
// the frontend bundle can't resolve the SDK.

/** Realtime channel for the sidebar's tabs; payload `{}`. */
export const TABS_CHANNEL = "studio-tabs";

/** Realtime channel for agents' commands to one window's workspace; payload a WorkspaceCommand (src/workspace-presence.ts). */
export const WORKSPACE_CHANNEL = "studio-workspace";

/** Window event that opens or closes Studio search; no detail. */
export const QUICK_OPEN_EVENT = "bb-studio:quick-open";

/** Window event that makes a space: Studio's New space dialog; no detail. */
export const NEW_SPACE_EVENT = "studio:new-space";

/**
 * Window event that opens one of a space's dialogs from anywhere, such as the
 * Space's ⋯ menu in Studio Sidebar; detail `{ spaceId, dialog }`, where dialog
 * is "edit", "delete", "threads", "projects" or "heartbeat" (lead and
 * heartbeat). Dispatch it cancelable: Studio cancels it when it opens one.
 */
export const SPACE_DIALOG_EVENT = "studio:space-dialog";

/**
 * Window event that opens the Chief of Staff's heartbeat dialog from anywhere,
 * such as the Chief of Staff row's menu in Studio Sidebar; no detail. Dispatch
 * it cancelable: Studio cancels it when it opens the dialog.
 */
export const CHIEF_DIALOG_EVENT = "studio:chief-dialog";

/** Window event after a space dialog changes the space; detail `{ spaceId }`. */
export const SPACE_CHANGED_EVENT = "studio:space-changed";
