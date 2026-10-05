import { describe, expect, it } from "vitest";
import { isSpaceLeadThread, leadSafeArchiveIds } from "./SpaceLead.js";
import type { StudioSpacesState } from "./studioSpaces.js";

const ready = (leads: Record<string, string | null>): StudioSpacesState => ({
  status: "ready", spaces: [], spaceOf: {}, leads, heartbeats: {}, items: {}, threadsLoaded: false,
});

describe("Space leads", () => {
  it("knows a lead without By space's thread to Space map", () => {
    const state = ready({ sp_a: "thr_lead", sp_b: null });
    expect(isSpaceLeadThread(state, "thr_lead")).toBe(true);
    expect(isSpaceLeadThread(state, "thr_other")).toBe(false);
    expect(isSpaceLeadThread({ status: "loading" }, "thr_lead")).toBe(false);
  });

  it("archives a group around its lead and the lead's ancestors", () => {
    const thread = (id: string, parentThreadId: string | null = null, archivedAt: number | null = null) => ({ id, parentThreadId, archivedAt });
    const threads = [
      thread("thr_root"),
      thread("thr_lead", "thr_root"),
      thread("thr_sibling", "thr_root"),
      thread("thr_nephew", "thr_sibling"),
      thread("thr_loose"),
      thread("thr_done", null, 1),
    ];
    expect(leadSafeArchiveIds(threads, () => false)).toBeNull();
    expect(leadSafeArchiveIds(threads, (id) => id === "thr_lead")).toEqual(["thr_sibling", "thr_loose"]);
    expect(leadSafeArchiveIds([thread("thr_lead")], (id) => id === "thr_lead")).toEqual([]);
  });
});
