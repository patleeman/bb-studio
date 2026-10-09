// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { canPromoteThread, CHIEF_DIALOG_EVENT, chiefOfStaffOf, isSpaceLeadThread, leadSafeArchiveIds, openChiefHeartbeat } from "./SpaceLead.js";
import type { StudioSpacesState } from "./studioSpaces.js";

const top = { id: "sp_top", name: "Personal", color: "#000", icon: null, defaultProjectId: null, isDefault: true, projectIds: [] };
const ready = (leads: Record<string, string | null>, chiefOfStaff: string | null = null): StudioSpacesState => ({
  status: "ready", spaces: [top], spaceOf: {}, leads: { ...leads, [top.id]: chiefOfStaff }, heartbeats: {}, items: {}, threadsLoaded: false,
});

describe("Space leads", () => {
  it("offers Promote only for open top-level threads, or one that already holds a role", () => {
    expect(canPromoteThread({ parentThreadId: null, archivedAt: null }, false)).toBe(true);
    expect(canPromoteThread({ parentThreadId: "thr_p", archivedAt: null }, false)).toBe(false);
    expect(canPromoteThread({ parentThreadId: null, archivedAt: 5 }, false)).toBe(false);
    expect(canPromoteThread({ parentThreadId: "thr_p", archivedAt: 5 }, true)).toBe(true);
  });

  it("knows a lead without By space's thread to Space map", () => {
    const state = ready({ sp_a: "thr_lead", sp_b: null });
    expect(isSpaceLeadThread(state, "thr_lead")).toBe(true);
    expect(isSpaceLeadThread(state, "thr_other")).toBe(false);
    expect(isSpaceLeadThread({ status: "loading" }, "thr_lead")).toBe(false);
  });

  it("reads the Chief of Staff, the default Space's lead, only from a ready load", () => {
    expect(chiefOfStaffOf(ready({}, "thr_chief"))).toBe("thr_chief");
    expect(chiefOfStaffOf({ status: "unavailable", error: "no studio" })).toBeNull();
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

describe("Chief of Staff", () => {
  it("can't be archived until demoted, like a lead", () => {
    const state = ready({ sp_a: "thr_lead" }, "thr_chief");
    expect(isSpaceLeadThread(state, "thr_chief")).toBe(true);
    expect(isSpaceLeadThread(ready({}, null), "thr_chief")).toBe(false);
    const threads = [
      { id: "thr_chief", parentThreadId: null, archivedAt: null },
      { id: "thr_other", parentThreadId: null, archivedAt: null },
    ];
    expect(leadSafeArchiveIds(threads, (id) => isSpaceLeadThread(state, id))).toEqual(["thr_other"]);
  });

  it("opens Studio's heartbeat dialog by window event", () => {
    const seen = vi.fn((event: Event) => { expect(event.cancelable).toBe(true); event.preventDefault(); });
    window.addEventListener(CHIEF_DIALOG_EVENT, seen);
    openChiefHeartbeat();
    window.removeEventListener(CHIEF_DIALOG_EVENT, seen);
    expect(CHIEF_DIALOG_EVENT).toBe("studio:chief-dialog");
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
