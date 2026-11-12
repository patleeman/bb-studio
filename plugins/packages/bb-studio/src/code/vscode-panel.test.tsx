// @vitest-environment jsdom
// VS Code's nav panel: its root lands on the last workspace or the picker,
// and the old addresses under the Library go to the same page here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/",
  recent: null as { id: string } | null,
  navigate: { toPluginPanel: vi.fn() },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => state.navigate,
  useRpc: () => ({ call: async () => ({ workspace: state.recent }) }),
}));
vi.mock("../kit/app/route", () => ({ usePathname: () => state.pathname }));
vi.mock("../kit/app/retained", () => ({ retainPanel: (_path: string, Component: (props: { subPath: string }) => unknown) => Component }));
vi.mock("../ui/studio-open", () => ({ StudioContainerProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("./route", () => ({ default: ({ id }: { id: string }) => <p data-page={id} /> }));

import { OldCodeAddress, VsCodePanel } from "./vscode-panel";

let root: Root;
let host: HTMLDivElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const render = async (node: React.ReactNode) => { await act(async () => { root.render(node); await settle(); }); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
  state.navigate.toPluginPanel.mockClear();
  state.recent = null;
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

it("lands on the workspace used last, in place of the panel's root", async () => {
  state.recent = { id: "cws_b" };
  await render(<VsCodePanel subPath="" />);
  expect(state.navigate.toPluginPanel).toHaveBeenCalledWith("vscode", { subPath: "cws_b", replace: true });
});

it("lands on the picker with no workspace to open", async () => {
  await render(<VsCodePanel subPath="" />);
  expect(state.navigate.toPluginPanel).toHaveBeenCalledWith("vscode", { subPath: "choose", replace: true });
});

it("shows a workspace, or the picker, at its address", async () => {
  await render(<VsCodePanel subPath="cws_a" />);
  expect(host.querySelector("[data-page]")?.getAttribute("data-page")).toBe("cws_a");
  await render(<VsCodePanel subPath="choose" />);
  expect(host.querySelector("[data-page]")?.getAttribute("data-page")).toBe("choose");
  expect(state.navigate.toPluginPanel).not.toHaveBeenCalled();
});

it("sends an old address under the Library to the same page, each time it is shown", async () => {
  state.pathname = "/plugins/studio/studio/workspaces/cws_a";
  await render(<OldCodeAddress id="cws_a" />);
  expect(state.navigate.toPluginPanel).toHaveBeenCalledWith("vscode", { subPath: "cws_a", replace: true });
  state.pathname = "/plugins/studio/vscode/cws_a";
  await render(<OldCodeAddress id="cws_a" />);
  expect(state.navigate.toPluginPanel).toHaveBeenCalledTimes(1);
});
