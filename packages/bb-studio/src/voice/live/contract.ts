// The RPCs behind hands-free voice (src/voice/live/live.ts), for the iOS app.
//
// A session: voiceLive.start checks the monthly cap, opens the session's
// voice thread and starts the OpenAI side. For gpt-live-1 the phone sends its
// SDP offer and gets the answer (the key never leaves the host, and there's
// no client secret at all); for gpt-realtime-2.1 it gets a 2-minute client
// secret and posts its offer to callsUrl itself. The model's tool calls come
// back through voiceLive.tool, which enforces the eyes-free rules.
// voiceLive.event reports transcripts and usage (and says when the cap is
// hit), voiceLive.poll picks up replies, and voiceLive.end hangs up.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { LIVE_MODELS } from "./shared";

const sessionId = z.string().regex(/^vl_[a-f0-9]{16}$/);
const text = z.string().max(20_000);
const tokens = z.number().int().min(0).max(100_000_000).optional();

/** A Realtime response.done event's usage, as OpenAI sends it. */
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

/** What the phone saw, reported as it happens. */
export const liveEventSchema = z.discriminatedUnion("type", [
  /** A finished line: the user's words (input transcript) or the voice's (output transcript). */
  z.object({ type: z.literal("transcript"), role: z.enum(["user", "assistant"]), text, at: z.number().int().min(0).optional() }),
  /** The user talked over the voice; `heard` is what the voice had said by then. */
  z.object({ type: z.literal("interrupted"), heard: z.string().max(4000), at: z.number().int().min(0).optional() }),
  /** Realtime: one response's tokens. */
  z.object({ type: z.literal("usage"), usage: realtimeUsageSchema }),
  /** Realtime: one transcription's usage. */
  z.object({ type: z.literal("transcription_usage"), usage: z.object({ type: z.enum(["tokens", "duration"]).optional(), input_tokens: tokens, output_tokens: tokens, seconds: z.number().min(0).max(100_000).optional() }) }),
  /** GPT-Live: session.usage.updated's cumulative voice seconds. */
  z.object({ type: z.literal("live_usage"), seconds: z.number().min(0).max(1_000_000) }),
  /** GPT-Live: one backend Responses turn's tokens (response.completed). */
  z.object({ type: z.literal("backend_usage"), input_tokens: tokens, cached_tokens: tokens, output_tokens: tokens }),
]);
export type LiveEvent = z.infer<typeof liveEventSchema>;

export const voiceLiveStateSchema = z.object({
  /** Whether a session can start now (a Chief of Staff, a key, under the cap). */
  ready: z.boolean(),
  problem: z.string().nullable(),
  cosName: z.string().nullable(),
  monthUsd: z.number(),
  capUsd: z.number(),
  model: z.enum(LIVE_MODELS),
});
export type VoiceLiveState = z.infer<typeof voiceLiveStateSchema>;

export const voiceLiveViewSchema = z.object({
  id: z.string(),
  model: z.string(),
  voiceThreadId: z.string().nullable(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  durationMs: z.number(),
  costUsd: z.number().nullable(),
  transcript: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string(), at: z.number() })),
  sent: z.array(z.object({ threadId: z.string(), title: z.string(), message: z.string(), at: z.number() })),
  replies: z.array(z.object({ threadId: z.string(), title: z.string(), text: z.string(), at: z.number() })),
});
export type VoiceLiveView = z.infer<typeof voiceLiveViewSchema>;

export const voiceLiveContract = defineRpcContract({
  "voiceLive.state": {
    experimental_description: "Whether a hands-free voice session can start, and this month's voice spend against the cap.",
    input: z.object({}).strict(),
    output: voiceLiveStateSchema,
  },
  "voiceLive.start": {
    experimental_description: "Start a hands-free voice session: checks the monthly cap and opens its voice thread. gpt-live-1: pass the WebRTC SDP offer; Studio creates the session with OpenAI and returns the answer (no credential reaches the phone). gpt-realtime-2.1: returns a 2-minute client secret; POST the offer to callsUrl with it.",
    input: z.object({ model: z.enum(LIVE_MODELS).optional(), sdp: z.string().min(1).max(100_000).optional() }).strict(),
    output: z.object({
      sessionId: z.string(),
      model: z.enum(LIVE_MODELS),
      transport: z.enum(["live-webrtc", "realtime-webrtc", "mock"]),
      /** gpt-live-1: the SDP answer to set as the remote description. */
      answerSdp: z.string().nullable(),
      /** gpt-realtime-2.1: the bearer token for callsUrl, valid until expiresAt. */
      clientSecret: z.string().nullable(),
      expiresAt: z.number().nullable(),
      callsUrl: z.string().nullable(),
      /** A staged BB's scripted mock server, when the host sets one; never with a real session. */
      mockUrl: z.string().nullable(),
      voiceThreadId: z.string().nullable(),
      cosName: z.string(),
    }),
  },
  "voiceLive.tool": {
    experimental_description: "Run one of the voice's tools (loops_list, read_replies, send_to_cos, send_to_thread, loops_act, loops_add, undo, stop_thread, archive_thread, pause_automation, delete_automation, confirm, cancel). Relays and loop actions happen at once; destructive ones wait for confirm after a spoken yes. Saves `events` first, so a yes said just before confirm counts. Returns the function_call_output text.",
    input: z.object({ sessionId, name: z.string().min(1).max(64), args: z.string().max(20_000).optional(), events: z.array(liveEventSchema).max(200).optional() }).strict(),
    output: z.object({ output: z.string() }),
  },
  "voiceLive.event": {
    experimental_description: "Report what happened: finished transcript lines, interruptions and usage. Returns the running cost, how many replies wait for voiceLive.poll, and whether to stop (the monthly cap).",
    input: z.object({ sessionId, events: z.array(liveEventSchema).max(200) }).strict(),
    output: z.object({ costUsd: z.number().nullable(), replies: z.number().int(), stop: z.string().nullable() }),
  },
  "voiceLive.poll": {
    experimental_description: "Replies to what the session sent, not yet picked up; each has the note to add to the conversation.",
    input: z.object({ sessionId }).strict(),
    output: z.object({ replies: z.array(z.object({ id: z.number().int(), title: z.string(), summary: z.string(), note: z.string() })) }),
  },
  "voiceLive.end": {
    experimental_description: "Hang up: posts the rest of the transcript and a summary to the voice thread. Replies that come later go to the voice thread and the phone.",
    input: z.object({ sessionId, events: z.array(liveEventSchema).max(200).optional() }).strict(),
    output: voiceLiveViewSchema,
  },
});
