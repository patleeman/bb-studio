import { describe, expect, it } from "vitest";
import { forkStrongMatches, strongMatchRanges } from "./fork-palette-match";

describe("palette title matches", () => {
  it("marks only the whole query or query words at a word start, never scattered letters", () => {
    expect(
      strongMatchRanges("Fix review 1-3: voice reports, reaper", "trees"),
    ).toEqual([]);
    expect(strongMatchRanges("Real @pierre/trees render", "trees")).toEqual([
      { start: 13, end: 18 },
    ]);
    expect(strongMatchRanges("Fix review 1-3", "fix rev")).toEqual([
      { start: 0, end: 7 },
    ]);
    expect(strongMatchRanges("unrevealed review", "rev")).toEqual([
      { start: 2, end: 5 },
      { start: 11, end: 14 },
    ]);
  });

  it("drops weak fuzzy matches and keeps bb's own for a one-letter query", () => {
    const items = [
      { item: "Fix review 1-3: voice reports, reaper", positions: [] },
      { item: "Real @pierre/trees", positions: [] },
    ];
    expect(
      forkStrongMatches(items, "trees", (text) => text).map(
        (match) => match.item,
      ),
    ).toEqual(["Real @pierre/trees"]);
    expect(
      forkStrongMatches(items, "t", (text) => text).map(
        (match) => match.forkRanges,
      ),
    ).toEqual([null, null]);
  });
});
