import { defineRpcContract } from "@get-bb/plugin-sdk";
import { studioSchemas, studioTagSchemas } from "@bb-studio/kit/contract";
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

const tagSchemas = studioTagSchemas(z);
const { tag, tagId, tagName, itemRef } = tagSchemas;
const actor = z.object({ kind: z.enum(["user", "agent", "bot", "cli", "app", "editor"]), id: z.string().optional(), name: z.string().optional() });
const link = z.object({ from: itemRef, to: itemRef, kind: z.enum(["mention", "embed", "task-link", "related"]), source: pluginId });
const activityEvent = z.object({ actor, verb: z.string().min(1).max(100), ref: itemRef, at: z.number(), summary: z.string().max(2000) });
const homeTask = z.object({ id: z.string(), title: z.string(), status: z.string(), due: z.string().nullable(), projectId: z.string().nullable(), archived: z.boolean() });
const homeThread = z.object({ id: z.string(), title: z.string(), status: z.string(), projectId: z.string() });
const homeBot = z.object({ id: z.string(), name: z.string(), projectId: z.string() });
const homeActivity = activityEvent.extend({ id: z.number(), href: z.string() });
const needEntry = z.object({ id: z.string(), source: z.string(), kind: z.enum(["approval", "question", "attention", "review", "due", "reply", "mention"]), title: z.string(), body: z.string(), href: z.string(), createdAt: z.number(), priority: z.number(), threadId: z.string().optional(), interactionId: z.string().optional(), responseKind: z.enum(["approval", "question"]).optional() });
const usageLimits = z.object({ turnsPerHour: z.number(), turnsPerDay: z.number(), minutesPerTurn: z.number(), concurrentForks: z.number() });
const thread = z.object({ threadId: z.string(), ref: itemRef, role: z.string(), state: z.string(), createdAt: z.number(), updatedAt: z.number(), metadata: z.record(z.string(), z.string()) });
const comment = z.object({ id: z.string(), ref: itemRef, parentId: z.string().nullable(), anchor: z.string().nullable(), actor, body: z.string(), createdAt: z.number(), resolvedAt: z.number().nullable() });
const version = z.object({ id: z.string(), ref: itemRef, sha256: z.string(), label: z.string(), actor, createdAt: z.number() });
export type TagView = z.infer<typeof tag>;

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
  home: {
    input: z.object({ projectId: z.string().optional(), periodDays: z.number().int().min(1).max(90).default(7) }),
    output: z.object({
      needsYou: z.array(needEntry).optional(),
      due: z.array(homeTask).nullable(), review: z.array(homeTask).nullable(),
      working: z.object({ threads: z.array(homeThread), bots: z.array(homeBot).nullable() }),
      recent: z.array(z.object({ pluginId: z.string(), id: z.string(), title: z.string(), href: z.string(), kind: z.string(), updatedAt: z.number() })),
      automations: z.array(z.object({ id: z.string(), name: z.string(), projectId: z.string(), enabled: z.boolean(), nextRunAt: z.number().nullable() })).nullable(),
      activity: z.array(homeActivity),
      dashboard: z.object({ periodDays: z.number(), threads: z.array(homeThread.omit({ projectId: true }).extend({ turns: z.number(), failures: z.number(), durationMs: z.number() })), bots: z.array(homeBot.omit({ projectId: true }).extend({ turns: z.number(), failures: z.number(), durationMs: z.number(), active: z.number(), limits: usageLimits.nullable() })).nullable() }),
    }),
  },
  homeRespond: { input: z.object({ threadId: z.string(), interactionId: z.string(), action: z.enum(["approve", "deny", "answer"]), answer: z.string().max(10_000).optional() }), output: z.object({ ok: z.boolean() }) },
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
  items: { input: z.object({ pluginId, ids }), output: z.object({ items: z.array(schemas.item.extend({ pluginId: z.string(), tags: z.array(z.string()) })) }) },
  changes: {
    input: z.object({ since: z.number().int().min(0) }),
    output: z.object({ cursor: z.number().int(), reset: z.boolean(), changes: z.array(z.object({ pluginId, id: z.string(), kind: z.string(), removed: z.boolean(), at: z.number() })) }),
  },
  /** `<plugin>:<id>` keys of items whose content matches, and the matching text by key. */
  search: {
    input: z.object({ query: z.string().min(1).max(200) }),
    output: z.object({ keys: z.array(z.string()), snippets: z.record(z.string(), z.string()) }),
  },
  searchAll: {
    input: z.object({ query: z.string().max(200), kinds: z.array(z.string()).max(20).optional(), projectId: projectId.optional(), limit: z.number().int().min(1).max(100).default(40) }),
    output: z.array(z.object({
      ref: z.object({ pluginId: z.string(), id: z.string() }), kind: z.string(), title: z.string(),
      snippet: z.object({ text: z.string(), ranges: z.array(z.object({ start: z.number().int(), end: z.number().int() })) }),
      href: z.string(), projectId, updatedAt: z.number(), score: z.number(),
    })),
  },
  create: {
    input: z.object({ pluginId, kind: z.string().min(1).max(100), projectId }),
    output: z.object({ item: schemas.item }),
  },
  duplicate: { input: z.object({ pluginId, id: z.string().min(1).max(200), projectId, includeChildren: z.boolean().optional() }), output: z.object({ item: schemas.item }) },
  setTemplate: { input: z.object({ pluginId, id: z.string().min(1).max(200), template: z.boolean() }), output: z.object({ item: schemas.item }) },
  instantiateTemplate: { input: z.object({ pluginId, id: z.string().min(1).max(200), projectId, variables: z.record(z.string(), z.string()).default({}) }), output: z.object({ item: schemas.item }) },
  templates: { input: z.null(), output: z.object({ items: z.array(schemas.item.extend({ pluginId })) }) },
  exportItem: { input: z.object({ pluginId, id: z.string().min(1).max(200), format: z.string().min(1).max(30) }), output: schemas.provider.studio_export.output },
  exportBulk: { input: z.object({ items: z.array(itemRef.extend({ format: z.string().min(1).max(30) })).min(1).max(100) }), output: z.object({ name: z.string(), mime: z.string(), data: z.string() }) },
  move: { input: z.object({ pluginId, ids, projectId }), output: schemas.results },
  archive: { input: z.object({ pluginId, ids, archived: z.boolean() }), output: schemas.results },
  remove: { input: z.object({ pluginId, ids }), output: schemas.results },
  action: {
    input: z.object({ pluginId, action: z.string().min(1).max(100), ids }),
    output: z.object({ message: z.string().nullable(), text: z.string().nullable() }),
  },
  /** Makes a tag, or returns the one with this name. */
  createTag: tagSchemas.createTag,
  renameTag: { input: z.object({ id: tagId, name: tagName }), output: z.object({ tag }) },
  deleteTag: { input: z.object({ id: tagId }), output: z.object({ ok: z.boolean() }) },
  /** Adds and removes tags on items from any add-on. */
  tagItems: tagSchemas.tagItems,
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
  links: { input: z.object({ ref: itemRef }), output: z.object({ outgoing: z.array(link), backlinks: z.array(link) }) },
  replaceLinks: { input: z.object({ ref: itemRef, source: pluginId, links: z.array(link).max(500) }), output: z.object({ ok: z.boolean() }) },
  itemThreads: { input: z.object({ ref: itemRef }), output: z.object({ threads: z.array(thread) }) },
  linkItemThread: { input: z.object({ thread }), output: z.object({ ok: z.boolean() }) },
  spawnForItem: { input: z.object({ ref: itemRef, prompt: z.string().min(1).max(100000), role: z.string().min(1).max(100), metadata: z.record(z.string(), z.string()).optional(), projectId: projectId.optional(), visibility: z.enum(["user", "agent-only"]).optional() }), output: z.object({ threadId: z.string() }) },
  activity: { input: z.object({ ref: itemRef.optional(), since: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() }), output: z.object({ events: z.array(activityEvent.extend({ id: z.number() })) }) },
  recordActivity: { input: activityEvent, output: z.object({ id: z.number() }) },
  comments: { input: z.object({ ref: itemRef }), output: z.object({ comments: z.array(comment) }) },
  commentCreate: { input: z.object({ ref: itemRef, parentId: z.string().nullable(), anchor: z.string().nullable(), actor, body: z.string().min(1).max(10000) }), output: z.object({ comment }) },
  commentResolve: { input: z.object({ ref: itemRef, id: z.string(), resolved: z.boolean() }), output: z.object({ ok: z.boolean() }) },
  versions: { input: z.object({ ref: itemRef }), output: z.object({ versions: z.array(version) }) },
  versionCreate: { input: z.object({ ref: itemRef, bytes: z.string().max(16_000_000), label: z.string().max(200), actor }), output: z.object({ version }) },
  versionRead: { input: z.object({ ref: itemRef, id: z.string() }), output: z.object({ bytes: z.string().nullable() }) },
});
