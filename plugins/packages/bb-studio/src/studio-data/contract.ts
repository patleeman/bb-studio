import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { IMPORT_STATES } from "./journal";

const stopped = z.object({ bots: z.number(), heartbeats: z.number(), runners: z.number(), automations: z.number(), leads: z.number(), otherTriggers: z.number(), approvals: z.number() });

export const studioDataStatusSchema = z.object({
  ownData: z.union([z.object({ has: z.literal(false) }), z.object({ has: z.literal(true), reason: z.string() })]),
  journal: z.object({
    state: z.enum(IMPORT_STATES),
    error: z.string().nullable(),
    stagedAt: z.number(),
    appliedAt: z.number().nullable().optional(),
    restoredAt: z.number().nullable().optional(),
    stopped: stopped.nullable().optional(),
  }).nullable(),
  keptIn: z.string().nullable(),
  preview: z.object({
    bots: z.number(),
    pages: z.number(),
    tasks: z.number(),
    memories: z.number(),
    threads: z.object({ required: z.array(z.string()), wanted: z.array(z.string()) }),
    minisWithSecrets: z.number(),
    watchersWithEnv: z.number(),
    problem: z.string().nullable(),
  }).nullable(),
});
export type StudioDataStatusView = z.infer<typeof studioDataStatusSchema>;

export const studioDataContract = defineRpcContract({
  "studioData.status": {
    experimental_description: "Read-only: whether this BB Studio's Studio holds data of its own, the state of a 'Bring over BB Studio data' from bb, and what a staged copy of bb's Studio data holds.",
    input: z.null(),
    output: studioDataStatusSchema,
  },
});
