import { expect, it } from "vitest";
import { mainCompanionPath, mainTarget, swapCompanions } from "./placements";
import { EMPTY, moveCompanion, navigateTab, openTab, pinTab, tabKey } from "./stack";

it("swaps retained views without transferring one view's pin or history to the other", () => {
  const first = { kind: "thread" as const, threadId: "one" };
  const main = { kind: "path" as const, path: "/plugins/pages/pages/launch" };
  let state = navigateTab(openTab(EMPTY, { kind: "path", path: "/plugins/pages/pages/reference" }), "path:/plugins/pages/pages/reference", first);
  state = pinTab(state, tabKey(first), true);
  state = moveCompanion(state, tabKey(first), "workbench");
  state = moveCompanion(openTab(state, main), tabKey(main), "main");
  const before = state.tabs;
  const next = swapCompanions(state, tabKey(first), main);
  expect(next.tabs).toHaveLength(2);
  expect(next.tabs[0]).toMatchObject({ key: tabKey(first), target: before[0]!.target, pinned: true, back: before[0]!.back, placement: "main" });
  expect(next.tabs[1]).toMatchObject({ key: tabKey(main), target: before[1]!.target, pinned: false, placement: "workbench" });
  expect(next.active).toBe(tabKey(first));
});

it("adopts an ordinary main target once and preserves any existing destination tab", () => {
  const first = { kind: "thread" as const, threadId: "one" };
  const main = { kind: "path" as const, path: "/plugins/pages/pages/launch" };
  const original = openTab(EMPTY, first);
  const once = swapCompanions(original, tabKey(first), main);
  const twice = swapCompanions(once, tabKey(first), main);
  expect(twice.tabs.map(tab => tab.key)).toEqual([tabKey(first), tabKey(main)]);
  expect(twice.tabs[1]!.target).toEqual(main);
  expect(swapCompanions(once, "missing", main)).toBe(once);
  expect(swapCompanions(once, tabKey(first), first)).toBe(once);
});

it("resolves canonical main companion routes and rejects unavailable or malformed targets", () => {
  const target = { kind: "path" as const, path: "/plugins/pages/pages/a space" };
  const key = tabKey(target);
  const state = moveCompanion(openTab(EMPTY, target), key, "main");
  expect(mainTarget(state, mainCompanionPath(key))).toEqual(target);
  expect(mainTarget(state, `${mainCompanionPath(key)}?inspector=1`)).toEqual(target);
  expect(mainTarget(moveCompanion(state, key, "floating"), mainCompanionPath(key))).toBeNull();
  expect(mainTarget(state, "/plugins/float/companions/%ZZ")).toBeNull();
});
