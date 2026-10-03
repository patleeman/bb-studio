import { describe, expect, it } from "vitest";
import { HANDOFF_LABELS, HANDOFF_SHORT, HANDOFF_STATES, formatDue, isDay, isOverdue, isTaskId, studioHref, today } from "./shared";

const noon = new Date(2026, 9, 1, 12);

describe("days", () => {
  it("accepts only real days", () => {
    expect(isDay("2026-10-01")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-10-1")).toBe(false);
  });

  it("formats due days relative to today", () => {
    expect(today(noon)).toBe("2026-10-01");
    expect(formatDue("2026-10-01", noon)).toBe("Today");
    expect(formatDue("2026-10-02", noon)).toBe("Tomorrow");
    expect(formatDue("2026-09-30", noon)).toBe("Yesterday");
    expect(formatDue("2026-10-15", noon)).toBe("Oct 15");
    expect(formatDue("2027-01-15", noon)).toBe("Jan 15, 2027");
  });

  it("calls a task overdue after its day, until it's done", () => {
    expect(isOverdue("2026-09-30", "todo", noon)).toBe(true);
    expect(isOverdue("2026-10-01", "todo", noon)).toBe(false);
    expect(isOverdue("2026-09-30", "done", noon)).toBe(false);
    expect(isOverdue(null, "todo", noon)).toBe(false);
  });
});

describe("labels", () => {
  it("names every handoff state, with who acts next spelled out", () => {
    for (const state of HANDOFF_STATES) {
      expect(HANDOFF_LABELS[state]).toMatch(/^[A-Z]/);
      expect(HANDOFF_SHORT[state]).toMatch(/^[A-Z]/);
    }
    expect(HANDOFF_LABELS["needs-input"]).toBe("Agent needs your input");
  });
});

describe("ids and links", () => {
  it("recognises task ids", () => {
    expect(isTaskId("tsk_0123456789abcdef")).toBe(true);
    expect(isTaskId("tsk_0123")).toBe(false);
  });

  it("links to each add-on's item view", () => {
    expect(studioHref("talk", "rec 1")).toBe("/plugins/talk/recordings/rec%201");
    expect(studioHref("excalidraw", "d1")).toBe("/plugins/excalidraw/drawings/d1");
    expect(studioHref("unknown", "x")).toBeNull();
  });
});
