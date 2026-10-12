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
const thread = z.object({ threadId: z.string(), ref: itemRef, role: z.string(), state: z.string(), createdAt: z.number(), updatedAt: z.number(), metadata: z.record(z.string(), z.string()) });
const comment = z.object({ id: z.string(), ref: itemRef, parentId: z.string().nullable(), anchor: z.string().nullable(), actor, body: z.string(), createdAt: z.number(), resolvedAt: z.number().nullable() });
const version = z.object({ id: z.string(), ref: itemRef, sha256: z.string(), label: z.string(), actor, createdAt: z.number() });
export type TagView = z.infer<typeof tag>;

/** A thread to pick as a lead. */
const threadOption = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  projectId: z.string().nullable(),
  updatedAt: z.number(),
});
export type ThreadOptionView = z.infer<typeof threadOption>;
const savedView = z.object({ id: z.string(), name: z.string(), query: z.string() });
export type SavedViewView = z.infer<typeof savedView>;
const listedItem = schemas.item.extend({ pluginId: z.string(), tags: z.array(z.string()) });

export { TABS_CHANNEL } from "./ids";

const itemLink = z.object({
  pluginId: z.string(),
  id: z.string(),
  title: z.string(),
  /** The item's emoji, or null for its kind's icon. */
  icon: z.string().nullable(),
  kindIcon: z.string(),
  href: z.string(),
});
/** An open tab; pinned tabs come first and are never closed to make room. */
const tab = itemLink.extend({ pinned: z.boolean() });
export type TabView = z.infer<typeof tab>;

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

/** A project lead's heartbeat. Weekly runs Monday; hour intervals use time's minute. */
export const heartbeatRunSchema = z.object({
  enabled: z.boolean(),
  cadence: z.enum(["hourly", "daily", "weekdays", "every5minutes", "every15minutes", "every30minutes", "every2hours", "every6hours", "weekly", "custom"]),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  cron: z.string().trim().min(1).max(100).refine(validCron, "Use a valid five-field cron expression (minute hour day month weekday).").optional(),
});
export type HeartbeatRun = z.infer<typeof heartbeatRunSchema>;
/** A BB project's optional lead thread and its heartbeat. */
const projectLead = z.object({
  projectId: z.string(),
  leadThreadId: z.string().nullable(),
  run: heartbeatRunSchema.nullable(),
});
export type ProjectLeadView = z.infer<typeof projectLead>;
const leadProjectId = z.string().min(1).max(200);
/** Deprecated (chief_of_staff*): the Bot's thread and heartbeat. Same data as project_lead for proj_personal. */
const chiefOfStaff = z.object({
  threadId: z.string().nullable(),
  run: heartbeatRunSchema.nullable(),
});
export type ChiefOfStaffView = z.infer<typeof chiefOfStaff>;
/** The user's Bot (src/bot.ts): an always-on agent. Its thread is an implementation detail that handoffs rotate. */
export const botStateSchema = z.enum(["active", "paused", "stopped"]);
const bot = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string(),
  state: botStateSchema,
  threadId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
