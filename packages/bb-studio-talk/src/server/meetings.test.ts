import { describe, expect, it } from "vitest";
import { addSegment, memoryStore } from "../test/db";
import { parseMeetingNotes } from "./meetings";

describe("meeting notes", () => {
  it("parses a model response and keeps assignee suggestions", () => {
    expect(parseMeetingNotes('```json\n{"summary":"  Plan agreed. ","decisions":["Ship beta"],"actionItems":[{"title":" Draft launch note ","assignee":"agent"}]}\n```'))
      .toEqual({ summary: "Plan agreed.", decisions: ["Ship beta"], actionItems: [{ title: "Draft launch note", assignee: "agent" }] });
    expect(() => parseMeetingNotes('{"summary":"","decisions":[],"actionItems":[]}')).toThrow();
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
