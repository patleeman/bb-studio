// The RPCs behind Studio's settings sections, `bb studio settings` and the
// iOS app's reads (reactions, Todos), plus the push status
// Studio shows for the Mobile plugin (Phone notifications, on Studio's settings page).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const value = z.union([z.boolean(), z.number(), z.string().max(10_000)]);
export const settingsValuesSchema = z.record(z.string(), value);

/** "Hold phone notifications while I'm at my Mac": the switch, whether the user is at the desk (null: no client says), and how many pushes wait. */
export const deskHoldSchema = z.object({ enabled: z.boolean(), atDesk: z.boolean().nullable(), held: z.number().int().min(0) });
export type DeskHoldStatus = z.infer<typeof deskHoldSchema>;
export const deskBeatSchema = z.strictObject({ clientId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/), state: z.enum(["active", "away"]), source: z.enum(["system", "window"]) });
export type DeskBeat = z.infer<typeof deskBeatSchema>;

export const pushStatusSchema = z.object({
  /** False when the Mobile plugin isn't installed or running. */
  installed: z.boolean(),
  ready: z.boolean(),
  /** Why pushes can't go out yet, in plain words; null when ready. */
  problem: z.string().nullable(),
  devices: z.number().int().min(0),
  lastDelivery: z.object({ at: z.number(), sent: z.number().int().min(0) }).nullable(),
  /** Missing when the Mobile plugin predates the desk hold. */
  deskHold: deskHoldSchema.optional(),
});
export type PushStatus = z.infer<typeof pushStatusSchema>;

export const pushTestSchema = z.object({ ok: z.boolean(), sent: z.number().int().min(0), message: z.string() });
export type PushTest = z.infer<typeof pushTestSchema>;

export const apiKeysSchema = z.object({
  keys: z.array(z.object({ key: z.string(), label: z.string(), description: z.string(), set: z.boolean() })),
});
export type ApiKeys = z.infer<typeof apiKeysSchema>;

export const settingsContract = defineRpcContract({
  "settings.get": {
    experimental_description: "Studio's settings that aren't API keys, with defaults filled in, and the facts the settings sections show.",
    input: z.null(),
    output: z.object({
      values: settingsValuesSchema,
      /** The keys someone set; the rest follow their default. */
      changed: z.array(z.string()),
      /** Todos' time zone: the todosTimeZone setting, else defaultTimeZone. */
      timeZone: z.string(),
      defaultTimeZone: z.string().optional(),
    }),
  },
  "settings.set": {
    experimental_description: "Change Studio settings; null puts one back to its default. All or nothing.",
    input: z.object({ values: z.record(z.string(), value.nullable()) }),
    output: z.object({ values: settingsValuesSchema, changed: z.array(z.string()), timeZone: z.string().optional(), defaultTimeZone: z.string().optional() }),
  },
  "settings.keys.get": {
    experimental_description: "Studio's API keys in settings-page order, each with whether it is set. Never the keys themselves.",
    input: z.null(),
    output: apiKeysSchema,
  },
  "settings.keys.set": {
    experimental_description: "Save Studio API keys; an empty value or null removes one. Answers which keys are set.",
    input: z.object({ values: z.record(z.string(), z.string().max(10_000).nullable()) }),
    output: apiKeysSchema,
  },
  "mobile.push.status": {
    experimental_description: "Whether the Mobile plugin can send pushes, to how many phones, and the last delivery.",
    input: z.null(),
    output: pushStatusSchema,
  },
  "mobile.desk.beat": {
    experimental_description: "Studio's overlay on a desktop or web client says whether the user is at the desk; the Mobile plugin holds phone pushes while they are. Null when the Mobile plugin can't take it.",
    input: deskBeatSchema,
    output: deskHoldSchema.nullable(),
  },
  "mobile.desk.hold": {
    experimental_description: "Turns \"Hold phone notifications while I'm at my Mac\" on or off in the Mobile plugin.",
    input: z.strictObject({ enabled: z.boolean() }),
    output: deskHoldSchema,
  },
  "mobile.push.test": {
    experimental_description: "Send a test push to every phone the Mobile plugin knows.",
    input: z.null(),
    output: pushTestSchema,
  },
});
