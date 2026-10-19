// The composer's one recording surface: who owns the microphone, what the
// footer shows, and how push-to-talk and hands-free take turns. Pure, so the
// rules are tested without a microphone or a speaker.
//
// - One recording at a time: Talk's dictation or voice mode's capture, never
//   both, and your voice (red) and the Bot's (blue) never show at once.
//   Turning voice mode on finishes a dictation; starting a dictation in a
//   voice thread ends voice mode's turn and holds it (hands-free too) until
//   the dictation is done.
// - Push-to-talk, the default: hold to talk, release to send; a press while
//   the Bot speaks cuts it off. Holding without saying anything (a long
//   press) switches to hands-free.
// - Hands-free: always listening; a pause after you speak sends the turn, and
//   talking over the Bot stops it. Tapping the red pill goes back to
//   push-to-talk.

export type VoiceSub = "ptt" | "hands-free";

/** A silent hold at least this long is a long press: hands-free. Shorter is a tap. */
export const LONG_PRESS_MS = 600;
/** Sound above the speech level this long is you talking. */
export const SPEECH_MS = 200;
/** The smoothed input level (0..1) that counts as speech. */
export const SPEECH_LEVEL = 0.2;
/**
 * Talking over the Bot: a higher level for longer, so its own voice leaking
 * past echo cancellation doesn't interrupt it.
 */
export const BARGE_LEVEL = 0.32;
export const BARGE_MS = 300;
/** In hands-free, this much quiet after you spoke ends your turn. */
export const TURN_END_MS = 1200;

export interface VoiceInput {
  sub: VoiceSub;
  /** When the push-to-talk control went down, while it's held. */
  pressedAt: number | null;
  /** A dictation has the mic: voice mode doesn't listen until it ends. */
  yielded?: true;
}

export const INITIAL_INPUT: VoiceInput = { sub: "ptt", pressedAt: null };

export type VoiceEvent =
  | { type: "press"; at: number }
  | { type: "release"; at: number; heard: boolean }
  /** The pointer left without a release (Escape, a lost pointer). */
  | { type: "cancel" }
  | { type: "tap-pill"; heard: boolean }
  /** The speech gate heard you talk over the Bot. */
  | { type: "barge-in" }
  /** Hands-free: a pause after you spoke. */
  | { type: "turn-end" }
  | { type: "voice-on"; dictating: boolean }
  /** Talk's dictation mic was pressed in this thread: hand it the mic. */
  | { type: "dictation-start"; heard: boolean }
  /** That dictation is over (or never started): voice mode listens again. */
  | { type: "dictation-end" }
  | { type: "voice-off" };

export type VoiceEffect =
  /** Open voice mode's capture (Talk, in this thread). */
  | "start-capture"
  /** End the capture and send what was heard. */
  | "send"
  /** End the capture without sending. */
  | "discard"
  | "stop-playback"
  /** Finish Talk's dictation (typing it in) before voice mode takes the mic. */
  | "finish-dictation"
  | "show-hint";

export interface Context {
  /** The Bot's reply is playing or loading. */
  speaking: boolean;
  /** Voice mode's capture is open or opening. */
  capturing: boolean;
}

export function reduce(state: VoiceInput, event: VoiceEvent, context: Context): { state: VoiceInput; effects: VoiceEffect[] } {
  switch (event.type) {
    case "press": {
      if (state.sub !== "ptt" || state.pressedAt !== null || state.yielded) return { state, effects: [] };
      const effects: VoiceEffect[] = [];
      if (context.speaking) effects.push("stop-playback");
      if (!context.capturing) effects.push("start-capture");
      return { state: { ...state, pressedAt: event.at }, effects };
    }
    case "release": {
      if (state.pressedAt === null) return { state, effects: [] };
      const held = event.at - state.pressedAt;
      if (event.heard) return { state: { ...state, pressedAt: null }, effects: ["send"] };
      // A long silent hold: stay listening, now hands-free.
      if (held >= LONG_PRESS_MS) return { state: { sub: "hands-free", pressedAt: null }, effects: [] };
      return { state: { ...state, pressedAt: null }, effects: ["discard", "show-hint"] };
    }
    case "cancel":
      if (state.pressedAt === null) return { state, effects: [] };
      return { state: { ...state, pressedAt: null }, effects: context.capturing ? ["discard"] : [] };
    case "tap-pill":
      if (state.sub !== "hands-free") return { state, effects: [] };
      // What you'd already said still goes; silence just closes the mic.
      return { state: { sub: "ptt", pressedAt: null }, effects: context.capturing ? [event.heard ? "send" : "discard"] : [] };
    case "barge-in":
      return { state, effects: context.speaking ? ["stop-playback"] : [] };
    case "turn-end":
      return { state, effects: state.sub === "hands-free" && context.capturing ? ["send"] : [] };
    case "voice-on":
      return { state: INITIAL_INPUT, effects: event.dictating ? ["finish-dictation"] : [] };
    case "voice-off":
      return { state: INITIAL_INPUT, effects: context.capturing ? ["discard"] : [] };
    case "dictation-start": {
      // What you'd already said in this turn still goes; then the mic is the dictation's.
      const effects: VoiceEffect[] = context.capturing ? [event.heard ? "send" : "discard"] : [];
      if (context.speaking) effects.push("stop-playback");
      return { state: { sub: state.sub, pressedAt: null, yielded: true }, effects };
    }
    case "dictation-end":
      return { state: state.yielded ? { sub: state.sub, pressedAt: state.pressedAt } : state, effects: [] };
  }
}

