import { defineRpcContract } from "@get-bb/plugin-sdk";
import { conversationRequestSchema, studioSchemas, studioTagSchemas } from "@bb-studio/kit/contract";
import { z } from "zod";

export const schemas = studioSchemas(z);

const pluginId = z.string().min(1).max(100);
const ids = z.array(z.string().min(1).max(200)).min(1).max(500);
const projectId = z.string().min(1).max(200).nullable();

const searchStatus = z.object({
  state: z.enum(["initializing", "current", "stale", "recovering"]),
  pendingProviders: z.array(z.string()),
  unavailableProviders: z.array(z.string()),
  discoveryIncomplete: z.boolean(),
  revision: z.number().int().min(0),
});
export type SearchStatus = z.infer<typeof searchStatus>;

const provider = z.object({
  pluginId: z.string(),
  name: z.string(),
  /** ready: listed; offline: not running or failing. */
  state: z.enum(["ready", "offline"]),
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
const homeThread = z.object({ id: z.string(), title: z.string(), status: z.string(), projectId: z.string() });
const homeBot = z.object({ id: z.string(), name: z.string(), projectId: z.string() });
const homeActivity = activityEvent.extend({ id: z.number(), href: z.string() });
const needEntry = z.object({ id: z.string(), source: z.string(), kind: z.enum(["approval", "question", "reply", "mention"]), title: z.string(), body: z.string(), href: z.string(), createdAt: z.number(), priority: z.number(), threadId: z.string().optional(), interactionId: z.string().optional(), responseKind: z.enum(["approval", "question"]).optional() });
const usageLimits = z.object({ turnsPerHour: z.number(), turnsPerDay: z.number(), minutesPerTurn: z.number(), concurrentForks: z.number() });
const thread = z.object({ threadId: z.string(), ref: itemRef, role: z.string(), state: z.string(), createdAt: z.number(), updatedAt: z.number(), metadata: z.record(z.string(), z.string()) });
const comment = z.object({ id: z.string(), ref: itemRef, parentId: z.string().nullable(), anchor: z.string().nullable(), actor, body: z.string(), createdAt: z.number(), resolvedAt: z.number().nullable() });
const version = z.object({ id: z.string(), ref: itemRef, sha256: z.string(), label: z.string(), actor, createdAt: z.number() });
export type TagView = z.infer<typeof tag>;

const space = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string().nullable(),
  description: z.string(),
  /** Where the space's new items and threads go: its catch-all project. */
  defaultProjectId: z.string().nullable(),
  /** BB projects whose items and threads all belong to the space. */
  projectIds: z.array(z.string()),
  threadIds: z.array(z.string()),
  /** Always empty: items follow their project. */
  itemKeys: z.array(z.string()),
  /** The space's brief page in Pages, or null before it has one. */
  pageId: z.string().nullable(),
});
export type SpaceView = z.infer<typeof space>;
const spaceId = z.string().min(1).max(100);
const spaceFields = z.object({
  icon: z.string().max(16).nullable().optional(),
  description: z.string().max(500).optional(),
  defaultProjectId: z.string().min(1).max(200).nullable().optional(),
});
/** `bb-project:<id>` for a whole project, or `bb-thread:<id>` for a thread. */
const spaceMember = itemRef;
const spaceThread = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  projectId: z.string().nullable(),
  updatedAt: z.number(),
});
export type SpaceThreadView = z.infer<typeof spaceThread>;
const savedView = z.object({ id: z.string(), name: z.string(), query: z.string() });
export type SavedViewView = z.infer<typeof savedView>;
const listedItem = schemas.item.extend({ pluginId: z.string(), tags: z.array(z.string()), spaces: z.array(z.string()) });

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

/** A space in the sidebar's tree, with its newest items, sub-items under their parents. */
const treeSpace = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string(),
  href: z.string(),
  items: z.array(tab.extend({ updatedAt: z.number(), parentId: z.string().nullable(), depth: z.number() })),
  /** Every item it holds; `items` stops at a cap. */
  itemCount: z.number(),
  /** Its items open as tabs, in the order they were opened. */
  open: z.array(tab),
});
export type SpaceTreeView = z.infer<typeof treeSpace>;

