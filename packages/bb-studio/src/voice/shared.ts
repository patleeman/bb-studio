// Voice's names the frontend and server share; no SDK imports, so the app bundle can take them.

export const VOICE_SUBPATH = "voice";
/** Studio publishes `VoiceSpoken` here when the voice agent's reply is ready to play. */
export const VOICE_REALTIME_CHANNEL = "studio-voice";

export interface VoiceSpoken {
  threadId: string;
  text: string;
  /** Audio URLs for the reply's pieces, in order; the server is already making them. */
  urls: string[];
  /** Why it can't be spoken (speech isn't set up), when it can't. */
  problem?: string;
}
