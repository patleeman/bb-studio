// What a thread composer's voice controls share: one player for the window (a
// reply speaking in one thread stops when another starts), each thread's
// voice mode, so the speaker button and the pill agree, and the composers that
// can take a finished dictation.
import { useSyncExternalStore } from "react";
import { Speaker, type SpeakerState } from "../../speech/speaker";
import { speechChunks } from "../../speech/chunks";
import { speakable } from "../instructions";
import { clearHighlight, highlightPiece } from "./read-along";

interface Snapshot {
  /** The thread whose reply is playing or loading, if any. */
  threadId: string | null;
  playing: SpeakerState;
  /** Voice mode per thread, as last read or set. */
  on: Readonly<Record<string, boolean>>;
  /** The thread whose composer shows the push-to-talk hint, if any. */
  hint: string | null;
}

let snapshot: Snapshot = { threadId: null, playing: "idle", on: {}, hint: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// The reply's sound runs through an analyser so the pill can show its level.
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
const samples = new Float32Array(1024);
function playable(url: string): HTMLAudioElement {
  const audio = new Audio(url);
  try {
    audioContext ??= new AudioContext();
    if (!analyser) {
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(audioContext.destination);
    }
    audioContext.createMediaElementSource(audio).connect(analyser);
    void audioContext.resume().catch(() => {});
  } catch {
    // Without Web Audio it still plays; the pill just shows no level.
  }
  return audio;
}

const speaker = new Speaker(
  async () => { throw new Error("Voice mode plays audio the server prepared."); },
  (playing) => {
    if (playing === "idle") clearHighlight();
    set({ playing, ...(playing === "idle" ? { threadId: null } : {}) });
  },
  playable,
);

/** Composers showing a voice thread, by thread: they take a finished dictation and send it. */
const composers = new Map<string, (text: string) => void>();
/** Each voice thread's controls, told when a dictation takes or gives back the mic. */
const micHolders = new Map<string, (dictating: boolean) => void>();
/** The reply last started, so a second composer on the same thread (or a repeated event) doesn't start it again. */
let lastPlayed = "";
const playedEvents = new Set<string>();

// A reload of Studio's bundle loads this module again in the same window. Only
// the newest copy plays, and it silences the one before, so two replies never
// talk over each other.
const CURRENT = Symbol.for("bb-studio.voice.player");
const current = () => (window as unknown as Record<symbol, unknown>)[CURRENT];

export const voicePlayer = {
  /** Play a thread's reply, cutting off whatever was speaking; each piece lights up as it plays. */
  play(threadId: string, urls: readonly string[], pieces: readonly string[] = [], eventId?: string): Promise<void> {
    const key = eventId ? `${threadId}:${eventId}` : null;
    if (current() !== voicePlayer || (key && playedEvents.has(key))) return Promise.resolve();
    if (key) {
      playedEvents.add(key);
      if (playedEvents.size > 1000) playedEvents.delete(playedEvents.values().next().value!);
    }
    set({ threadId });
    return speaker.play(urls, (index) => { if (pieces[index]) highlightPiece(pieces[index]!); }).catch((error) => {
      if (key) playedEvents.delete(key);
      throw error;
    });
  },
  /** Read text aloud on request (a message's Read aloud), even if it was spoken before; again stops it. */
  readAloud(threadId: string, text: string, prepare: (piece: string) => Promise<string>): Promise<void> {
    if (snapshot.threadId === threadId && snapshot.playing !== "idle" && lastPlayed === `read:${text}`) {
      speaker.stop();
      return Promise.resolve();
    }
    const pieces = speechChunks(speakable(text));
    lastPlayed = `read:${text}`;
    set({ threadId });
    return speaker.play(pieces.map(prepare), (index) => { if (pieces[index]) highlightPiece(pieces[index]!); });
  },
  stop(): void {
    speaker.stop();
  },
  /** Playback speed for every reply from now on, and the one playing. */
  setRate(rate: number): void {
    speaker.setRate(rate);
  },
  isOn(threadId: string | null): boolean {
    return threadId !== null && snapshot.on[threadId] === true;
  },
  setOn(threadId: string, on: boolean): void {
    if (snapshot.on[threadId] === on) return;
    set({ on: { ...snapshot.on, [threadId]: on } });
    if (!on && snapshot.threadId === threadId) speaker.stop();
  },
  /** The playing reply's level, 0..1, for a meter; read it on animation frames. */
  level(): number {
    if (!analyser || snapshot.playing !== "speaking") return 0;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / samples.length) * 4);
  },
  /** Show the push-to-talk hint above a thread's composer, or hide it (null). */
  setHint(threadId: string | null): void {
    if (snapshot.hint !== threadId) set({ hint: threadId });
  },
  hint(): string | null {
    return snapshot.hint;
  },
  /** Called whenever voice mode or playback changes; returns the release. */
  subscribe,
  /** A voice thread's composer offers to take its finished dictations; returns the release. */
  takeDictations(threadId: string, send: (text: string) => void): () => void {
    composers.set(threadId, send);
    return () => { if (composers.get(threadId) === send) composers.delete(threadId); };
  },
  /** A voice thread's controls hand the mic to a dictation and take it back; returns the release. */
  holdMic(threadId: string, yieldTo: (dictating: boolean) => void): () => void {
    micHolders.set(threadId, yieldTo);
    return () => { if (micHolders.get(threadId) === yieldTo) micHolders.delete(threadId); };
  },
  /** Talk's voiceDictation.dictating: a dictation is starting in the thread (true) or is over (false). */
  dictating(threadId: string, dictating: boolean): void {
    micHolders.get(threadId)?.(dictating);
  },
  /** Talk's voiceDictation.deliver: true when a showing composer took the text. */
  deliver(threadId: string, text: string): boolean {
    const send = composers.get(threadId);
    if (!send) return false;
    send(text);
    return true;
  },
};

export function useVoiceSnapshot(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

const previous = current() as { stop(): void } | undefined;
(window as unknown as Record<symbol, unknown>)[CURRENT] = voicePlayer;
previous?.stop();
