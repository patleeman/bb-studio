import { afterEach, describe, expect, it, vi } from "vitest";
import { foldOfSeq, RUN_MIN, statusRunFolds, type Tags } from "./model";
import { foldsOf, openFold, openFoldOf, registerTimelineFilter, resetSelectionForTests, setFoldTags, subscribeSelection } from "./selection";

afterEach(() => resetSelectionForTests());

type Turn = { key: string; kind: "user" | "report"; tag: "status" | "needs-you" | null; line?: string };
/** Turns t1…tN in order, with their replies' tags. */
function tags(turns: Turn[]): Tags {
  return {
    tags: turns.map((turn, index) => ({ turnId: turn.key, seq: (index + 1) * 10, strandId: "s1", kind: turn.kind })),
    strands: [{ id: "s1", title: "Work" }],
    replies: turns.flatMap((turn, index) => (turn.tag ? [{ turnId: turn.key, seq: (index + 1) * 10 + 5, tag: turn.tag, ask: null, resolved: false, line: turn.line ?? `${turn.key} said` }] : [])),
  };
}
const status = (key: string, kind: "user" | "report" = "report"): Turn => ({ key, kind, tag: "status" });

describe("runs of status replies to fold", () => {
  it("folds consecutive status replies with no message the user typed between them; the turn the user started may open the run", () => {
    const day = tags([status("a", "user"), status("b"), status("c"), status("d"), { key: "e", kind: "user", tag: "status" }, status("f")]);
    const [fold] = statusRunFolds(day);
    expect(fold).toMatchObject({ id: "run:a", turnIds: ["a", "b", "c", "d"], label: "4 updates · last: d said" });
    // BB cut the run short: the line counts what it folds.
    expect(fold!.labelFor(["a", "b"])).toBe("2 updates · last: b said");
    expect(statusRunFolds(day)).toHaveLength(1);
  });

  it("ends a run at a reply that needs the user or one with no tag; shorter runs stay open", () => {
    expect(RUN_MIN).toBe(3);
    const day = tags([status("a"), status("b"), { key: "ask", kind: "report", tag: "needs-you" }, status("c"), status("d"), status("e"), { key: "x", kind: "report", tag: null }, status("f"), status("g"), status("h")]);
    expect(statusRunFolds(day).map((fold) => fold.turnIds)).toEqual([["c", "d", "e"]]);
  });

  it("never folds the newest turn, and leaves out the folds the user opened", () => {
    const day = tags([status("a"), status("b"), status("c")]);
    expect(statusRunFolds(day)).toEqual([]);
    const longer = tags([status("a"), status("b"), status("c"), status("d"), status("e")]);
    expect(statusRunFolds(longer).map((fold) => fold.turnIds)).toEqual([["a", "b", "c", "d"]]);
    expect(statusRunFolds(longer, new Set(["b"]))).toEqual([]);
    expect(statusRunFolds({ ...longer, replies: longer.replies!.map((reply) => ({ ...reply, line: null })) })[0]!.label).toBe("4 updates");
  });

  it("finds the fold a message or reply falls in", () => {
    const day = tags([status("a"), status("b"), status("c"), status("d"), status("e")]);
    const folds = statusRunFolds(day);
    expect(foldOfSeq(day, folds, 25)?.id).toBe("run:a");
    expect(foldOfSeq(day, folds, 55)).toBeNull();
    expect(foldOfSeq(day, folds, 5)).toBeNull();
  });
});

describe("the folds BB's timeline reads", () => {
  it("hands BB folds and expandFold with the filter; the same array while nothing changes; opening one tells BB", () => {
    const registered: { folds?: (threadId: string) => unknown; expandFold?: (threadId: string, id: string) => void }[] = [];
    expect(registerTimelineFilter({ experimental_timelineFilter: (registration: never) => registered.push(registration) })).toBe(true);
    expect(registered[0]!.folds).toBe(foldsOf);
    const day = tags([status("a"), status("b"), status("c"), status("d"), status("e")]);
    const heard = vi.fn();
    const off = subscribeSelection(heard);
    expect(foldsOf("thr_main")).toBeNull();
    setFoldTags("thr_main", day);
    expect(heard).toHaveBeenCalledTimes(1);
    const first = foldsOf("thr_main");
    expect(first).toHaveLength(1);
    expect(foldsOf("thr_main")).toBe(first);
    setFoldTags("thr_main", day);
    expect(heard).toHaveBeenCalledTimes(1);
    registered[0]!.expandFold!("thr_main", "run:a");
    expect(heard).toHaveBeenCalledTimes(2);
    expect(foldsOf("thr_main")).toEqual([]);
    off();
  });

  it("keeps an opened run open when a late tag moves where it starts", () => {
    const untagged: Turn = { key: "x", kind: "report", tag: null };
    setFoldTags("thr_main", tags([untagged, status("a"), status("b"), status("c"), status("d"), status("e")]));
    expect(foldsOf("thr_main")!.map((fold) => fold.id)).toEqual(["run:a"]);
    openFold("thr_main", "run:a");
    expect(foldsOf("thr_main")).toEqual([]);
    setFoldTags("thr_main", tags([status("x"), status("a"), status("b"), status("c"), status("d"), status("e")]));
    expect(foldsOf("thr_main")).toEqual([]);
    openFold("thr_main", "run:nowhere");
  });

  it("opens the fold that holds a jump's target, and only that one", () => {
    setFoldTags("thr_main", tags([status("a"), status("b"), status("c"), status("d"), status("e")]));
    openFoldOf("thr_main", 999);
    openFoldOf("thr_main", 5);
    expect(foldsOf("thr_main")).toHaveLength(1);
    openFoldOf("thr_main", 35);
    expect(foldsOf("thr_main")).toHaveLength(0);
    openFold("thr_main", "run:a");
    expect(foldsOf("thr_main")).toHaveLength(0);
  });
});
