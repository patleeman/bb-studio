// Hands-free voice's names the clients and server share; no SDK imports.
//
// A hands-free session is a speech-to-speech model (GPT-Live or the Realtime
// API) that the phone talks to over WebRTC. It is the "voice agent": small,
// fast, and with no data of its own. Its tools run here in Studio
// (tools.ts), which enforces the eyes-free rules, and every send it makes is
// a visible message in the target thread and in the session's voice thread.

/** Studio publishes `VoiceLiveSignal` here: a reply for a live session to pick up, or a session ended. */
export const VOICE_LIVE_CHANNEL = "studio-voice-live";

export interface VoiceLiveSignal {
  sessionId: string;
  kind: "reply" | "ended";
}

/** The models, best first: GPT-Live (server creates the session), then Realtime (the phone gets a client secret). */
export const LIVE_MODELS = ["gpt-live-1", "gpt-realtime-2.1"] as const;
export type LiveModel = (typeof LIVE_MODELS)[number];

/** How the phone connects for each model. */
export type LiveTransport = "live-webrtc" | "realtime-webrtc" | "mock";

/** Where the phone sends its SDP offer for the Realtime API, with the client secret as its bearer token. */
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
/** The data channel both APIs carry JSON events on. */
export const DATA_CHANNEL = "oai-events";

/**
 * The voice agent's tools. Reads are free; sends need a spoken yes
 * (confirm_send); done and snooze run at once with a spoken undo window.
 * Nothing else is a tool: spending, email, posting, deleting and approvals
 * can't be reached by voice at all.
 */
export const VOICE_TOOLS = ["loops_list", "read_replies", "send_to_cos", "send_to_thread", "confirm_send", "cancel_send", "loops_act", "undo"] as const;
export type VoiceToolName = (typeof VOICE_TOOLS)[number];

/** "$0.42", "<$0.01". */
export function usd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** "6 min", "45 s". */
export function sessionLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** The note the phone adds to the conversation when a relayed thread answers. */
export function replyNote(title: string, summary: string): string {
  return `(Studio, not the user:) ${title} answered: ${summary}\nTell the user in a sentence or two, then let them talk.`;
}

/** The note the phone adds after the user talked over the voice: where it was cut off. */
export function interruptedNote(heard: string): string {
  const said = heard.trim();
  return said
    ? `(Studio, not the user:) The user interrupted you. They heard up to: "${said.slice(-200)}". Don't repeat it; answer what they said next.`
    : "(Studio, not the user:) The user interrupted you before you said anything. Answer what they said.";
}
