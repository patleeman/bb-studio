import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const key = z.string().min(1).max(500);
export const inboxEventSchema = z.object({
  key, spaceId: z.string(), type: z.enum(["request", "report", "comment"]), source: z.string(),
  botId: z.string().nullable(), threadId: z.string().nullable(),
  item: z.object({ ref: z.string(), title: z.string(), href: z.string() }).nullable(),
  title: z.string(), body: z.string(), href: z.string().nullable(),
  actions: z.array(z.object({ id: z.string(), label: z.string(), primary: z.boolean().optional() })).nullable(),
  urgent: z.boolean().optional(), answerable: z.boolean().optional(), createdAt: z.number(), readAt: z.number().nullable(), doneAt: z.number().nullable(),
});
export type InboxEvent = z.infer<typeof inboxEventSchema>;
export const inboxContract = defineRpcContract({
  inbox_list: { input: z.object({ spaceId: z.string().min(1), type: z.enum(["request", "report", "comment"]).optional(), cursor: z.string().max(2000).optional() }), output: z.object({ events: z.array(inboxEventSchema), cursor: z.string().nullable() }) },
  inbox_counts: { input: z.object({}), output: z.object({ bySpace: z.record(z.string(), z.object({ requests: z.number().int(), unreadReports: z.number().int() })) }) },
  inbox_act: { input: z.object({ key, actionId: z.string().min(1).max(100), text: z.string().max(100000).optional() }), output: z.object({ ok: z.boolean() }) },
  inbox_done: { input: z.object({ keys: z.array(key).min(1).max(500) }), output: z.object({ ok: z.boolean() }) },
  inbox_read: { input: z.object({ keys: z.array(key).min(1).max(500) }), output: z.object({ ok: z.boolean() }) },
});
