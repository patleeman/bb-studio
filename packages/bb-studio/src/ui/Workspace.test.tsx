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
import { StudioWorkspace, WorkspaceBridge } from "./Workspace";
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
  const transfer = { types: ["application/x-bb-studio-item"], getData: () => JSON.stringify({ href: page, title: "One" }), dropEffect: "none" };
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
