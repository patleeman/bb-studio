import { describe, expect, it, vi } from "vitest";
import { addSegment, memoryStore } from "../test/db";
import { Summaries, parseRecordingSummary, recordingSummaryPrompt } from "./meetings";

describe("recording summaries", () => {
  it("parses a general summary without a meeting template", () => {
    expect(parseRecordingSummary('```json\n{"summary":"  I want to prototype the garden planner. "}\n```'))
      .toEqual({ summary: "I want to prototype the garden planner." });
    expect(() => parseRecordingSummary('{"summary":"  "}')).toThrow("recording summary was empty");
    expect(() => parseRecordingSummary('{"decisions":[]}')).toThrow();
  });

  it("treats a brain dump as data without assuming a meeting", () => {
    const prompt = recordingSummaryPrompt("I wonder if a garden planner would help me.");
    expect(prompt).toContain("brain dump, personal note, idea");
    expect(prompt).toContain("without assuming a meeting took place");
    expect(prompt).toContain("Do not force decisions, action items, or task assignments");
    expect(prompt).toContain('"""\nI wonder if a garden planner would help me.\n"""');
  });

  it("persists notes only for a finished recording", () => {
    const { store } = memoryStore();
    const id = "rec_aaaaaaaa";
    store.create({ id, kind: "recording", projectId: null, threadId: null });
    const notes = { summary: "Plan agreed." };
    expect(store.saveMeetingNotes(id, notes)).toBe(false);
    addSegment(store, id, "sessiona", 0, 100);
    store.markTranscribed(id, "sessiona-0", "We agreed to ship beta.");
    store.setStatus(id, "finishing");
    expect(store.saveMeetingNotes(id, notes)).toBe(true);
    expect(store.recording(id)?.meetingNotes).toEqual(notes);
    store.setStatus(id, "recording");
    expect(store.recording(id)?.meetingNotes).toBeNull();
  });

  it("summarizes a resumed recording that finishes while a stale summary runs", async () => {
    const { store } = memoryStore();
    const id = "rec_bbbbbbbb";
    store.create({ id, kind: "recording", projectId: null, threadId: null });
    addSegment(store, id, "sessiona", 0, 100);
    store.markTranscribed(id, "sessiona-0", "First part.");
    store.setStatus(id, "finishing");
    const pending: ((notes: { summary: string }) => void)[] = [];
    const summarize = vi.fn((_id: string, transcript: string) => new Promise<{ summary: string }>((resolve) => pending.push(() => resolve({ summary: transcript }))));
    const summaries = new Summaries({ store, summarize, changed: () => {} });
    const first = summaries.run(id);
    // Record more, then finish again while the first summary is still running.
    store.setStatus(id, "recording");
    addSegment(store, id, "sessionb", 0, 200);
    store.markTranscribed(id, "sessionb-0", "Second part.");
    store.setStatus(id, "finishing");
    await summaries.run(id);
    pending.shift()!({ summary: "" });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()!({ summary: "" });
    await first;
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(store.recording(id)?.meetingNotes).toEqual({ summary: "First part.\n\nSecond part." });
  });
});

