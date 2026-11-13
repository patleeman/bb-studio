export const CONTINUED_DIRECTIVE = "continued";

export const conversationLink = (threadId: string): string => `/threads/${encodeURIComponent(threadId)}`;

const attribute = (value: string): string => value.replace(/["\n\r{}]/g, " ").replace(/\s+/g, " ").trim();
const label = (value: string): string => value.replace(/[[\]\n\r]/g, " ").replace(/\s+/g, " ").trim();

export function continuedLines(threadId: string, title: string): string {
  return `::${CONTINUED_DIRECTIVE}{to="${attribute(threadId)}" title="${attribute(title)}"}\n${continuedFallback(threadId, title)}`;
}

export function continuedFallback(threadId: string, title: string): string {
  return `[Continued in ${label(title)} →](${conversationLink(threadId)})`;
}
