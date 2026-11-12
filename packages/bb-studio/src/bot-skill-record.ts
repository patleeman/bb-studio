// Portable stored skill fields. Defaults keep backups made before section v3 readable.
import { z } from "zod";

export const botSkillRecord = z.object({
  bot_id: z.string().min(1).max(300),
  name: z.string().min(1).max(64),
  description: z.string().max(500),
  body: z.string().max(20_000),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  state: z.enum(["active", "stale", "archived"]).default("active"),
  pinned: z.union([z.literal(0), z.literal(1)]).default(0),
  used_at: z.number().int().nullable().default(null),
  lint_warnings: z.string().max(100_000).default("[]"),
});
export type BotSkillRecord = z.infer<typeof botSkillRecord>;
