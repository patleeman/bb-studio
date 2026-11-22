// Parts of a long tool result, the way pages_read reads a page: a default
// budget, and the "Next:" call right after the header (so no cut can take it).
// The cursor in that call is opaque to the agent. It is one of three kinds:
// - a keyset cursor (pageByKey): a position in an order that doesn't change
//   while an item lives, so items that change, arrive or go between parts never
//   make another one repeat or go missing;
// - an item id (pageItems, pageSections): a cursor whose item is gone says so,
//   with the exact call that starts again, instead of starting over;
// - a character or row offset (pageText, memory search by relevance).
import { ALIASES, MERGES } from "./merged-tools";

/** Default characters for one part of a list or a body. */
export const PART_CHARS = 6_000;

export interface ItemPage<T> {
  items: T[];
  /** The last item shown, to pass as `after` for the next part; null when this is the last part. */
  next: string | null;
  /** 1-based positions shown, and the total. */
  from: number;
  to: number;
  total: number;
  /** `after` named no item in the list. */
  missing?: true;
}

/**
 * The items after `after` (an item's id) that fit in `budget` characters as rendered, and at most `max`;
 * always at least one.
 */
export function pageItems<T>(items: readonly T[], idOf: (item: T) => string, size: (item: T) => number, options: { after?: string | null; budget?: number; max?: number }): ItemPage<T> {
  const budget = options.budget ?? PART_CHARS;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  let start = 0;
  if (options.after) {
    const at = items.findIndex((item) => idOf(item) === options.after);
    if (at < 0) return { items: [], next: null, from: 0, to: 0, total: items.length, missing: true };
    start = at + 1;
  }
  const out: T[] = [];
  let used = 0;
  for (let index = start; index < items.length && out.length < max; index++) {
    const cost = size(items[index]!) + 1;
    if (out.length && used + cost > budget) break;
    out.push(items[index]!);
    used += cost;
  }
  const end = start + out.length;
  return { items: out, next: end < items.length && out.length ? idOf(out.at(-1)!) : null, from: out.length ? start + 1 : start, to: end, total: items.length };
}

/** A tool call as an agent writes it, under the name the session sees: memory { op: "search", query: "x" }. */
export function callText(tool: string, args: Record<string, unknown>): string {
  const alias = ALIASES.get(tool);
  const merge = alias ? MERGES.find((each) => each.name === alias.merged) : undefined;
  const fields = { ...(alias && merge ? { [merge.field]: alias.op } : {}), ...args };
  const shown = Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ");
  return shown ? `${alias?.merged ?? tool} { ${shown} }` : `${alias?.merged ?? tool} {}`;
}

/** The line right after a part's header: where this part sits, and the call for the next one. */
export function nextLine(page: { from: number; to: number; total: number; next: string | null }, call: (after: string) => string, noun = "items"): string | null {
  if (page.next === null) return null;
  return `(Showing ${page.from}–${page.to} of ${page.total} ${noun}. Next: ${call(page.next)}.)`;
}

/** What a stale cursor says, with the exact call that starts again. */
export function staleCursor(after: string, again: string): string {
  return `${after} is no longer in this list (it was removed or changed). Start again: ${again}.`;
}

/** A cut at `end` that never splits a surrogate pair (an emoji stays whole). */
export function safeEnd(text: string, end: number): number {
  if (end <= 0 || end >= text.length) return end;
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}

/** A start at `start` that never begins inside a surrogate pair: it takes the whole emoji. */
export function safeStart(text: string, start: number): number {
  if (start <= 0 || start >= text.length) return start;
  const code = text.charCodeAt(start);
  return code >= 0xdc00 && code <= 0xdfff ? start - 1 : start;
}

