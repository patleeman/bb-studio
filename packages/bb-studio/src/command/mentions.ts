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

/** Picked from the "This Space" provider: `space-threads:<threadId>`. */
export const spaceThreadMentionId = (itemId: string) =>
  itemId.startsWith("space-threads:") ? itemId.slice("space-threads:".length) || null : null;

type MentionableThread = { id: string; title: string; parentThreadId: string | null; status: string };

/** A Space's top-level threads, lead first, for a bare or typed @. */
export function matchingSpaceThreads(threads: readonly MentionableThread[], leadThreadId: string | null, query: string) {
  const q = query.toLowerCase();
  return threads
    .filter(t => !t.parentThreadId)
    .map(thread => ({ thread }))
    .filter(({ thread }) => thread.title.toLowerCase().includes(q))
    .map(({ thread }) => ({
      id: thread.id,
      title: thread.title,
      subtitle: [thread.id === leadThreadId ? "Lead" : null, thread.status === "active" || thread.status === "starting" ? "Working" : null].filter(Boolean).join(" · ") || "Thread",
      icon: "MessageSquare",
    }));
}
