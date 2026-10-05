import { describe, expect, it } from "vitest";
import { beginPendingSpaceMove, startSpaceLoad, withPendingSpaceMoves } from "./studioSpaces.js";

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
