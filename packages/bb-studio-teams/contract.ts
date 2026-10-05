import { revisionSchema, usageLimits, usageSummary } from "./workspace-contract";
import type { defineRpcContract } from "@get-bb/plugin-sdk";
import { botSetupThreadRequest } from "./bot-creation-contract";
import { z } from "zod";
export const idSchema = z.string().regex(/^bot_[a-f0-9]{16}$/);
export const permissionModeSchema = z.enum(["accept-edits", "auto", "full"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export const profileInput = z.object({
  limits: usageLimits.optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
  avatar: z.string().max(16).default("🤖"),
  providerId: z.string().max(100).default("codex"),
  model: z.string().max(200).default(""),
  fallbackProviderId: z.string().max(100).default(""),
  fallbackModel: z.string().max(200).default(""),
  fallbackReasoningLevel: z
    .enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"])
    .default("medium"),
  reasoningLevel: z
    .enum([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
      "ultracode",
    ])
    .default("medium"),
  permissionMode: permissionModeSchema.default("auto"),
  intervalMinutes: z
    .number()
    .int()
    .min(0)
    .max(10080)
    .refine((n) => n === 0 || n >= 5)
    .default(0),
});
export const botSchema = profileInput.extend({
  id: idSchema,
  handle: z.string(),
  home: z.string(),
  projectId: z.string(),
  hostId: z.string(),
  retired: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastWakeAt: z.number(),
  error: z.string().nullable(),
});
export type Bot = z.infer<typeof botSchema>;
export const botListItemSchema = botSchema.extend({
  working: z.boolean(),
  lastActivityAt: z.number().nullable(),
});
export type BotListItem = z.infer<typeof botListItemSchema>;
export const directThreadIndicatorSchema = z.enum([
  "background-agent", "background-command", "draft", "goal", "none",
  "plan-mode", "queued-failed", "queued-waiting", "runtime",
  "unread-error", "unread-success", "waiting-for-input", "workflow",
  "working-draft",
]);
export const threadStatusViewSchema = z.object({
  threadId: z.string(),
  indicator: directThreadIndicatorSchema,
  status: z.enum(["pending", "starting", "active", "stopping", "idle", "error"]),
});
export type ThreadStatusView = z.infer<typeof threadStatusViewSchema>;
export type DirectThreadView = ThreadStatusView;
export type ProfileInput = z.infer<typeof profileInput>;
export const botCreateInput = profileInput.extend({
  mission: z.string().min(1).max(64000),
});
export const botCreateRequestSchema = z.object({
  id: z.string().uuid(),
  requesterBotId: idSchema,
  requesterThreadId: z.string().min(1),
  requesterName: z.string().min(1),
  input: botCreateInput,
  status: z.enum([
    "pending",
    "approved",
    "creating",
    "created",
    "denied",
    "expired",
    "cancelled",
  ]),
  createdAt: z.number(),
  expiresAt: z.number(),
  resolvedAt: z.number().nullable(),
  createdBotId: idSchema.nullable().default(null),
});
export type BotCreateRequest = z.infer<typeof botCreateRequestSchema>;
export const botCreateRequestViewSchema = z.object({
  id: z.string().uuid(),
  requesterBotId: idSchema,
  requesterName: z.string().min(1),
  name: z.string(),
  description: z.string(),
  avatar: z.string(),
  providerId: z.string(),
  model: z.string(),
  reasoningLevel: z.string(),
  permissionMode: z.string(),
  intervalMinutes: z.number(),
  mission: z.string().max(4000),
  missionTruncated: z.boolean(),
  createdAt: z.number(),
  expiresAt: z.number(),
});
export type BotCreateRequestView = z.infer<typeof botCreateRequestViewSchema>;
// Creation defaults must never reset fields omitted from a partial update.
const profilePatch = z.object({
  limits: usageLimits.optional(),
  name: profileInput.shape.name.optional(),
  description: profileInput.shape.description.removeDefault().optional(),
  avatar: profileInput.shape.avatar.removeDefault().optional(),
  providerId: profileInput.shape.providerId.removeDefault().optional(),
  model: profileInput.shape.model.removeDefault().optional(),
  fallbackProviderId: profileInput.shape.fallbackProviderId.removeDefault().optional(),
  fallbackModel: profileInput.shape.fallbackModel.removeDefault().optional(),
  fallbackReasoningLevel: profileInput.shape.fallbackReasoningLevel.removeDefault().optional(),
  reasoningLevel: profileInput.shape.reasoningLevel.removeDefault().optional(),
  permissionMode: profileInput.shape.permissionMode.removeDefault().optional(),
  intervalMinutes: profileInput.shape.intervalMinutes
    .removeDefault()
    .optional(),
});
export const conversationSchema = z.object({
  id: z.string(),
  botId: idSchema,
  key: z.string(),
  threadId: z.string(),
  title: z.string(),
  kind: z.enum(["admin", "mission"]),
  createdAt: z.number(),
  archivedAt: z.number().optional(),
  originalKey: z.string().optional(),
  providerId: z.string().optional(),
  model: z.string().optional(),
});
export type Conversation = z.infer<typeof conversationSchema>;
export const directThreadInfoSchema = z.object({
  title: z.string(),
  projectId: z.string(),
  archivedAt: z.number().nullable(),
  pinned: z.boolean(),
  unread: z.boolean(),
  sectionId: z.string().nullable(),
  /** Last activity, for sorting the flat Direct messages list. */
  updatedAt: z.number().default(0),
});
export type DirectThreadInfo = z.infer<typeof directThreadInfoSchema>;
export const attachmentSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  projectId: z.string(),
  name: z.string(),
  path: z.string(),
  mimeType: z.string().optional(),
  type: z.enum(["localFile", "localImage"]),
  sizeBytes: z.number(),
  alt: z.string().max(500).optional(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export const jobSchema = z.object({
  contextMessageId: z.string().optional(),
  rosterVersion: z.string().optional(),
  delegationId: z.string().optional(),
  rootTaskId: z.string().optional(),
  parentTaskId: z.string().optional(),
  coordinatorId: idSchema.optional(),
  returnOf: z.string().optional(),
  timedOut: z.boolean().optional(),
  timeoutNoticePending: z.boolean().optional(),
  taskTitle: z.string().optional(),
  queueReason: z.string().optional(),
  queuePosition: z.number().optional(),
  dispatchAction: z.enum(["steer", "followup", "fork"]).optional(),
  forkSourceThreadId: z.string().optional(),
  requiresPromptMatch: z.boolean().optional(),
  fallbackAttempted: z.boolean().optional(),
  directMessageRequestIds: z.array(z.string()).optional(),
  pendingSteer: z
    .object({ priorPrompt: z.string(), attemptedAt: z.number().optional() })
    .optional(),
  wrapUpRequestedAt: z.number().optional(),
  /** How long the turn has run, without gaps the runtime didn't see (see turn-clock.ts). */
  turnMs: z.number().optional(),
  /** When the runtime last moved `turnMs`. */
  clockAt: z.number().optional(),
  /** When a turn that made no progress was stopped and sent again (once per job). */
  stallRetriedAt: z.number().optional(),
  automationId: z.string().optional(),
  id: z.string(),
  botId: idSchema,
  conversationKey: z.string(),
  threadId: z.string().nullable(),
  text: z.string(),
  status: z.enum([
    "queued",
    "dispatching",
    "running",
    "done",
    "error",
    "cancelled",
  ]),
  cancellationPending: z.boolean().optional(),
  activitySnippet: z.string().max(240).optional(),
  retryOf: z.string().optional(),
  reply: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().nullable(),
  dispatchStartedAt: z.number().nullable().default(null),
  roomId: z.string().nullable(),
  runId: z.string().nullable(),
  triggerMessageId: z.string().nullable().default(null),
  depth: z.number().int().default(0),
  attachments: z.array(attachmentSchema).default([]),
  outputAttachments: z.array(attachmentSchema).default([]),
});
export type Job = z.infer<typeof jobSchema>;
export const rpcContract = {
  createBotSetupThread: {
    input: botSetupThreadRequest,
    output: z.object({ threadId: z.string() }),
  },
  documentHistory: {
    input: z.object({
      id: idSchema,
      file: z.enum(["MISSION.md", "MEMORY.md"]),
      before: z.number().optional(),
    }),
    output: z.array(revisionSchema),
  },
  usage: {
    input: z.object({ id: idSchema }),
    output: usageSummary,
  },
  saveLimits: {
    input: z.object({ id: idSchema, limits: usageLimits }),
    output: usageSummary,
  },
  list: {
    input: z.null(),
    output: z.object({
      bots: z.array(botListItemSchema),
      directThreads: z.record(idSchema, threadStatusViewSchema),
      directConversations: z.record(idSchema, z.array(conversationSchema)),
      directThreadInfo: z.record(z.string(), directThreadInfoSchema),
      botCreateRequests: z.array(botCreateRequestViewSchema),
    }),
  },
  /** Direct messages by BB thread, for Studio spaces. */
  spaceConversations: {
    input: z.null(),
    output: z.object({
      direct: z.array(z.object({ threadId: z.string(), botName: z.string() })),
    }),
  },
  create: {
    input: botCreateInput,
    output: botSchema,
  },
  resolveBotCreateRequest: {
    input: z.object({ id: z.string().uuid(), approved: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  update: {
    input: profilePatch.extend({
      id: idSchema,
      expectedUpdatedAt: z.number().optional(),
    }),
    output: botSchema,
  },
  swapModel: {
    input: z.object({ id: idSchema, expectedUpdatedAt: z.number().optional() }),
    output: botSchema,
  },
  retire: {
    input: z.object({ id: idSchema, retired: z.boolean() }),
    output: botSchema,
  },
  get: {
    input: z.object({ id: idSchema }),
    output: z.object({
      bot: botSchema,
      conversations: z.array(conversationSchema),
      jobs: z.array(jobSchema),
    }),
  },
  document: {
    input: z.object({
      id: idSchema,
      file: z.enum(["MISSION.md", "MEMORY.md"]),
    }),
    output: z.object({ text: z.string(), version: z.string() }),
  },
  saveDocument: {
    input: z.object({
      id: idSchema,
      file: z.enum(["MISSION.md", "MEMORY.md"]),
      text: z.string().max(64000),
      version: z.string(),
    }),
    output: z.object({ text: z.string(), version: z.string() }),
  },
  wake: {
    input: z.object({ id: idSchema }),
    output: z.object({ queued: z.boolean() }),
  },
  conversation: {
    input: z.object({ id: idSchema }),
    output: conversationSchema,
  },
  newConversation: {
    input: z.object({ id: idSchema }),
    output: conversationSchema,
  },
  // Threads with a profile: the composer's profile picker and the bot page.
  profiles: {
    input: z.object({}),
    output: z.array(botSchema),
  },
  threadProfile: {
    input: z.object({ threadId: z.string().min(1) }),
    // Null when the thread can't take a profile, such as a bot's mission thread.
    output: z.object({ botId: idSchema.nullable() }).nullable(),
  },
  setThreadProfile: {
    input: z.object({ threadId: z.string().min(1), botId: idSchema.nullable() }),
    output: z.object({ botId: idSchema.nullable() }),
  },
  pendingThreadProfile: {
    input: z.object({ projectId: z.string().min(1), botId: idSchema.nullable() }),
    output: z.object({ ok: z.literal(true) }),
  },
  // Which bot each thread works as, for the sidebar's thread rows.
  threadBots: {
    input: z.object({}),
    output: z.array(z.object({ threadId: z.string(), botId: idSchema })),
  },
  profileThreads: {
    input: z.object({ id: idSchema }),
    output: z.array(z.object({
      threadId: z.string(),
      title: z.string(),
      archived: z.boolean(),
      updatedAt: z.number(),
    })),
  },
} satisfies Parameters<typeof defineRpcContract>[0];
