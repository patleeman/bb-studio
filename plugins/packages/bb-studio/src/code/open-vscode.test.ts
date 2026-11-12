// The launcher's VS Code row: beside the thread in view, else VS Code's nav panel.
import { expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({}));
vi.mock("../kit/app/index", () => ({}));
vi.mock("../ui/studio-open", () => ({ openFrom: vi.fn() }));

import { openVsCode, type OpenVsCodeDeps } from "./open-vscode";
import { landingPage } from "./vscode-panel";

const workspace = (id: string) => ({ id, title: `Folder ${id}`, folderKey: null });

function deps(over: Partial<OpenVsCodeDeps> & { forThread?: ReturnType<typeof workspace> | Error }) {
  const call = vi.fn(async () => {
    if (over.forThread instanceof Error || !over.forThread) throw over.forThread ?? new Error("no folder");
    return { workspace: over.forThread };
  });
  return { threadId: null, call, openTab: vi.fn(async () => true), show: vi.fn(), ...over };
}

it("opens VS Code beside the thread in view, on its folder", async () => {
  const d = deps({ threadId: "thr_1", forThread: workspace("cws_a") });
  expect(await openVsCode(d)).toBe("thread");
  expect(d.call).toHaveBeenCalledWith("code.forThread", { threadId: "thr_1" });
  expect(d.openTab).toHaveBeenCalledWith("thr_1", { actionId: "code", title: "VS Code" });
  expect(d.show).not.toHaveBeenCalled();
});

it("with no thread in view, or one VS Code can't open beside, shows VS Code's panel", async () => {
  const none = deps({});
  expect(await openVsCode(none)).toBe("panel");
  expect(none.show).toHaveBeenCalledWith("/plugins/studio/vscode");
  const noFolder = deps({ threadId: "thr_1" });
  expect(await openVsCode(noFolder)).toBe("panel");
  const declined = deps({ threadId: "thr_1", forThread: workspace("cws_a"), openTab: vi.fn(async () => false) });
  expect(await openVsCode(declined)).toBe("panel");
  expect(declined.show).toHaveBeenCalledWith("/plugins/studio/vscode");
});

it("the panel lands on the workspace used last, else the picker", async () => {
  expect(await landingPage(async () => ({ workspace: { id: "cws_b" } }))).toBe("cws_b");
  expect(await landingPage(async () => ({ workspace: null }))).toBe("choose");
  expect(await landingPage(async () => { throw new Error("offline"); })).toBe("choose");
});
