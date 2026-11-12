// Hands-free voice's names the clients and server share; no SDK imports.
//
// A hands-free session is a speech-to-speech model (GPT-Live or the Realtime
// API) that the phone talks to over WebRTC. It is the "voice agent": small,
// fast, and with no data of its own. Its tools run here in Studio
// (tools.ts), which enforces the eyes-free rules, and every send it makes is
// a visible message in the target thread and in the session's voice thread.

/** Studio publishes `VoiceLiveSignal` here: a reply for a live session to pick up, or a session ended. */
export const VOICE_LIVE_CHANNEL = "studio-voice-live";

/**
 * A window event any plugin's page can dispatch to start a hands-free
 * session speaking for one of its threads: detail `{ threadId }`. The Canvas
 * plugin's page does, for its canvas thread.
 */
export const HANDSFREE_START_EVENT = "bb-studio:handsfree-start";

export interface VoiceLiveSignal {
  sessionId: string;
  kind: "reply" | "ended";
}

/** The models, best first: GPT-Live (server creates the session), then Realtime (the phone gets a client secret). */
export const LIVE_MODELS = ["gpt-live-1", "gpt-realtime-2.1"] as const;
export type LiveModel = (typeof LIVE_MODELS)[number];

/**
 * Each model's voices (checked 2026-11-01). GPT-Live:
 * developers.openai.com/api/docs/guides/live-conversations (default marin);
 * Realtime: developers.openai.com/api/docs/guides/realtime-conversations.
 * marin is in both, so it's the default.
 */
export const LIVE_VOICES: Record<LiveModel, readonly string[]> = {
  "gpt-live-1": ["marin", "quartz", "ripple", "vesper", "willow", "stone", "gleam", "meridian", "bossa", "tempo", "beacon", "delta", "cinder", "nuri", "juni", "flitz", "brise", "sillage", "nira", "harema", "shida", "noeul"],
  "gpt-realtime-2.1": ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"],
};
export const DEFAULT_VOICE = "marin";
/** Every voice either model has, for the setting's options. */
export const ALL_VOICES: readonly string[] = [...new Set(Object.values(LIVE_VOICES).flat())];
/** The voice a session uses: the chosen one when its model has it, otherwise marin. */
export const voiceFor = (model: LiveModel, voice: string | null | undefined): string =>
  voice && LIVE_VOICES[model].includes(voice) ? voice : DEFAULT_VOICE;

/** GPT-Live's backend (responses delegation): the models it may use, cheapest first. Realtime has none. */
export const BACKEND_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"] as const;
export type BackendModel = (typeof BACKEND_MODELS)[number];
export const DEFAULT_BACKEND_MODEL: BackendModel = "gpt-5.6-luna";
export const DEFAULT_CAP_USD = 20;

/** How the phone connects for each model. */
export type LiveTransport = "live-webrtc" | "realtime-webrtc" | "mock";

/** Where the phone sends its SDP offer for the Realtime API, with the client secret as its bearer token. */
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
/** The data channel both APIs carry JSON events on. */
export const DATA_CHANNEL = "oai-events";

/**
 * The voice agent's tools. Reads are free; relays and todo actions happen at
 * once (todo actions with a spoken undo); destructive ones (drop a todo, stop
 * or archive a thread, pause or delete an automation) wait for a spoken yes
 * (confirm). Spending, messaging people outside BB, posting publicly and
 * approving credentials aren't tools at all.
 */
export const VOICE_TOOLS = ["todos_list", "read_replies", "send_to_cos", "send_to_thread", "todos_act", "todos_add", "undo", "stop_thread", "archive_thread", "pause_automation", "delete_automation", "confirm", "cancel"] as const;
export type VoiceToolName = (typeof VOICE_TOOLS)[number];
/** The tools' names from before Todos were renamed: still accepted, not offered. */
export const VOICE_TOOL_ALIASES: Readonly<Record<string, VoiceToolName>> = { loops_list: "todos_list", loops_act: "todos_act", loops_add: "todos_add" };
/** A tool's current name: an old `loops_*` name becomes its `todos_*` one. */
export const voiceToolName = (name: string): string => VOICE_TOOL_ALIASES[name] ?? name;

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

export type RelayIntent = "answer" | "do" | "fyi";
/** Old callers and malformed tool arguments must still hear the answer. */
export const relayIntent = (value: unknown): RelayIntent => value === "do" || value === "fyi" ? value : "answer";

/** The note the phone adds to the conversation when a relayed thread answers. */
export function replyNote(title: string, summary: string, intent: RelayIntent = "do", nextPart?: number): string {
  if (intent === "answer") return `(Studio, not the user:) ${title} answered. Read it to the user in full, in your own spoken words, without shortening: <reply>${summary}</reply>${nextPart ? `
Reply cut: true. Then ask if they want the rest. If yes, call read_replies with target "${title}" and part ${nextPart}.` : ""}`;
  return `(Studio, not the user:) ${title} answered: ${summary}\nTell the user in a sentence or two, then let them talk.`;
}

/** The note the phone adds after the user talked over the voice: where it was cut off. */
export function interruptedNote(heard: string): string {
  const said = heard.trim();
  return said
    ? `(Studio, not the user:) The user interrupted you. They heard up to: "${said.slice(-200)}". Don't repeat it; answer what they said next.`
    : "(Studio, not the user:) The user interrupted you before you said anything. Answer what they said.";
}

/** How long the client waits for an "answer" relay's reply before the voice says it's still waiting, once. */
export const STILL_WAITING_MS = 20_000;

/** What the client is told to wait for after an "answer" relay (voiceLive.tool's `waitFor`). */
export interface VoiceWaitFor { title: string; ms: number; note: string }

/** The note the client adds, once, when an "answer" relay has had no reply for STILL_WAITING_MS. */
export function waitingNote(title: string): string {
  return `(Studio, not the user:) ${title} hasn't answered yet. Say only, briefly: "Still waiting on ${title}." Then wait; don't guess.`;
}

/** The waitFor an "answer" relay to `title` returns. */
export const waitFor = (title: string): VoiceWaitFor => ({ title, ms: STILL_WAITING_MS, note: waitingNote(title) });
