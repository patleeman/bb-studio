// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: () => null,
  experimental_usePluginId: () => "pages",
  useRpc: () => rpc,
}));
const rpc = { call: async () => ({ tab: null }) };
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
