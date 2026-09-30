import { describe, expect, it } from "vitest";
import { cleanTitle, formatClock, formatLength, joinTranscript, tail, titleExcerpt } from "./format";

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
});
