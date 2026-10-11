import type { Recording } from "../shared/contract";
import { recordingHref } from "../shared/format";

export type RecordingReference = Pick<Recording, "id" | "title" | "kind">;

export function parseRecordingReference(value: unknown): RecordingReference | null {
  if (!value || typeof value !== "object") return null;
  const { id, title, kind } = value as Record<string, unknown>;
  if (typeof id !== "string" || !/^rec_[a-z0-9]{8,32}$/.test(id) || typeof title !== "string" || (kind !== "dictation" && kind !== "recording")) return null;
  return { id, title: title.trim().slice(0, 160) || (kind === "dictation" ? "Dictation" : "Recording"), kind };
}

export function recordingLink(recording: RecordingReference, title = recording.title): string {
  return `[${title.replace(/[\[\]\\\n\r]/g, " ").trim()}](${recordingHref(recording.id)})`;
}

/** A portable version for the clipboard or a composer without a Talk bridge. */
export function textWithRecordings(text: string, recordings: readonly RecordingReference[]): string {
  return [text.trim(), ...recordings.map((recording) => recordingLink(recording))].join("\n\n");
}
