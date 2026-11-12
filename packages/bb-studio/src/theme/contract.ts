import { z } from "zod";
import { themePackageSchema } from "./schema";

export const themeCreatorSchema = z.object({ name: z.string(), botId: z.string().nullable() });
export const themeEntrySchema = z.object({
  source: z.enum(["builtin", "stored"]),
  theme: themePackageSchema,
  creator: themeCreatorSchema.nullable(),
  usedBy: z.array(z.object({ id: z.string(), name: z.string() })),
});
export const checkLineSchema = z.object({ id: z.string(), pass: z.boolean(), reason: z.string() });

const requestId = z.string().min(1).max(100);

export const themeRpcSchemas = {
  themes_list: { input: z.object({}), output: z.object({ themes: z.array(themeEntrySchema) }) },
  theme_gpu_claim: { input: z.object({ requestId }), output: z.object({ go: z.boolean() }) },
  theme_gpu_reply: { input: z.object({ requestId, results: z.array(checkLineSchema).max(8) }), output: z.object({ ok: z.boolean() }) },
} as const;
