export interface ForkMatchRange {
  start: number;
  end: number;
}

const MIN_MARK = 2;
const MAX_WORDS = 12;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function occurrences(text: string, pattern: RegExp): ForkMatchRange[] {
  const ranges: ForkMatchRange[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match[0].length > 0) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

export function strongMatchRanges(
  text: string,
  query: string,
): ForkMatchRange[] {
  const whole = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (text === "" || whole.length < MIN_MARK) return [];
  const words = [
    ...new Set(
      (whole.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) =>
        word.toLocaleLowerCase(),
      ),
    ),
  ]
    .filter((word) => word.length >= MIN_MARK)
    .slice(0, MAX_WORDS);
  const found = [
    ...occurrences(
      text,
      new RegExp(escape(whole).replace(/ /g, "\\s+"), "giu"),
    ),
    ...words.flatMap((word) =>
      occurrences(
        text,
        new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}`, "giu"),
      ),
    ),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: ForkMatchRange[] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last !== undefined && range.start < last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function forkStrongMatches<Match extends { item: unknown }>(
  matches: readonly Match[],
  query: string,
  getText: (item: Match["item"]) => string,
): (Match & { forkRanges: ForkMatchRange[] | null })[] {
  if (query.trim().length < MIN_MARK) {
    return matches.map((match) => ({ ...match, forkRanges: null }));
  }
  return matches.flatMap((match) => {
    const ranges = strongMatchRanges(getText(match.item), query);
    return ranges.length > 0 ? [{ ...match, forkRanges: ranges }] : [];
  });
}
