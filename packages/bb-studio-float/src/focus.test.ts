import { afterEach, expect, it, vi } from "vitest";
import { EMPTY, openTab, moveCompanion, pinTab, navigateTab } from "./stack";
import { getFloat, update } from "./store";
import { focusCompanion } from "./focus";

afterEach(() => update(() => EMPTY));

it("focuses a retained main companion through its canonical route without moving or replacing it", () => {
  const key = "thread:one";
  const navigate = { toPluginPanel: vi.fn() };
  update(() => pinTab(moveCompanion(navigateTab(openTab(EMPTY, { kind: "path", path: "/plugins/pages/pages/launch" }), "path:/plugins/pages/pages/launch", { kind: "thread", threadId: "one" }), key, "main"), key, true));
  const tab = getFloat().tabs[0]!;
  update(state => ({ ...state, hidden: true, collapsed: true, active: null }));
  focusCompanion(key, navigate);
  const state = getFloat();
  expect(navigate.toPluginPanel).toHaveBeenCalledWith("companions", { subPath: key });
  expect(state).toMatchObject({ active: key, hidden: false, collapsed: false });
  expect(state.tabs).toHaveLength(1);
  expect(state.tabs[0]).toMatchObject({ key, target: tab.target, back: tab.back, pinned: true, placement: "main", opened: true });
  expect(state.tabs[0]!.activation).toBe((tab.activation ?? 0) + 1);
});

it("does not navigate main for floating or docked tabs, or recreate a closed tab", () => {
  const navigate = { toPluginPanel: vi.fn() };
  update(() => openTab(EMPTY, { kind: "thread", threadId: "one" }));
  focusCompanion("thread:one", navigate);
  update(state => moveCompanion(state, "thread:one", "workbench"));
  focusCompanion("thread:one", navigate);
  const before = getFloat();
  focusCompanion("thread:missing", navigate);
  expect(getFloat()).toBe(before);
  expect(navigate.toPluginPanel).not.toHaveBeenCalled();
});
