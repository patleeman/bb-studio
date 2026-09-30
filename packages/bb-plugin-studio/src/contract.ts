import { defineRpcContract } from "@get-bb/plugin-sdk";
import { studioSchemas } from "@bb-studio/kit/contract";
import { z } from "zod";

export const schemas = studioSchemas(z);

const pluginId = z.string().min(1).max(100);
const ids = z.array(z.string().min(1).max(200)).min(1).max(500);
const projectId = z.string().min(1).max(200).nullable();

const provider = z.object({
  pluginId: z.string(),
  name: z.string(),
  /** ready: listed; outdated: installed without Studio support; offline: not running or failing. */
  state: z.enum(["ready", "outdated", "offline"]),
  detail: z.string().nullable(),
  panel: z.string().nullable(),
  kinds: z.array(schemas.kind),
});
export type ProviderView = z.infer<typeof provider>;

const sidebar = z.object({
  /** Add-on panels Studio can hide, as sidebar item ids (`<plugin>/<panel>`). */
  panels: z.array(z.object({ id: z.string(), label: z.string(), visible: z.boolean() })),
});
export type SidebarView = z.infer<typeof sidebar>;

const tag = z.object({ id: z.string(), name: z.string(), color: z.string() });
export type TagView = z.infer<typeof tag>;
const tagId = z.string().min(1).max(100);
const tagName = z.string().min(1).max(100);
const itemRef = z.object({ pluginId, id: z.string().min(1).max(200) });

export { TABS_CHANNEL } from "./ids";

const tab = z.object({
  pluginId: z.string(),
  id: z.string(),
  title: z.string(),
  /** The item's emoji, or null for its kind's icon. */
  icon: z.string().nullable(),
  kindIcon: z.string(),
  href: z.string(),
});
export type TabView = z.infer<typeof tab>;

export const rpcContract = defineRpcContract({
  /** Every provider and all of their items. */
  overview: {
    input: z.null(),
    output: z.object({
      providers: z.array(provider),
      /** Tag ids per item, in tag-name order. */
      items: z.array(schemas.item.extend({ pluginId: z.string(), tags: z.array(z.string()) })),
      tags: z.array(tag),
    }),
  },
  /** `<plugin>:<id>` keys of items whose content matches, and the matching text by key. */
  search: {
    input: z.object({ query: z.string().min(1).max(200) }),
    output: z.object({ keys: z.array(z.string()), snippets: z.record(z.string(), z.string()) }),
  },
  create: {
    input: z.object({ pluginId, kind: z.string().min(1).max(100), projectId }),
    output: z.object({ item: schemas.item }),
  },
  move: { input: z.object({ pluginId, ids, projectId }), output: schemas.results },
  archive: { input: z.object({ pluginId, ids, archived: z.boolean() }), output: schemas.results },
  remove: { input: z.object({ pluginId, ids }), output: schemas.results },
  action: {
    input: z.object({ pluginId, action: z.string().min(1).max(100), ids }),
    output: z.object({ message: z.string().nullable(), text: z.string().nullable() }),
  },
  /** Makes a tag, or returns the one with this name. */
  createTag: { input: z.object({ name: tagName }), output: z.object({ tag }) },
  renameTag: { input: z.object({ id: tagId, name: tagName }), output: z.object({ tag }) },
  deleteTag: { input: z.object({ id: tagId }), output: z.object({ ok: z.boolean() }) },
  /** Adds and removes tags on items from any add-on. */
  tagItems: {
    input: z.object({ items: z.array(itemRef).min(1).max(500), add: z.array(tagId).max(50), remove: z.array(tagId).max(50) }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Add-ons call this when their items change. */
  studio_changed: schemas.changed,
  sidebar: { input: z.null(), output: sidebar },
  /** Open tabs, in order; tabs of deleted items are closed. */
  tabs: { input: z.null(), output: z.object({ tabs: z.array(tab) }) },
  /** Opens a tab for the item whose view is at `path`, if any. */
  visitTab: { input: z.object({ path: z.string().min(1).max(2000) }), output: z.object({ tab: tab.nullable() }) },
  closeTabs: { input: z.object({ items: z.array(itemRef).min(1).max(100) }), output: z.object({ ok: z.boolean() }) },
  setSidebar: { input: z.object({ visible: z.boolean() }), output: sidebar },
  /** The item a path opens, or an item by id, with its kind. Studio Chat calls it. */
  itemAt: schemas.itemAt,
});
