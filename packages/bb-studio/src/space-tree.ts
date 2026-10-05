// The sidebar's space tree: each space with the items it holds, sub-items
// under their parents. A view over membership, not real nesting, so an item
// in two spaces shows under both.
import { untitled } from "@bb-studio/kit/format";
import { inSpace, type Space } from "./spaces";

export const TREE_ITEMS = 50;
export const TREE_DEPTH = 3;

export interface TreeSource {
  pluginId: string;
  id: string;
  kind: string;
  title: string;
  icon: string | null;
  href: string;
  updatedAt: number;
  projectId: string | null;
  parentId: string | null;
  archived: boolean;
}

export interface TreeItem {
  pluginId: string;
  id: string;
  title: string;
  icon: string | null;
  kindIcon: string;
  href: string;
  updatedAt: number;
  /** The item it shows under, or null at the space's top level. */
  parentId: string | null;
  depth: number;
}

/**
 * The items a space shows: live ones, not background kinds,
 * the newest `limit` of them, then in tree order. A sub-item nests under its
 * parent when both show; deeper than `TREE_DEPTH` it stays at the last level.
 */
export function spaceTreeItems(
  space: Space,
  items: readonly TreeSource[],
  options: { background: ReadonlySet<string>; kindIcon(item: TreeSource): string; limit?: number },
): { items: TreeItem[]; count: number } {
  const held = items
    .filter((item) => !item.archived && !options.background.has(`${item.pluginId}:${item.kind}`) && inSpace(space, item))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const shown = held.slice(0, options.limit ?? TREE_ITEMS);
  const key = (pluginId: string, id: string) => `${pluginId}:${id}`;
  const present = new Set(shown.map((item) => key(item.pluginId, item.id)));
  const children = new Map<string, TreeSource[]>();
  const roots: TreeSource[] = [];
  for (const item of shown) {
    const parent = item.parentId && item.parentId !== item.id && present.has(key(item.pluginId, item.parentId)) ? key(item.pluginId, item.parentId) : null;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), item]);
    else roots.push(item);
  }
  const out: TreeItem[] = [];
  const placed = new Set<string>();
  const visit = (item: TreeSource, depth: number, parentId: string | null) => {
    const id = key(item.pluginId, item.id);
    if (placed.has(id)) return;
    placed.add(id);
    out.push({ pluginId: item.pluginId, id: item.id, title: untitled(item.title), icon: item.icon, kindIcon: options.kindIcon(item), href: item.href, updatedAt: item.updatedAt, parentId, depth });
    for (const child of children.get(id) ?? []) visit(child, Math.min(depth + 1, TREE_DEPTH), item.id);
  };
  for (const root of roots) visit(root, 0, null);
  // Items in a parent cycle reach no root; list them at the top.
  for (const item of shown) visit(item, 0, null);
  return { items: out, count: held.length };
}

export interface OpenItem { pluginId: string; id: string; title: string; icon: string | null; kindIcon: string; href: string; pinned: boolean }

/** The Space's items among the open tabs, in tab order (pinned first); archived and missing ones drop out. */
export function spaceOpenItems<T extends TreeSource>(space: Space, tabs: readonly { pluginId: string; id: string; pinned: boolean }[], items: readonly T[], kindIcon: (item: T) => string): OpenItem[] {
  const byKey = new Map(items.map((item) => [`${item.pluginId}:${item.id}`, item]));
  return tabs.flatMap((tab) => {
    const item = byKey.get(`${tab.pluginId}:${tab.id}`);
    if (!item || item.archived || !inSpace(space, item)) return [];
    return [{ pluginId: item.pluginId, id: item.id, title: untitled(item.title), icon: item.icon, kindIcon: kindIcon(item), href: item.href, pinned: tab.pinned }];
  });
}
