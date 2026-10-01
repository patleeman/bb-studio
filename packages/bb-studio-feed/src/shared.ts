// Names and the `::post` directive, shared by the server and the app. Keep it
// free of server-only imports.

export const PLUGIN_ID = "feed";
export const PANEL_PATH = "feed";
export const REALTIME_CHANNEL = "feed";
export const FEED_ICON = "feed/feed";

/** The directive: `::post{title="Harlem Line delays cleared" topic="Commute" story="harlem-line"}`. */
export const DIRECTIVE = "post";

export const PRIORITIES = ["urgent", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MAX_TITLE = 200;
export const MAX_TOPIC = 40;
export const MAX_STORY = 80;
export const MAX_BODY = 20_000;

/** A post or a story changed. */
export type RealtimeEvent = { type: "post"; postId: string; story: string | null } | { type: "removed"; postId: string } | { type: "seen" };

export const postHref = (id: string) => `/plugins/${PLUGIN_ID}/${PANEL_PATH}/${encodeURIComponent(id)}`;

export interface PostDirective {
  title: string;
  topic: string | null;
  story: string | null;
  priority: Priority;
}

export interface ParsedPost extends PostDirective {
  /** The reply without its trailing directive lines. */
  body: string;
  /** The directive line as written, which also identifies the post in a reply. */
  source: string;
}

const ATTRIBUTE = /([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g;
const DIRECTIVE_LINE = /^::([a-z][\w-]*)\{([^\n]*)\}\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, key, value] of text.matchAll(ATTRIBUTE)) attributes[key!] = value!;
  return attributes;
}

const clean = (value: string | undefined, max: number) => {
  const text = value?.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return text ? text : null;
};

/** A story key: lowercase words joined by dashes, so "Harlem Line" and "harlem-line" are one story. */
export function storyKey(value: string | null | undefined): string | null {
  const key = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_STORY)
    .replace(/-+$/, "");
  return key ? key : null;
}

export function priority(value: string | null | undefined): Priority {
  const lower = value?.trim().toLowerCase();
  return (PRIORITIES as readonly string[]).includes(lower ?? "") ? (lower as Priority) : "normal";
}

/** The directive's attributes, validated. Null without a title. */
export function postDirective(attributes: Readonly<Record<string, string>>): PostDirective | null {
  const title = clean(attributes.title, MAX_TITLE);
  if (!title) return null;
  return {
    title,
    topic: clean(attributes.topic, MAX_TOPIC),
    story: storyKey(attributes.story),
    priority: priority(attributes.priority),
  };
}

/** Each line, and whether it's inside fenced code. */
function fenced(lines: readonly string[]): boolean[] {
  let open: string | null = null;
  return lines.map((line) => {
    const marker = FENCE.exec(line)?.[1];
    if (!marker) return open !== null;
    if (!open) open = marker;
    else if (marker[0] === open[0] && marker.length >= open.length && !line.trim().slice(marker.length).trim()) open = null;
    return true;
  });
}

/**
 * The post in a reply: a `::post{…}` line among the directive lines that end
 * it (`::reactions` and `::explore` may follow it). The rest of the reply,
 * without those lines, is the body. Null when the reply isn't a post.
 */
export function parsePost(text: string | null | undefined): ParsedPost | null {
  if (!text) return null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const inCode = fenced(lines);
  let end = lines.length;
  let found: { source: string; directive: PostDirective } | null = null;
  while (end > 0) {
    const line = lines[end - 1]!.trim();
    if (!line) {
      end -= 1;
      continue;
    }
    if (inCode[end - 1]) break;
    const match = DIRECTIVE_LINE.exec(line);
    if (!match) break;
    if (match[1] === DIRECTIVE && !found) {
      const directive = postDirective(parseAttributes(match[2] ?? ""));
      if (directive) found = { source: line, directive };
    }
    end -= 1;
  }
  if (!found) return null;
  const body = lines.slice(0, end).join("\n").trim().slice(0, MAX_BODY);
  return { ...found.directive, body, source: found.source };
}

/** One line of plain text from Markdown, for previews and notifications. */
export function plainText(markdown: string, max = 280): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/[\\`*_~#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const inline = (text: string) =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<?https?:\/\/[^\s>)]+>?/g, " ")
    .replace(/[\\`*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const LIST_ITEM = /^\s*(?:[-*•+]|\d+[.)])\s+/;

/**
 * A post's lede for the reader: its first paragraph as plain text, skipping
 * headings, pictures and bare links. A list reads "one · two · three".
 */
export function lede(markdown: string, max = 240): string {
  const blocks = markdown.replace(/\r\n?/g, "\n").replace(/```[\s\S]*?```/g, "\n\n").split(/\n\s*\n/);
  for (const block of blocks) {
    let text = "";
    for (const line of block.split("\n")) {
      if (/^\s*#{1,6}\s/.test(line) || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
      const item = LIST_ITEM.test(line);
      const part = inline(line.replace(LIST_ITEM, ""));
      if (!part) continue;
      if (!text) text = part;
      else if (item) text += /[:.!?]$/.test(text) ? ` ${part}` : ` · ${part}`;
      else text += ` ${part}`;
    }
    if (text) return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }
  return "";
}

/** The first picture in a post's body. */
export function bodyImage(markdown: string): string | null {
  return /!\[[^\]]*\]\((https?:\/\/[^)\s]+)/.exec(markdown)?.[1] ?? null;
}

/** The first page a post's body links to, whose preview picture can stand for the post. */
export function firstLink(markdown: string): string | null {
  const text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  return /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|<?(https?:\/\/[^\s>)]+)/.exec(text)?.slice(1).find(Boolean) ?? null;
}

/** The link domains in a post's body, for the reader's "from" line. */
export function sourceDomains(markdown: string, max = 3): string[] {
  const domains: string[] = [];
  for (const [, url] of markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    try {
      const host = new URL(url!).hostname.replace(/^www\./, "");
      if (!domains.includes(host)) domains.push(host);
    } catch {
      // Not a URL.
    }
    if (domains.length >= max) break;
  }
  return domains;
}
