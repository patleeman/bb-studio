// Names and the `::post` directive, shared by the server and the app. Keep it
// free of server-only imports.

export const PLUGIN_ID = "feed";
export const PANEL_PATH = "feed";
export const REALTIME_CHANNEL = "feed";
export const FEED_ICON = "feed/feed";
/** The panel is the Inbox: threads that need you, then the feed's posts. */
export const INBOX_ICON = "feed/inbox";
export const INBOX_TITLE = "Inbox";

/** The card directive a reply ends with: `::post{id="post_…"}` (older replies: `::post{title="…"}`). */
export const DIRECTIVE = "post";

export const PRIORITIES = ["urgent", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MAX_TITLE = 200;
export const MAX_TOPIC = 40;
export const MAX_STORY = 80;
export const MAX_BODY = 20_000;

/** A post or a story changed. */
export type RealtimeEvent = { type: "post"; postId: string; story: string | null } | { type: "removed"; postId: string } | { type: "seen" };

/** Stories Explore (in Studio Pages) posts a saved finding under; the reader offers to explore them. */
export const EXPLORE_STORY_PREFIX = "explore-";
/** Explore runs inside Studio Pages, which registers its RPC methods with an `explore_` prefix. */
export const EXPLORE_PLUGIN_ID = "pages";

/** The line a reply ends with to show a post `feed_post` made, as a card. */
export const cardLine = (postId: string) => `::${DIRECTIVE}{id="${postId}"}`;

export const postHref = (id: string) => `/plugins/${PLUGIN_ID}/${PANEL_PATH}/${encodeURIComponent(id)}`;

export const discussionHref = (id: string) => `${postHref(id)}/discussion`;
export const discussionPrompt = (post: { id: string; title: string; author: string; channelName: string | null }) =>
  `Let's discuss "${post.title}".\n\n`;
export const discussionContext = (post: { id: string; title: string; author: string; channelName: string | null }) =>
  `The user is discussing this feed post: "${post.title}" (${post.channelName ? `${post.author} in #${post.channelName}` : post.author}). Read it first with feed_read id ${post.id}.\n\n`;

export interface PostDirective {
  title: string;
  topic: string | null;
  story: string | null;
  priority: Priority;
}

const ATTRIBUTE = /([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g;

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

/** The first page a post's body links to, whose preview picture can stand for the post. BB's own links are previews of their own. */
export function firstLink(markdown: string): string | null {
  const text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  for (const match of text.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|<?(https?:\/\/[^\s>)]+)/g)) {
    const url = match.slice(1).find(Boolean)!;
    if (!itemPath(url)) return url;
  }
  return null;
}

/** A Studio item a post points at: by its app path, or by plugin and id. */
export type StudioRef = { path: string } | { pluginId: string; id: string };

const ITEM_PATH = /^\/plugins\/([a-z0-9-]+)\/[a-z0-9-]+\/[^\s?#]+/;

/** The app path in a BB link, absolute (any host) or relative; null for anything else and for the feed's own links. */
function itemPath(url: string): string | null {
  let path = url;
  if (/^https?:\/\//.test(url)) {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  const match = ITEM_PATH.exec(path);
  return match && match[1] !== PLUGIN_ID ? match[0] : null;
}

/**
 * The Studio items a post links to, in order, at most `max`: links to their
 * app paths (`/plugins/pages/pages/pg_…`, absolute or relative) and mentions
 * (`@[Title](page:pg_…)`, `@[Title](item:artifacts:art_…)`).
 */
export function studioRefs(markdown: string, max = 3): StudioRef[] {
  const refs: StudioRef[] = [];
  const seen = new Set<string>();
  const add = (key: string, ref: StudioRef) => {
    if (seen.has(key) || refs.length >= max) return;
    seen.add(key);
    refs.push(ref);
  };
  const text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  for (const match of text.matchAll(/\]\(([^)\s]+)\)|(https?:\/\/[^\s>)]+)/g)) {
    const target = (match[1] ?? match[2])!;
    const mention = /^(?:page:(pg_[A-Za-z0-9]+)|item:([a-z0-9-]+):([^\s]+))$/.exec(target);
    if (mention) {
      const ref = mention[1] ? { pluginId: "pages", id: mention[1] } : { pluginId: mention[2]!, id: decodeURIComponent(mention[3]!) };
      add(`${ref.pluginId}:${ref.id}`, ref);
      continue;
    }
    const path = itemPath(target);
    if (path) add(path, { path });
  }
  return refs;
}

/** The link domains in a post's body, for the reader's "from" line. */
export function sourceDomains(markdown: string, max = 3): string[] {
  const domains: string[] = [];
  for (const [, url] of markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (itemPath(url!)) continue;
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
