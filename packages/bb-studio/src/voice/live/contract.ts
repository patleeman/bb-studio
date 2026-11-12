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
import { BACKEND_MODELS, LIVE_MODELS } from "./shared";

const sessionId = z.string().regex(/^vl_[a-f0-9]{16}$/);
const text = z.string().max(20_000);
const tokens = z.number().int().min(0).max(100_000_000).optional();
/** When, in ms since the epoch (the phone's clock). */
const at = z.number().int().min(0).optional();
/** A linear RMS level, 0 to 1. */
const level = z.number().min(0).max(1);

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
  /**
   * A finished line: the user's words (input transcript) or the voice's (output transcript).
   * A user line also says when its speech started (`started_at`, the phone's clock) and, when a
   * destructive action's question had already gone back to the model by then, that action's id
   * (`answers`): only such a line can be the spoken yes. Clients that send neither can't confirm by voice.
   */
  z.object({
    type: z.literal("transcript"), role: z.enum(["user", "assistant"]), text, at: z.number().int().min(0).optional(),
    started_at: z.number().int().min(0).optional(), answers: z.string().max(40).optional(),
  }),
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
  // The phone's audio, for diagnosing dropouts (stored, not shown).
  /** The level gate muted the voice and no words followed: the mic and playback levels then, and how long it was silent. */
  z.object({ type: z.literal("false_trigger"), at, mic: level, playback: level, muted_ms: z.number().int().min(0).max(3_600_000) }),
  /** The audio route changed: AVAudioSession's reason, and the new input and output ports. */
  z.object({ type: z.literal("route_change"), at, reason: z.string().max(64), input: z.string().max(200), output: z.string().max(200) }),
  /** A phone call or Siri took the audio (began), or gave it back. */
  z.object({ type: z.literal("audio_interruption"), at, began: z.boolean() }),
  /** The app went to the background or came back. */
  z.object({ type: z.literal("app_state"), at, state: z.enum(["background", "foreground"]) }),
  /** Why the session ended: End (user), the screen closing, an error, the connection dropping, the cap, or the voice service. */
  z.object({ type: z.literal("close"), at, reason: z.enum(["user", "dismissed", "error", "transport", "cap", "server"]), detail: z.string().max(500).optional(), background: z.boolean().optional() }),
]);
export type LiveEvent = z.infer<typeof liveEventSchema>;

export const voiceIdentitySchema = z.object({
  kind: z.enum(["cos", "bot", "lead", "runner", "thread"]),
  label: z.string(),
  name: z.string(),
  threadId: z.string().nullable(),
});

export const voiceLiveStateSchema = z.object({
  /** Whether a session can start now (a Chief of Staff, a key, under the cap). */
  ready: z.boolean(),
  problem: z.string().nullable(),
  cosName: z.string().nullable(),
  monthUsd: z.number(),
  capUsd: z.number(),
  model: z.enum(LIVE_MODELS),
  /** The next session's voice (one of the model's own; marin by default). */
  voice: z.string(),
  /** gpt-live-1's backend model (responses delegation); Realtime has none. */
  backendModel: z.enum(BACKEND_MODELS),
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
  "voiceLive.configure": {
    experimental_description: "Save the next hands-free session's model, voice or backend model as Studio settings (a running session keeps its own). A voice must be one of the model's; switching to a model without the current voice moves it to marin. Returns the new state.",
    input: z.object({ model: z.enum(LIVE_MODELS).optional(), voice: z.string().min(1).max(40).optional(), backendModel: z.enum(BACKEND_MODELS).optional() }).strict(),
    output: voiceLiveStateSchema,
  },
  "voiceLive.start": {
    experimental_description: "Start a hands-free voice session: checks the monthly cap, builds its identity seed once from the launching thread (threadId; none means the Chief of Staff) and opens its voice thread. gpt-live-1: pass the WebRTC SDP offer; Studio creates the session with OpenAI and returns the answer (no credential reaches the phone). gpt-realtime-2.1: returns a 2-minute client secret; POST the offer to callsUrl with it.",
    input: z.object({
      model: z.enum(LIVE_MODELS).optional(), sdp: z.string().min(1).max(100_000).optional(),
      /** The thread it was launched from: the session speaks as it (docs/voice/identity.md). None: the Chief of Staff. */
      threadId: z.string().min(1).max(200).optional(),
    }).strict(),
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
      /** Who the session speaks as: the pill shows `label`; relays with no target go to `threadId`. */
      identity: voiceIdentitySchema,
    }),
  },
  "voiceLive.tool": {
    experimental_description: "Run one of the voice's tools (todos_list, read_replies, send_to_cos, send_to_thread, todos_act, todos_add, undo, stop_thread, archive_thread, pause_automation, delete_automation, confirm, cancel). The old names loops_list, loops_act and loops_add still work. Relays and todo actions happen at once; destructive ones wait for confirm after a spoken yes. Saves `events` first, so a yes said just before confirm counts. Returns the function_call_output text, and for an \"answer\" relay a waitFor: the one \"still waiting\" note to add if no reply comes in time.",
    input: z.object({ sessionId, name: z.string().min(1).max(64), args: z.string().max(20_000).optional(), events: z.array(liveEventSchema).max(200).optional() }).strict(),
    output: z.object({
      output: z.string(),
      /**
       * After an "answer" relay: if no reply for this session comes within `ms`,
       * add `note` to the conversation once (spoken), so the voice says "Still
       * waiting on <title>." Cancel it when a reply arrives, the user says
       * something new, or the session ends. Absent for every other tool.
       */
      waitFor: z.object({ title: z.string(), ms: z.number().int().min(0), note: z.string() }).optional(),
    }),
  },
  "voiceLive.event": {
    experimental_description: "Report what happened: finished transcript lines, interruptions and usage. Returns the running cost, how many replies wait for voiceLive.poll, and whether to stop (the monthly cap).",
    input: z.object({ sessionId, events: z.array(liveEventSchema).max(200) }).strict(),
    /** voiceThreadId: the session's voice thread once it's open (the pill links to it). */
    output: z.object({ costUsd: z.number().nullable(), replies: z.number().int(), stop: z.string().nullable(), voiceThreadId: z.string().nullable() }),
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
