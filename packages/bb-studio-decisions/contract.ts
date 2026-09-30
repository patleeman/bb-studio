import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answerSchema, questionsSchema } from "./system-one";

const reasoningLevel = z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]);

const chosenModelSchema = z
  .object({
    mode: z.literal("model"),
    providerId: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200),
    reasoningLevel: reasoningLevel.nullable(),
  })
  .strict();
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

const id = z.string().trim().min(1).max(200);
/** `unavailable` means nothing is configured to answer, as opposed to a provider failing. */
const failure = z.object({ ok: z.literal(false), unavailable: z.boolean(), error: z.string() });

/**
 * The methods other plugins call with `bb.sdk.plugins.callRpc({ pluginId:
 * "smart-decisions", method, input, outputSchema })`. Studio Decisions owns the
 * provider settings, so callers send only their question.
 */
export const publicContract = defineRpcContract({
  /** Ask Jev System One questions about untrusted `state`, through the configured providers. */
  "systemOne.ask": {
    experimental_description: "Ask Jev structured questions through the providers configured in Studio Decisions.",
    input: z
      .object({
        caller: id,
        state: z.unknown().refine((value) => JSON.stringify(value ?? null).length <= 64_000, {
          message: "The state is larger than 64,000 characters.",
        }),
        questions: questionsSchema,
      })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), answers: z.record(z.string(), answerSchema), via: z.string(), ms: z.number() }),
      failure,
    ]),
  },
  /** Run a prompt through the fallback model in a hidden, temporary thread on `hostId`, and return its output. */
  "model.ask": {
    experimental_description: "Run a classifier prompt through the fallback model configured in Studio Decisions.",
    input: z
      .object({
        caller: id,
        requestId: id,
        hostId: id,
        prompt: z.string().min(1).max(64_000),
        /** Used when the fallback follows the caller's provider. */
        providerId: id.nullable(),
      })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), text: z.string().nullable(), via: z.string(), ms: z.number() }),
      failure,
    ]),
  },
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
