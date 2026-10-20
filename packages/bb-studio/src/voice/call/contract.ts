// The RPCs behind voice calls with the Bot (src/voice/call/calls.ts): the
// desktop's call button in a Bot chat's header and, next, the iOS app.
//
// A call: voice_call_start mints a short-lived OpenAI client secret (the API
// key never leaves the server); the client opens WebRTC to OpenAI with it,
// runs the model's tool calls through voice_call_tool, reports transcripts and
// usage with voice_call_event, picks up the Bot's replies with voice_call_poll
// and hangs up with voice_call_end, which saves the record in the Bot's chat.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const callId = z.string().regex(/^vc_[a-f0-9]{16}$/);
const text = z.string().max(20_000);
const tokens = z.number().int().min(0).max(100_000_000).optional();

/** A response.done event's usage, as OpenAI sends it; extra fields are kept out. */
export const realtimeUsageSchema = z.object({
  input_tokens: tokens,
  output_tokens: tokens,
  input_token_details: z.object({
    text_tokens: tokens,
    audio_tokens: tokens,
    cached_tokens: tokens,
    cached_tokens_details: z.object({ text_tokens: tokens, audio_tokens: tokens }).optional(),
  }).optional(),
  output_token_details: z.object({ text_tokens: tokens, audio_tokens: tokens }).optional(),
});

/** A transcription's usage: tokens, or seconds of audio. */
export const transcriptionUsageSchema = z.object({
  type: z.enum(["tokens", "duration"]).optional(),
  input_tokens: tokens,
  output_tokens: tokens,
  seconds: z.number().min(0).max(100_000).optional(),
});

/** What the client saw on the call, reported as it happens. */
export const callEventSchema = z.discriminatedUnion("type", [
  /** A finished turn's words: the user's (input transcription) or the voice's (its audio transcript). */
  z.object({ type: z.literal("transcript"), role: z.enum(["user", "assistant"]), text, at: z.number().int().min(0).optional() }),
  /** One response's tokens (response.done). */
  z.object({ type: z.literal("usage"), usage: realtimeUsageSchema }),
  /** One transcription's usage (conversation.item.input_audio_transcription.completed). */
  z.object({ type: z.literal("transcription_usage"), usage: transcriptionUsageSchema }),
]);
export type CallEvent = z.infer<typeof callEventSchema>;

export const voiceCallStateSchema = z.object({
  /** The Bot whose chat this is, or null: no call button. */
  botId: z.string().nullable(),
  botName: z.string().nullable(),
  /** Whether a call can start now (a key is set and the month is under the cap). */
  ready: z.boolean(),
  /** Why not, when it can't. */
  problem: z.string().nullable(),
  /** This calendar month's calls, estimated, and the cap. */
  monthUsd: z.number(),
  capUsd: z.number(),
  model: z.string(),
});
export type VoiceCallState = z.infer<typeof voiceCallStateSchema>;

const transcriptLine = z.object({ role: z.enum(["user", "assistant"]), text: z.string(), at: z.number() });
const sentLine = z.object({ message: z.string(), at: z.number() });

export const voiceCallViewSchema = z.object({
  id: z.string(),
  botId: z.string(),
  botName: z.string(),
  model: z.string(),
  voice: z.string(),
  startedAt: z.number(),
  /** Null while it's on. */
  endedAt: z.number().nullable(),
  durationMs: z.number(),
  /** Estimated from the usage the client reported; null for a model without prices. */
  costUsd: z.number().nullable(),
  transcript: z.array(transcriptLine),
  /** What the call sent the Bot (send_to_bot). */
  sent: z.array(sentLine),
  /** The Bot's replies the call heard. */
  replies: z.array(z.object({ text: z.string(), at: z.number() })),
  /** The page with the call's record, linked from the Bot's chat. */
  pageId: z.string().nullable(),
});
export type VoiceCallView = z.infer<typeof voiceCallViewSchema>;

const reply = z.object({ id: z.number().int(), summary: z.string(), note: z.string() });

export const voiceCallContract = defineRpcContract({
  voice_call_state: {
    experimental_description: "Whether a thread is a Bot's chat that can start a voice call, and this month's call spend against the cap.",
    input: z.object({ threadId: z.string().min(1).max(200).optional(), botId: z.string().min(1).max(100).optional() }).strict(),
    output: voiceCallStateSchema,
  },
  voice_call_start: {
    experimental_description: "Start a voice call with a Bot (the primary without botId): checks the monthly cap and mints a short-lived OpenAI Realtime client secret with the call's session (model, voice, instructions, server VAD, transcription, tools). The API key never leaves the server. POST the WebRTC SDP offer to callsUrl with the secret as the bearer token.",
    input: z.object({ botId: z.string().min(1).max(100).optional() }).strict(),
    output: z.object({
      callId: z.string(),
      clientSecret: z.string(),
      /** Milliseconds since the epoch: start the WebRTC call before then. */
      expiresAt: z.number(),
      model: z.string(),
      voice: z.string(),
      callsUrl: z.string(),
      /** The Bot's name, for the call bar. */
      botName: z.string(),
    }),
  },
  voice_call_tool: {
    experimental_description: "Run one of the call's tools for the model (bot_status, leads_status, daily_brief read; send_to_bot posts to the Bot's chat). Returns the function_call_output text.",
    input: z.object({ callId, name: z.string().min(1).max(64), args: z.string().max(20_000).optional() }).strict(),
    output: z.object({ output: z.string() }),
  },
  voice_call_event: {
    experimental_description: "Report what happened on a call: finished transcript lines and usage. Returns the running cost estimate and how many Bot replies wait for voice_call_poll.",
    input: z.object({ callId, events: z.array(callEventSchema).max(200) }).strict(),
    output: z.object({ costUsd: z.number().nullable(), replies: z.number().int() }),
  },
  voice_call_poll: {
    experimental_description: "The Bot's replies to what the call sent it, not yet picked up. Each has the note to add to the conversation (then response.create).",
    input: z.object({ callId }).strict(),
    output: z.object({ replies: z.array(reply) }),
  },
  voice_call_end: {
    experimental_description: "Hang up: saves the call's record (transcript, what it sent, minutes, cost) as a page linked in the Bot's chat. Replies that come later go to the chat and the phone.",
    input: z.object({ callId, events: z.array(callEventSchema).max(200).optional() }).strict(),
    output: voiceCallViewSchema,
  },
  voice_call_get: {
    experimental_description: "One call's record.",
    input: z.object({ callId }).strict(),
    output: voiceCallViewSchema,
  },
});
