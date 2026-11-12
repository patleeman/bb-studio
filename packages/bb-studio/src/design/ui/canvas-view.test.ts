import { expect, it } from "vitest";
import { FIT_PADDING, FIT_TOP, MAX_SCALE, VIEWS_MAX, firstSectionView, fitView, openingView, parseSavedViews, rememberView, type SavedView } from "./canvas-view";

const box = { width: 1200, height: 800 };
/** A board of two rounds of desktop screens: far bigger than the viewport. */
const board = { width: 6000, height: 9000 };
const saved = (over: Partial<SavedView> = {}): SavedView => ({ scale: 0.5, x: -300, y: -1200, fit: false, layout: "2:3,1:3", at: 1, ...over });

it("opens a design nobody has moved at 100% on its first section, not fitted to a thumbnail", () => {
  const opening = openingView(undefined, "2:3,1:3", box, board);
  expect(opening).toEqual({ mode: "first", view: { scale: 1, x: FIT_PADDING, y: FIT_TOP } });
  // Fitting the same board would have been unreadable.
  expect(fitView(box, board).scale).toBeLessThan(0.1);
});

it("centres a first section narrower than the viewport", () => {
  expect(firstSectionView(box, { width: 400, height: 300 })).toEqual({ scale: 1, x: 400, y: FIT_TOP });
});

it("restores the remembered zoom and position when the board is unchanged", () => {
  expect(openingView(saved(), "2:3,1:3", box, board)).toEqual({ mode: "user", view: { scale: 0.5, x: -300, y: -1200 } });
  expect(openingView(saved({ scale: 40 }), "2:3,1:3", box, board).view.scale).toBe(MAX_SCALE);
});

it("keeps only the zoom when rounds were added since, back on the first section", () => {
  expect(openingView(saved(), "3:2,2:3,1:3", box, board)).toEqual({ mode: "user", view: { scale: 0.5, x: FIT_PADDING, y: FIT_TOP } });
});

it("reopens fitted when Fit was the user's choice", () => {
  expect(openingView(saved({ fit: true }), "anything", box, board)).toEqual({ mode: "fit", view: fitView(box, board) });
});

it("remembers at most VIEWS_MAX designs, dropping the least recently saved", () => {
  let views: Record<string, SavedView> = {};
  for (let at = 1; at <= VIEWS_MAX + 5; at++) views = rememberView(views, `design-${at}`, saved({ at }));
  expect(Object.keys(views)).toHaveLength(VIEWS_MAX);
  expect(views["design-1"]).toBeUndefined();
  expect(views[`design-${VIEWS_MAX + 5}`]).toBeDefined();
  // Saving an old design again makes it recent, so it survives the next cut.
  views = rememberView(views, "design-6", saved({ at: 1000 }));
  views = rememberView(views, "design-new", saved({ at: 1001 }));
  expect(views["design-6"]).toBeDefined();
  expect(views["design-7"]).toBeUndefined();
});

it("reads stored views defensively", () => {
  expect(parseSavedViews("not json")).toEqual({});
  expect(parseSavedViews("[1]")).toEqual({});
  expect(parseSavedViews(JSON.stringify({ good: saved(), bad: { scale: "x" }, zero: saved({ scale: 0 }) }))).toEqual({ good: saved() });
});
