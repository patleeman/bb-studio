import { z } from "zod";
import { presenceSchema } from "./schema";

export const presenceEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: z.enum(["builtin", "stored"]),
  creator: z.object({ name: z.string(), botId: z.string().nullable() }).nullable(),
  usedBy: z.array(z.object({ id: z.string(), name: z.string() })),
  code: z.string().nullable(),
  updatedAt: z.number(),
});
export type PresenceEntryView = z.infer<typeof presenceEntrySchema>;
export const presenceCheckLineSchema = z.object({ id: z.string().max(40), pass: z.boolean(), reason: z.string().max(600) });

const requestId = z.string().min(1).max(100);
const botId = z.string().min(1).max(200);

export const presenceRpcSchemas = {
  presences_list: { input: z.object({}), output: z.object({ presences: z.array(presenceEntrySchema) }) },
  bot_set_presence: { input: z.object({ botId, presence: presenceSchema }), output: z.object({ presence: presenceSchema }) },
  presence_ask: { input: z.object({ botId, prompt: z.string().trim().min(1).max(400) }), output: z.object({ sent: z.boolean() }) },
  presence_check_claim: { input: z.object({ requestId }), output: z.object({ go: z.boolean() }) },
  presence_check_reply: { input: z.object({ requestId, results: z.array(presenceCheckLineSchema).max(12) }), output: z.object({ ok: z.boolean() }) },
} as const;

export function presenceAskText(prompt: string): string {
  return `Make a presence (my living icon) with presence_create from this description, then put it on with presence_apply: ${prompt.trim()}`;
}
