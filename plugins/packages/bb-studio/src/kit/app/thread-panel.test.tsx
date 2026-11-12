// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ openTab: vi.fn((_options: unknown) => true), tabs: { open: false, selectedKey: null as string | null, tabs: [] as unknown[] } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_useAppPanel: () => ({ openTab: state.openTab, getTabs: () => state.tabs }), useComposer: () => ({ scope: { kind: "thread", threadId: "thr_a" } }) }));
const { onThreadTabOpen, openThreadTab, requestThreadTab, resetThreadTabRequests, ThreadTabReceiver, threadTab } = await import("./thread-panel");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.openTab.mockReset().mockReturnValue(true);
  state.tabs = { open: false, selectedKey: null, tabs: [] };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); resetThreadTabRequests(); vi.useRealTimers(); });

it("opens a Studio thread tab by id, with its title and params, and reads a throw as declined", () => {
  const panel = { openTab: vi.fn((_options: unknown) => true) };
  expect(openThreadTab(panel, { actionId: "studio", title: "Plan", params: { kind: "page", id: "pg_1" } })).toBe(true);
  expect(panel.openTab).toHaveBeenCalledWith({ tab: threadTab("studio"), title: "Plan", params: { kind: "page", id: "pg_1" } });
  expect(threadTab("studio")).toEqual({ id: "studio", context: { kind: "thread" }, availability: "action" });
  expect(openThreadTab({ openTab: () => { throw new Error("gone"); } }, { actionId: "studio" })).toBe(false);
});

it("asks for the workbench's Global section only for a tab opened as global", () => {
  const panel = { openTab: vi.fn((_options: unknown) => true) };
  openThreadTab(panel, { actionId: "code", title: "fix-retry", params: { environmentId: "env_1" }, global: true });
  expect(panel.openTab).toHaveBeenLastCalledWith({ tab: threadTab("code"), title: "fix-retry", params: { environmentId: "env_1" }, experimental_global: true });
  openThreadTab(panel, { actionId: "code", title: "VS Code" });
  expect(panel.openTab).toHaveBeenLastCalledWith({ tab: threadTab("code"), title: "VS Code" });
});

it("a thread's composer takes the requests for its thread once, and only its own", async () => {
  const mine = requestThreadTab("thr_a", { actionId: "loops", title: "Todos" });
  const other = requestThreadTab("thr_b", { actionId: "loops", title: "Todos" });
  await act(async () => root.render(<ThreadTabReceiver />));
  await expect(mine).resolves.toBe(true);
  expect(state.openTab).toHaveBeenCalledTimes(1);
  state.openTab.mockReturnValueOnce(false);
  let opened: boolean | undefined;
  await act(async () => { opened = await requestThreadTab("thr_a", { actionId: "bot-info", title: "Bot info" }); });
  expect(opened).toBe(false);
  expect(state.openTab).toHaveBeenCalledTimes(2);
  resetThreadTabRequests();
  await expect(other).resolves.toBe(false);
});

it("a newer request replaces a waiting one, and a request no thread takes gives up after 15 seconds", async () => {
  vi.useFakeTimers();
  const first = requestThreadTab("thr_c", { actionId: "loops" });
  const second = requestThreadTab("thr_c", { actionId: "bot-info" });
  await expect(first).resolves.toBe(false);
  vi.advanceTimersByTime(15_000);
  await expect(second).resolves.toBe(false);
  expect(state.openTab).not.toHaveBeenCalled();
});

it("a background open waits behind the user's, and leaves a plugin tab the user opened alone", async () => {
  const user = requestThreadTab("thr_a", { actionId: "loops" });
  await expect(requestThreadTab("thr_a", { actionId: "bot-info", background: true })).resolves.toBe(false);
  await act(async () => root.render(<ThreadTabReceiver />));
  await expect(user).resolves.toBe(true);
  expect(state.openTab).toHaveBeenCalledTimes(1);
  expect(state.openTab).toHaveBeenLastCalledWith({ tab: threadTab("loops") });
  state.tabs = { open: true, selectedKey: "k1", tabs: [{ key: "k1", title: "Todos", status: null, closable: true, detail: { kind: "plugin", pluginId: "studio", tab: threadTab("loops"), params: null } }] };
  let opened: boolean | undefined;
  await act(async () => { opened = await requestThreadTab("thr_a", { actionId: "bot-info", background: true }); });
  expect(opened).toBe(false);
  expect(state.openTab).toHaveBeenCalledTimes(1);
  state.tabs = { open: true, selectedKey: "info", tabs: [{ key: "info", title: "Info", status: null, closable: false, detail: { kind: "info" } }] };
  await act(async () => { opened = await requestThreadTab("thr_a", { actionId: "bot-info", background: true }); });
  expect(opened).toBe(true);
  expect(state.openTab).toHaveBeenCalledTimes(2);
});

it("tells open listeners before each open, and a throwing listener doesn't block it", () => {
  const seen: unknown[] = [];
  const stopThrow = onThreadTabOpen(() => { throw new Error("boom"); });
  const stop = onThreadTabOpen((open) => seen.push(open.params));
  const openTab = vi.fn(() => true);
  expect(openThreadTab({ openTab }, { actionId: "studio", params: { kind: "page", id: "pg_1" } })).toBe(true);
  stop();
  stopThrow();
  openThreadTab({ openTab }, { actionId: "studio" });
  expect(seen).toEqual([{ kind: "page", id: "pg_1" }]);
  expect(openTab).toHaveBeenCalledTimes(2);
});

it("opens BB's own Info tab for INFO_TAB, by selecting it, and says false where the panel has none", async () => {
  const { INFO_TAB } = await import("./thread-panel");
  const selectTab = vi.fn((_key: string) => true);
  const panel = { openTab: state.openTab, getTabs: () => ({ open: false, selectedKey: null, tabs: [{ key: "t1", detail: { kind: "file" } }, { key: "info", detail: { kind: "info" } }] }), selectTab };
  expect(openThreadTab(panel as never, { actionId: INFO_TAB })).toBe(true);
  expect(selectTab).toHaveBeenCalledWith("info");
  expect(state.openTab).not.toHaveBeenCalled();
  expect(openThreadTab({ openTab: state.openTab, getTabs: () => ({ open: false, selectedKey: null, tabs: [] }), selectTab } as never, { actionId: INFO_TAB })).toBe(false);
  expect(openThreadTab({ openTab: state.openTab } as never, { actionId: INFO_TAB })).toBe(false);
});
