import { describe, expect, it } from "vitest";
import type { Segment } from "../shared/contract";
import { callBarLabel, callTurns, lastSource, rememberSource } from "./call-view";

const seg = (id: string, speaker: "me" | "them", startedAt: number, status: Segment["status"], text: string | null, extra: Partial<Segment> = {}): Segment => ({
  id, sessionId: speaker, startedAt, offsetMs: startedAt - 1000, durationMs: 4000, mimeType: "audio/wav", bytes: 1, status, text, error: null, attempts: 0, speaker, ...extra,
});

describe("a call's live transcript", () => {
  it("merges both sides by time into turns, and leaves echoes out", () => {
    const turns = callTurns([
      seg("them-0", "them", 1000, "done", "Shall we start?"),
      seg("me-0", "me", 1500, "done", "shall we start", { echo: true }),
      seg("them-1", "them", 5000, "done", "The launch date first."),
      seg("me-1", "me", 9000, "done", "Yes."),
      seg("me-2", "me", 12_000, "empty", null),
    ]);
    expect(turns.map((turn) => [turn.speaker, turn.text, turn.offsetMs])).toEqual([
      ["them", "Shall we start? The launch date first.", 0],
      ["me", "Yes.", 8000],
    ]);
  });

  it("shows a partial in its waiting piece, or as a new turn before its piece arrives", () => {
    const segments = [seg("them-0", "them", 1000, "done", "Hello."), seg("me-0", "me", 5000, "pending", null)];
    const turns = callTurns(segments, [
      { speaker: "me", index: 0, text: "Hi, can you", startMs: 4000 },
      { speaker: "them", index: 1, text: "So the", startMs: 9000 },
    ], 1000);
    expect(turns.map((turn) => [turn.speaker, turn.text, turn.pending])).toEqual([
      ["them", "Hello.", false],
      ["me", "Hi, can you", true],
      ["them", "So the", true],
    ]);
  });

  it("drops a partial once its piece has its final", () => {
    const turns = callTurns([seg("them-0", "them", 1000, "done", "Hello there.")], [{ speaker: "them", index: 0, text: "Hello", startMs: 0 }], 1000);
    expect(turns.map((turn) => turn.text)).toEqual(["Hello there."]);
  });

  it("labels the bar", () => {
    expect(callBarLabel({ app: "zoom.us", phase: "recording", startedAt: 0 }, 724_000)).toBe("Recording call: zoom.us · 12:04");
    expect(callBarLabel({ app: "zoom.us", phase: "starting", startedAt: 0 }, 0)).toMatch(/^Starting/);
    expect(callBarLabel({ app: "zoom.us", phase: "stopping", startedAt: 0 }, 0)).toMatch(/^Stopping/);
  });

  it("remembers the last source", () => {
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) };
    expect(lastSource(storage)).toBeNull();
    rememberSource({ source: "us.zoom.xos", mic: false }, storage);
    expect(lastSource(storage)).toEqual({ source: "us.zoom.xos", mic: false });
  });
});
