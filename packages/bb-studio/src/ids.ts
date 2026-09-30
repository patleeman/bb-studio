// Constants the UI imports at runtime. Kept apart from contract.ts, which
// imports @get-bb/plugin-sdk: BB installs plugins without devDependencies, so
// the frontend bundle can't resolve the SDK.

/** Realtime channel for the sidebar's tabs; payload `{}`. */
export const TABS_CHANNEL = "studio-tabs";

/** Window event that opens or closes Studio search; no detail. */
export const QUICK_OPEN_EVENT = "bb-studio:quick-open";
