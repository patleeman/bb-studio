import { describe, expect, it } from "vitest";
import { cleanTitle, formatClock, holdKeyCode, isLongDictation, formatLength, joinTranscript, tail, titleExcerpt, transcriptionError } from "./format";

describe("format", () => {
  it("formats clocks and lengths", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatLength(20_000)).toBe("20 sec");
    expect(formatLength(3_600_000)).toBe("1 hr");
  });

  it("joins segments with spaces and sessions with paragraph breaks", () => {
    expect(
      joinTranscript([
        { sessionId: "a", text: "one" },
        { sessionId: "a", text: null },
        { sessionId: "a", text: " two " },
        { sessionId: "b", text: "three" },
      ]),
    ).toBe("one two\n\nthree");
  });

  it("reports why transcription is stuck, preferring pieces that gave up", () => {
    expect(transcriptionError([{ status: "done", error: null }, { status: "pending", error: null }])).toBeNull();
    expect(transcriptionError([{ status: "pending", error: "HTTP 503" }])).toBe("HTTP 503");
    expect(
      transcriptionError([
        { status: "pending", error: "HTTP 503" },
        { status: "failed", error: "bad audio" },
      ]),
    ).toBe("bad audio");
  });

  it("cleans model titles", () => {
    expect(cleanTitle('Title: "Quarterly planning sync."\nmore')).toBe("Quarterly planning sync");
    expect(cleanTitle("**Hiring loop debrief**")).toBe("Hiring loop debrief");
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle("x".repeat(100))!.length).toBe(80);
  });

  it("keeps the ends of long text", () => {
    expect(tail("alpha beta gamma", 10)).toBe("…gamma");
    const excerpt = titleExcerpt("a".repeat(5000) + "END", 100);
    expect(excerpt.length).toBeLessThan(110);
    expect(excerpt.endsWith("END")).toBe(true);
  });

  it("maps the hold-to-talk setting to a key code", () => {
    expect(holdKeyCode(undefined)).toBe("AltRight");
    expect(holdKeyCode("Right Command")).toBe("MetaRight");
    expect(holdKeyCode("Off")).toBeNull();
  });

  it("calls a dictation long by length or words", () => {
    const dictation = { kind: "dictation", durationMs: 60_000, wordCount: 100 };
    expect(isLongDictation(dictation)).toBe(false);
    expect(isLongDictation({ ...dictation, durationMs: 5 * 60_000 })).toBe(true);
    expect(isLongDictation({ ...dictation, wordCount: 800 })).toBe(true);
    expect(isLongDictation({ ...dictation, kind: "recording", wordCount: 800 })).toBe(false);
  });
});
