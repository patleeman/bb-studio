import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Studio's frontend imports the contract, and a plugin frontend bundle can't
// resolve the root SDK. The SDK helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

const probability = z.number().min(0).max(1);
const questionId = z.string().trim().min(1).max(120);
const id = z.string().trim().min(1).max(200);

export const questionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), instructions: z.string().min(1).max(4000) }).strict(),
  z.object({
    type: z.literal("choice"),
    instructions: z.string().min(1).max(4000),
    criteria: z.record(questionId, z.string().min(1).max(2000)).refine(
      (criteria) => Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 32,
      { message: "A choice needs between 2 and 32 options." },
    ),
  }).strict(),
]);
export const questionsSchema = z.record(questionId, questionSchema).refine(
  (questions) => Object.keys(questions).length >= 1 && Object.keys(questions).length <= 64,
  { message: "Ask between 1 and 64 questions." },
);
export const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
]);
export type Question = z.infer<typeof questionSchema>;
export type Questions = Record<string, Question>;
export type Answer = z.infer<typeof answerSchema>;
export type Answers = Record<string, Answer>;

/** A caller's explicit choice; omitted requests still use Decisions' fallback. */
export const modelSelectionSchema = z.object({
  providerId: z.string().trim().min(1).max(100),
  model: id,
  reasoningLevel: z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]).nullable(),
  serviceTier: z.string().trim().min(1).max(100).optional(),
}).strict();
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

const failure = z.object({ ok: z.literal(false), unavailable: z.boolean(), error: z.string() });

/** RPCs other Studio features call when they need a decision. */
export const publicContract = defineRpcContract({
  "decisions.systemOne.ask": {
    experimental_description: "Ask Jev structured questions through Studio Decisions.",
    input: z.object({
      caller: id,
      state: z.unknown().refine((value) => JSON.stringify(value ?? null).length <= 64_000),
      questions: questionsSchema,
    }).strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), answers: z.record(z.string(), answerSchema), via: z.string(), ms: z.number() }),
      failure,
    ]),
  },
  "decisions.model.ask": {
    experimental_description: "Ask the configured fallback model in a temporary thread.",
    input: z.object({
      caller: id, requestId: id, hostId: id, prompt: z.string().min(1).max(64_000), providerId: id.nullable(),
      modelSelection: modelSelectionSchema.optional(),
    }).strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), text: z.string().nullable(), via: z.string(), ms: z.number() }),
      failure,
    ]),
  },
});

const chosenModelSchema = modelSelectionSchema.extend({ mode: z.literal("model") });
/** Which model decides when no Jev provider answers. */
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

/** The current, prefixed Decisions API. */
export const decisionMethods = defineRpcContract({
  ...publicContract,
  "decisions.fallback.get": { input: z.null(), output: fallbackSchema },
  "decisions.fallback.set": { input: fallbackSchema, output: fallbackSchema },
  /** A starting choice for the picker: an available provider's default model at its lowest reasoning level. */
  "decisions.fallback.suggest": { input: z.null(), output: chosenModelSchema.nullable() },
  "decisions.jev.status": { input: z.null(), output: jevStatusSchema },
  /** Classifies a fixed sample message; never reads a thread. */
  "decisions.jev.check": {
    input: z.null(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), via: z.string(), action: z.string(), confidence: z.number(), ms: z.number() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  },
});

export const rpcContract = defineRpcContract({
  ...decisionMethods,
  "decisions.cli": {
    input: z.object({ argv: z.array(z.string().max(16000)).max(100) }).strict(),
    output: z.object({ exitCode: z.number(), stdout: z.string().optional(), stderr: z.string().optional() }),
  },
});