/** Portable five-field cron: numbers/names, wildcards, lists, ranges and positive steps. */
function validCron(cron: string): boolean {
  const fields = cron.split(/\s+/u);
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] as const;
  const months = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
  const days = "SUN MON TUE WED THU FRI SAT".split(" ");
  return fields.length === 5 && fields.every((field, index) => {
    const [min, max] = bounds[index]!;
    const number = (token: string): number => {
      if (/^\d+$/u.test(token)) return Number(token);
      const names = index === 3 ? months : index === 4 ? days : [];
      const found = names.indexOf(token.toUpperCase());
      return found < 0 ? NaN : found + (index === 3 ? 1 : 0);
    };
    return field.split(",").every((part) => {
      const pieces = part.split("/");
      if (pieces.length > 2) return false;
      if (pieces.length === 2 && (!/^\d+$/u.test(pieces[1]!) || Number(pieces[1]) < 1 || Number(pieces[1]) > max)) return false;
      if (pieces[0] === "*") return true;
      const range = pieces[0]!.split("-");
      if (range.length > 2) return false;
      const start = number(range[0]!);
      const end = range.length === 2 ? number(range[1]!) : start;
      return start >= min && end <= max && start <= end;
    });
  });
}

/** A space's heartbeat. Weekly runs Monday; hour intervals use time's minute. */
export const spaceRunSchema = z.object({
  enabled: z.boolean(),
  cadence: z.enum(["hourly", "daily", "weekdays", "every5minutes", "every15minutes", "every30minutes", "every2hours", "every6hours", "weekly", "custom"]),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  cron: z.string().trim().min(1).max(100).refine(validCron, "Use a valid five-field cron expression (minute hour day month weekday).").optional(),
});
export type SpaceRun = z.infer<typeof spaceRunSchema>;
/** A space as a meta-project: its lead thread works beside the space's page. */
const spaceLead = z.object({
  spaceId: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string(),
  leadThreadId: z.string().nullable(),
  pageId: z.string().nullable(),
  pageHref: z.string().nullable(),
  defaultProjectId: z.string().nullable(),
  run: spaceRunSchema.nullable(),
});
export type SpaceLeadView = z.infer<typeof spaceLead>;
/** The full request from experimental_NewThreadComposer; Studio picks the project. */
const newThreadRequest = conversationRequestSchema(z);
export type NewThreadRequestInput = z.output<typeof newThreadRequest>;
const spaceOverview = z.object({
  threads: z.array(z.object({
    id: z.string(), title: z.string(), status: z.string(), updatedAt: z.number(), parentThreadId: z.string().nullable(), isLead: z.boolean(),
    progress: z.string().nullable().optional(), progressAt: z.number().nullable().optional(),
    failureReason: z.string().nullable().optional(), blockedReason: z.string().nullable().optional(),
  })),
  activity: z.array(z.object({
    id: z.string(), threadId: z.string(), title: z.string(), isLead: z.boolean(),
    kind: z.enum(["progress", "failure", "blocked"]), summary: z.string(), at: z.number(),
  })),
  /** `ref` is `<plugin>:<id>`. */
  items: z.array(z.object({
    ref: z.string(), title: z.string(), kind: z.string(), href: z.string(), icon: z.string().nullable(), updatedAt: z.number(),
    /** The kind's name and icon. */
    kindLabel: z.string(), kindIcon: z.string(),
    preview: z.string().nullable(), updatedBy: z.enum(["user", "agent"]).nullable(),
  })),
});
export type SpaceOverviewView = z.infer<typeof spaceOverview>;

