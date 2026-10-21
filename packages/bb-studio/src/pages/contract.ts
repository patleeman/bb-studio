// Pages' RPC surface, in the kit (`@bb-studio/kit/pages-contract`) so the
// iOS app's generated contract matches it. Methods are Studio's `pages.*`.
// Document content doesn't go through RPC: editors sync over `/pages/sync`
// (src/pages/hub.ts).
export * from "./constants";
export * from "../kit/pages-contract";
