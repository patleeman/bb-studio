// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SpaceProjectsDialog } from "./Spaces";

const sdk = vi.hoisted(() => ({
  system: { config: vi.fn(async () => ({ primaryHostId: "host_1" })) },
  hosts: { pickFolder: vi.fn(async (): Promise<{ path: string | null }> => ({ path: "/code/site" })) },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => ({}), useSdk: () => sdk }));
vi.mock("@bb-studio/kit/app", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return { DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: () => null, DropdownMenuItem: Pass, DropdownMenuSeparator: () => null, GHOST_BUTTON: "", Icon: () => null, ItemLinkTextarea: () => null, OUTLINE_BUTTON: "", projectName: () => "" };
});
vi.mock("@bb-studio/kit/ui", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  const Button = ({ variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => React.createElement("button", props);
  return { Button, cn: () => "", Dialog: Pass, DialogContent: Pass, DialogDescription: Pass, DialogFooter: Pass, DialogHeader: Pass, DialogTitle: Pass, Input: (props: object) => React.createElement("input", props) };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const space = { id: "spc_1", name: "Work", projectIds: [] as string[], threadIds: [], defaultProjectId: "proj_general" };
const rpc = { call: vi.fn(async () => ({ space: { ...space, projectIds: ["proj_site"] }, project: { id: "proj_site", name: "site" } })) };
const onChanged = vi.fn();
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const mount = () => act(async () => {
  root.render(React.createElement(SpaceProjectsDialog, { rpc: rpc as never, space: space as never, projects: [{ id: "proj_general", name: "General" }], onClose: () => {}, onChanged }));
});
const button = (text: string) => [...container.querySelectorAll("button")].find((each) => each.textContent === text)!;
const click = (text: string) => act(async () => { button(text).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });

test("Add a folder… adds the picked folder as a project and lists it", async () => {
  await mount();
  await click("Add a folder…");
  expect(sdk.hosts.pickFolder).toHaveBeenCalledWith({ hostId: "host_1", clientHostId: "host_1" });
  expect(rpc.call).toHaveBeenCalledWith("addSpaceFolder", { id: "spc_1", path: "/code/site" });
  expect(onChanged).toHaveBeenCalled();
  expect(container.textContent).toContain("site");
});

test("when the picker can't open, it says why and takes a typed path", async () => {
  sdk.hosts.pickFolder.mockRejectedValueOnce(new Error("Native folder picker is only available on the same machine."));
  await mount();
  await click("Add a folder…");
  expect(rpc.call).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Couldn't open the folder picker (Native folder picker is only available on the same machine). Type the folder's path instead.");
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "/code/site");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Add folder");
  expect(rpc.call).toHaveBeenCalledWith("addSpaceFolder", { id: "spc_1", path: "/code/site" });
  expect(container.querySelector("input")).toBeNull();
});

test("a cancelled picker changes nothing", async () => {
  sdk.hosts.pickFolder.mockResolvedValueOnce({ path: null });
  await mount();
  await click("Add a folder…");
  expect(rpc.call).not.toHaveBeenCalled();
  expect(container.querySelector("input")).toBeNull();
});
