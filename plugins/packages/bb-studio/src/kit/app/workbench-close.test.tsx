// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const panel = vi.hoisted(() => ({ tabs: [] as unknown[], closeTab: vi.fn((_key: string) => true) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_useAppPanel: () => ({ getTabs: () => ({ open: true, selectedKey: null, tabs: panel.tabs }), closeTab: panel.closeTab }) }));

import { findWorkbenchTab, requestCloseWorkbenchTab, useWorkbenchCloseRequests, type WorkbenchTabRef } from "./workbench-close";

const plugin = (key: string, tabId: string, params: unknown, over: Record<string, unknown> = {}) => ({ key, title: key, status: null, closable: true, detail: { kind: "plugin", pluginId: "studio", tab: { id: tabId }, params }, ...over });
const ref = (tabId: string, params: Record<string, unknown> | undefined, threadId: string | null = "thr_a"): WorkbenchTabRef => ({ pluginId: "studio", tabId, params, threadId });
function Receiver({ threadId }: { threadId: string | null }) { useWorkbenchCloseRequests(threadId); return null; }

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  panel.closeTab.mockClear();
  panel.closeTab.mockReturnValue(true);
  panel.tabs = [
    { key: "info", title: "Info", status: null, closable: false, detail: { kind: "info" } },
    plugin("k-page", "studio", { kind: "page", id: "pg_1" }),
    plugin("k-thread", "thread", { threadId: "thr_b" }),
    plugin("k-bot", "bot", { botId: "b1" }, { closable: false }),
  ];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("finds the plugin's tab with the same params, whatever order they were written in, and never one that can't be closed", () => {
  const tabs = { tabs: panel.tabs as never };
  expect(findWorkbenchTab(tabs, ref("studio", { id: "pg_1", kind: "page" }))?.key).toBe("k-page");
  expect(findWorkbenchTab(tabs, ref("studio", { kind: "page", id: "pg_2" }))).toBeNull();
  expect(findWorkbenchTab(tabs, ref("bot", { botId: "b1" }))).toBeNull();
  expect(findWorkbenchTab(tabs, { ...ref("thread", { threadId: "thr_b" }), pluginId: "git" })).toBeNull();
});

it("the side panel that holds the tab closes it and says so; nobody answers for another thread's panel", async () => {
  await act(async () => root.render(<Receiver threadId="thr_a" />));
  expect(requestCloseWorkbenchTab(ref("thread", { threadId: "thr_b" }))).toBe(true);
  expect(panel.closeTab).toHaveBeenCalledWith("k-thread");
  expect(requestCloseWorkbenchTab(ref("thread", { threadId: "thr_b" }, "thr_other"))).toBe(false);
  expect(requestCloseWorkbenchTab(ref("thread", { threadId: "thr_b" }, null))).toBe(false);
  expect(requestCloseWorkbenchTab(ref("studio", { kind: "page", id: "pg_9" }))).toBe(false);
  expect(panel.closeTab).toHaveBeenCalledTimes(1);
});

it("the Studio page's panel answers for tabs with no thread, and nothing answers once it is gone", async () => {
  await act(async () => root.render(<Receiver threadId={null} />));
  expect(requestCloseWorkbenchTab(ref("studio", { kind: "page", id: "pg_1" }, null))).toBe(true);
  expect(panel.closeTab).toHaveBeenCalledWith("k-page");
  await act(async () => root.render(<span />));
  expect(requestCloseWorkbenchTab(ref("studio", { kind: "page", id: "pg_1" }, null))).toBe(false);
});
