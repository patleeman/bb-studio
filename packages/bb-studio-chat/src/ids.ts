// Constants the UI imports at runtime. Kept apart from contract.ts, which
// imports @get-bb/plugin-sdk: BB installs plugins without devDependencies, so
// the frontend bundle can't resolve the SDK.

/** The mention provider whose pills name a Studio item; item ids are `<plugin>:<id>`. */
export const MENTION_PROVIDER_ID = "item";
