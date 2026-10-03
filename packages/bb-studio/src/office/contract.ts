import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { conversationRequestSchema } from "@bb-studio/kit/contract";
import { inboxEventSchema, inboxContract } from "./inbox-contract";
export { inboxEventSchema, type InboxEvent } from "./inbox-contract";

import { officeTabsContract, todayArchiveAfterSchema } from "./tabs-contract";
export { officeTabsContract, officeTabSchema, tabFolderSchema, type Tab, type TabZone, type TabFolder } from "./tabs-contract";

const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(100);
export const trustSchema = z.enum(["ask", "act"]);
/** A Space's color, like an Arc Space's: it tints the sidebar and marks the Space in the footer. */
export const spaceColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export { SPACE_COLORS } from "./space-colors";
export const officeSpaceSchema = z.object({
  position: z.number().int().nonnegative(),
  id, name, icon: z.string().max(100).nullable(), color: spaceColorSchema, description: z.string(),
  isDefault: z.boolean(), defaultProjectId: id.nullable(),
  projectIds: z.array(id), createdAt: z.number(), updatedAt: z.number(),
});
export const spaceSettingsSchema = z.object({
  todayArchiveAfter: todayArchiveAfterSchema.default("3d"),
  enabledItemKinds: z.array(id).nullable(),
  defaultTrust: trustSchema,
  defaultBotModel: z.object({ providerId: id, model: id }).nullable(),
});
export const spaceSettingsPatchSchema = spaceSettingsSchema.partial().extend({ todayArchiveAfter: todayArchiveAfterSchema.optional() });
export const officeItemSchema = z.object({
  pluginId: id, id, kind: id, title: z.string(), href: z.string(),
  projectId: id.nullable(), authorBotId: id.nullable(), updatedAt: z.number(),
});
export const officeThreadSchema = z.object({
  id, title: z.string(), state: z.string(), updatedAt: z.number(),
  authorBotId: id.nullable(),
});
export const folderSchema = z.object({
  id, spaceId: id, name: z.string(), path: z.string().nullable(),
  archived: z.boolean(), isDefault: z.boolean(),
});
const spaceInput = z.object({ name, icon: z.string().max(100).nullable().optional(), color: spaceColorSchema.optional(), description: z.string().max(500).optional() });

export const workingTaskSchema = z.object({
  id, botId: id.nullable(), title: z.string(),
  status: z.enum(["working", "waiting", "review", "done"]),
  note: z.string().nullable(), recurring: z.string().nullable(), href: z.string(), updatedAt: z.number(),
});
export const teamBotSchema = z.object({
  id, name: z.string(), avatar: z.string().nullable(), role: z.string().nullable(),
  spaceId: id, model: z.string().nullable(), trust: trustSchema,
  /** The provider the bot runs on: codex, claude-code, or an external agent such as hermes or openclaw. */
  providerId: z.string().default("codex"),
  state: z.enum(["idle", "working", "needs_you"]), activeTaskCount: z.number().int().nonnegative(),
});
export const talkConversationSchema = z.object({
  id, title: z.string(), memberBotIds: z.array(id), isDirect: z.boolean(),
  needsYou: z.boolean(), unread: z.boolean(), href: z.string(),
});

/** Published before module integration so web and native clients share one
 * contract. Registered when the Teams and Tasks services are ready. */
export const officeTeamContract = defineRpcContract({
  team_list: { input: z.object({ spaceId: id }), output: z.object({ bots: z.array(teamBotSchema) }) },
  bot_desk: { input: z.object({ botId: id }), output: z.object({
    bot: teamBotSchema, tasks: z.array(workingTaskSchema),
    directConversationId: id.nullable(), directThreadId: id.nullable(), profileHref: z.string(),
    memory: z.object({ mission: z.string(), memory: z.string() }).nullable(),
  }) },
  talk_dm: { input: z.object({ botId: id }), output: z.object({ conversationId: id, threadId: id }) },
  talk_list: { input: z.object({ spaceId: id }), output: z.object({ conversations: z.array(talkConversationSchema) }) },
  delegate: { input: z.object({
    botId: id, brief: z.string().trim().min(1).max(64000),
    context: z.array(z.string().min(1).max(500)).max(100).optional(), folderId: id.nullable().optional(),
    schedule: z.enum(["hourly", "daily", "weekdays", "weekly"]).optional(),
  }), output: z.object({ taskId: id, task: workingTaskSchema }) },
});

/** Office RPCs use project ownership for Space membership. Legacy camelCase
 * RPCs remain separate while the existing UI is replaced. */
export const officeContract = defineRpcContract({
  ...inboxContract,
  ...officeTabsContract,
  ...officeTeamContract,
  office_start: {
    input: z.object({ spaceId: id, request: conversationRequestSchema(z) }),
    output: z.union([z.object({ threadId: id }), z.object({ taskId: id, botId: id })]),
  },
  home: { input: z.object({ spaceId: id }), output: z.object({
    needsYou: z.array(inboxEventSchema), reports: z.array(inboxEventSchema), recent: z.array(officeItemSchema),
    working: z.array(workingTaskSchema),
  }) },
  space_reorder: { input: z.object({ spaceIds: z.array(id).max(10000) }), output: z.object({ ok: z.literal(true) }) },
  spaces_list: { input: z.object({}), output: z.object({ spaces: z.array(officeSpaceSchema) }) },
  space_create: { input: spaceInput, output: z.object({ space: officeSpaceSchema }) },
  space_update: { input: spaceInput.partial().extend({ spaceId: id }), output: z.object({ space: officeSpaceSchema }) },
  space_delete: { input: z.object({ spaceId: id }), output: z.object({ ok: z.boolean() }) },
  space_move_project: { input: z.object({ projectId: id, spaceId: id }), output: z.object({ space: officeSpaceSchema }) },
  space_settings_get: { input: z.object({ spaceId: id }), output: z.object({ settings: spaceSettingsSchema }) },
  space_settings_set: { input: z.object({ spaceId: id, settings: spaceSettingsPatchSchema }), output: z.object({ settings: spaceSettingsSchema }) },
  folder_create: { input: z.object({ spaceId: id, name }), output: z.object({ folder: folderSchema }) },
  folder_archive: { input: z.object({ folderId: id }), output: z.object({ ok: z.boolean() }) },
  space_tree: { input: z.object({ spaceId: id }), output: z.object({
    space: officeSpaceSchema,
    folders: z.array(folderSchema.extend({ threads: z.array(officeThreadSchema), items: z.array(officeItemSchema) })),
  }) },
});

export type OfficeSpace = z.infer<typeof officeSpaceSchema>;
export type SpaceSettings = z.infer<typeof spaceSettingsSchema>;
export type OfficeFolder = z.infer<typeof folderSchema>;
export type OfficeItem = z.infer<typeof officeItemSchema>;
export type OfficeThread = z.infer<typeof officeThreadSchema>;
export type OfficeInput<M extends keyof typeof officeContract> = z.input<(typeof officeContract)[M]["input"]>;
export type OfficeOutput<M extends keyof typeof officeContract> = z.output<(typeof officeContract)[M]["output"]>;

export { recurringTaskContract, recurringSource, type RecurringTaskInput } from "./recurring-contract";

export const officeAuthorsRpc = { input: z.object({}), output: z.array(z.object({ threadId: id, botId: id })) };
