import { describe, expect, it } from "vitest";
import { parseRecordingReference, textWithRecordings } from "./recording-reference";

describe("recording references", () => {
  it("keeps portable links safe when a title contains Markdown or newlines", () => {
    const recording = { id: "rec_aaaaaaaa", title: "Draft [notes]\nnext", kind: "dictation" as const };
    expect(textWithRecordings("My thoughts.", [recording])).toBe("My thoughts.\n\n[Draft  notes  next](/plugins/studio/recordings/rec_aaaaaaaa)");
  });

  it("rejects references that could point outside Talk", () => {
    expect(parseRecordingReference({ id: "../settings", title: "Oops", kind: "recording" })).toBeNull();
    expect(parseRecordingReference({ id: "rec_aaaaaaaa", title: "Test", kind: "page" })).toBeNull();
    expect(parseRecordingReference({ id: "rec_aaaaaaaa", title: " ", kind: "dictation" })).toEqual({ id: "rec_aaaaaaaa", title: "Dictation", kind: "dictation" });
  });
});
