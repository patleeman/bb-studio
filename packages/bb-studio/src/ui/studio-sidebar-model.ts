// What the Studio sidebar lists, from Studio's overview and its tabs: the
// kinds (with item counts), saved views, tags, pinned items and recent ones.
// Pure, so the grouping is tested directly.
import type { CollectionItem } from "../kit/app/index";
import type { ProviderView, SavedViewView, TabView, TagView } from "../contract";
import { formatQuery } from "../query";

export interface SidebarKind { pluginId: string; id: string; label: string; icon: string; count: number; query: string }
export interface SidebarTag { id: string; name: string; color: string; count: number; query: string }
export interface SidebarItem { key: string; title: string; icon: string | null; kindIcon: string; href: string }
export interface StudioSidebarModel {
  kinds: SidebarKind[];
  views: SavedViewView[];
  tags: SidebarTag[];
  pinned: SidebarItem[];
  recent: SidebarItem[];
}

/** The built-in kinds first, in this order; others follow as their add-ons list them. */
const KIND_ORDER = ["page", "drawing", "recording", "artifact", "design"];
export const RECENT_LIMIT = 15;

const kindQuery = (id: string) => formatQuery({ filters: [{ field: "kind", value: id }], text: "" });
const tagQuery = (name: string) => formatQuery({ filters: [{ field: "tag", value: name }], text: "" });

export function studioSidebarModel(
  data: { providers: ProviderView[]; items: CollectionItem[]; tags: TagView[]; views: SavedViewView[] },
  tabs: TabView[],
  off: ReadonlySet<string> = new Set(),
): StudioSidebarModel {
  const live = data.items.filter((item) => !item.archived && !item.template);
  const count = (match: (item: CollectionItem) => boolean) => live.reduce((n, item) => n + (match(item) ? 1 : 0), 0);
  const rank = (id: string) => { const at = KIND_ORDER.indexOf(id); return at < 0 ? KIND_ORDER.length : at; };
  const kinds = data.providers
    .filter((provider) => provider.state === "ready")
    .flatMap((provider) => provider.kinds.filter((kind) => !off.has(kind.id)).map((kind) => ({
      pluginId: provider.pluginId,
      id: kind.id,
      label: kind.plural,
      icon: kind.icon,
      count: count((item) => item.pluginId === provider.pluginId && item.kind === kind.id),
      query: kindQuery(kind.id),
    })))
    .map((kind, index) => ({ kind, index }))
    .sort((a, b) => rank(a.kind.id) - rank(b.kind.id) || a.index - b.index)
    .map(({ kind }) => kind);
  const iconOf = new Map(kinds.map((kind) => [`${kind.pluginId}:${kind.id}`, kind.icon]));
  const tags = data.tags.map((tag) => ({ ...tag, count: count((item) => (item.tags ?? []).includes(tag.id)), query: tagQuery(tag.name) }));
  const pinned = tabs.filter((tab) => tab.pinned).map((tab) => ({ key: `${tab.pluginId}:${tab.id}`, title: tab.title, icon: tab.icon, kindIcon: tab.kindIcon, href: tab.href }));
  const pinnedKeys = new Set(pinned.map((item) => item.key));
  const recent = live
    .filter((item) => !pinnedKeys.has(`${item.pluginId}:${item.id}`) && iconOf.has(`${item.pluginId}:${item.kind}`))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT_LIMIT)
    .map((item) => ({ key: `${item.pluginId}:${item.id}`, title: item.title, icon: item.icon, kindIcon: iconOf.get(`${item.pluginId}:${item.kind}`)!, href: item.href }));
  return { kinds, views: data.views, tags, pinned, recent };
}
