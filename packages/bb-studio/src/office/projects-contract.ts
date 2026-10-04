import { defineRpcContract } from "@get-bb/plugin-sdk";
import { conversationRequestSchema } from "@bb-studio/kit/contract";
import { z } from "zod";

const id = z.string().min(1).max(200);
export const officeProjectSchema = z.object({
  projectId: id, name: z.string(), leadThreadId: id.nullable(),
  pageId: id.nullable(), pageHref: z.string().nullable(),
});
export const officeProjectsContract = defineRpcContract({
  project_get: { input: z.object({ projectId: id }), output: officeProjectSchema },
  project_setup: { input: z.object({ projectId: id, request: conversationRequestSchema(z) }), output: officeProjectSchema },
  project_threads: { input: z.object({ projectId: id }), output: z.object({ threads: z.array(z.object({
    id, title: z.string().nullable(), status: z.string(), updatedAt: z.number(), isLead: z.boolean(),
  })) }) },
});
