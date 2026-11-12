import { expect, it } from "vitest";
import type { Segment } from "../shared/contract";
import { PREVIEW_LINES, isRecordingId, transcriptLines } from "./recording-card";

const segment = (n: number, text: string | null, cleanedText?: string | null): Segment => ({
  id: `s${n}`, sessionId: "x", startedAt: 0, offsetMs: n * 1000, durationMs: 1000, mimeType: "audio/webm",
  bytes: 1, status: "done", text, cleanedText, error: null, attempts: 1,
});

it("prefers cleaned text and skips segments without any", () => {
  const { lines, total } = transcriptLines([segment(0, "um hello", "Hello."), segment(1, null), segment(2, "  "), segment(3, "Bye")]);
  expect(lines.map((line) => line.text)).toEqual(["Hello.", "Bye"]);
  expect(total).toBe(2);
});

it("caps the lines and counts the rest", () => {
  const { lines, total } = transcriptLines(Array.from({ length: PREVIEW_LINES + 3 }, (_, n) => segment(n, `Line ${n}`)));
  expect(lines).toHaveLength(PREVIEW_LINES);
  expect(total).toBe(PREVIEW_LINES + 3);
});

it("accepts only recording ids", () => {
  expect(isRecordingId("rec_abcd1234")).toBe(true);
  expect(isRecordingId("rec_x")).toBe(false);
  expect(isRecordingId("pg_abcd1234")).toBe(false);
});
