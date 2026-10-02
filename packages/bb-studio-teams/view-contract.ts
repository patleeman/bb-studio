import { z } from "zod";

export const viewMemberSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bot"), id: z.string().min(1) }),
  z.object({ kind: z.literal("thread"), id: z.string().min(1) }),
]);
export const threadViewSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80),
  members: z.array(viewMemberSchema).max(32), archived: z.boolean().default(false),
  createdAt: z.number(), updatedAt: z.number(),
});
export const viewThreadSchema = z.object({
  id: z.string(), title: z.string(), botId: z.string().nullable(),
  parentThreadId: z.string().nullable(), status: z.string(), updatedAt: z.number(),
  error: z.string().nullable().default(null),
});
export const viewEntrySchema = z.object({
  id: z.string(), threadId: z.string(), role: z.enum(["user", "assistant"]),
  text: z.string(), createdAt: z.number(), groupId: z.string().nullable().default(null),
});
/** Files and images from BB's composer, forwarded unchanged to every recipient thread. */
export const viewAttachmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("image"), url: z.string().min(1) }),
  z.object({ type: z.literal("localImage"), path: z.string().min(1) }),
  z.object({ type: z.literal("localFile"), path: z.string().min(1), name: z.string().optional(), mimeType: z.string().optional(), sizeBytes: z.number().optional() }),
]);
export const viewSendInput = z.object({
  id: z.string().uuid(), requestId: z.string().uuid(), text: z.string().trim().max(16000).default(""),
  attachments: z.array(viewAttachmentSchema).max(20).default([]),
  targets: z.array(viewMemberSchema).max(32).default([]),
  replyThreadId: z.string().nullable().default(null), fresh: z.boolean().default(false),
  mode: z.enum(["auto", "steer", "followup", "fork"]).default("auto"),
}).refine(input => input.text || input.attachments.length, { message: "Write a message or attach a file.", path: ["text"] });
export const viewDeliverySchema = z.object({
  threadId: z.string(), status: z.enum(["sent", "queued", "error"]), error: z.string().nullable(),
});
export const viewContract = {
  views: { input: z.object({}), output: z.array(threadViewSchema) },
  viewCreate: {
    input: threadViewSchema.pick({ name: true, members: true }).extend({ requestId: z.string().uuid() }),
    output: threadViewSchema,
  },
  viewUpdate: {
    input: threadViewSchema.pick({ id: true, name: true, members: true, archived: true }).extend({ expectedUpdatedAt: z.number() }),
    output: threadViewSchema,
  },
  viewDelete: { input: z.object({ id: z.string().uuid() }), output: z.object({ deleted: z.boolean() }) },
  view: {
    input: z.object({ id: z.string().uuid(), before: z.number().optional(), beforeId: z.string().optional(), limit: z.number().int().min(1).max(100).default(60) }),
    output: z.object({ view: threadViewSchema, threads: z.array(viewThreadSchema), entries: z.array(viewEntrySchema), hasOlder: z.boolean() }),
  },
  viewSend: { input: viewSendInput, output: z.object({ requestId: z.string(), deliveries: z.array(viewDeliverySchema) }) },
};
export type ThreadView = z.infer<typeof threadViewSchema>;
export type ViewMember = z.infer<typeof viewMemberSchema>;
export type ViewThread = z.infer<typeof viewThreadSchema>;
export type ViewEntry = z.infer<typeof viewEntrySchema>;
export type ViewSend = z.infer<typeof viewSendInput>;
export type ViewAttachment = z.infer<typeof viewAttachmentSchema>;
export type ViewDelivery = z.infer<typeof viewDeliverySchema>;
