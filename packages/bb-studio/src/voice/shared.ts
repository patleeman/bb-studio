// Voice mode's names the frontend and server share; no SDK imports, so the app bundle can take them.

/** Studio publishes `VoiceSpoken` here when a voice thread's reply is ready to play. */
export const VOICE_REALTIME_CHANNEL = "studio-voice";

export interface VoiceSpoken {
  /** Identifies this reply delivery, independently of its cached audio. */
  eventId: string;
  threadId: string;
  text: string;
  /** Audio URLs for the reply's pieces, in order; the server is already making them. */
  urls: string[];
  /** The text of each piece, for lighting it up in the transcript as it plays. */
  pieces: string[];
  /** Why it can't be spoken (speech isn't set up), when it can't. */
  problem?: string;
}
