// The RPCs behind voice mode: the speaker button in a thread's composer and New voice chat.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export { VOICE_REALTIME_CHANNEL, type VoiceSpoken } from "./shared";

export const voiceStateSchema = z.object({
  /** Whether the thread has voice mode on. */
  on: z.boolean(),
  /** Threads it's waiting on. */
  pending: z.array(z.string()),
  /** Why replies can't be spoken, or null. */
  speechProblem: z.string().nullable(),
});
export type VoiceState = z.infer<typeof voiceStateSchema>;

const threadId = z.string().min(1).max(100);

export const voiceContract = defineRpcContract({
  "voice.state": {
    experimental_description: "Whether a thread has voice mode on (its replies spoken), what it's waiting on, and whether speech is set up.",
    input: z.object({ threadId }).strict(),
    output: voiceStateSchema,
  },
  "voice.set": {
    experimental_description: "Turn voice mode on or off in a thread.",
    input: z.object({ threadId, on: z.boolean() }).strict(),
    output: voiceStateSchema,
  },
  "voice.new": {
    experimental_description: "Start a new voice chat: a thread on a fast model with voice mode on. Returns its thread id.",
    input: z.object({ projectId: z.string().max(100).nullable().optional(), modelId: z.string().max(50).optional() }).strict(),
    output: z.object({ threadId }),
  },
});
