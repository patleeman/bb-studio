import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { publicContract, modelSelectionSchema } from "@bb-studio/kit/decisions-contract";
export { publicContract } from "@bb-studio/kit/decisions-contract";

const chosenModelSchema = modelSelectionSchema.extend({ mode: z.literal("model") });
/**
 * Which model decides when no Jev provider answers. `thread` uses the
 * caller's provider (the busy thread's, or the bot's) and its default model,
 * so it works with whatever the user has installed.
 */
export const fallbackSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("thread") }).strict(),
  z.object({ mode: z.literal("off") }).strict(),
  chosenModelSchema,
]);
export type Fallback = z.infer<typeof fallbackSchema>;
export const defaultFallback: Fallback = { mode: "thread" };

const jevStatusSchema = z.object({
  provider: z.string(),
  routes: z.array(z.object({ name: z.string(), model: z.string() })),
  problems: z.array(z.string()),
});

export const rpcContract = defineRpcContract({
  ...publicContract,
  "fallback.get": { input: z.null(), output: fallbackSchema },
  "fallback.set": { input: fallbackSchema, output: fallbackSchema },
  /** A starting choice for the picker: an available provider's default model at its lowest reasoning level. */
  "fallback.suggest": { input: z.null(), output: chosenModelSchema.nullable() },
  "jev.status": { input: z.null(), output: jevStatusSchema },
  /** Classifies a fixed sample message; never reads a thread. */
  "jev.check": {
    input: z.null(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), via: z.string(), action: z.string(), confidence: z.number(), ms: z.number() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  },
});