/** The Bot, or null before one is made, and its heartbeat. */
const botView = z.object({ bot: bot.nullable(), run: heartbeatRunSchema.nullable() });
export type BotView = z.infer<typeof botView>;
const botName = z.string().trim().min(1).max(60);
const botAvatar = z.string().trim().min(1).max(16);
/** A thread in the Bot's Activity: its own thread ("self") or one it started. */
const botThread = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  projectId: z.string().nullable(),
  updatedAt: z.number(),
  relation: z.enum(["self", "started"]),
  needsYou: z.boolean(),
});
export type BotThreadView = z.infer<typeof botThread>;
const botScheduled = z.object({
  id: z.string(),
  kind: z.enum(["heartbeat", "automation"]),
  name: z.string(),
  cron: z.string().nullable(),
  enabled: z.boolean(),
  nextRunAt: z.number().nullable(),
});
export type BotScheduledView = z.infer<typeof botScheduled>;
const botActivity = z.object({
  needsYou: z.array(botThread),
  inProgress: z.array(botThread),
  scheduled: z.array(botScheduled),
  completed: z.array(botThread),
  /** The end of the Bot thread's latest reply, for the home's chat preview. */
  latest: z.string().nullable(),
});
export type BotActivityView = z.infer<typeof botActivity>;
/** The full request from experimental_NewThreadComposer; Studio picks the project. */
const newThreadRequest = conversationRequestSchema(z);
export type NewThreadRequestInput = z.output<typeof newThreadRequest>;
export const rpcContract = defineRpcContract({
  /** Every provider and all of their items. */
  overview: {
    input: z.null(),
    output: z.object({
      providers: z.array(provider),
      /** Tag ids per item, in tag-name order. */
      items: z.array(listedItem),
      tags: z.array(tag),
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
  rename: { input: z.object({ pluginId, id: z.string().min(1).max(200), title: z.string().trim().min(1).max(200) }), output: schemas.results },
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
  /** Open threads, newest first, to pick a lead from. */
  recentThreads: { input: z.null(), output: z.object({ threads: z.array(threadOption) }) },
  /** Every project with a lead or heartbeat settings. */
  project_leads: { input: z.object({}), output: z.object({ leads: z.array(projectLead) }) },
  /** A project's lead and heartbeat. Clears a lead thread that was deleted, and turns its heartbeat off. */
  project_lead: { input: z.object({ projectId: leadProjectId }), output: projectLead },
  /** Makes an existing thread the project's lead (out of any other project's lead role); null clears the lead and turns the heartbeat off. */
  project_set_lead: { input: z.object({ projectId: leadProjectId, threadId: z.string().min(1).max(200).nullable() }), output: projectLead },
  /** Turns the lead's heartbeat on or off; on needs a lead. */
  project_set_run: { input: heartbeatRunSchema.omit({ time: true }).extend({ projectId: leadProjectId, time: heartbeatRunSchema.shape.time.optional() }), output: projectLead },
  /** Deprecated alias of bot_get (one release): the Bot's thread and heartbeat. Clears a thread that was deleted. */
  chief_of_staff: { input: z.object({}), output: chiefOfStaff },
  /** Deprecated alias of bot_set_thread (one release); null leaves the Bot without a thread. */
  chief_of_staff_set: { input: z.object({ threadId: z.string().min(1).max(200).nullable() }), output: chiefOfStaff },
  /** Deprecated alias of bot_set_run (one release). */
  chief_of_staff_set_run: { input: heartbeatRunSchema.omit({ time: true }).extend({ time: heartbeatRunSchema.shape.time.optional() }), output: chiefOfStaff },
  /** The user's Bot and its heartbeat; bot null before one is made. */
  bot_get: { input: z.object({}), output: botView },
  /** Makes the Bot: from an existing thread, or a new chat in the personal project started with `prompt`. */
  bot_create: { input: z.object({ name: botName, avatar: botAvatar, threadId: z.string().min(1).max(200).optional(), prompt: z.string().trim().min(1).max(20000).optional() }), output: botView },
  /** Renames the Bot or changes its avatar. */
  bot_set: { input: z.object({ name: botName.optional(), avatar: botAvatar.optional() }), output: botView },
  /** Makes a thread the Bot's thread ("Make this my Bot"); makes the Bot if there is none. */
  bot_set_thread: { input: z.object({ threadId: z.string().min(1).max(200) }), output: botView },
  /** The Bot's heartbeat (check-ins); on needs an active Bot. */
  bot_set_run: { input: heartbeatRunSchema.omit({ time: true }).extend({ time: heartbeatRunSchema.shape.time.optional() }), output: botView },
  /** Pauses the Bot: heartbeat off, and it's told it's paused and refuses new work. */
  bot_pause: { input: z.object({}), output: botView },
  /** Resumes a paused or stopped Bot, and its heartbeat if it was on. */
  bot_resume: { input: z.object({}), output: botView },
  /** Pauses the Bot, stops the running threads it started and turns off its schedules. Its data is kept. */
  bot_stop: { input: z.object({}), output: botView.extend({ stoppedThreadIds: z.array(z.string()), pausedAutomationIds: z.array(z.string()) }) },
  /** What the Bot is doing: Needs you, In progress, Scheduled, Completed. */
  bot_activity: { input: z.object({}), output: botActivity },
  /** Continues a thread in a new one on the chosen provider and archives the old one; a lead stays the lead and the Bot keeps its new thread. */
  thread_handoff: { input: z.object({ threadId: z.string().min(1).max(200), request: newThreadRequest }), output: z.object({ threadId: z.string() }) },
  /** Saves a collection query by name, replacing a view with that name. */
  saveView: { input: z.object({ name: z.string().min(1).max(60), query: z.string().max(500) }), output: z.object({ view: savedView }) },
  deleteView: { input: z.object({ id: z.string().min(1).max(100) }), output: z.object({ ok: z.boolean() }) },
  /** Add-ons call this when their items change. */
  studio_changed: schemas.changed,
  sidebar: { input: z.null(), output: sidebar },
  /** Open tabs, in order; tabs of deleted items are closed. */
  tabs: { input: z.null(), output: z.object({ tabs: z.array(tab) }) },
  /** Opens a tab for the item whose view is at `path`, if any. */
  visitTab: { input: z.object({ path: z.string().min(1).max(2000) }), output: z.object({ tab: tab.nullable() }) },
  closeTabs: { input: z.object({ items: z.array(itemRef).min(1).max(100) }), output: z.object({ ok: z.boolean() }) },
  /** A window's workspace, so agents can see what the user has open (src/workspace-presence.ts). */
  workspaceReport: {
    input: z.object({
      client: z.string().min(1).max(100),
      focused: z.boolean(),
      showing: z.boolean(),
      panes: z.array(z.object({
        id: z.string().min(1).max(100),
        focused: z.boolean(),
        active: z.string().max(2000).nullable(),
        tabs: z.array(z.object({ href: z.string().min(1).max(2000), title: z.string().max(300) })).max(100),
      })).max(8),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Pins or unpins an item's tab; pinning opens it if it isn't open. */
  pinTab: { input: z.object({ pluginId, id: z.string().min(1).max(200), pinned: z.boolean() }), output: z.object({ ok: z.boolean() }) },
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
