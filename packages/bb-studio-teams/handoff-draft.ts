export type ChannelHandoffSource = {
  threadId: string;
  projectId: string;
  title: string;
};

export function channelHandoffPath(source: ChannelHandoffSource) {
  return source.projectId === "proj_personal"
    ? `/threads/${encodeURIComponent(source.threadId)}`
    : `/projects/${encodeURIComponent(source.projectId)}/threads/${encodeURIComponent(source.threadId)}`;
}

export function channelHandoffText(source: ChannelHandoffSource) {
  const path = channelHandoffPath(source);
  const title = source.title
    .replace(/[\\[\]<>*_`]/gu, "\\$&")
    .replace(/[\r\n]/gu, " ");
  return `Continue from [${title}](${path}) (@thread:${source.threadId})`;
}

const threadHandoffKey = (threadId: string) => `bb:bots:thread-handoff:${threadId}`;

/** What a new channel thread's draft starts with: a source thread, typed text, or both. */
export type ChannelThreadHandoff = { source: ChannelHandoffSource | null; draft: string };

/** Remember a handoff until the new channel thread's composer can take it. */
export function saveChannelThreadHandoff(threadId: string, handoff: ChannelThreadHandoff) {
  localStorage.setItem(threadHandoffKey(threadId), JSON.stringify(handoff));
}

/** Read and forget a saved handoff, so it pre-fills the draft only once. */
export function takeChannelThreadHandoff(threadId: string): ChannelThreadHandoff | null {
  try {
    const saved = localStorage.getItem(threadHandoffKey(threadId));
    if (!saved) return null;
    localStorage.removeItem(threadHandoffKey(threadId));
    const parsed = JSON.parse(saved) as Partial<ChannelThreadHandoff> & Partial<ChannelHandoffSource>;
    // Saved before drafts were carried: the source itself.
    if (parsed.threadId) return { source: parsed as ChannelHandoffSource, draft: "" };
    return { source: parsed.source ?? null, draft: parsed.draft ?? "" };
  } catch {
    return null;
  }
}

/** The new channel draft: the source link, then any text carried over. */
export function channelHandoffDraft(handoff: ChannelThreadHandoff, current: string) {
  return [handoff.source ? channelHandoffText(handoff.source) : "", handoff.draft, current]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n") + "\n\n";
}
