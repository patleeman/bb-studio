// What a mini app can ask for, in plain words. Shared by Studio's own
// approval dialog and by the request Studio hands to BB's dialog.

/** What a capability lets the app do, in plain words. */
export function describeCapability(capability: string): string {
  if (capability.startsWith("fetch:")) return `Reach ${capability.slice(6).replace(/^\*\./, "any address under ")} over the internet`;
  if (capability.startsWith("secret:")) return `Send the secret “${capability.slice(7)}” as a request header`;
  if (capability === "bb.threads.read") return "See the titles of your recent threads";
  if (capability === "bb.studio.read") return "Search the titles of your Studio items";
  if (capability === "bb.open") return "Open threads and Studio items in BB";
  return capability;
}
