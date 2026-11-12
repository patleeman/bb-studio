// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({}) }));
vi.mock("./hooks", () => ({ LOOPS_PANE: "loops" }));

const { keepTodosTabName, RENAME_SETTLE_MS } = await import("./tab-name");

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("names the Todos tab when Studio loads, and again after another window or a navigation brings an old title back", () => {
  const calls: unknown[] = [];
  const stop = keepTodosTabName({ experimental_renameTab: (options: unknown) => { calls.push(options); return true; } }, window);
  expect(calls).toEqual([{ tab: { id: "loops" }, title: "Todos" }]);
  vi.advanceTimersByTime(RENAME_SETTLE_MS);
  expect(calls).toHaveLength(2);
  window.dispatchEvent(new Event("storage"));
  window.dispatchEvent(new Event("pointerup"));
  vi.advanceTimersByTime(RENAME_SETTLE_MS);
  expect(calls).toHaveLength(3);
  stop();
  window.dispatchEvent(new Event("storage"));
  vi.advanceTimersByTime(RENAME_SETTLE_MS);
  expect(calls).toHaveLength(3);
});

it("renames a Todos tab that was opened with parameters, which the plain rename does not match", () => {
  const calls: unknown[] = [];
  const tabs = [
    { key: "a", title: "Loops", detail: { kind: "plugin", pluginId: "studio", tab: { id: "loops" }, params: { botId: "bot_main" } } },
    { key: "b", title: "Todos", detail: { kind: "plugin", pluginId: "studio", tab: { id: "loops" }, params: null } },
    { key: "c", title: "Loops", detail: { kind: "plugin", pluginId: "other", tab: { id: "loops" }, params: null } },
  ];
  const stop = keepTodosTabName({ experimental_renameTab: (options: unknown) => { calls.push(options); return true; }, experimental_workbench: () => ({ threadId: "thr", list: () => ({ open: true, selectedKey: "a", tabs }) }) }, window);
  expect(calls).toEqual([{ tab: { id: "loops" }, title: "Todos" }, { tab: { id: "loops" }, params: { botId: "bot_main" }, title: "Todos" }]);
  stop();
});

it("does nothing on a bb without tab renaming, and survives a rename that throws", () => {
  expect(() => keepTodosTabName({}, window)()).not.toThrow();
  const stop = keepTodosTabName({ experimental_renameTab: () => { throw new Error("no"); } }, window);
  expect(() => vi.advanceTimersByTime(RENAME_SETTLE_MS)).not.toThrow();
  stop();
});
