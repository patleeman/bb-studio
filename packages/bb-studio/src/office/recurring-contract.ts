import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const recurringSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mission"), botId: z.string().min(1), intervalMinutes: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("automation"), automationId: z.string().min(1), schedule: z.string().min(1) }),
]);
export const recurringTaskContract = defineRpcContract({
  office_recurringLookup: {
    input: z.object({ automationId: z.string().min(1) }),
    output: z.object({ taskId: z.string().nullable(), threadId: z.string().nullable(), managed: z.boolean(), suppressed: z.boolean() }),
  },
  office_syncRecurring: {
    input: z.object({ projectId: z.string().min(1), title: z.string().min(1), description: z.string(), botId: z.string().nullable(), threadId: z.string().nullable(), enabled: z.boolean(), source: recurringSource }),
    output: z.object({ taskId: z.string().nullable() }),
  },
});
export type RecurringTaskInput = z.infer<typeof recurringTaskContract.office_syncRecurring.input>;
