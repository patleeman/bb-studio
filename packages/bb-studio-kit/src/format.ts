// Formatting shared by every Studio surface, so dates and counts read the
// same everywhere.

export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Sep 30, 3:04 PM" */
export function shortDateTime(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? noun : many}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const untitled = (title: string) => title.trim() || "Untitled";

/** A compact binary byte count for item metadata and file sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} ${units[unit]}`;
}

/** How many content matches an add-on excerpts; the rest match without a snippet. */
export const SNIPPET_LIMIT = 50;

/**
 * One line of `text` around the first match of `query`, cut at word breaks
 * with "…" where it's trimmed, or null when the text doesn't contain it.
 */
export function snippet(text: string, query: string, width = 100): string | null {
  const needle = query.trim().toLowerCase();
  const flat = text.replace(/\s+/g, " ").trim();
  const at = needle ? flat.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return null;
  // A third of the room goes before the match, so it reads in context.
  let start = Math.max(0, at - Math.max(0, Math.floor((width - needle.length) / 3)));
  let end = Math.min(flat.length, Math.max(start + width, at + needle.length));
  start = Math.max(0, Math.min(start, end - width));
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > at + needle.length) end = space;
  }
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** `studio_search` snippets: the first SNIPPET_LIMIT items' matching text, by id. */
export function snippets<T extends { id: string }>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string | null | undefined,
): Record<string, string> {
  const found: Record<string, string> = {};
  for (const item of items.slice(0, SNIPPET_LIMIT)) {
    const text = textOf(item);
    const line = text ? snippet(text, query) : null;
    if (line) found[item.id] = line;
  }
  return found;
}