/** A keyset cursor: a list's sort key and id, as one opaque string. */
export function encodeKey(key: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

export function decodeKey(text: string): (string | number)[] | null {
  try {
    const key = JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as unknown;
    return Array.isArray(key) && key.every((part) => typeof part === "string" || typeof part === "number") ? key as (string | number)[] : null;
  } catch { return null; }
}

/** Compares sort keys part by part; `descending[i]` flips part i. */
export function compareKeys(a: readonly (string | number)[], b: readonly (string | number)[], descending: readonly boolean[] = []): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    const order = x === undefined ? -1 : y === undefined ? 1 : typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    if (order) return descending[i] ? -order : order;
  }
  return 0;
}

/**
 * One part of a list in the order of `keyOf` (with `descending`), after the cursor's key: items that
 * change, arrive or go between parts never make another item repeat or go missing, because the
 * cursor is a position in the order, not an item. The key must not change while an item lives (a
 * creation time and the id). `next` is the last shown item's encoded key.
 */
export function pageByKey<T>(items: readonly T[], keyOf: (item: T) => (string | number)[], size: (item: T) => number, options: { after?: string | null; budget?: number; max?: number; descending?: readonly boolean[] }): ItemPage<T> {
  const sorted = [...items].sort((a, b) => compareKeys(keyOf(a), keyOf(b), options.descending));
  let start = 0;
  if (options.after) {
    const key = decodeKey(options.after);
    if (!key) return { items: [], next: null, from: 0, to: 0, total: sorted.length, missing: true };
    start = sorted.findIndex((item) => compareKeys(keyOf(item), key, options.descending) > 0);
    if (start < 0) start = sorted.length;
  }
  const part = pageItems(sorted.slice(start), (item) => String(sorted.indexOf(item)), size, { budget: options.budget, max: options.max });
  const last = part.items.at(-1);
  const end = start + part.items.length;
  return { items: part.items, next: last !== undefined && end < sorted.length ? encodeKey(keyOf(last)) : null, from: part.items.length ? start + 1 : start, to: end, total: sorted.length };
}

/** One part of a long text body, by character offset, cut at a line end where one is near. */
export function pageText(text: string, offset: number, budget = PART_CHARS): { text: string; next: number | null; missing?: true } {
  if (offset < 0 || offset > text.length) return { text: "", next: null, missing: true };
  if (text.length - offset <= budget) return { text: text.slice(offset), next: null };
  let hard = safeEnd(text, offset + budget);
  // A budget too small for the character at `offset` (half an emoji) takes the whole character, so a part always moves on.
  if (hard <= offset) hard = Math.min(text.length, offset + 2);
  const line = text.lastIndexOf("\n", hard);
  const end = line > offset + budget / 2 ? line + 1 : hard;
  return { text: text.slice(offset, end), next: end };
}

/** A text's first line, at most `max` characters. */
export function clipLine(text: string, max = 120): string {
  const line = text.split("\n").find((each) => each.trim())?.trim() ?? "";
  return line.length > max ? `${line.slice(0, safeEnd(line, max - 1))}…` : line;
}

/**
 * One part of a list made of sections ("Conversations:", "Workers:"): rows in order, each section's heading
 * shown again in any part that has rows of it. Returns the lines, or null for a stale cursor.
 */
export function pageSections(rows: readonly { id: string; section: string; line: string }[], options: { after?: string | null; budget?: number; max?: number }): { lines: string[]; page: ItemPage<{ id: string; section: string; line: string }> } | null {
  const page = pageItems(rows, (row) => row.id, (row) => row.line.length, options);
  if (page.missing) return null;
  const lines: string[] = [];
  let section: string | null = null;
  for (const row of page.items) {
    if (row.section !== section) { section = row.section; if (section) lines.push(section); }
    lines.push(row.line);
  }
  return { lines, page };
}

/** A count that may have hit a fetch cap: "At least N" when the fetch (`fetched` rows, before any filter) did. */
export function counted(count: number, cap: number, fetched = count): string {
  return fetched >= cap ? `At least ${count}` : String(count);
}
