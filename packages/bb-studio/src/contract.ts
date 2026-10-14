import { defineRpcContract } from "@get-bb/plugin-sdk";
import { BOT_SHAPES } from "./bot-shapes";
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
const reasoningLevel = z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]);
const permissionMode = z.enum(["accept-edits", "auto", "full"]);
const bot = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string(),
  state: botStateSchema,
  threadId: z.string().nullable(),
  /** Its Memory page (a Studio page), once made. */
  memoryPageId: z.string().nullable().optional(),
  /** Its drawn avatar, a shape with eyes in a color; null shows the emoji. */
  shape: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  /** A sentence or two on its role, given to it ("You are my chief of staff."). */
  role: z.string().nullable().optional(),
  /** Its image avatar (generated or uploaded), served by Studio; null shows the drawn avatar. Clients that can't load it draw the avatar. */
  avatarImageUrl: z.string().nullable().optional(),
  /** The primary Bot: the personal project's lead. Additional Bots ("New bot") have their own thread. */
  primary: z.boolean().optional(),
  /** From its current thread's provider: "external" runs on an external agent provider (Studio Agents), with that provider's memory and tools; "studio" runs BB's tools (Memory, skills, runners). */
  kind: z.enum(["studio", "external"]).optional(),
  /** Its current thread's provider and model (read off BB; the model is the thread's, not the bot's). */
  providerId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
/** One of the Bot's own skills: only its thread loads them, until shared. */
const botSkill = z.object({
  name: z.string(), description: z.string(), updatedAt: z.number(),
  /** The curator moves unused skills active → stale (30 days) → archived (90 days, hidden from the Bot, restorable). */
  state: z.enum(["active", "stale", "archived"]).optional(),
  /** Pinned skills are exempt from the curator. */
  pinned: z.boolean().optional(),
  /** When the Bot last loaded or saved it. */
  usedAt: z.number().nullable().optional(),
});
/** A Bot's skill learning (src/skill-learning.ts): background reviews, the curator and staged changes. */
const botLearning = z.object({
  enabled: z.boolean(), interval: z.number(), reviewModel: z.string().nullable(), defaultModel: z.string().nullable(), models: z.array(z.string()),
  approval: z.boolean(), consolidate: z.boolean(), curatorPaused: z.boolean(),
  toolTurns: z.number(), userTurns: z.number(), reviewing: z.boolean(),
  lastReview: z.object({ at: z.number(), result: z.string() }).nullable(),
  lastCurator: z.object({ at: z.number(), result: z.string() }).nullable(),
  nextCuratorAt: z.number().nullable(),
  pending: z.array(z.object({ id: z.string(), name: z.string(), action: z.enum(["write", "delete"]), description: z.string().nullable(), diff: z.string(), createdAt: z.number() })),
});
export type BotLearningView = z.infer<typeof botLearning>;
export type BotSkillView = z.infer<typeof botSkill>;
/** The Bot, or null before one is made, and its heartbeat. */
const botView = z.object({ bot: bot.nullable(), run: heartbeatRunSchema.nullable() });
export type BotView = z.infer<typeof botView>;
const botName = z.string().trim().min(1).max(60);
const botAvatar = z.string().trim().min(1).max(16);
const botShape = z.enum(BOT_SHAPES);
const botColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const botRole = z.string().trim().max(400);
/** A Bot's image avatars (src/bot-avatar.ts). */
const botAvatarHistory = z.object({
  current: z.string().nullable(),
  previous: z.string().nullable(),
  images: z.array(z.object({ id: z.string(), url: z.string(), mime: z.string(), source: z.enum(["generated", "upload"]), prompt: z.string().nullable(), provider: z.string().nullable(), createdAt: z.number() })),
});
export type BotAvatarHistoryView = z.infer<typeof botAvatarHistory>;
/**
 * One edit to a Bot's profile (src/bot.ts, table bot_profile_changes): one
 * the Bot made itself (`actorBotId`), or the user's revert of one
 * (`reverts`, actorBotId null). avatarImage values are image ids ("" or null
 * for the drawn avatar), with their URLs while the image is kept.
 */
