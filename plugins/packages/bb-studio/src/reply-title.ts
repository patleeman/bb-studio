export const REPLY_TITLE_SUFFIX = " · thread";

export function isReplyTitle(title: string): boolean {
  return title.trim().endsWith(REPLY_TITLE_SUFFIX);
}

export function shownThreadTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed.endsWith(REPLY_TITLE_SUFFIX)) return trimmed;
  const parent = trimmed.slice(0, -REPLY_TITLE_SUFFIX.length).trim();
  return parent ? `Reply in ${parent}` : trimmed;
}
