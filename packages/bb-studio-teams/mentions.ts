/** `@all` and `@everyone` address every thread in a Command view. */
export const broadcastHandles = ["all", "everyone"] as const;

export const isBroadcastHandle = (handle: string) =>
  broadcastHandles.some((alias) => alias === handle.toLowerCase());

/** BB namespaces picked items as <provider>:<item>. Keep the @ in the sent text. */
export const broadcastMentionText = (itemId: string) => {
  const handle = itemId.replace(/^broadcasts:/, "");
  return itemId.startsWith("broadcasts:") && isBroadcastHandle(handle)
    ? `@${handle.toLowerCase()}`
    : null;
};

export const matchingBroadcastMentions = (query: string) =>
  broadcastHandles
    .filter((handle) => handle !== "everyone" || !!query)
    .filter((handle) => handle.startsWith(query.toLowerCase()))
    .map((handle) => ({ handle }));
