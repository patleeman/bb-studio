// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: () => null,
  experimental_usePluginId: () => "pages",
  useRpc: () => rpc,
  useRealtime: (channel: string, handler: (payload: unknown) => void) => { if (channel === "studio-workspace") realtime.handler = handler; },
}));
const realtime = vi.hoisted(() => ({ handler: (_payload: unknown) => {} }));
const reports: { method: string; input: any }[] = [];
const rpc = { call: async (method: string, input: unknown) => {
  reports.push({ method, input });
  if (method === "itemAt") return { item: { pluginId: "pages", id: "one" }, kind: null };
  if (method === "rename") return { done: ["one"], failed: [] };
  return { tab: null };
} };
import { RetainedPanels, openWorkspaceItem } from "@bb-studio/kit/app";
import { closeWorkspaceTabs, StudioWorkspace, WorkspaceBridge } from "./Workspace";
const page = "/plugins/pages/pages/one", other = "/plugins/pages/pages/two";
let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps editor drafts while switching tabs, splitting and returning to the workspace", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  function App({ show = true }: { show?: boolean }) { return <><WorkspaceBridge /><RetainedPanels path="pages" render={subPath => <textarea aria-label={subPath} defaultValue={subPath} />} />{show && <StudioWorkspace />}</>; }
  await act(() => root.render(<App />));
  await act(() => { expect(openWorkspaceItem({ href: page, title: "One" })).toBe(true); });
  const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="one"]')!;
  expect(editor).not.toBeNull(); editor.value = "Keep my draft";
  await act(() => { openWorkspaceItem({ href: other, title: "Two" }); });
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
  const target = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="two"]')!;
  const body = target.closest<HTMLElement>('[data-studio-workspace-drop]')!;
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} });
  // An editor consumes its own drop events, and one in an iframe never sees
  // them: while a Studio item is dragged, a drop layer covers each editor.
  target.addEventListener("drop", event => event.stopPropagation());
  const transfer = { types: ["application/x-bb-studio-item"], getData: () => JSON.stringify({ href: page, title: "One" }) };
  const drag = (type: string, at: EventTarget) => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 95, clientY: 50 }); Object.defineProperty(event, "dataTransfer", { value: transfer }); at.dispatchEvent(event); };
  await act(() => { drag("dragenter", target); });
  const layer = body.querySelector<HTMLElement>("[data-studio-workspace-drop-layer]")!;
  expect(layer).not.toBeNull();
  await act(() => { drag("dragover", layer); });
  expect(body.textContent).toContain("Split right");
  await act(() => { drag("drop", layer); });
  expect(host.querySelector("[data-studio-workspace-drop-layer]")).toBeNull();
  expect(host.querySelectorAll('[data-workspace-pane]')).toHaveLength(2);
  expect(host.querySelector('textarea[aria-label="one"]')).toBe(editor);
  expect(editor.value).toBe("Keep my draft");
  await act(() => root.render(<App show={false} />));
  await act(() => root.render(<App />));
  expect(host.querySelectorAll('[data-workspace-pane]')).toHaveLength(2);
  expect(host.querySelector('textarea[aria-label="one"]')).toBe(editor);
  expect(editor.value).toBe("Keep my draft");
  const close = host.querySelector<HTMLButtonElement>('button[aria-label="Close One"]')!;
  await act(() => close.click());
  expect(host.querySelectorAll('[data-workspace-pane]')).toHaveLength(1);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
});
it("closes others and the tabs to the right from a tab's context menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const third = "/plugins/pages/pages/three";
  // The workspace outlives a test; start from no tabs.
  closeWorkspaceTabs([page, other, third]);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; };
  await act(() => root.render(<><WorkspaceBridge /><RetainedPanels path="pages" render={subPath => <textarea aria-label={subPath} />} /><StudioWorkspace /></>));
  await act(() => { for (const [href, title] of [[page, "One"], [other, "Two"], [third, "Three"]] as const) openWorkspaceItem({ href, title }); });
  const titles = () => [...host.querySelectorAll('[role="tab"]')].map(tab => tab.textContent);
  expect(titles()).toEqual(["One", "Two", "Three"]);
  const menu = async (title: string, action: string) => {
    const tab = [...host.querySelectorAll<HTMLElement>("[data-studio-workspace-tab]")].find(each => each.textContent === title)!;
    await act(() => { tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })); });
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(each => each.textContent === action)!;
    expect(item).toBeDefined();
    await act(() => { item.click(); });
  };
  await menu("Two", "Close tabs to the right");
  expect(titles()).toEqual(["One", "Two"]);
  await menu("Two", "Close others");
  expect(titles()).toEqual(["Two"]);
});

