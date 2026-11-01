// A hands-free session's OpenAI side: what the voice is told, its tools, and
// the requests that start it. The key is only ever used here, on the host.
//
// Docs (checked 2026-11-01):
// - GPT-Live: https://developers.openai.com/api/docs/models/gpt-live-1
//   The server creates the session: POST /v1/live/sessions with the phone's
//   SDP offer, and gets the SDP answer back (201). Live has no client
//   secrets, so the phone never holds a credential at all.
//   https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
// - Delegation: "responses" runs a Responses model as the backend, whose
//   function calls come to us; "client" hands each turn to our own agent
//   (no task text, only transcripts). We use "responses" with function tools.
//   https://developers.openai.com/api/docs/guides/live-delegation
// - Realtime (the fallback): POST /v1/realtime/client_secrets mints a short
//   secret with the whole session; the phone POSTs its SDP to /v1/realtime/calls.
//   https://developers.openai.com/api/docs/guides/realtime-webrtc
import type { LiveModel, VoiceToolName } from "./shared";
import { DRAFT_MS, UNDO_MS, VOICE_SNOOZES } from "./rules";

export const LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
export const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
/** A Realtime client secret lives this long; the phone must connect before then. */
export const CLIENT_SECRET_SECONDS = 120;
/** GPT-Live's backend: cheap and fast; it only picks tools and words replies. */
export const LIVE_BACKEND_MODEL = "gpt-5.6-luna";
export const REALTIME_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
/** Both APIs default to marin; it's in GPT-Live's list and the Realtime one. */
export const VOICE = "marin";

const seconds = (ms: number) => Math.round(ms / 1000);

/** What the voice is told. Plain, short, and the rules (which Studio enforces anyway). */
export function voiceInstructions(cosName: string): string {
  return `You are the user's hands-free voice assistant. They're often driving: they can't look at a screen or tap anything. You're a fast front end: you read them what's waiting, and you pass messages to ${cosName} (their Chief of Staff) and to their threads, then read the replies back.

How to talk:
- Short, natural spoken sentences, usually one or two. No lists, markdown, links or code.
- Lead with the answer. If you didn't catch something, say what you heard and ask.
- Don't narrate tools. Say what happened in a few words.
- If you're interrupted, stop, and answer what they said next.

How to work:
- "What's waiting?": loops_list, then the most urgent few, briefly.
- To pass something on: send_to_cos, or send_to_thread with a name like "the Kensico lead". Write a complete request: they don't hear this conversation. Studio answers with a read-back; say it exactly, then wait. Only when the user says yes, call confirm_send. A no, a change or silence means cancel_send or a new draft.
- Done or snooze a loop with loops_act. Say what you did and that they can say "undo" for ${seconds(UNDO_MS)} seconds; on "undo", call undo.
- When a thread answers, Studio tells you. Sum it up in a sentence or two. read_replies reads one again.
- You can't spend money, email or message people, post anything, delete anything or approve anything, and neither can ${cosName} on your word. Say ${cosName} will ask in the chat.`;
}

/** GPT-Live's backend model: it decides on tools and words the results for the voice. */
export function backendInstructions(cosName: string): string {
  return `${voiceInstructions(cosName)}

You are the backend behind the live voice: call the tools, then answer in one or two short spoken sentences the voice can say as they are. Read a send's read-back word for word. A draft waits ${seconds(DRAFT_MS)} seconds for a yes.`;
}

type ToolDefinition = { type: "function"; name: VoiceToolName; description: string; parameters: Record<string, unknown> };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const message = { type: "string", description: "A complete request: the receiver doesn't hear this conversation." };

export const VOICE_TOOL_DEFINITIONS: ToolDefinition[] = [
  { type: "function", name: "loops_list", description: "What's waiting on the user: needs you now, then coming up, with each loop's id.", parameters: object({}) },
  { type: "function", name: "read_replies", description: "The latest reply from a thread you sent to (or a named one): who answered and what, summed up.", parameters: object({ target: { type: "string", description: "Optional: a thread's name, \"the Bot\" or \"the Kensico lead\". Empty: the replies to this session's sends." } }) },
  { type: "function", name: "send_to_cos", description: "Draft a message to the Chief of Staff. Nothing is sent until the user says yes: it returns the read-back to say.", parameters: object({ message }, ["message"]) },
  { type: "function", name: "send_to_thread", description: "Draft a message to a thread by name or project lead (\"the Kensico lead\", \"launch review\"). Nothing is sent until the user says yes: it returns the read-back to say, or the names to choose from.", parameters: object({ target: { type: "string" }, message }, ["target", "message"]) },
  { type: "function", name: "confirm_send", description: "Send a draft after the user said yes out loud. Studio checks it heard the yes itself.", parameters: object({ draft_id: { type: "string" } }, ["draft_id"]) },
  { type: "function", name: "cancel_send", description: "Drop a draft: the user said no or changed it.", parameters: object({ draft_id: { type: "string" } }, ["draft_id"]) },
  { type: "function", name: "loops_act", description: "Mark a loop done, or snooze it. Runs at once and can be undone for a few seconds.", parameters: object({ loop_id: { type: "string" }, action: { type: "string", enum: ["done", "snooze"] }, snooze: { type: "string", enum: [...VOICE_SNOOZES] } }, ["loop_id", "action"]) },
  { type: "function", name: "undo", description: "Undo the last done or snooze, while its window is open.", parameters: object({ action_id: { type: "string" } }, ["action_id"]) },
];

/** POST /v1/live/sessions: GPT-Live over WebRTC, its backend a Responses model with Studio's tools. */
export function liveSessionRequest(input: { cosName: string; sdp: string; backendModel?: string }) {
  return {
    session: {
      model: "gpt-live-1" satisfies LiveModel,
      instructions: voiceInstructions(input.cosName),
      audio: { output: { voice: VOICE } },
      delegation: {
        type: "responses",
        responses: {
          model: input.backendModel ?? LIVE_BACKEND_MODEL,
          instructions: backendInstructions(input.cosName),
          tools: VOICE_TOOL_DEFINITIONS,
          tool_choice: "auto",
          // One at a time: a confirm must land after its draft.
          parallel_tool_calls: false,
        },
      },
      store: false,
    },
    transport: { type: "webrtc", sdp: input.sdp },
  };
}

/** POST /v1/realtime/client_secrets: the Realtime fallback's whole session, in a 2-minute secret. */
export function realtimeSecretRequest(input: { cosName: string }) {
  return {
    expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_SECONDS },
    session: {
      type: "realtime",
      model: "gpt-realtime-2.1" satisfies LiveModel,
      instructions: voiceInstructions(input.cosName),
      output_modalities: ["audio"],
      audio: {
        input: {
          transcription: { model: REALTIME_TRANSCRIBE_MODEL },
          noise_reduction: { type: "far_field" },
          // Semantic VAD waits for a finished thought, not a fixed pause; talking over the voice cancels its reply.
          turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true },
        },
        output: { voice: VOICE },
      },
      tools: VOICE_TOOL_DEFINITIONS,
      tool_choice: "auto",
    },
  };
}
