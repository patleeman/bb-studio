// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { PanelTab } from "../../workbench-agent/exec";
import { closeStrandsTabs, retireStrandsTabs, strandsTabsToClose } from "./retire-strands-tabs";

const plugin = (key: string, pluginId: string, id: string): PanelTab => ({ key, title: key, closable: true, detail: { kind: "plugin", pluginId, tab: { id }, params: null } });
const TABS: PanelTab[] = [
  plugin("a", "studio", "loops"),
  plugin("b", "studio", "memory"),
  plugin("c", "other", "loops"),
  { key: "d", title: "a.ts", closable: true, detail: { kind: "file", path: "a.ts" } },
  { ...plugin("e", "studio", "loops"), detail: { kind: "plugin", pluginId: "studio", tab: { id: "loops" }, params: { botId: "bot_main" } } },
];

function host(tabs: PanelTab[]) {
  const open = [...tabs];
  const close = vi.fn((key: string) => { const at = open.findIndex((tab) => tab.key === key); if (at < 0) return false; open.splice(at, 1); return true; });
  return { open, close, navigate: { experimental_workbench: () => ({ list: () => ({ open: true, selectedKey: null, tabs: open }), close }) } };
}

afterEach(() => { vi.useRealTimers(); });

it("picks only Studio's old Strands page tabs, whatever their params", () => {
  expect(strandsTabsToClose(TABS)).toEqual(["a", "e"]);
});

it("closes them in the workbench on screen and leaves every other tab", () => {
  const { open, close, navigate } = host(TABS);
  expect(closeStrandsTabs(navigate)).toBe(2);
  expect(close.mock.calls.map(([key]) => key)).toEqual(["a", "e"]);
  expect(open.map((tab) => tab.key)).toEqual(["b", "c", "d"]);
  expect(closeStrandsTabs(navigate)).toBe(0);
});

it("does nothing on a BB without a workbench, or when the workbench throws", () => {
  expect(closeStrandsTabs({})).toBe(0);
  expect(closeStrandsTabs({ experimental_workbench: () => { throw new Error("gone"); } })).toBe(0);
});

it("checks at start and again after the view changes, until stopped", () => {
  vi.useFakeTimers();
  const first = host([plugin("a", "studio", "loops")]);
  let current = first;
  const navigate = { experimental_workbench: () => current.navigate.experimental_workbench() };
  const stop = retireStrandsTabs(navigate, window);
  expect(first.open).toEqual([]);
  // Another conversation's workbench comes on screen with an old tab.
  current = host([plugin("x", "studio", "loops"), plugin("y", "studio", "memory")]);
  window.dispatchEvent(new Event("popstate"));
  vi.advanceTimersByTime(500);
  expect(current.open.map((tab) => tab.key)).toEqual(["y"]);
  stop();
  current = host([plugin("z", "studio", "loops")]);
  window.dispatchEvent(new Event("popstate"));
  vi.advanceTimersByTime(500);
  expect(current.open.map((tab) => tab.key)).toEqual(["z"]);
});
