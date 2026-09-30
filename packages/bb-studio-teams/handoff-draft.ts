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

/** Remember a handoff until the new channel thread's composer can take it. */
export function saveChannelThreadHandoff(threadId: string, source: ChannelHandoffSource) {
  localStorage.setItem(threadHandoffKey(threadId), JSON.stringify(source));
}

/** Read and forget a saved handoff, so it pre-fills the draft only once. */
export function takeChannelThreadHandoff(threadId: string): ChannelHandoffSource | null {
  try {
    const saved = localStorage.getItem(threadHandoffKey(threadId));
    if (!saved) return null;
    localStorage.removeItem(threadHandoffKey(threadId));
    return JSON.parse(saved) as ChannelHandoffSource;
  } catch {
    return null;
  }
}
