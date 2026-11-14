const MENTION_HREF = /^@([a-z][a-z0-9-]*):([^\s/?#]+)$/iu;

export interface MentionHref {
  kind: string;
  id: string;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseMentionHref(href: string | null | undefined): MentionHref | null {
  if (!href) return null;
  const match = MENTION_HREF.exec(decode(href.trim()));
  if (match === null) return null;
  return { kind: match[1]!.toLowerCase(), id: match[2]! };
}

export function isMentionHref(href: string | null | undefined): boolean {
  return parseMentionHref(href) !== null;
}

export function forkMentionHref(href: string | undefined): string | undefined {
  const mention = parseMentionHref(href);
  if (mention === null) return href;
  if (mention.kind === "thread") {
    return `/threads/${encodeURIComponent(mention.id)}`;
  }
  return `@${mention.kind}:${mention.id}`;
}
