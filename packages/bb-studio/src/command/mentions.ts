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

/**
 * One-letter names for a Space's threads, quick to read on a pane and to
 * type as @a. A thread keeps its letter while it's in the Space; a new one
 * takes the first free letter, then a2, b2 and so on.
 */
export function assignAliases(previous: Readonly<Record<string, string>>, threadIds: readonly string[]) {
  const next: Record<string, string> = {};
  for (const id of threadIds) if (previous[id]) next[id] = previous[id];
  const taken = new Set(Object.values(next));
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let round = 1, at = 0;
  for (const id of threadIds) {
    if (next[id]) continue;
    let alias: string;
    do {
      alias = letters[at]! + (round > 1 ? round : "");
      if (++at === letters.length) { at = 0; round++; }
    } while (taken.has(alias));
    taken.add(alias);
    next[id] = alias;
  }
  return next;
}

/** `@a` typed as text, not picked from the menu: the aliases it names. */
export const typedAliases = (text: string) =>
  [...text.matchAll(/(^|[^a-zA-Z0-9_.-])@([a-zA-Z][2-9]?)(?![a-zA-Z0-9_.-])/g)].map(match => match[2]!.toLowerCase());

type MentionableThread = { id: string; title: string; parentThreadId: string | null; status: string; alias?: string };

/** A Space's top-level threads, lead first, for a bare or typed @. A typed alias puts its thread first. */
export function matchingSpaceThreads(threads: readonly MentionableThread[], leadThreadId: string | null, query: string) {
  const q = query.toLowerCase();
  return threads
    .filter(t => !t.parentThreadId)
    .filter(thread => thread.title.toLowerCase().includes(q) || thread.alias === q)
    .sort((a, b) => Number(b.alias === q) - Number(a.alias === q))
    .map(thread => ({
      id: thread.id,
      title: thread.title,
      subtitle: [thread.alias ? `@${thread.alias}` : null, thread.id === leadThreadId ? "Lead" : null, thread.status === "active" || thread.status === "starting" ? "Working" : null].filter(Boolean).join(" · ") || "Thread",
      icon: "MessageSquare",
    }));
}
