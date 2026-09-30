// What an agent receives when a recording is @-mentioned, and the rows the
// mention menu shows.
import type { Recording } from "../shared/contract";
import { formatLength, recordingHref } from "../shared/format";

/** Mention context budget. Longer transcripts point at the CLI for the rest. */
export const MENTION_TRANSCRIPT_CHARS = 60_000;

const STATUS_LABEL: Record<Recording["status"], string> = {
  recording: "recording now",
  paused: "paused",
  interrupted: "interrupted",
  finishing: "finishing transcription",
  done: "complete",
};

export function mentionSubtitle(recording: Recording): string {
  const date = new Date(recording.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const parts = [date, formatLength(recording.durationMs)];
  if (recording.status !== "done") parts.push(STATUS_LABEL[recording.status]);
  return parts.join(" · ");
}

export function mentionContext(recording: Recording, transcript: string): string {
  const started = new Date(recording.createdAt).toISOString();
  const header = [
    `Talk recording "${recording.title}" — ${recordingHref(recording.id)}`,
    `Recorded ${started}, ${formatLength(recording.durationMs)}, ${recording.wordCount} words, ${STATUS_LABEL[recording.status]}.`,
  ];
  if (recording.pendingCount > 0 || recording.failedCount > 0) {
    header.push(
      `Transcript is incomplete: ${recording.pendingCount} segment(s) still transcribing, ${recording.failedCount} failed.`,
    );
  }
  header.push(`Link to it in replies as [${recording.title}](${recordingHref(recording.id)}).`);
  let body = transcript.trim() === "" ? "(No transcript yet.)" : transcript;
  if (body.length > MENTION_TRANSCRIPT_CHARS) {
    body =
      `${body.slice(0, MENTION_TRANSCRIPT_CHARS)}\n\n[Transcript truncated at ${MENTION_TRANSCRIPT_CHARS} of ${transcript.length} characters. ` +
      `Read the rest with: bb talk transcript ${recording.id} --offset ${MENTION_TRANSCRIPT_CHARS}]`;
  }
  return `${header.join("\n")}\n\nTranscript:\n${body}`;
}
