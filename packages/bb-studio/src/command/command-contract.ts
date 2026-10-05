import { z } from "zod";
import { conversationRequestSchema } from "@bb-studio/kit/contract";

/** One of a Space's threads, as the Command view shows it. */
export const commandThreadSchema = z.object({
  id: z.string(), title: z.string(),
  parentThreadId: z.string().nullable(), status: z.string(), updatedAt: z.number(),
  error: z.string().nullable().default(null),
  hasPendingInteraction: z.boolean().optional(),
});
/** An owner message or a final reply, for the merged layout. */
export const commandEntrySchema = z.object({
  id: z.string(), threadId: z.string(), role: z.enum(["user", "assistant"]),
  text: z.string(), createdAt: z.number(),
});
/** Files and images from BB's composer, forwarded unchanged to every recipient thread. */
export const commandAttachmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("image"), url: z.string().min(1) }),
  z.object({ type: z.literal("localImage"), path: z.string().min(1) }),
  z.object({ type: z.literal("localFile"), path: z.string().min(1), name: z.string().optional(), mimeType: z.string().optional(), sizeBytes: z.number().optional() }),
]);
export const commandPermissionModeSchema = z.enum(["accept-edits", "auto", "full"]);
const spaceId = z.string().min(1).max(200);
export const commandSendInput = z.object({
  spaceId,
  threadIds: z.array(z.string().min(1)).min(1).max(32),
  text: z.string().trim().max(16000).default(""),
  attachments: z.array(commandAttachmentSchema).max(20).default([]),
  mode: z.enum(["auto", "steer", "followup", "fork"]).default("auto"),
  /** Approval mode for every recipient's turn; null keeps each thread's own. */
  permissionMode: commandPermissionModeSchema.nullable().default(null),
}).refine(input => input.text || input.attachments.length, { message: "Write a message or attach a file.", path: ["text"] });
export const commandDeliverySchema = z.object({
  threadId: z.string(), status: z.enum(["sent", "queued", "error"]), error: z.string().nullable(),
});
export const commandContract = {
  /** A Space's threads, lead first. */
  command: {
    input: z.object({ spaceId }),
    output: z.object({
      space: z.object({ id: z.string(), name: z.string(), defaultProjectId: z.string().nullable().default(null) }),
      leadThreadId: z.string().nullable(),
      threads: z.array(commandThreadSchema),
    }),
  },
  /** Owner messages and final replies across the Space's threads, oldest first. */
  commandFeed: { input: z.object({ spaceId }), output: z.object({ entries: z.array(commandEntrySchema) }) },
  commandSend: { input: commandSendInput, output: z.object({ deliveries: z.array(commandDeliverySchema) }) },
  /** Starts a thread from BB's new-thread composer and adds it to the Space. */
  commandSpawn: { input: z.object({ spaceId, request: conversationRequestSchema(z) }), output: z.object({ threadId: z.string() }) },
  /** The Command composer was focused: its Space's threads answer @ in the "This Space" mention provider. */
  commandFocus: { input: z.object({ spaceId }), output: z.object({ ok: z.literal(true) }) },
};
export type CommandThread = z.infer<typeof commandThreadSchema>;
export type CommandSpace = z.infer<typeof commandContract.command.output>;
export type CommandEntry = z.infer<typeof commandEntrySchema>;
export type CommandSend = z.infer<typeof commandSendInput>;
export type CommandAttachment = z.infer<typeof commandAttachmentSchema>;
export type CommandPermissionMode = z.infer<typeof commandPermissionModeSchema>;
export type CommandDelivery = z.infer<typeof commandDeliverySchema>;
