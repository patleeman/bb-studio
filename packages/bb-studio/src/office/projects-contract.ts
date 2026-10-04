import { defineRpcContract } from "@get-bb/plugin-sdk";
import { conversationRequestSchema } from "@bb-studio/kit/contract";
import { z } from "zod";

const id = z.string().min(1).max(200);
export const projectNameSchema = z.string().trim().min(1).max(100).refine(name => !/[\x00-\x1f\x7f]/.test(name), "Project names cannot contain control characters");
export const projectRefSchema = z.string().max(1000).regex(/^(?:thread:[^:\s]+|item:[^:\s]+:.+)$/);
const linkInput = z.object({ projectId: id, refs: z.array(projectRefSchema).min(1).max(500) });
const ok = z.object({ ok: z.literal(true) });
export const runSchema = z.object({ enabled: z.boolean(), cadence: z.enum(["hourly", "daily", "weekdays"]), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) });
export const officeProjectSchema = z.object({
  id, bbProjectId: id.nullable(), icon: z.string().nullable(), position: z.number().int(), archivedAt: z.number().nullable(),
  role: z.enum(["chief-of-staff", "project"]), run: runSchema.nullable(),
  projectId: id, name: z.string(), leadThreadId: id.nullable(),
  pageId: id.nullable(), pageHref: z.string().nullable(),
});
export const officeProjectsContract = defineRpcContract({
  project_link: { input: linkInput, output: ok },
  project_unlink: { input: linkInput.omit({ projectId: true }), output: ok },
  project_membership: { input: z.object({}), output: z.object({ threads: z.record(z.string(), id), items: z.array(z.object({ ref: projectRefSchema, projectId: id, title: z.string(), kind: z.string(), href: z.string(), icon: z.string().nullable() })) }) },
  projects_list: { input: z.object({}), output: z.object({ projects: z.array(officeProjectSchema) }) },
  project_create: { input: z.object({ name: projectNameSchema, bbProjectId: id.nullable().optional() }), output: officeProjectSchema },
  project_update: { input: z.object({ projectId: id, name: projectNameSchema.optional(), bbProjectId: id.nullable().optional(), icon: z.string().max(100).nullable().optional() }), output: officeProjectSchema },
  project_reorder: { input: z.object({ projectId: id, previousProjectId: id.nullable(), nextProjectId: id.nullable() }), output: ok },
  project_archive: { input: z.object({ projectId: id, archived: z.boolean() }), output: officeProjectSchema },
  project_thread_start: { input: z.object({ projectId: id, request: conversationRequestSchema(z) }), output: z.object({ threadId: id }) },
  project_set_run: { input: runSchema.omit({ time: true }).extend({ projectId: id, time: runSchema.shape.time.optional() }), output: officeProjectSchema },
  thread_handoff: { input: z.object({ threadId: id, request: conversationRequestSchema(z).extend({ prompt: z.string().max(100000).optional() }) }), output: z.object({ threadId: id }) },
  bots_overview: { input: z.object({}), output: z.object({ bots: z.array(z.object({
    id, name: z.string(), avatar: z.string().nullable(), providerId: z.string(), projectId: id.nullable(), mission: z.string(), hasMemory: z.boolean(), schedules: z.number().int().nonnegative(), suggestion: z.enum(["project", "chief-of-staff", "retire"]),
  })) }) },
  bot_to_project: { input: z.object({ botId: id, projectId: id.nullable().optional() }), output: officeProjectSchema },
  bot_retire: { input: z.object({ botId: id }), output: z.object({ ok: z.literal(true) }) },
  project_get: { input: z.object({ projectId: id }), output: officeProjectSchema },
  project_setup: { input: z.object({ projectId: id, request: conversationRequestSchema(z) }), output: officeProjectSchema },
  project_threads: { input: z.object({ projectId: id }), output: z.object({ threads: z.array(z.object({
    id, title: z.string().nullable(), status: z.string(), updatedAt: z.number(), linked: z.boolean(), isLead: z.boolean(),
  })) }) },
});
