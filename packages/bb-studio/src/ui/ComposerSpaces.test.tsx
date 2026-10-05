// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ComposerSpaces, handOffNewThreadSpace } from "./ComposerSpaces";

const rpc = vi.hoisted(() => ({ call: vi.fn(async (method: string) => method === "spaces" ? { spaces: [{ id: "spc_launch", name: "Launch", icon: null }] } : { ok: true }) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({}),
  useComposer: () => ({ experimental_onSubmitted: () => () => {} }),
  useComposerView: () => ({ scope: { kind: "new-thread", projectId: "proj_1" } }),
  useRealtime: () => {},
  useRpc: () => rpc,
}));
vi.mock("@bb-studio/kit/app", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return { DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: () => null, DropdownMenuItem: Pass, DropdownMenuLabel: Pass, DropdownMenuSeparator: () => null, Icon: () => null };
});
vi.mock("./StudioPanel", () => ({ openSpaceItems: () => {} }));
vi.mock("sonner", () => ({ toast: { error: () => {} } }));

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); rpc.call.mockClear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const mount = async (inCommand: boolean) => {
  if (inCommand) container.setAttribute("data-command-composer", "");
  await act(async () => { root.render(React.createElement(ComposerSpaces)); await new Promise(resolve => setTimeout(resolve, 10)); });
};

test("Command's composer shows no Space picker and leaves New thread's handoff alone", async () => {
  handOffNewThreadSpace("spc_launch", "proj_1");
  await mount(true);
  expect(container.querySelector("button")).toBeNull();
  expect(rpc.call).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem("studio:new-thread-space")!).spaceId).toBe("spc_launch");
});
test("a new thread's composer takes the handoff and shows the Space", async () => {
  handOffNewThreadSpace("spc_launch", "proj_1");
  await mount(false);
  expect(sessionStorage.getItem("studio:new-thread-space")).toBeNull();
  expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Spaces: Launch");
});
