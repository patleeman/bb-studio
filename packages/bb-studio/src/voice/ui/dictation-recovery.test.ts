import { describe, expect, it } from "vitest";
import { canRestoreFailedDictation } from "./dictation-recovery";

describe("failed voice dictation recovery", () => {
  it("does not replace a newer draft after the send fails", () => {
    expect(canRestoreFailedDictation({ text: "A newer draft", mentions: [] }, 0)).toBe(false);
  });

  it("does not replace mentions or attachments, but restores into an empty composer", () => {
    expect(canRestoreFailedDictation({ text: "", mentions: [{ to: 1 }] }, 0)).toBe(false);
    expect(canRestoreFailedDictation({ text: "", mentions: [] }, 1)).toBe(false);
    expect(canRestoreFailedDictation({ text: "  ", mentions: [] }, 0)).toBe(true);
  });
});
