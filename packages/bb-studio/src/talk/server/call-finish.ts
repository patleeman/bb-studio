// When a call recording is done (Stop, or the app quit, and every piece is
// transcribed), Talk runs its usual flow on it: the title, the summary, Make
// Notes, then cleanup. The transcript keeps its "Me:" and "Them:" labels, so
// the notes can say who said what.
import type { Segment } from "../shared/contract";
import type { TalkStore } from "./store";

/** One cleanup call reads at most this much of a turn. */
export const TURN_CHARS = 4_000;

/**
 * A call's transcribed pieces as cleanup units: consecutive pieces from the
 * same side, split past `maxChars`. Cleaning a whole turn reads better than
 * 8-second pieces, and costs far fewer model calls.
 */
export function cleanupTurns(segments: readonly Segment[], maxChars = TURN_CHARS): { ids: string[]; text: string }[] {
  const turns: { ids: string[]; text: string; speaker: string | null | undefined }[] = [];
  for (const segment of segments) {
    if (segment.status !== "done" || segment.echo || !segment.text?.trim()) continue;
    const last = turns.at(-1);
    const text = segment.text.trim();
    if (last && last.speaker === segment.speaker && last.text.length + text.length + 1 <= maxChars) {
      last.ids.push(segment.id);
      last.text += ` ${text}`;
    } else {
      turns.push({ ids: [segment.id], text, speaker: segment.speaker });
    }
  }
  return turns.map(({ ids, text }) => ({ ids, text }));
}

/** Tells the summary and notes models what the labels mean. */
export function callContext(app: string): string {
  return `[A call recorded from ${app}. "Me" is the person who recorded it; "Them" is everyone else on the call.]\n\n`;
}

export interface CallFinisherDeps {
  store: Pick<TalkStore, "recording" | "segments" | "saveCleanup" | "cleanedTranscript">;
  title(id: string): void;
  summarize(id: string): Promise<void>;
  makeNotes(id: string): Promise<unknown>;
  /** The cleaned text, or null to keep the turn as spoken. */
  clean(id: string, text: string, segmentId: string): Promise<string | null>;
  changed(id: string): void;
  warn(message: string): void;
}

export class CallFinisher {
  private readonly running = new Set<string>();
  private readonly finished = new Set<string>();

  constructor(private readonly deps: CallFinisherDeps) {}

  /** Runs once per call, when it is done with nothing pending or failed. Safe to call on every change. */
  maybeRun(id: string): void {
    if (this.running.has(id) || this.finished.has(id)) return;
    const recording = this.deps.store.recording(id);
    if (!recording?.call || recording.status !== "done" || recording.pendingCount || recording.failedCount || !recording.wordCount) return;
    this.running.add(id);
    void this.run(id).finally(() => this.running.delete(id));
  }

  async run(id: string): Promise<void> {
    const { deps } = this;
    deps.title(id);
    await deps.summarize(id).catch((error) => deps.warn(`Talk could not summarize call ${id}: ${String(error)}`));
    const notesPage = deps.store.recording(id)?.notesPageId;
    if (!notesPage) await deps.makeNotes(id).catch((error) => deps.warn(`Talk could not make notes for call ${id}: ${String(error)}`));
    if (deps.store.cleanedTranscript(id) === null) await this.cleanUp(id);
    this.finished.add(id);
  }

  private async cleanUp(id: string): Promise<void> {
    const { deps } = this;
    const segments = deps.store.segments(id);
    const byId = new Map(segments.map((segment) => [segment.id, segment]));
    for (const turn of cleanupTurns(segments)) {
      if (turn.ids.every((segmentId) => byId.get(segmentId)?.cleanedText != null)) continue;
      const cleaned = await deps.clean(id, turn.text, turn.ids[0]!);
      if (cleaned === null) return; // Keep the rest as spoken; the page's Clean up still works.
      // The cleaned turn sits on its first piece; the others are folded into it.
      for (const [position, segmentId] of turn.ids.entries()) {
        const segment = byId.get(segmentId)!;
        if (!deps.store.saveCleanup(id, segmentId, segment.text!, position === 0 ? cleaned : "")) return;
      }
      deps.changed(id);
    }
  }
}
