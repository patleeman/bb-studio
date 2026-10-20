// A voice call's OpenAI Realtime session: what the voice is told, its tools,
// and the client-secret request that carries them.
//
// Docs (checked 2026-10-20):
// - Client secrets: POST https://api.openai.com/v1/realtime/client_secrets
//   https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
// - WebRTC: the client POSTs its SDP offer to /v1/realtime/calls with the secret
//   https://developers.openai.com/api/docs/guides/realtime-webrtc
// - Models: https://developers.openai.com/api/docs/models
import type { VoiceCallToolName } from "./shared";

/** The Realtime models a call can use, newest first. */
export const CALL_MODELS = ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"] as const;
/** OpenAI's built-in voices; it recommends marin and cedar. */
export const CALL_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;
/** Input transcription: billed by token, cheap, reports usage. */
export const CALL_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
/** A client secret lives this long; the call must start before then. */
export const CLIENT_SECRET_SECONDS = 120;
export const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

/** What the voice is told. BB-style: plain, short, the rules that matter. */
export function callInstructions(botName: string): string {
  return `You are the voice on a phone call between the user and their assistant, ${botName}. You're a fast, friendly front end for ${botName}: the user talks to you, and you hand real work to ${botName}.

How to talk:
- Short, natural spoken sentences, usually one or two. No lists, markdown, links or code: everything you say is heard.
- Lead with the answer. If you didn't catch something, say what you heard and ask.
- Don't narrate tools. Say what you did in a few words.

How to work:
- Answer quick things yourself: small talk, what you can see with bot_status, leads_status and daily_brief.
- Anything real (research, code, changes, messages, plans, anything that takes more than a moment) goes to ${botName} with send_to_bot. Write a complete request, since ${botName} doesn't hear this call. Then say "On it" or "I've asked ${botName}", and keep talking with the user.
- When ${botName} replies during the call, Studio tells you. Sum it up in a sentence or two.
- Never approve or agree to spending money, anything outward-facing (emails, posts, messages to other people, purchases) or deleting anything. Say ${botName} will ask in the chat, and leave it to them.`;
}

/** The tools the voice can call: three that read, and send_to_bot. */
export const CALL_TOOL_DEFINITIONS: { type: "function"; name: VoiceCallToolName; description: string; parameters: Record<string, unknown> }[] = [
  {
    type: "function", name: "bot_status",
    description: "The Bot's state, what needs the user, what's in progress, and its latest reply.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function", name: "leads_status",
    description: "The user's project leads and the Bot's runners: each one's thread status and schedule.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function", name: "daily_brief",
    description: "Today's Kensico Brief and Heard on the Street top items, from the user's Studio items. Says when they can't be found.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function", name: "send_to_bot",
    description: "Send a message to the Bot's chat, where it does the work. The user sees it there, marked as from this call. The Bot's reply comes back during the call.",
    parameters: {
      type: "object",
      properties: { message: { type: "string", description: "A complete request: the Bot doesn't hear this call." } },
      required: ["message"],
      additionalProperties: false,
    },
  },
];

/** The body of POST /v1/realtime/client_secrets. */
export function clientSecretRequest(input: { botName: string; model: string; voice: string }) {
  return {
    expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_SECONDS },
    session: {
      type: "realtime",
      model: input.model,
      instructions: callInstructions(input.botName),
      output_modalities: ["audio"],
      audio: {
        input: {
          transcription: { model: CALL_TRANSCRIBE_MODEL },
          noise_reduction: { type: "near_field" },
          turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: true, interrupt_response: true },
        },
        output: { voice: input.voice },
      },
      tools: CALL_TOOL_DEFINITIONS,
      tool_choice: "auto",
    },
  };
}
