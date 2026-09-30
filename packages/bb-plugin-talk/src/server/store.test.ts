import { describe, expect, it } from "vitest";
import { addSegment, memoryStore } from "../test/db";

const REC = "rec_aaaaaaaaaaaaaaaa";

function setup() {
  let now = 1_000_000;
  const clock = { advance: (ms: number) => (now += ms) };
  const { store } = memoryStore(() => now);
  store.create({ id: REC, kind: "recording", projectId: null, threadId: null });
  return { store, clock };
}

describe("TalkStore", () => {
  it("creates a recording with a placeholder title", () => {
    const { store } = setup();
    const recording = store.recording(REC)!;
    expect(recording.status).toBe("recording");
    expect(recording.titleSource).toBe("pending");
    expect(recording.title).toMatch(/^Recording · /);
  });

  it("stores a segment once, however often it is uploaded", () => {
    const { store } = setup();
    expect(addSegment(store, REC, "sessiona", 0, 10)).toBe(true);
    expect(addSegment(store, REC, "sessiona", 0, 10)).toBe(false);
    expect(store.recording(REC)).toMatchObject({ segmentCount: 1, pendingCount: 1 });
  });

  it("hands out only the oldest pending segment per recording, with the previous text as hint", () => {
    const { store } = setup();
    addSegment(store, REC, "sessiona", 1, 200);
    addSegment(store, REC, "sessiona", 0, 100);
    expect(store.due(10).map((s) => s.id)).toEqual(["sessiona-0"]);
    store.markTranscribed(REC, "sessiona-0", "hello there");
    const [next] = store.due(10);
    expect(next).toMatchObject({ id: "sessiona-1", hint: "hello there" });
  });

  it("orders segments by recorded time and joins sessions into paragraphs", () => {
    const { store } = setup();
    addSegment(store, REC, "sessiona", 0, 100, 20_000);
    addSegment(store, REC, "sessiona", 1, 200, 25_000);
    addSegment(store, REC, "sessionb", 0, 900, 10_000);
    store.markTranscribed(REC, "sessiona-0", "one");
    store.markTranscribed(REC, "sessiona-1", "two");
    store.markTranscribed(REC, "sessionb-0", "three");
    expect(store.segments(REC).map((s) => s.offsetMs)).toEqual([0, 20_000, 45_000]);
    expect(store.transcript(REC)).toBe("one two\n\nthree");
    expect(store.recording(REC)).toMatchObject({ durationMs: 55_000, wordCount: 3 });
  });

  it("backs a failed segment off, and gives up only when told", () => {
    const { store, clock } = setup();
    addSegment(store, REC, "sessiona", 0, 100);
    store.markFailed(REC, "sessiona-0", "timeout", 5_000);
    expect(store.due(10)).toEqual([]);
    clock.advance(5_000);
    expect(store.due(10)).toHaveLength(1);
    store.markFailed(REC, "sessiona-0", "bad audio", null);
    expect(store.recording(REC)).toMatchObject({ pendingCount: 0, failedCount: 1 });
    expect(store.retryFailed(REC)).toBe(1);
    expect(store.due(10)[0]).toMatchObject({ attempts: 0 });
  });

  it("stays finishing until every segment is transcribed, then is done", () => {
    const { store } = setup();
    addSegment(store, REC, "sessiona", 0, 100);
    expect(store.setStatus(REC, "finishing")!.status).toBe("finishing");
    store.markTranscribed(REC, "sessiona-0", "");
    const recording = store.recording(REC)!;
    expect(recording.status).toBe("done");
    expect(store.segments(REC)[0]!.status).toBe("empty");
  });

  it("is done at once when it finishes with nothing pending", () => {
    const { store } = setup();
    expect(store.setStatus(REC, "finishing")!.status).toBe("done");
  });

  it("marks a silent capture interrupted, and a heartbeat takes it back", () => {
    const { store, clock } = setup();
    clock.advance(60_000);
    expect(store.interruptStale(120_000)).toEqual([]);
    clock.advance(61_000);
    expect(store.interruptStale(120_000)).toEqual([REC]);
    expect(store.recording(REC)!.status).toBe("interrupted");
    expect(store.heartbeat(REC)).toBe("recording");
    expect(store.heartbeat("rec_missingmissing")).toBeNull();
  });

  it("titles once there is enough text, and never over a user's title", () => {
    const { store } = setup();
    addSegment(store, REC, "sessiona", 0, 100);
    store.markTranscribed(REC, "sessiona-0", "short");
    expect(store.titleDue(REC, 280)).toBeNull();
    addSegment(store, REC, "sessiona", 1, 200);
    store.markTranscribed(REC, "sessiona-1", "x".repeat(300));
    const due = store.titleDue(REC, 280);
    expect(due).not.toBeNull();
    store.rename(REC, "Planning sync", "auto", due!.chars);
    expect(store.titleDue(REC, 280)).toBeNull();
    store.rename(REC, "My title", "user");
    expect(store.rename(REC, "Model title", "auto")).toBeNull();
    expect(store.recording(REC)!.title).toBe("My title");
    addSegment(store, REC, "sessiona", 2, 300);
    store.markTranscribed(REC, "sessiona-2", "y".repeat(3000));
    expect(store.titleDue(REC, 280)).toBeNull();
  });

  it("searches titles and transcripts", () => {
    const { store } = setup();
    store.create({ id: "rec_bbbbbbbbbbbbbbbb", kind: "dictation", projectId: null, threadId: null });
    addSegment(store, REC, "sessiona", 0, 100);
    store.markTranscribed(REC, "sessiona-0", "the quarterly roadmap review");
    expect(store.list({ query: "roadmap" }).map((r) => r.id)).toEqual([REC]);
    expect(store.list({ query: "dictation" }).map((r) => r.id)).toEqual(["rec_bbbbbbbbbbbbbbbb"]);
    expect(store.list()).toHaveLength(2);
  });

  it("deletes a recording with its segments", () => {
    const { store } = setup();
    addSegment(store, REC, "sessiona", 0, 100);
    expect(store.delete(REC)).toBe(true);
    expect(store.recording(REC)).toBeNull();
    expect(store.due(10)).toEqual([]);
  });

  it("finds finished recordings without a word, and only those", () => {
    const { store } = setup();
    store.setStatus(REC, "finishing");
    expect(store.emptyRecordings()).toEqual([REC]);

    const OTHER = "rec_bbbbbbbbbbbbbbbb";
    store.create({ id: OTHER, kind: "dictation", projectId: null, threadId: null });
    addSegment(store, OTHER, "sessiona", 0, 10);
    store.setStatus(OTHER, "finishing");
    // Still transcribing.
    expect(store.emptyRecordings(OTHER)).toEqual([]);
    store.markTranscribed(OTHER, "sessiona-0", "  ");
    expect(store.emptyRecordings(OTHER)).toEqual([OTHER]);
  });

  it("keeps recordings with words or with failed audio", () => {
    const { store } = setup();
    addSegment(store, REC, "sessiona", 0, 10);
    addSegment(store, REC, "sessiona", 1, 20);
    store.setStatus(REC, "finishing");
    store.markTranscribed(REC, "sessiona-0", "");
    store.markFailed(REC, "sessiona-1", "voice service off", null);
    expect(store.recording(REC)!.status).toBe("done");
    // The failed piece may hold speech; a retry can still transcribe it.
    expect(store.emptyRecordings()).toEqual([]);
    store.retryFailed(REC);
    store.markTranscribed(REC, "sessiona-1", "hello");
    expect(store.emptyRecordings()).toEqual([]);
  });

  it("never treats a recording still being captured as empty", () => {
    const { store } = setup();
    expect(store.emptyRecordings()).toEqual([]);
    store.setStatus(REC, "paused");
    expect(store.emptyRecordings()).toEqual([]);
  });
});