const botProfileChange = z.object({
  id: z.number(),
  field: z.enum(["name", "role", "avatar", "shape", "color", "avatarImage"]),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  oldImageUrl: z.string().nullable(),
  newImageUrl: z.string().nullable(),
  actorBotId: z.string().nullable(),
  /** The Bot that made it, by its current name; null for the user's reverts. */
  actorName: z.string().nullable(),
  threadId: z.string().nullable(),
  at: z.number(),
  /** The change this one undid. */
  reverts: z.number().nullable(),
  /** When the user reverted this change; null while it stands. */
  revertedAt: z.number().nullable(),
});
export type BotProfileChangeView = z.infer<typeof botProfileChange>;
/** Which Bot a bot_* call acts on; the primary Bot when absent. */
const botId = z.string().min(1).max(100).optional();
/** Import bot: the provider (one of EXTERNAL_PROVIDERS) and model its thread runs on. */
const externalBot = z.object({ providerId: z.string().min(1).max(100), model: z.string().min(1).max(200), permissionMode: permissionMode.optional() });
const externalProviders = z.object({
  /** Studio Agents (plugin id external-agents) is installed and answering. */
  installed: z.boolean(),
  providers: z.array(z.object({
    id: z.string(),
    displayName: z.string(),
    logoUrl: z.string().nullable(),
    /** ready: registered and reachable; disabled: off in Studio Agents settings; offline/unauthenticated: its health check failed. */
    status: z.enum(["ready", "disabled", "offline", "unauthenticated", "missing"]),
    message: z.string(),
    models: z.array(z.object({ id: z.string(), displayName: z.string(), isDefault: z.boolean() })),
    /** The permission modes it supports, from BB's provider list (empty when it isn't registered). */
    permissionModes: z.array(permissionMode).default([]),
  })),
});
export type ExternalProvidersView = z.infer<typeof externalProviders>;
const forBot = z.object({ botId });
/** A Bot's prompt-cache warming settings (src/bot-cache.ts); wakeStart and wakeEnd are minutes after the host's local midnight. */
const warmSettings = z.object({ enabled: z.boolean(), thresholdTokens: z.number(), idleHours: z.number(), wakeStart: z.number(), wakeEnd: z.number() });
/** A Bot chat's prompt cache: warm (and until when), cold, or not warmed, with the cost estimates from Studio's price table. */
const botCacheState = z.object({
  botId: z.string().nullable(),
  threadId: z.string(),
  state: z.enum(["warm", "cold", "off"]),
  /** "Warm · 42m", "Cold" or "Warming off"; empty when it isn't a Bot's chat. */
  label: z.string(),
  warmUntil: z.number().nullable(),
  model: z.string().nullable(),
  contextTokens: z.number().nullable(),
  warming: z.object({ active: z.boolean(), nextPingAt: z.number().nullable(), reason: z.string().nullable(), lastPingAt: z.number().nullable() }),
  /** US dollars; null when the model isn't in the price table. */
  costs: z.object({ warmingPerHour: z.number().nullable(), coldSend: z.number().nullable(), warmSend: z.number().nullable() }),
  banner: z.boolean(),
  settings: warmSettings,
});
export type BotCacheStateView = z.infer<typeof botCacheState>;
/** A side thread on one of a Bot's replies (src/bot-side-threads.ts). */
const sideThread = z.object({ messageId: z.string(), threadId: z.string(), replies: z.number(), lastReplyAt: z.number().nullable(), working: z.boolean() });
export type SideThreadView = z.infer<typeof sideThread>;
const threadIdInput = z.string().min(1).max(200);
/** A thread in the Bot's Activity: its own thread ("self") or one it started. */
const botThread = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  projectId: z.string().nullable(),
  updatedAt: z.number(),
  relation: z.enum(["self", "started"]),
  needsYou: z.boolean(),
  /** The listed thread that started this one; null when the Bot did (or for its own). */
  parentId: z.string().nullable().default(null),
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
  /** Queued threads, or ones whose message is scheduled for later. */
  waiting: z.array(botThread).default([]),
  scheduled: z.array(botScheduled),
  completed: z.array(botThread),
  /** The end of the Bot thread's latest reply, for the home's chat preview. */
  latest: z.string().nullable(),
});
export type BotActivityView = z.infer<typeof botActivity>;
/** A Bot's runner (src/runners.ts): a long-lived thread on its own schedule that reports only through runner_report. */
const runnerSchedule = heartbeatRunSchema.omit({ enabled: true, time: true }).extend({ time: heartbeatRunSchema.shape.time.default("09:00") });
const runnerLevel = z.enum(["log", "tell", "urgent"]);
const runner = z.object({
  id: z.string(),
  name: z.string(),
  job: z.string(),
  threadId: z.string().nullable(),
  state: z.enum(["active", "paused"]),
  /** Adopted from a thread and automation the Bot had; deleting only lets it go. */
  adopted: z.boolean(),
  schedule: heartbeatRunSchema.omit({ enabled: true }),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  lastLevel: runnerLevel.nullable(),
  lastReport: z.string().nullable(),
  lastReportAt: z.number().nullable(),
  /** An urgent report the user hasn't opened: it's in Needs you. */
  urgent: z.boolean(),
});
export type RunnerView = z.infer<typeof runner>;
/** A thread the Bot started that an automation wakes: it can be adopted as a runner. */
const runnerAdoptable = z.object({ threadId: z.string(), title: z.string(), automationId: z.string(), automationName: z.string(), projectId: z.string(), cron: z.string().nullable(), enabled: z.boolean() });
export type RunnerAdoptableView = z.infer<typeof runnerAdoptable>;
/** A Bot automation's schedule (src/schedule.ts): times on days, an interval in a window, a raw cron, or once. */
const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const weekday = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
const scheduleCommon = {
  timezone: z.string().min(1).max(100).optional(),
  quiet: z.object({ from: hhmm, to: hhmm }).nullish(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
};
export const scheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("times"), days: z.array(weekday).min(1).max(7), times: z.array(hhmm).min(1).max(24), ...scheduleCommon }),
  z.object({ type: z.literal("interval"), every: z.number().int().min(1).max(1440), unit: z.enum(["minutes", "hours"]), days: z.array(weekday).min(1).max(7), from: hhmm.optional(), to: hhmm.optional(), ...scheduleCommon }),
  z.object({ type: z.literal("cron"), cron: z.string().trim().min(1).max(100), ...scheduleCommon }),
  z.object({ type: z.literal("once"), at: z.number() }),
]);
const automationKind = z.enum(["checkin", "runner", "reminder", "watcher"]);
const interpreter = z.enum(["bash", "sh", "node", "python3"]);
/** One of a Bot's automations (src/automations.ts): check-in, runner, reminder or watcher. */
const botAutomation = z.object({
  id: z.string(),
  kind: automationKind,
  name: z.string(),
  /** The Bot's original check-in (its heartbeat): its instruction is the Memory page's Check-in section. */
  original: z.boolean(),
  instruction: z.string(),
  schedule: scheduleSchema,
  scheduleText: z.string(),
  state: z.enum(["active", "paused", "done", "ended"]),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  lastOutcome: z.string().nullable(),
  /** Check-ins and reminders: a model and reasoning other than the Bot thread's; null fields use the thread's. */
  model: z.object({ model: z.string().nullable(), reasoning: z.string().nullable() }).nullable(),
  /** Watchers: the script (env values aren't sent back). */
  script: z.object({ body: z.string(), interpreter, timeoutMs: z.number(), workingDirectory: z.string().nullable(), envKeys: z.array(z.string()) }).nullable(),
  /** Who it wakes: "main" (the Bot's thread), a runner id (watchers), or "own" (a runner's own thread). */
  target: z.string(),
  targetName: z.string(),
  threadId: z.string().nullable(),
});
export type BotAutomationView = z.infer<typeof botAutomation>;
const botAutomationRun = z.object({ id: z.string(), at: z.number(), status: z.string(), manual: z.boolean(), outcome: z.string(), threadId: z.string().nullable() });
export type BotAutomationRunView = z.infer<typeof botAutomationRun>;
const automationName = z.string().trim().min(1).max(60);
const automationInstruction = z.string().trim().max(2000);
const automationModel = z.object({ model: z.string().max(200).nullish(), reasoning: z.string().max(40).nullish() }).nullish();
const automationScript = z.object({ body: z.string().min(1).max(262_144), interpreter, timeoutMs: z.number().int().min(1000).max(900_000).optional(), env: z.record(z.string(), z.string()).optional(), workingDirectory: z.string().max(4096).nullish() });
const automationId = z.string().min(1).max(200);
const runnerName = z.string().trim().min(1).max(60);
const runnerJob = z.string().trim().min(1).max(2000);
const runnerId = z.string().min(1).max(200);
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
  /** Every Bot, the primary first. */
  bot_list: { input: z.object({}), output: z.object({ bots: z.array(bot) }) },
  /** A Bot (the primary without botId) and its heartbeat; bot null before one is made. */
  bot_get: { input: forBot, output: botView },
  /** Makes a Bot: from an existing thread, or a new chat in the personal project started with `prompt`. The first is the primary; later ones are additional Bots. */
  bot_create: { input: z.object({ name: botName, avatar: botAvatar, shape: botShape.optional(), color: botColor.optional(), threadId: z.string().min(1).max(200).optional(), prompt: z.string().trim().min(1).max(20000).optional(), setup: z.string().trim().max(2000).optional(), external: externalBot.optional() }), output: botView },
  /** The external agent providers a bot can be imported from (Studio Agents), with their status and models. */
  bot_external_providers: { input: z.object({}), output: externalProviders },
  /**
   * Switches any thread's model. The same provider switches it in place (as
   * BB's composer does); another provider hands it off to a new thread there
   * with a summary, carrying its permission forward. A bot's thread hands off
   * along the bot's chain. threadId is the thread to follow afterwards.
   */
  thread_handoff_to_model: {
    input: z.object({ threadId: z.string().min(1).max(200), providerId: z.string().min(1).max(100), model: z.string().min(1).max(200), reasoning: reasoningLevel.optional() }),
    output: z.object({ change: z.enum(["unchanged", "in-place", "handoff"]), threadId: z.string() }),
  },
  /** Renames the Bot or changes its avatar. */
  bot_set: { input: z.object({ botId, name: botName.optional(), avatar: botAvatar.optional(), shape: botShape.nullable().optional(), color: botColor.optional(), role: botRole.optional() }), output: botView },
  /** Its image avatars, newest first (the last few), the one shown and the one Revert goes back to ("" for the drawn avatar, null for nothing). */
  bot_avatar_history: { input: forBot, output: botAvatarHistory },
  /** Shows one of its images, or the drawn avatar (imageId null). */
  bot_avatar_use: { input: z.object({ botId, imageId: z.string().min(1).max(100).nullable() }), output: botView },
  /** Back to the avatar the last change replaced. */
  bot_avatar_revert: { input: forBot, output: botView },
  /** Uploads an image (PNG, JPEG, WebP or GIF, base64, at most 4 MB) and shows it. */
  bot_avatar_upload: { input: z.object({ botId, data: z.string().min(1).max(6_000_000) }), output: botView },
  /** Edits the Bot made to its own profile, and the user's reverts of them, newest first. */
  bot_profile_changes: { input: forBot, output: z.object({ changes: z.array(botProfileChange) }) },
  /** Restores the value a Bot's own edit replaced, recording the revert. */
  bot_profile_revert: { input: z.object({ botId, changeId: z.number().int().positive() }), output: botView },
  /** Makes a thread the Bot's thread ("Make this my Bot"); makes the Bot if there is none. */
  bot_set_thread: { input: z.object({ threadId: z.string().min(1).max(200) }), output: botView },
  /** The Bot's heartbeat (check-ins); on needs an active Bot. */
  bot_set_run: { input: heartbeatRunSchema.omit({ time: true }).extend({ botId, time: heartbeatRunSchema.shape.time.optional() }), output: botView },
  /** Pauses the Bot: heartbeat off, and it's told it's paused and refuses new work. */
  bot_pause: { input: forBot, output: botView },
  /** Resumes a paused or stopped Bot, and its heartbeat if it was on. */
  bot_resume: { input: forBot, output: botView },
  /** Pauses the Bot, stops the running threads it started and turns off its schedules. Its data is kept. */
  bot_stop: { input: forBot, output: botView.extend({ stoppedThreadIds: z.array(z.string()), pausedAutomationIds: z.array(z.string()) }) },
  /** What the Bot is doing: Needs you, In progress, Scheduled, Completed. */
  bot_activity: { input: forBot, output: botActivity },
  /** A thread's prompt cache when it's a Bot's chat (botId null otherwise); with botId alone, that Bot's chat. */
  bot_cache_state: { input: z.object({ threadId: threadIdInput.optional(), botId }), output: botCacheState },
  /** Changes a Bot's cache-warming settings; returns its chat's cache state. */
  bot_cache_set: { input: z.object({ botId, enabled: z.boolean().optional(), thresholdTokens: z.number().int().min(10_000).max(2_000_000).optional(), idleHours: z.number().min(0.5).max(24).optional(), wakeStart: z.number().int().min(0).max(1439).optional(), wakeEnd: z.number().int().min(0).max(1440).optional() }), output: botCacheState },
  /** "Don't show for this thread": no cold-send banner in this chat again. */
  bot_cache_banner_hide: { input: z.object({ threadId: threadIdInput }), output: z.object({ ok: z.literal(true) }) },
  /** Starts BB's compaction of an idle Bot chat (the user's manual action). */
  bot_cache_compact: { input: z.object({ threadId: threadIdInput }), output: z.object({ ok: z.literal(true) }) },
  /** The Bot's Memory page, made on first need. */
  bot_memory: { input: forBot, output: z.object({ pageId: z.string().nullable() }) },
  /** The Bot's chat as one conversation: its thread and the ones it handed off from, oldest first. `threads` carries each one's title: they're hidden, so BB's title lookup shows nothing. */
  bot_chain: { input: forBot, output: z.object({ threadIds: z.array(z.string()), threads: z.array(z.object({ id: z.string(), title: z.string() })) }) },
  /** The side threads on a Bot chat's replies (src/bot-side-threads.ts), by reply; chat is false on any other thread. */
  bot_side_threads: { input: z.object({ threadId: threadIdInput }), output: z.object({ chat: z.boolean(), threads: z.array(sideThread) }) },
  /** A reply's side thread: a fork of the chat at that reply, made on first open. */
  bot_side_thread_open: { input: z.object({ threadId: threadIdInput, messageId: z.string().min(1).max(200) }), output: z.object({ threadId: z.string(), created: z.boolean() }) },
  /** The Bot a thread belongs to (its chat, a thread it started, a runner, an automation run), or null: the sidebar keeps the Bots list on it. */
  bot_thread_owner: { input: z.object({ threadId: z.string().min(1).max(200) }), output: z.object({ botId: z.string().nullable() }) },
  /** A check-in preset: sets the schedule and adds its one-line instruction to the Memory page's Check-in section. */
  bot_checkin_preset: { input: z.object({ botId, preset: z.enum(["morning", "evening", "working", "off"]) }), output: botView },
  /** The Bot's own skills. */
  bot_skills: { input: forBot, output: z.object({ skills: z.array(botSkill) }) },
  /** Adds or replaces one of the Bot's skills (as its bot_skill_write tool does). */
  bot_skill_write: { input: z.object({ botId, name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64), description: z.string().trim().min(1).max(500), body: z.string().min(1).max(20_000) }), output: botSkill },
  /** Shares a Bot skill: it moves into BB's user skills, for every agent. */
  bot_skill_share: { input: z.object({ botId, name: z.string().min(1).max(100) }), output: z.object({ path: z.string() }) },
  /** Deletes a Bot skill. */
  bot_skill_delete: { input: z.object({ botId, name: z.string().min(1).max(100) }), output: z.object({ deleted: z.boolean() }) },
  /** Pins a skill (the curator leaves it alone) or unpins it. */
  bot_skill_pin: { input: z.object({ botId, name: z.string().min(1).max(100), pinned: z.boolean() }), output: z.object({ changed: z.boolean() }) },
  /** Brings an archived (or stale) skill back to active. */
  bot_skill_restore: { input: z.object({ botId, name: z.string().min(1).max(100) }), output: z.object({ changed: z.boolean() }) },
  /** The Bot's skill learning: settings, counters, the last review and curator run, staged changes. */
  bot_learning: { input: forBot, output: botLearning },
  /** Changes the Bot's skill learning settings. */
  bot_learning_set: { input: z.object({ botId, enabled: z.boolean().optional(), interval: z.number().int().min(2).max(200).optional(), reviewModel: z.string().max(200).nullable().optional(), approval: z.boolean().optional(), consolidate: z.boolean().optional(), curatorPaused: z.boolean().optional() }), output: botLearning },
  /** Starts a skill review now (a fork of the Bot's idle thread); started is false when one is running or the Bot is busy. */
  bot_learning_review: { input: forBot, output: z.object({ started: z.boolean() }) },
  /** Runs the skill curator now; dryRun lists what it would change. */
  bot_skill_curate: { input: z.object({ botId, dryRun: z.boolean().optional() }), output: z.object({ changes: z.array(z.object({ name: z.string(), from: z.string(), to: z.string() })), consolidating: z.boolean(), result: z.string() }) },
  /** Approves or rejects a review's staged skill change. */
  bot_skill_pending_resolve: { input: z.object({ botId, id: z.string().min(1).max(100), approve: z.boolean() }), output: botLearning },
  /** The Bot's runners, and threads it started that an automation wakes (Adopt as runner). */
  bot_runners: { input: forBot, output: z.object({ runners: z.array(runner), adoptable: z.array(runnerAdoptable) }) },
  /** Makes a runner: its thread (first run now) and its schedule. */
  bot_runner_create: { input: z.object({ botId, name: runnerName, job: runnerJob, schedule: runnerSchedule }), output: runner },
  bot_runner_update: { input: z.object({ botId, id: runnerId, name: runnerName.optional(), job: runnerJob.optional(), schedule: runnerSchedule.optional() }), output: runner },
  bot_runner_pause: { input: z.object({ botId, id: runnerId }), output: runner },
  bot_runner_resume: { input: z.object({ botId, id: runnerId }), output: runner },
  bot_runner_run_now: { input: z.object({ botId, id: runnerId }), output: runner },
  /** Deletes a runner Studio made (automation deleted, thread archived); an adopted one is only let go. */
  bot_runner_delete: { input: z.object({ botId, id: runnerId }), output: z.object({ deleted: z.literal(true), kept: z.boolean() }) },
  /** The user opened a runner: its urgent report leaves Needs you. */
  bot_runner_seen: { input: z.object({ botId, id: runnerId }), output: z.object({ ok: z.literal(true) }) },
  /** Adopt as runner: registers the thread, keeps its automation, switches it to runner_report. The user's choice only. */
  bot_runner_adopt: { input: z.object({ botId, threadId: z.string().min(1).max(200), automationId: z.string().min(1).max(200), name: runnerName.optional(), job: runnerJob.optional() }), output: runner },
  /** A Bot's automations: check-ins (its original one first), reminders, watchers and runners. */
  bot_automations: { input: forBot, output: z.object({ automations: z.array(botAutomation) }) },
  bot_automation_create: { input: z.object({ botId, kind: automationKind, name: automationName, instruction: automationInstruction.optional(), schedule: scheduleSchema, model: automationModel, script: automationScript.nullish(), target: z.string().max(200).nullish() }), output: botAutomation },
  bot_automation_update: { input: z.object({ botId, id: automationId, name: automationName.optional(), instruction: automationInstruction.optional(), schedule: scheduleSchema.optional(), model: automationModel, script: automationScript.nullish(), target: z.string().max(200).nullish() }), output: botAutomation },
  bot_automation_pause: { input: z.object({ botId, id: automationId }), output: botAutomation },
  bot_automation_resume: { input: z.object({ botId, id: automationId }), output: botAutomation },
  bot_automation_run_now: { input: z.object({ botId, id: automationId }), output: botAutomation },
  bot_automation_delete: { input: z.object({ botId, id: automationId }), output: z.object({ deleted: z.literal(true) }) },
  /** Recent runs, newest first, with what came of each. */
  bot_automation_runs: { input: z.object({ botId, id: automationId, limit: z.number().int().min(1).max(50).optional() }), output: z.object({ runs: z.array(botAutomationRun) }) },
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
