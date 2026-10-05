// The RPCs Studio's frontend uses to show plugin health; see health.ts.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const problemSchema = z.object({
  /** Changes when the problem does, so hiding one doesn't hide the next. */
  key: z.string(),
  pluginId: z.string(),
  pluginName: z.string(),
  status: z.enum(["degraded", "broken"]),
  title: z.string(),
  detail: z.string().nullable(),
  fix: z.object({ label: z.string(), path: z.string() }),
  hidden: z.boolean(),
});
export type Problem = z.infer<typeof problemSchema>;

export const summarySchema = z.object({
  checkedAt: z.number(),
  problems: z.array(problemSchema),
  /** Plugins whose own check passed, with what it confirmed. */
  healthy: z.array(z.object({ pluginId: z.string(), pluginName: z.string(), titles: z.array(z.string()) })),
  /** Plugins whose check didn't answer. */
  unanswered: z.array(z.object({ pluginId: z.string(), pluginName: z.string(), error: z.string() })),
});
export type HealthSummary = z.infer<typeof summarySchema>;

export const healthContract = defineRpcContract({
  "health.summary": {
    experimental_description: "Plugin problems Studio found. maxAgeMs: reuse a result this recent; 0 checks again.",
    input: z.object({ maxAgeMs: z.number().int().min(0).max(3_600_000) }).strict(),
    output: summarySchema,
  },
  "health.hide": {
    experimental_description: "Hide one problem until it changes, or show it again.",
    input: z.object({ key: z.string().min(1).max(1000), hidden: z.boolean() }).strict(),
    output: summarySchema,
  },
  "health.disable": {
    experimental_description: "Turn a plugin off.",
    input: z.object({ pluginId: z.string().min(1).max(100) }).strict(),
    output: summarySchema,
  },
});
