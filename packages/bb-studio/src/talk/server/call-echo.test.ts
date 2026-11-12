import { describe, expect, it } from "vitest";
import { echoSegments, isEcho } from "./call-echo";

const seg = (id: string, speaker: "me" | "them", startedAt: number, durationMs: number, text: string, status = "done") =>
  ({ id, speaker, startedAt, durationMs, status, text });

describe("echo dedupe", () => {
  it("matches a repeat with transcription slips, not a reply that reuses words", () => {
    expect(isEcho("we should launch on the twelfth if review", "We should launch on the twelfth, if the review passes.")).toBe(true);
    expect(isEcho("I think we should do that next week", "Should we do that next week or later? I think so.")).toBe(false);
    expect(isEcho("Yes.", "Yes, let's do that.")).toBe(false);
    expect(isEcho("Okay, sure.", "okay sure")).toBe(true);
    expect(isEcho("", "anything")).toBe(false);
  });

  it("drops only 'me' pieces that overlap the 'them' text they repeat", () => {
    const segments = [
      seg("them-0", "them", 0, 7_000, "Can you send the release notes by Friday?"),
      seg("me-0", "me", 500, 7_000, "can you send the release notes by friday"),
      seg("me-1", "me", 8_000, 3_000, "Sure, I'll send them Thursday."),
      // Same words, but said long after: a real quote, kept.
      seg("me-2", "me", 60_000, 4_000, "can you send the release notes by friday"),
    ];
    expect(echoSegments(segments)).toEqual(["me-0"]);
  });

  it("finds an echo that straddles two of their pieces", () => {
    const segments = [
      seg("them-0", "them", 0, 8_000, "The budget for next quarter is"),
      seg("them-1", "them", 8_000, 6_000, "about forty thousand dollars in total"),
      seg("me-0", "me", 5_000, 8_000, "for next quarter is about forty thousand dollars"),
    ];
    expect(echoSegments(segments)).toEqual(["me-0"]);
  });

  it("ignores pieces that aren't transcribed or are already hidden", () => {
    expect(echoSegments([seg("them-0", "them", 0, 5_000, "hello there everyone welcome", "pending"), seg("me-0", "me", 0, 5_000, "hello there everyone welcome")])).toEqual([]);
    expect(echoSegments([seg("them-0", "them", 0, 5_000, "hello there everyone welcome"), { ...seg("me-0", "me", 0, 5_000, "hello there everyone welcome"), echo: true }])).toEqual([]);
  });
});
