// Voice calls' names the frontend and server share; no SDK imports, so the app bundle can take them.

/** Studio publishes `VoiceCallSignal` here: something for a call to pick up (a Bot reply), or the call's record changed. */
export const VOICE_CALL_CHANNEL = "studio-voice-call";

export interface VoiceCallSignal {
  callId: string;
  /** "reply": the Bot answered something the call sent it; call voice_call_poll. "ended": the call's record is saved. */
  kind: "reply" | "ended";
}

/** Where the client sends its SDP offer, with the client secret as its bearer token. */
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/** The data channel OpenAI's WebRTC calls carry events on. */
export const REALTIME_DATA_CHANNEL = "oai-events";

/** The call's tools: everything but send_to_bot only reads. */
export const VOICE_CALL_TOOLS = ["bot_status", "leads_status", "daily_brief", "send_to_bot"] as const;
export type VoiceCallToolName = (typeof VOICE_CALL_TOOLS)[number];

/** The spoken note the client adds when the Bot answers mid-call. */
export function botReplyNote(botName: string, summary: string): string {
  return `(Studio, not the user:) ${botName} replied to what you sent: ${summary}\nTell the user in a sentence or two, then let them talk.`;
}

/** "6 min", "45 s": a call's length for its record. */
export function callLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}

/** "4:05": the call bar's timer. */
export function callClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** "$0.42", "<$0.01". */
export function callUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}
