import { z } from "zod";

export const automaticUpdate = z.object({
  threadId: z.string(), title: z.string(), headline: z.string(), body: z.string(),
  at: z.number(), urgent: z.boolean(), read: z.boolean(), author: z.string().nullable(),
});
export const followState = z.object({ followed: z.boolean(), automatic: z.boolean(), override: z.boolean().nullable() });
export const automationFailure = z.object({ id: z.string(), name: z.string(), error: z.string() });
export const automaticContract = {
  "inbox.updates": { input: z.object({}), output: z.object({ updates: z.array(automaticUpdate), degraded: z.boolean(), failures: z.array(automationFailure) }) },
  "inbox.follow": { input: z.object({ threadId: z.string().min(1), followed: z.boolean().nullable().optional() }), output: followState },
  "inbox.read": { input: z.object({ threadId: z.string().min(1), at: z.number() }), output: z.object({ ok: z.literal(true) }) },
};
export type AutomaticUpdate = z.infer<typeof automaticUpdate>;

// Only the public fields Inbox consumes; tolerate new fields and damaged schedules.
export const automation = z.object({
  id: z.string(), name: z.string(), projectId: z.string(),
  trigger: z.object({ triggerType: z.string() }).optional(),
  execution: z.object({ mode: z.string(), targetThreadId: z.string().nullable().optional() }).optional(),
  lastRunThreadId: z.string().nullable().optional(),
  lastRunStatus: z.string().nullable().optional(), lastError: z.string().nullable().optional(),
  problem: z.string().optional(),
});
export function recurringThread(value: z.infer<typeof automation>, id: string): boolean {
  return value.trigger?.triggerType === "schedule" && value.execution?.mode === "agent" &&
    (value.execution.targetThreadId === id || value.lastRunThreadId === id);
}