it("reports its tabs for agents and opens and closes tabs an agent sends to this window", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  closeWorkspaceTabs([page, other, "/plugins/pages/pages/three"]);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  await act(() => root.render(<><WorkspaceBridge /><RetainedPanels path="pages" render={subPath => <textarea aria-label={subPath} />} /><StudioWorkspace /></>));
  await act(async () => { openWorkspaceItem({ href: page, title: "One" }); await new Promise(resolve => setTimeout(resolve, 350)); });
  const report = reports.filter(each => each.method === "workspaceReport").at(-1)!.input;
  expect(report.panes[0].tabs).toEqual([{ href: page, title: "One" }]);
  expect(report.panes[0].active).toBe(page);
  // Commands for another window change nothing; this window's split and close.
  await act(() => { realtime.handler({ client: "elsewhere", action: "open", items: [{ href: other, title: "Two" }], placement: "tab", show: false }); });
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
  await act(() => { realtime.handler({ client: report.client, action: "open", items: [{ href: other, title: "Two" }], placement: "right", show: false }); });
  expect(host.querySelectorAll("[data-workspace-pane]")).toHaveLength(2);
  await act(() => { realtime.handler({ client: report.client, action: "close", hrefs: [other] }); });
  expect([...host.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(["One"]);
  // A batch keeps together where the first lands, even past a tab open elsewhere.
  const third = "/plugins/pages/pages/three", fourth = "/plugins/pages/pages/four";
  await act(() => { openWorkspaceItem({ href: other, title: "Two" }); });
  await act(() => { realtime.handler({ client: report.client, action: "open", items: [{ href: third, title: "Three" }, { href: other, title: "Two" }, { href: fourth, title: "Four" }], placement: "right", show: false }); });
  const pane = (index: number) => [...host.querySelectorAll("[data-workspace-pane]")][index]!;
  const tabsIn = (element: Element) => [...element.querySelectorAll('[role="tab"]')].map(tab => tab.textContent);
  expect(host.querySelectorAll("[data-workspace-pane]")).toHaveLength(2);
  expect(tabsIn(pane(0))).toEqual(["One"]);
  expect(tabsIn(pane(1))).toEqual(["Three", "Two", "Four"]);
  closeWorkspaceTabs([third, other, fourth]);
});

it("renames an item from its tab with a double-click", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  closeWorkspaceTabs([page, other, "/plugins/pages/pages/three", "/plugins/pages/pages/four"]);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  await act(() => root.render(<><WorkspaceBridge /><RetainedPanels path="pages" render={subPath => <textarea aria-label={subPath} />} /><StudioWorkspace /></>));
  await act(() => { openWorkspaceItem({ href: page, title: "One" }); });
  await act(() => { host.querySelector('[role="tab"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename One"]')!;
  input.value = "Launch plan";
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(reports.find(each => each.method === "rename")?.input).toEqual({ pluginId: "pages", id: "one", title: "Launch plan" });
  expect(host.querySelector('[role="tab"]')!.textContent).toBe("Launch plan");
});
it("opens an item's own address as a tab and leaves it for the workspace", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  closeWorkspaceTabs([page, other, "/plugins/pages/pages/three", "/plugins/pages/pages/four"]);
  window.history.replaceState(null, "", page);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); window.history.replaceState(null, "", "/"); };
  await act(() => root.render(<><WorkspaceBridge /><RetainedPanels path="pages" render={subPath => <textarea aria-label={subPath} />} /><StudioWorkspace /></>));
  expect([...host.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(["one"]);
  expect(window.location.pathname).toBe("/plugins/studio/studio");
  // A sub-view, such as a page's chat, keeps its own page.
  await act(() => { window.history.replaceState(null, "", `${other}/chat/thr_1`); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(window.location.pathname).toBe(`${other}/chat/thr_1`);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
});
