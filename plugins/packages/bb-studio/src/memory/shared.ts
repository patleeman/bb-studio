// Memory constants and small pure helpers the UI and the server both use.
// No SDK import: the frontend bundle can't resolve @get-bb/plugin-sdk at
// runtime (see src/ids.ts), so the zod contract lives in ./contract.ts and
// the UI imports only its types.

/** The Memory view under the Studio panel: `memory` (the active Bot) or `memory/<botId>`. */
export const MEMORY_SUBPATH = "memory";
export const MEMORY_PATH = `/plugins/studio/studio/${MEMORY_SUBPATH}`;
export const memoryPath = (botId?: string | null) => botId ? `${MEMORY_PATH}/${encodeURIComponent(botId)}` : MEMORY_PATH;

/** The Bot a Memory route names, or null for the bare route. */
export function memoryBotFromPath(subPath: string): string | null {
  const match = /^memory\/([^/?#]+)/.exec(subPath.replace(/^\/+/, ""));
  if (!match) return null;
  try { return decodeURIComponent(match[1]!); } catch { return null; }
}

/**
 * BB keeps at most this many characters of a plugin's instructions for a
 * session (PluginAgentConfiguration.instructions); the rest is cut off.
 */
export const INSTRUCTIONS_LIMIT = 4096;

/**
 * The most of the core profile that goes into every conversation's and
 * worker's instructions, in characters. It also gets no more than what is
 * left of INSTRUCTIONS_LIMIT after the Bot's own instructions. Past either,
 * the text is cut at a line break and the Bot is told the rest is on the
 * page (pages_read); the Memory view warns when the profile is over the cap.
 */
export const PROFILE_CAP_CHARS = 2500;

/** Where a memory record came from. */
export const MEMORY_SOURCE_KINDS = ["conversation", "worker", "thread", "page", "manual"] as const;
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number];

/** A topic as stored: trimmed, single spaces, at most 60 characters. */
export function cleanTopic(topic: string): string {
  return topic.replace(/\s+/g, " ").trim().slice(0, 60).trim();
}

/** The record list's date, "Nov 7" this year and "Nov 7, 2025" otherwise. */
export function recordDate(at: number, now = Date.now()): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function recordLine(text: string): string {
  return text.split("\n")
    .map((line) => line
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, "$1$2")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^[-*_]{3,}$/.test(line))
    .join(" · ");
}

/** A record's text cut to one short line, for "replaces “…”". */
export function snippet(text: string, max = 60): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
