// The RPCs behind Setup's Kinds section; see kinds.ts.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const candidate = z.object({ pluginId: z.string(), name: z.string(), kindId: z.string(), label: z.string() });

export const kindViewSchema = z.object({
  kind: z.string(),
  label: z.string(),
  /** What turning it off hides. */
  covers: z.string(),
  on: z.boolean(),
  /** The stored "Open and create with" choice: "studio", a plugin id, or null for automatic. */
  choice: z.string().nullable(),
  /** Who opens and creates new ones now. */
  active: candidate,
  reason: z.enum(["chosen", "only-replacement", "built-in"]),
  /** Ready providers whose kinds replace this one. */
  alternatives: z.array(candidate),
});
export type KindView = z.infer<typeof kindViewSchema>;

export const kindsStateSchema = z.object({
  kinds: z.array(kindViewSchema),
  /** What the frontend reads once per window load: kinds off, and kinds whose New entries go elsewhere. */
  frontend: z.object({ off: z.array(z.string()), routedAway: z.array(z.string()) }),
});
export type KindsState = z.infer<typeof kindsStateSchema>;

export const kindsContract = defineRpcContract({
  "kinds.state": {
    experimental_description: "Studio's built-in kinds: on or off, and which provider opens and creates each.",
    input: z.null(),
    output: kindsStateSchema,
  },
  "kinds.update": {
    experimental_description: "Turn a built-in kind on or off, or choose who opens and creates it (\"studio\", a provider plugin id, or null for automatic).",
    input: z.object({ kind: z.string().min(1).max(100), on: z.boolean().optional(), use: z.string().min(1).max(100).nullable().optional() }).strict(),
    output: kindsStateSchema,
  },
});
