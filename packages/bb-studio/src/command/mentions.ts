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

/** A Space's one-letter names, and the letters its departed threads left behind, oldest first. */
export type AliasState = { aliases: Record<string, string>; released: string[] };

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Reads what an earlier version stored too: a bare thread-to-alias record. */
export function aliasState(stored: unknown): AliasState {
  if (!stored || typeof stored !== "object") return { aliases: {}, released: [] };
  const value = stored as Partial<AliasState>;
  if (value.aliases && typeof value.aliases === "object" && Array.isArray(value.released)) return { aliases: { ...value.aliases }, released: value.released.filter(alias => typeof alias === "string") };
  return { aliases: Object.fromEntries(Object.entries(stored).filter(([, alias]) => typeof alias === "string")), released: [] };
}

/**
 * One-letter names for a Space's threads, quick to read on a pane and to
 * type as @a. `memberIds` is every thread in the Space, not only the shown
 * ones: a thread keeps its letter until it leaves the Space. A departed
 * thread's letter isn't reused while an unused letter is left, so @b never
 * quietly names a different thread. A new thread takes the first unused
 * letter, then the longest-released one, then a2, b2 and so on.
 */
export function assignAliases(previous: AliasState, memberIds: readonly string[], keepIds: readonly string[] = []): AliasState {
  // keepIds are members that hold on to a letter they have without getting a new one (archived threads).
  const members = new Set([...memberIds, ...keepIds]);
  const aliases: Record<string, string> = {};
  const released = [...previous.released];
  for (const [id, alias] of Object.entries(previous.aliases)) {
    if (members.has(id)) aliases[id] = alias;
    else if (!released.includes(alias)) released.push(alias);
  }
  const taken = new Set(Object.values(aliases));
  for (let i = released.length - 1; i >= 0; i--) if (taken.has(released[i]!)) released.splice(i, 1);
  const pick = () => {
    const fresh = [...LETTERS].find(letter => !taken.has(letter) && !released.includes(letter));
    if (fresh) return fresh;
    if (released.length) return released.shift()!;
    for (let round = 2;; round++) for (const letter of LETTERS) if (!taken.has(letter + round)) return letter + round;
  };
  for (const id of memberIds) {
    if (aliases[id]) continue;
    const alias = pick();
    taken.add(alias);
    aliases[id] = alias;
  }
  return { aliases, released };
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
