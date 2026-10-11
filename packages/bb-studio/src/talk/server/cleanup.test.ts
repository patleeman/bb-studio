import { describe, expect, it } from "vitest";
import { acceptCleanup, cleanupPrompt } from "./cleanup";

const SPOKEN = "um so I think we should uh ship it on Friday";

describe("dictation clean-up", () => {
  it("fences the transcript as data", () => {
    expect(cleanupPrompt(SPOKEN)).toContain(`"""\n${SPOKEN}\n"""`);
  });

  it("accepts a tidied version and strips wrappers", () => {
    expect(acceptCleanup(SPOKEN, "So I think we should ship it on Friday.")).toBe("So I think we should ship it on Friday.");
    expect(acceptCleanup(SPOKEN, "```\nSo I think we should ship it on Friday.\n```")).toBe("So I think we should ship it on Friday.");
  });

  it("rejects empty, much shorter, or much longer text", () => {
    expect(acceptCleanup(SPOKEN, null)).toBeNull();
    expect(acceptCleanup(SPOKEN, "  ")).toBeNull();
    expect(acceptCleanup(SPOKEN, "Ship Friday.")).toBeNull();
    expect(acceptCleanup(SPOKEN, `Sure! Here is the cleaned text: ${SPOKEN}.`)).toBeNull();
  });
});
