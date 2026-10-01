// Ordering and multi-select for the collection, kept apart from React so it
// can be tested on its own.
import type { StudioItem, StudioKind } from "../contract";
import { untitled } from "../format";

export type CollectionKind = StudioKind & { pluginId: string };
/** `tags` holds tag ids, when the collection has tags; `spaces` space ids, when it has spaces. */
export type CollectionItem = StudioItem & { pluginId: string; tags?: readonly string[]; spaces?: readonly string[] };

/** Where an item's key is unique: ids are only unique within a plugin. */
export const itemKey = (item: { pluginId: string; id: string }) => `${item.pluginId}:${item.id}`;

export interface ActionResults {
  done: string[];
  failed: { id: string; error: string }[];
}

export type SortKey = "title" | "kind" | "project" | "updatedAt" | "createdAt" | `fact:${string}`;
export interface Sort {
  key: SortKey;
  descending: boolean;
}
export const DEFAULT_SORT: Sort = { key: "updatedAt", descending: true };

/** A sort as stored text, e.g. `updatedAt:desc`. */
export const formatSort = (sort: Sort) => `${sort.key}:${sort.descending ? "desc" : "asc"}`;
export function parseSort(text: string): Sort {
  const at = text.lastIndexOf(":");
  const key = text.slice(0, at);
  const direction = text.slice(at + 1);
  const known = key === "title" || key === "kind" || key === "project" || key === "updatedAt" || key === "createdAt" || /^fact:./.test(key);
  return known && (direction === "asc" || direction === "desc") ? { key: key as SortKey, descending: direction === "desc" } : DEFAULT_SORT;
}

export type GroupBy = "none" | "kind" | "project" | "space" | "tag";
export const GROUP_BYS: readonly GroupBy[] = ["none", "kind", "project", "space", "tag"];

export interface Group {
  /** A kind, project, space or tag id; "" for items with none. */
  id: string;
  label: string;
  items: CollectionItem[];
}

/**
 * Splits sorted items into groups, keeping their order within each. An item
 * in two spaces or with two tags shows in both groups. Groups follow `order`
 * (the kinds, spaces or tags as listed) or else their labels, and the group
 * of items with none comes last.
 */
export function groupItems(
  items: readonly CollectionItem[],
  by: Exclude<GroupBy, "none">,
  context: { label(id: string): string; order?: readonly string[] },
): Group[] {
  const groups = new Map<string, CollectionItem[]>();
  const add = (id: string, item: CollectionItem) => {
    const list = groups.get(id);
    if (list) list.push(item);
    else groups.set(id, [item]);
  };
  for (const item of items) {
    const ids = by === "kind" ? [item.kind] : by === "project" ? [item.projectId ?? ""] : by === "space" ? (item.spaces ?? []) : (item.tags ?? []);
    if (!ids.length) add("", item);
    for (const id of ids) add(id, item);
  }
  const rank = new Map(context.order?.map((id, index) => [id, index]));
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  return [...groups]
    .map(([id, list]) => ({ id, label: context.label(id), items: list }))
    .sort((a, b) => {
      if (!a.id || !b.id) return a.id ? -1 : b.id ? 1 : 0;
      return (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || text(a.label, b.label);
    });
}

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
    else if (sort.key === "createdAt") order = a.createdAt - b.createdAt;
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
  return { key, descending: key === "updatedAt" || key === "createdAt" || key.startsWith("fact:") };
}
