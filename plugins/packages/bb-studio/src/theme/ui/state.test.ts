import { afterEach, expect, it, vi } from "vitest";
import { defaultAppearance } from "../appearance";
import { NORD } from "../builtin/classic";
import { GRID } from "../builtin/grid";
import { appearanceOverrides, forgetSavedAppearance, markAppearanceSaved, SAVED_HOLD_MS, setAppearanceDraft, settleSavedAppearances, shownAppearance } from "./state";

afterEach(() => { forgetSavedAppearance(["cos", "home"]); setAppearanceDraft("cos", null, false); vi.useRealTimers(); });

const grid = defaultAppearance(GRID);
const nord = defaultAppearance(NORD);

it("shows a saved appearance at once, before the Bot list has it, and settles once the list agrees", () => {
  const stale = { id: "cos", appearance: nord };
  setAppearanceDraft("cos", grid);
  expect(shownAppearance(stale, appearanceOverrides())).toEqual(grid);
  markAppearanceSaved(["cos"], grid);
  setAppearanceDraft("cos", null, false);
  expect(shownAppearance(stale, appearanceOverrides())).toEqual(grid);
  settleSavedAppearances([stale]);
  expect(shownAppearance(stale, appearanceOverrides())).toEqual(grid);
  settleSavedAppearances([{ id: "cos", appearance: grid }]);
  expect(appearanceOverrides().saved.size).toBe(0);
  expect(shownAppearance({ id: "cos", appearance: nord }, appearanceOverrides())).toEqual(nord);
});

it("holds a saved None too, and lets go after a while when the list never agrees", () => {
  vi.useFakeTimers();
  markAppearanceSaved(["cos", "home"], null);
  expect(shownAppearance({ id: "home", appearance: grid }, appearanceOverrides())).toBeNull();
  vi.advanceTimersByTime(SAVED_HOLD_MS + 1);
  expect(shownAppearance({ id: "home", appearance: grid }, appearanceOverrides())).toEqual(grid);
});
