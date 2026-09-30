// Ordering and multi-select for the collection, kept apart from React so it
// can be tested on its own.
import type { StudioItem, StudioKind } from "../contract";
import { untitled } from "../format";

export type CollectionKind = StudioKind & { pluginId: string };
/** `tags` holds tag ids, when the collection has tags. */
export type CollectionItem = StudioItem & { pluginId: string; tags?: readonly string[] };

/** Where an item's key is unique: ids are only unique within a plugin. */
export const itemKey = (item: { pluginId: string; id: string }) => `${item.pluginId}:${item.id}`;

export interface ActionResults {
  done: string[];
  failed: { id: string; error: string }[];
}

export type SortKey = "title" | "kind" | "project" | "updatedAt" | `fact:${string}`;
export interface Sort {
  key: SortKey;
  descending: boolean;
}
export const DEFAULT_SORT: Sort = { key: "updatedAt", descending: true };

/**
 * Toggles one row. With `range`, every row from the last one clicked through
 * this one takes this row's new state, as in a file list.
 */
export function toggleSelection(
  selected: ReadonlySet<string>,
  orderedIds: readonly string[],
  id: string,
  options: { range: boolean; anchor: string | null },
): Set<string> {
  const next = new Set(selected);
  const checked = !selected.has(id);
  const from = options.anchor === null ? -1 : orderedIds.indexOf(options.anchor);
  const to = orderedIds.indexOf(id);
  const ids = options.range && from !== -1 && to !== -1 ? orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
  for (const each of ids) {
    if (checked) next.add(each);
    else next.delete(each);
  }
  return next;
}

export function sortItems(
  items: readonly CollectionItem[],
  sort: Sort,
  context: { kindLabel(item: CollectionItem): string; projectLabel(item: CollectionItem): string },
): CollectionItem[] {
  const direction = sort.descending ? -1 : 1;
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  const factSort = (item: CollectionItem, id: string) => item.facts.find((fact) => fact.id === id)?.sort ?? null;
  return [...items].sort((a, b) => {
    let order = 0;
    if (sort.key === "title") order = text(untitled(a.title), untitled(b.title));
    else if (sort.key === "kind") order = text(context.kindLabel(a), context.kindLabel(b));
    else if (sort.key === "project") order = text(context.projectLabel(a), context.projectLabel(b));
    else if (sort.key === "updatedAt") order = a.updatedAt - b.updatedAt;
    else {
      const id = sort.key.slice("fact:".length);
      const left = factSort(a, id);
      const right = factSort(b, id);
      // Missing values sort last either way.
      if (left === null || right === null) return left === right ? b.updatedAt - a.updatedAt : left === null ? 1 : -1;
      order = left - right;
    }
    return order * direction || b.updatedAt - a.updatedAt;
  });
}

export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, descending: !current.descending };
  return { key, descending: key === "updatedAt" || key.startsWith("fact:") };
}
