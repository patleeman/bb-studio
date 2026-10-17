// What a thread composer's voice controls share: one player for the window (a
// reply speaking in one thread stops when another starts), each thread's
// voice mode, so the speaker button and the pill agree, and the composers that
// can take a finished dictation.
import { useSyncExternalStore } from "react";
import { Speaker, type SpeakerState } from "../../speech/speaker";
import { clearHighlight, highlightPiece } from "./read-along";

interface Snapshot {
  /** The thread whose reply is playing or loading, if any. */
  threadId: string | null;
  playing: SpeakerState;
  /** Voice mode per thread, as last read or set. */
  on: Readonly<Record<string, boolean>>;
}

let snapshot: Snapshot = { threadId: null, playing: "idle", on: {} };
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

export const voicePlayer = {
  /** Play a thread's reply, cutting off whatever was speaking; each piece lights up as it plays. */
  play(threadId: string, urls: readonly string[], pieces: readonly string[] = []): Promise<void> {
    set({ threadId });
    return speaker.play(urls, (index) => { if (pieces[index]) highlightPiece(pieces[index]!); });
  },
  stop(): void {
    speaker.stop();
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
  /** A voice thread's composer offers to take its finished dictations; returns the release. */
  takeDictations(threadId: string, send: (text: string) => void): () => void {
    composers.set(threadId, send);
    return () => { if (composers.get(threadId) === send) composers.delete(threadId); };
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
