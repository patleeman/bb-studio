import { z } from "zod";
export const moduleStatusContract = {
  modules_status: { input: z.null(), output: z.object({ active: z.array(z.string()), legacyInstalled: z.array(z.string()) }) },
  modules_cleanup_legacy: {
    input: z.object({ dryRun: z.boolean().default(true) }).strict(),
    output: z.object({ dryRun: z.boolean(), archivePath: z.string().nullable(), entries: z.array(z.object({
      pluginId: z.string(), path: z.string(), status: z.enum(["ready", "retained", "removed"]),
      reason: z.string().nullable(), files: z.number(), bytes: z.number(),
    })) }),
  },
};
