import { describe, expect, it } from "vitest";
import { beginPendingChiefOfStaff, beginPendingLead, beginPendingSpaceMove, startSpaceLoad, withPendingChiefOfStaff, withPendingLeads, withPendingSpaceMoves } from "./studioSpaces.js";

describe("pending Space moves", () => {
  it("stay over refetched data until a load that began after the move settled", () => {
    const settle = beginPendingSpaceMove(["thr_moved"], "sp_new");
    const fetched = { thr_moved: "sp_old", thr_other: "sp_old" };

    // A refetch while the move is in flight still has the old Space.
    const during = startSpaceLoad();
    expect(withPendingSpaceMoves(fetched, during)).toEqual({ thr_moved: "sp_new", thr_other: "sp_old" });

    // One that started before Studio answered, but finished after, too.
    const straddling = startSpaceLoad();
    settle();
    expect(withPendingSpaceMoves(fetched, straddling).thr_moved).toBe("sp_new");

    // The first load started after the move settled is the truth.
    const after = startSpaceLoad();
    expect(withPendingSpaceMoves({ thr_moved: "sp_new" }, after)).toEqual({ thr_moved: "sp_new" });
    expect(withPendingSpaceMoves({ thr_moved: "sp_old" })).toEqual({ thr_moved: "sp_old" });
  });

  it("lets a later move of the same thread win", () => {
    const settleFirst = beginPendingSpaceMove(["thr_x"], "sp_a");
    const settleSecond = beginPendingSpaceMove(["thr_x"], "sp_b");
    settleFirst();
    expect(withPendingSpaceMoves({}, startSpaceLoad()).thr_x).toBe("sp_b");
    settleSecond();
    expect(withPendingSpaceMoves({}, startSpaceLoad()).thr_x).toBeUndefined();
  });
});

describe("pending lead changes", () => {
  it("stay over refetched leads until a load that began after the change settled", () => {
    const settle = beginPendingLead("sp_a", "thr_new");
    const fetched = { sp_a: "thr_old", sp_b: null };
    expect(withPendingLeads(fetched, startSpaceLoad())).toEqual({ sp_a: "thr_new", sp_b: null });
    // A refetch that began before Studio answered still has the old lead.
    const straddling = startSpaceLoad();
    settle();
    expect(withPendingLeads(fetched, straddling).sp_a).toBe("thr_new");
    // The first load after it settled is the truth, even a failure's old lead.
    expect(withPendingLeads(fetched, startSpaceLoad()).sp_a).toBe("thr_old");
    expect(withPendingLeads(fetched).sp_a).toBe("thr_old");
  });

  it("keeps a removal pending as no lead", () => {
    const settle = beginPendingLead("sp_c", null);
    expect(withPendingLeads({ sp_c: "thr_lead" }, startSpaceLoad()).sp_c).toBeNull();
    settle();
    startSpaceLoad();
    expect(withPendingLeads({ sp_c: null }, startSpaceLoad()).sp_c).toBeNull();
  });
});

describe("pending Chief of Staff changes", () => {
  it("stay over refetches until a load that began after the change settled", () => {
    const settle = beginPendingChiefOfStaff("thr_chief");
    expect(withPendingChiefOfStaff(null, startSpaceLoad())).toBe("thr_chief");
    const straddling = startSpaceLoad();
    settle();
    expect(withPendingChiefOfStaff(null, straddling)).toBe("thr_chief");
    expect(withPendingChiefOfStaff(null, startSpaceLoad())).toBeNull();
    expect(withPendingChiefOfStaff("thr_other")).toBe("thr_other");
  });

  it("keeps a removal pending as no Chief of Staff", () => {
    const settle = beginPendingChiefOfStaff(null);
    expect(withPendingChiefOfStaff("thr_chief", startSpaceLoad())).toBeNull();
    settle();
    expect(withPendingChiefOfStaff(null, startSpaceLoad())).toBeNull();
  });
});
