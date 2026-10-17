// The RPCs and realtime channel behind Studio → Voice.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export { VOICE_REALTIME_CHANNEL, VOICE_SUBPATH, type VoiceSpoken } from "./shared";

export const voiceStateSchema = z.object({
  session: z.object({ threadId: z.string(), modelId: z.string(), startedAt: z.number() }).nullable(),
  models: z.array(z.object({ id: z.string(), label: z.string() })),
  /** Threads the voice agent is waiting on. */
  pending: z.array(z.string()),
  /** Why replies can't be spoken, or null. */
  speechProblem: z.string().nullable(),
});
export type VoiceState = z.infer<typeof voiceStateSchema>;

export const voiceContract = defineRpcContract({
  "voice.state": {
    experimental_description: "The current voice session (its thread), the models it can run on, and whether speech is set up.",
    input: z.null(),
    output: voiceStateSchema,
  },
  "voice.start": {
    experimental_description: "Start a new voice session in a new thread on a fast model.",
    input: z.object({ modelId: z.string().max(50) }).strict(),
    output: voiceStateSchema,
  },
  "voice.end": {
    experimental_description: "End the voice session. Its thread stays in BB's history.",
    input: z.null(),
    output: voiceStateSchema,
  },
});