/** Hands-free listens whenever it isn't already: the effect that keeps the mic open between turns. */
export function wantsCapture(voiceOn: boolean, state: VoiceInput, talkIdle: boolean): boolean {
  return voiceOn && state.sub === "hands-free" && !state.yielded && talkIdle;
}

/**
 * The footer, from what's going on:
 * - `idle`: dictation mic and voice mode's speaker, no timers.
 * - `dictating`: Talk's red recorder with its timer (voice mode off, or a
 *   dictation started from Talk's mic in a voice thread).
 * - `ready`: voice mode on, push-to-talk, nothing heard: the hold-to-talk control.
 * - `listening`: voice mode's red pill (no timer).
 * - `speaking`: the Bot's blue pill with Stop, in the same spot.
 */
export type FooterKind = "idle" | "dictating" | "ready" | "listening" | "speaking";

export interface Footer {
  kind: FooterKind;
  sub: VoiceSub;
  /** The hold-to-talk control. */
  ptt: boolean;
  /** The one input or output indicator, if any. */
  indicator: "recorder" | "input" | "output" | null;
  /** The state word for the field's placeholder (and the pill's accessible name). */
  placeholder: "Listening…" | "Speaking…" | null;
}

export function footer(input: {
  voiceOn: boolean;
  state: VoiceInput;
  /** Talk is dictating (not voice mode's capture). */
  dictating: boolean;
  /** Voice mode's capture is open in this thread (the control held, the hold-to-talk key, or hands-free). */
  capturing: boolean;
  speaking: boolean;
}): Footer {
  const { voiceOn, state, dictating, capturing, speaking } = input;
  if (!voiceOn) {
    return dictating
      ? { kind: "dictating", sub: "ptt", ptt: false, indicator: "recorder", placeholder: null }
      : { kind: "idle", sub: "ptt", ptt: false, indicator: null, placeholder: null };
  }
  // A dictation has the mic: Talk's recorder is the one indicator; voice mode waits.
  if (dictating) return { kind: "dictating", sub: state.sub, ptt: false, indicator: "recorder", placeholder: null };
  // Your voice wins the spot while you hold to talk: the press already cut the Bot off.
  const talking = state.pressedAt !== null || (state.sub === "ptt" && capturing);
  // Hands-free keeps listening under the Bot's voice, but shows the Bot until you talk over it.
  if (speaking && !talking) return { kind: "speaking", sub: state.sub, ptt: state.sub === "ptt", indicator: "output", placeholder: "Speaking…" };
  if (talking || state.sub === "hands-free") return { kind: "listening", sub: state.sub, ptt: state.sub === "ptt", indicator: "input", placeholder: "Listening…" };
  return { kind: "ready", sub: "ptt", ptt: true, indicator: null, placeholder: null };
}

/**
 * Turn taking from the input level: whether you've spoken this turn, whether
 * you're talking over the Bot, and (hands-free) when your turn is over.
 */
export class SpeechGate {
  private loudMs = 0;
  heard = false;

  /** `level` is Talk's smoothed 0..1 level; `quietForMs` its time under the noise-floor threshold. */
  push(sample: { level: number; quietForMs: number }, dtMs: number, speaking: boolean): { bargeIn: boolean; turnEnd: boolean } {
    const loud = sample.quietForMs === 0 && sample.level >= (speaking ? BARGE_LEVEL : SPEECH_LEVEL);
    this.loudMs = loud ? this.loudMs + dtMs : 0;
    const talking = this.loudMs >= (speaking ? BARGE_MS : SPEECH_MS);
    if (talking) this.heard = true;
    return { bargeIn: talking && speaking, turnEnd: this.heard && !speaking && sample.quietForMs >= TURN_END_MS };
  }

  reset(): void {
    this.loudMs = 0;
    this.heard = false;
  }
}

/** The first-time hint, "Hold to talk · long-press for hands-free", remembered once seen. */
export const HINT_KEY = "studio:voice:ptt-hint-seen";
export const HINT_TEXT = "Hold to talk · long-press for hands-free";

export interface HintStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Whether to show the hint now; showing it marks it seen, so it appears once. */
export function takeHint(storage: HintStore | null): boolean {
  try {
    if (!storage || storage.getItem(HINT_KEY) === "1") return false;
    storage.setItem(HINT_KEY, "1");
    return true;
  } catch {
    // Without storage it would show every time: better not at all.
    return false;
  }
}
