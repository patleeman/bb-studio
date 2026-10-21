import { z } from "zod";
import { bbThemeSchema } from "./code-theme";
const nullableText = z.string().nullable();
export const workspaceRow = z.object({
  id: z.string().min(1).max(100), title: z.string(), project_id: nullableText,
  folders: z.string().refine((text) => { try { return z.array(z.string()).safeParse(JSON.parse(text)).success; } catch { return false; } }),
  archived: z.number().int(), created_at: z.number(), updated_at: z.number(),
  thread_id: nullableText, trusted: z.number().int(), share: z.number().int(), opened_at: z.number().nullable(), review_thread_id: nullableText,
}).strict();
export const commentRow = z.object({
  id: z.string().min(1).max(100), workspace_id: z.string().min(1).max(100), parent_id: nullableText, path: z.string(),
  start_line: z.number().int(), end_line: z.number().int(), line_text: z.string(), author: z.string(), body: z.string(),
  sent_to: nullableText, sent_at: z.number().nullable(), resolved_at: z.number().nullable(), created_at: z.number(),
}).strict();
export const acknowledged = z.object({ complete: z.literal(true) });
export const codeImportContract = {
  "code.importFiles": { input: z.object({ sourceRoot: z.string().max(4096), theme: bbThemeSchema.nullable() }).strict(), output: acknowledged },
  "code.importRows": { input: z.object({ workspaces: z.array(workspaceRow).max(100), comments: z.array(commentRow).max(100) }).strict(), output: z.object({ workspaces: z.array(z.string()), comments: z.array(z.string()) }) },
  "code.finishImport": { input: z.null(), output: acknowledged },
};