export const rpcContract = defineRpcContract({
  home: {
    input: z.object({ projectId: z.string().optional(), periodDays: z.number().int().min(1).max(90).default(7) }),
    output: z.object({
      needsYou: z.array(needEntry).optional(),
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
      /** Tag ids per item, in tag-name order, and the spaces each is in. */
      items: z.array(listedItem),
      tags: z.array(tag),
      spaces: z.array(space),
      views: z.array(savedView),
    }),
  },
  items: { input: z.object({ pluginId, ids }), output: z.object({ items: z.array(listedItem) }) },
  changes: {
    input: z.object({ since: z.number().int().min(0) }),
    output: z.object({ cursor: z.number().int(), reset: z.boolean(), changes: z.array(z.object({ pluginId, id: z.string(), kind: z.string(), removed: z.boolean(), at: z.number() })) }),
  },
  /** `<plugin>:<id>` keys of items whose content matches, and the matching text by key. */
  search: {
    input: z.object({ query: z.string().min(1).max(200) }),
    output: z.object({ keys: z.array(z.string()), snippets: z.record(z.string(), z.string()) }),
  },
  searchStatus: { input: z.null(), output: searchStatus },
  searchRetry: { input: z.null(), output: searchStatus },
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
  /** Every space, for the sidebar. */
  spaces: { input: z.null(), output: z.object({ spaces: z.array(space) }) },
  /** Spaces are made, renamed and deleted by the user only. */
  createSpace: { input: spaceFields.extend({ name: tagName }), output: z.object({ space }) },
  updateSpace: { input: spaceFields.extend({ id: spaceId, name: tagName.optional() }), output: z.object({ space }) },
  deleteSpace: { input: z.object({ id: spaceId }), output: z.object({ ok: z.boolean() }) },
  spaceMembers: {
    input: z.object({ id: spaceId, add: z.array(spaceMember).max(500).default([]), remove: z.array(spaceMember).max(500).default([]) }),
    output: z.object({ space }),
  },
  /** The spaces a thread is in; `inherited` ones hold it through a project. */
  spacesForThread: { input: z.object({ threadId: z.string().min(1).max(200) }), output: z.object({ spaces: z.array(space), inherited: z.array(z.string()) }) },
  /** Spaces picked in a project's new-thread composer; the next thread started there moves to the last one. */
  pendingThreadSpaces: { input: z.object({ projectId: z.string().min(1).max(200), ids: z.array(spaceId).max(50) }), output: z.object({ ok: z.boolean() }) },
  /** A space's brief page, made from the space template if it has none; null without Pages. */
  spacePage: { input: z.object({ id: spaceId }), output: z.object({ href: z.string().nullable() }) },
  /** An item made in the space's catch-all project, so it's in the space. */
  createInSpace: { input: z.object({ id: spaceId, pluginId, kind: z.string().min(1).max(100) }), output: z.object({ href: z.string(), title: z.string().optional() }) },
  /** Open threads to pick from when adding one to a space. */
  recentThreads: { input: z.null(), output: z.object({ threads: z.array(spaceThread) }) },
  /** A space's lead, page and heartbeat. Clears a lead thread that was deleted. */
  space_lead: { input: z.object({ spaceId }), output: spaceLead },
  /** Makes sure the space has its page and a lead thread; idempotent and serialized per space. */
  space_lead_setup: { input: z.object({ spaceId, request: newThreadRequest }), output: spaceLead },
  /** Starts a thread in the project picked in the composer and adds it to the space. */
  space_thread_start: { input: z.object({ spaceId, request: newThreadRequest }), output: z.object({ threadId: z.string() }) },
  /** The space's open threads (added, or through its projects, unless another space holds them) and its items, newest first. */
  space_overview: { input: z.object({ spaceId }), output: spaceOverview },
  /** The one space each thread is in. Refetch on Studio's realtime channel. */
  space_of_threads: { input: z.object({}), output: z.object({ threads: z.record(z.string(), z.string()) }) },
  /** Turns the lead's heartbeat on or off. */
  space_set_run: { input: spaceRunSchema.omit({ time: true }).extend({ spaceId, time: spaceRunSchema.shape.time.optional() }), output: spaceLead },
  /** Continues a thread in a new one on the chosen provider and archives the old one; a lead stays the lead. */
  thread_handoff: { input: z.object({ threadId: z.string().min(1).max(200), request: newThreadRequest }), output: z.object({ threadId: z.string() }) },
  /** Saves a collection query by name, replacing a view with that name. */
  saveView: { input: z.object({ name: z.string().min(1).max(60), query: z.string().max(500) }), output: z.object({ view: savedView }) },
  deleteView: { input: z.object({ id: z.string().min(1).max(100) }), output: z.object({ ok: z.boolean() }) },
  /** Add-ons call this when their items change. */
  studio_changed: schemas.changed,
  sidebar: { input: z.null(), output: sidebar },
  /** Every space with what it holds, for the sidebar's tree. */
  spaceTree: { input: z.object({}), output: z.object({ spaces: z.array(treeSpace) }) },
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
  /** The items linked to a thread: made in it, mentioned when it started, or handed off to it. */
  threadItems: { input: z.object({ threadId: z.string().min(1).max(200) }), output: z.object({ threads: z.array(thread) }) },
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
