import { describe, expect, it } from "vitest";
import { addSegment, memoryStore } from "../test/db";
import { parseRecordingSummary, recordingSummaryPrompt } from "./meetings";

describe("recording summaries", () => {
  it("parses a general summary without a meeting template", () => {
    expect(parseRecordingSummary('```json\n{"summary":"  I want to prototype the garden planner. "}\n```'))
      .toEqual({ summary: "I want to prototype the garden planner.", decisions: [], actionItems: [] });
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
    const notes = { summary: "Plan agreed.", decisions: ["Ship beta"], actionItems: [{ title: "Draft note", assignee: "agent" as const }] };
    expect(store.saveMeetingNotes(id, notes)).toBe(false);
    addSegment(store, id, "sessiona", 0, 100);
    store.markTranscribed(id, "sessiona-0", "We agreed to ship beta.");
    store.setStatus(id, "finishing");
    expect(store.saveMeetingNotes(id, notes)).toBe(true);
    expect(store.recording(id)?.meetingNotes).toEqual(notes);
    store.setStatus(id, "recording");
    expect(store.recording(id)?.meetingNotes).toBeNull();
  });
});
