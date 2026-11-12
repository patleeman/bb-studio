// The RPCs behind Studio's settings sections, `bb studio settings` and the
// iOS app's reads (reactions, Todos), plus the push status
// Studio shows for the Mobile plugin (Phone notifications, on Studio's settings page).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const value = z.union([z.boolean(), z.number(), z.string().max(10_000)]);
export const settingsValuesSchema = z.record(z.string(), value);

export const pushStatusSchema = z.object({
  /** False when the Mobile plugin isn't installed or running. */
  installed: z.boolean(),
  ready: z.boolean(),
  /** Why pushes can't go out yet, in plain words; null when ready. */
  problem: z.string().nullable(),
  devices: z.number().int().min(0),
  lastDelivery: z.object({ at: z.number(), sent: z.number().int().min(0) }).nullable(),
});
export type PushStatus = z.infer<typeof pushStatusSchema>;

export const pushTestSchema = z.object({ ok: z.boolean(), sent: z.number().int().min(0), message: z.string() });
export type PushTest = z.infer<typeof pushTestSchema>;

export const settingsContract = defineRpcContract({
  "settings.get": {
    experimental_description: "Studio's settings that aren't API keys, with defaults filled in, and the facts the settings sections show.",
    input: z.null(),
    output: z.object({
      values: settingsValuesSchema,
      /** The keys someone set; the rest follow their default. */
      changed: z.array(z.string()),
      /** Todos' time zone: this Mac's, or STUDIO_LOOP_TIME_ZONE on the BB host. */
      timeZone: z.string(),
    }),
  },
  "settings.set": {
    experimental_description: "Change Studio settings; null puts one back to its default. All or nothing.",
    input: z.object({ values: z.record(z.string(), value.nullable()) }),
    output: z.object({ values: settingsValuesSchema, changed: z.array(z.string()) }),
  },
  "mobile.push.status": {
    experimental_description: "Whether the Mobile plugin can send pushes, to how many phones, and the last delivery.",
    input: z.null(),
    output: pushStatusSchema,
  },
  "mobile.push.test": {
    experimental_description: "Send a test push to every phone the Mobile plugin knows.",
    input: z.null(),
    output: pushTestSchema,
  },
});
