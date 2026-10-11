import { expect, it } from "vitest";
import { needsWindowReload, parseKindsSnapshot, whenOn } from "./kinds-snapshot";

it("reads the frontend state from kinds.state and leaves everything on when it can't", () => {
  const snapshot = parseKindsSnapshot({ ok: true, result: { frontend: { off: ["design", 3], routedAway: ["page"] } } });
  expect([...snapshot.off]).toEqual(["design"]);
  expect([...snapshot.routedAway]).toEqual(["page"]);
  expect(parseKindsSnapshot(null).off.size).toBe(0);
  const Card = () => null;
  expect(whenOn(snapshot, "page", Card)).toBe(Card);
  expect(whenOn(snapshot, "design", Card)).not.toBe(Card);
  expect(needsWindowReload({ off: ["design"], routedAway: ["page"] }, snapshot)).toBe(false);
  expect(needsWindowReload({ off: [], routedAway: ["page"] }, snapshot)).toBe(true);
  expect(needsWindowReload({ off: [] , routedAway: [] }, null)).toBe(false);
});
