// The transcription queue. Segments are transcribed in recorded order within a
// recording (each uses the previous segment's text as its hint) and in
// parallel across recordings. Failures back off and retry; nothing is dropped.
import type { AudioFiles } from "./audio-files";
import type { PendingSegment, TalkStore } from "./store";

export type Transcribe = (audio: File, hint: string, signal: AbortSignal) => Promise<string>;

export interface TranscriberDeps {
  store: TalkStore;
  files: AudioFiles;
  transcribe: Transcribe;
  /** A segment finished (or gave up); the recording's view changed. */
  onSegment(recordingId: string): void;
  warn(message: string): void;
  concurrency?: number;
}

const BACKOFF_MS = [5_000, 15_000, 60_000, 180_000, 600_000];
/** Transient failures keep retrying for roughly a day before giving up. */
export const MAX_ATTEMPTS = 60;
/** While the voice service is off or signed out, check back every 10 minutes. */
const UNAVAILABLE_RETRY_MS = 600_000;

export function retryDelay(attempts: number, error: string): number | null {
  if (attempts + 1 >= MAX_ATTEMPTS) return null;
  if (isUnavailable(error)) return UNAVAILABLE_RETRY_MS;
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!;
}

/** The voice service is turned off, missing, or signed out: waiting helps. */
export function isUnavailable(error: string): boolean {
  return /\b(501|401|403)\b|not (configured|available|signed)|unavailable|turned off|sign in/i.test(error);
}

export class Transcriber {
  private wakeUp: (() => void) | null = null;
  private woken = false;
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: TranscriberDeps) {}

  /** New work arrived: stop sleeping. */
  wake(): void {
    if (this.wakeUp) this.wakeUp();
    else this.woken = true;
  }

  async run(signal: AbortSignal): Promise<void> {
    const concurrency = this.deps.concurrency ?? 2;
    const running = new Set<Promise<void>>();
    while (!signal.aborted) {
      const free = concurrency - running.size;
      const batch =
        free > 0
          ? this.deps.store.due(free + this.inFlight.size).filter((s) => !this.inFlight.has(s.recordingId))
          : [];
      for (const segment of batch.slice(0, free)) {
        this.inFlight.add(segment.recordingId);
        const task = this.process(segment, signal).finally(() => {
          this.inFlight.delete(segment.recordingId);
          running.delete(task);
          this.wake();
        });
        running.add(task);
      }
      const nextAt = this.deps.store.nextDueAt();
      let idleMs = nextAt === null ? 60_000 : Math.max(250, Math.min(60_000, nextAt - Date.now()));
      // Due rows that are all in flight: a finishing task wakes the loop.
      if (batch.length === 0 && running.size > 0) idleMs = 60_000;
      if (batch.length > 0 && running.size < concurrency) idleMs = 0;
      await this.sleep(idleMs, signal);
    }
    await Promise.allSettled(running);
  }

  private async process(segment: PendingSegment, signal: AbortSignal): Promise<void> {
    const { store, files, transcribe, onSegment, warn } = this.deps;
    try {
      const bytes = await files.read(segment.file);
      const audio = new File([new Uint8Array(bytes)], segment.file.split("/").pop()!, {
        type: segment.mimeType.split(";")[0],
      });
      const text = await transcribe(audio, segment.hint, signal);
      store.markTranscribed(segment.recordingId, segment.id, text);
    } catch (cause) {
      if (signal.aborted) return;
      const error = cause instanceof Error ? cause.message : String(cause);
      const missing = /ENOENT/.test(error);
      const delay = missing ? null : retryDelay(segment.attempts, error);
      if (delay === null || segment.attempts === 0) {
        warn(`Transcribing ${segment.recordingId}/${segment.id} failed: ${error}`);
      }
      store.markFailed(segment.recordingId, segment.id, error, delay);
    }
    onSegment(segment.recordingId);
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (this.woken || ms === 0) {
      this.woken = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        this.wakeUp = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
      this.wakeUp = done;
    });
  }
}
