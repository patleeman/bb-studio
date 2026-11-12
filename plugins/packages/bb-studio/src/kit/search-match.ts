// The one rule for marking what a search found, used by every Studio surface
// that highlights matches (Quick Open, the Search panel, collection rows) and
// by the server's snippets. A piece of text is marked only when it is:
//
//   - the whole query as typed, anywhere, case-insensitive (white space in the
//     query matches any run of white space), or
//   - a word of the query at the start of a word in the text ("rev" in
//     "review", never "rev" inside "unrevealed").
//
// Never scattered letters: "trees" marks nothing in "Fix review 1-3: voice
// reports, reaper", and a query word of one letter is never marked on its own.
// Pure, so search-match.test.ts tests it directly.

export interface MatchRange { start: number; end: number }

/** The shortest piece marked: one letter matches too much to be worth marking. */
export const MIN_MARK = 2;
const MAX_WORDS = 12;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The query as one phrase (white space collapsed) and its words of two characters or more, lowercased and once each. */
export function queryParts(query: string): { whole: string; words: string[] } {
  const whole = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  const words = [...new Set((whole.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.toLocaleLowerCase()))]
    .filter((word) => word.length >= MIN_MARK)
    .slice(0, MAX_WORDS);
  return { whole, words };
}

/** Every non-empty match of `pattern` (a global regex) in `text`. */
function occurrences(text: string, pattern: RegExp): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const match of text.matchAll(pattern)) if (match[0].length) ranges.push({ start: match.index, end: match.index + match[0].length });
  return ranges;
}

/**
 * Where `text` should be marked for `query`: the whole query anywhere, and
 * each query word where a word starts. Sorted, with overlapping pieces joined,
 * so the result never overlaps. Empty for a query shorter than two characters.
 */
export function highlightRanges(text: string, query: string): MatchRange[] {
  const { whole, words } = queryParts(query);
  if (!text || whole.length < MIN_MARK) return [];
  const found = [
    ...occurrences(text, new RegExp(escape(whole).replace(/ /g, "\\s+"), "giu")),
    ...words.flatMap((word) => occurrences(text, new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}`, "giu"))),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: MatchRange[] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** `text` cut into plain and marked parts by `highlightRanges`. */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const range of highlightRanges(text, query)) {
    if (range.start > at) parts.push({ text: text.slice(at, range.start), match: false });
    parts.push({ text: text.slice(range.start, range.end), match: true });
    at = range.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}
