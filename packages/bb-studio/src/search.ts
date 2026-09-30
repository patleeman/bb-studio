// Ranking for Studio search: titles match as you type, content matches come
// from the add-ons and follow them.

export interface Searchable {
  pluginId: string;
  id: string;
  title: string;
  updatedAt: number;
  archived: boolean;
}

export interface Match<T> {
  item: T;
  /** The matching text inside the item, when its add-on excerpted one. */
  snippet: string | null;
}

export interface ContentMatches {
  keys: readonly string[];
  snippets: Readonly<Record<string, string>>;
}

export const RECENT_LIMIT = 12;
export const MATCH_LIMIT = 40;

const keyOf = (item: Searchable) => `${item.pluginId}:${item.id}`;

/** Lower is better; null when a word of the query isn't in the title. */
function titleScore(title: string, query: string): number | null {
  const text = (title.trim() || "Untitled").toLowerCase();
  if (!query.split(/\s+/).every((word) => text.includes(word))) return null;
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  const at = text.indexOf(query);
  if (at > 0 && /[^\p{L}\p{N}]/u.test(text[at - 1]!)) return 2;
  return at >= 0 ? 3 : 4;
}

/**
 * What Studio search lists: recently changed items for an empty query, else
 * title matches best first, then items that match only in their content.
 */
export function studioMatches<T extends Searchable>(items: readonly T[], rawQuery: string, content: ContentMatches | null): Match<T>[] {
  const live = items.filter((item) => !item.archived);
  const query = rawQuery.trim().toLowerCase();
  const newest = (a: T, b: T) => b.updatedAt - a.updatedAt;
  if (!query) return [...live].sort(newest).slice(0, RECENT_LIMIT).map((item) => ({ item, snippet: null }));
  const snippetOf = (item: T) => content?.snippets[keyOf(item)] ?? null;
  const titled = live
    .flatMap((item) => {
      const score = titleScore(item.title, query);
      return score === null ? [] : [{ item, score }];
    })
    .sort((a, b) => a.score - b.score || newest(a.item, b.item))
    .map(({ item }) => item);
  const seen = new Set(titled.map(keyOf));
  const inContent = new Set(content?.keys ?? []);
  const contentOnly = live.filter((item) => inContent.has(keyOf(item)) && !seen.has(keyOf(item))).sort(newest);
  return [...titled, ...contentOnly].slice(0, MATCH_LIMIT).map((item) => ({ item, snippet: snippetOf(item) }));
}
