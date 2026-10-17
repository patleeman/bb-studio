// The RPCs behind speech: Setup's Speech section and any client that speaks.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const SPEECH_HTTP_PATH = "speech/audio";
export const SPEECH_HTTP_ROOT = `/api/v1/plugins/studio/http/${SPEECH_HTTP_PATH}`;

export const speechStateSchema = z.object({
  engine: z.enum(["openrouter", "custom"]),
  engines: z.array(z.object({ id: z.enum(["openrouter", "custom"]), label: z.string() })),
  model: z.string(),
  voice: z.string(),
  instructions: z.string(),
  endpoint: z.string(),
  /** Whether a key is set for OpenRouter (in settings or the host's environment). */
  openRouterKey: z.boolean(),
  /** Why speech can't run now, or null when it's set up. */
  problem: z.string().nullable(),
});
export type SpeechState = z.infer<typeof speechStateSchema>;

export const speechModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  pricePerMillionChars: z.number().optional(),
  voices: z.array(z.string()).nullable(),
});

const overrides = {
  model: z.string().trim().max(200).optional(),
  voice: z.string().trim().max(200).optional(),
  instructions: z.string().trim().max(1000).optional(),
};

export const speechContract = defineRpcContract({
  "speech.state": {
    experimental_description: "Studio's speech settings: engine, model, voice and delivery, and what's missing to speak.",
    input: z.null(),
    output: speechStateSchema,
  },
  "speech.update": {
    experimental_description: "Change the speech engine, model, voice, delivery or custom endpoint. Keys are set in Studio's plugin settings.",
    input: z.object({
      engine: z.enum(["openrouter", "custom"]).optional(),
      endpoint: z.string().trim().max(500).optional(),
      ...overrides,
    }).strict(),
    output: speechStateSchema,
  },
  "speech.models": {
    experimental_description: "The configured engine's speech models, with their voices and prices when it lists them.",
    input: z.null(),
    output: z.object({ models: z.array(speechModelSchema) }),
  },
  "speech.prepare": {
    experimental_description: "Get an audio URL for text, in the configured voice unless overridden. Fetching the URL makes the audio and streams it. Cut long text with speechChunks first.",
    input: z.object({ text: z.string().min(1).max(4000), ...overrides }).strict(),
    output: z.object({ url: z.string() }),
  },
});
