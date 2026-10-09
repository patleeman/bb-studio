// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ComposerSpaces } from "./ComposerSpaces";
import { draftRecipients, useCommandDraft } from "../command/draft-recipients";

const view = vi.hoisted(() => ({ text: "" }));
const rpc = vi.hoisted(() => ({ call: vi.fn(async (method: string) => method === "spaces" ? { spaces: [{ id: "spc_launch", name: "Launch", icon: null }] } : { ok: true }) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({}),
  useComposer: () => ({ scope: { kind: "new-thread", projectId: "proj_1" }, draft: { text: view.text, mentions: [], attachments: [] }, onSubmitted: () => () => {} }),
  useRealtime: () => {},
  useRpc: () => rpc,
}));
vi.mock("@bb-studio/kit/app", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return { DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: () => null, DropdownMenuItem: Pass, DropdownMenuLabel: Pass, DropdownMenuSeparator: () => null, Icon: () => null };
});
vi.mock("./StudioPanel", () => ({ openSpaceItems: () => {} }));
vi.mock("sonner", () => ({ toast: { error: () => {} } }));

/** What Studio Sidebar's handOffNewThreadSpace writes when New thread is opened from a Space. */
const handOffNewThreadSpace = (spaceId: string, projectId: string | null) => sessionStorage.setItem("studio:new-thread-space", JSON.stringify({ spaceId, projectId, at: Date.now() }));
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); rpc.call.mockClear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const mount = async (inCommand: boolean | string) => {
  if (inCommand) container.setAttribute(typeof inCommand === "string" ? inCommand : "data-command-composer", "");
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
test("a thread started from Command's new-thread pane gets no picker either", async () => {
  await mount("data-command-new-thread");
  expect(container.querySelector("button")).toBeNull();
  expect(rpc.call).not.toHaveBeenCalled();
});
test("a draft restored in Command's composer addresses its threads before anyone focuses it", async () => {
  view.text = "@b fix tests";
  container.setAttribute("data-command-space", "sp_restored");
  await mount(true);
  const threads = [
    { id: "thr_lead", title: "Lead", parentThreadId: null, status: "idle", updatedAt: 1, error: null, alias: "a" },
    { id: "thr_b", title: "Tests", parentThreadId: null, status: "idle", updatedAt: 1, error: null, alias: "b" },
  ];
  let seen: unknown = null;
  function To() { seen = draftRecipients(useCommandDraft("sp_restored"), threads); return null; }
  const other = document.createElement("div");
  const toRoot = createRoot(other);
  await act(async () => { toRoot.render(React.createElement(To)); });
  expect(document.activeElement).toBe(document.body);
  expect(seen).toEqual(["thr_b"]);
  // Another Space's view doesn't see it.
  await act(async () => { toRoot.render(React.createElement(function Elsewhere() { seen = draftRecipients(useCommandDraft("sp_other"), threads); return null; })); });
  expect(seen).toEqual([]);
  act(() => toRoot.unmount());
  view.text = "";
});
