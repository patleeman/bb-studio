import { describe, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => null, useBbNavigate: () => null }));
vi.mock("../kit/app/index", () => ({ BAR_BUTTON: "", Icon: () => null }));
vi.mock("../kit/format", () => ({ errorMessage: String }));

describe("opening a file with VS Code as the default", () => {
  it("goes straight to the thread's VS Code for files in the thread's folder or on its host", async () => {
    const { shouldAutoOpen } = await import("./file-opener");
    expect(shouldAutoOpen({ kind: "workspace", threadId: "thr_1" })).toBe(true);
    expect(shouldAutoOpen({ kind: "host", threadId: "thr_1" })).toBe(true);
  });

  it("stays on BB's preview with no thread, or for thread storage", async () => {
    const { shouldAutoOpen } = await import("./file-opener");
    expect(shouldAutoOpen({ kind: "workspace", threadId: null })).toBe(false);
    expect(shouldAutoOpen({ kind: "host", threadId: null })).toBe(false);
    expect(shouldAutoOpen({ kind: "thread-storage", threadId: "thr_1" })).toBe(false);
  });
});

describe("one trip to VS Code per open", () => {
  it("sends a click once, not again when the file tab remounts, and again for a new click", async () => {
    const { claimOpen } = await import("./file-opener");
    const first = { startLineNumber: 7, endLineNumber: 12 };
    expect(claimOpen("thr_a", "src/x.ts", first)).toBe(true);
    expect(claimOpen("thr_a", "src/x.ts", first)).toBe(false);
    expect(claimOpen("thr_a", "src/x.ts", { startLineNumber: 7, endLineNumber: 12 })).toBe(true);
    expect(claimOpen("thr_b", "src/x.ts", null)).toBe(true);
    expect(claimOpen("thr_b", "src/x.ts", null)).toBe(false);
  });
});

describe("which tab shows a workspace", () => {
  it("builds a folder's params with one key, the worktree before the project, so BB sees one tab per folder", async () => {
    const { codeTabParams, parseCodeTabParams, tabParamsOfKey, folderKey, codeTabIcon } = await import("./shared");
    expect(JSON.stringify(codeTabParams({ projectId: "proj_1", environmentId: "env_1" }))).toBe('{"environmentId":"env_1"}');
    expect(JSON.stringify(codeTabParams({ environmentId: null, projectId: "proj_1" }))).toBe('{"projectId":"proj_1"}');
    expect(codeTabParams({})).toBeNull();
    // Whatever order BB hands them back in, the same instance comes out.
    expect(JSON.stringify(parseCodeTabParams({ title: "x", projectId: "proj_1", environmentId: "env_1" }))).toBe('{"environmentId":"env_1"}');
    expect(parseCodeTabParams(null)).toBeNull();
    expect(parseCodeTabParams({ environmentId: 7 })).toBeNull();
    expect(JSON.stringify(tabParamsOfKey(folderKey({ environmentId: "env_1" })))).toBe('{"environmentId":"env_1"}');
    expect(JSON.stringify(tabParamsOfKey("project:proj_1"))).toBe('{"projectId":"proj_1"}');
    expect(tabParamsOfKey(null)).toBeNull();
    expect([codeTabIcon({ environmentId: "env_1" }), codeTabIcon({ projectId: "proj_1" }), codeTabIcon(null)]).toEqual(["GitBranch", "Folder", null]);
  });

  it("is the folder's Global tab, named for it, where BB has those; else the thread's own tab", async () => {
    const { codeTabFor } = await import("./file-opener");
    const workspace = { folderKey: "env:env_1", title: "fix-retry" };
    expect(codeTabFor(workspace, true)).toEqual({ actionId: "code", title: "fix-retry", params: { environmentId: "env_1" }, global: true });
    expect(codeTabFor(workspace, false)).toEqual({ actionId: "code", title: "VS Code" });
    // A workspace from before folders has no tab of its own.
    expect(codeTabFor({ folderKey: null, title: "Old" }, true)).toEqual({ actionId: "code", title: "VS Code" });
  });

  it("hands the thread's own tab over to the folder's, only while that tab is in front", async () => {
    const { moveToFolderTab } = await import("./thread-tab");
    const own = { key: "t1", detail: { kind: "plugin", tab: { id: "code" }, params: null } };
    const panel = (selected: unknown) => ({ openTab: vi.fn(() => true), closeTab: vi.fn(() => true), getTabs: () => ({ open: true, selectedKey: "t1", tabs: [selected] }) }) as never as Parameters<typeof moveToFolderTab>[0] & { openTab: ReturnType<typeof vi.fn>; closeTab: ReturnType<typeof vi.fn> };
    const workspace = { folderKey: "project:proj_1", title: "Studio" };
    const front = panel(own);
    expect(moveToFolderTab(front, workspace, true)).toBe(true);
    expect(front.openTab).toHaveBeenCalledWith({ tab: { id: "code", context: { kind: "thread" }, availability: "action" }, title: "Studio", params: { projectId: "proj_1" }, experimental_global: true });
    expect(front.closeTab).toHaveBeenCalledWith("t1");
    // Another tab is in front, or BB has no Global tabs: this tab shows the editor itself.
    const away = panel({ key: "t1", detail: { kind: "file", path: "a.ts" } });
    expect(moveToFolderTab(away, workspace, true)).toBe(false);
    expect(away.openTab).not.toHaveBeenCalled();
    expect(moveToFolderTab(panel(own), workspace, false)).toBe(false);
  });
});

describe("BB asks the opener before it opens a file tab", () => {
  const deps = () => {
    const calls: [string, unknown][] = [];
    const call = vi.fn(async (method: string, input: unknown) => { calls.push([method, input]); return method === "code.forThread" ? { workspace: { id: "cws_1", folderKey: "env:env_1", title: "fix-retry" } } : { shown: true }; });
    const openTab = vi.fn(async (_threadId: string, _open: unknown) => true);
    return { calls, call: call as never, openTab };
  };

  it("shows the file in the folder's VS Code at the line, opens that tab, and answers true", async () => {
    const { handleOpen, hostAsksFirst } = await import("./file-opener");
    const x = deps();
    // The diff's "Open in editor" passes the first changed line.
    expect(await handleOpen({ path: "src/retry.ts", source: { kind: "workspace", threadId: "thr_1" }, lineRange: { startLineNumber: 42, endLineNumber: 42 } }, x)).toBe(true);
    expect(x.calls).toEqual([
      ["code.forThread", { threadId: "thr_1" }],
      ["code.reveal", { id: "cws_1", path: "src/retry.ts", startLine: 42, endLine: 42 }],
    ]);
    expect(x.openTab).toHaveBeenCalledWith("thr_1", { actionId: "code", title: "VS Code" });
    expect(hostAsksFirst()).toBe(true);
    // With no lines asked for, the file opens at its top.
    await handleOpen({ path: "a.ts", source: { kind: "host", threadId: "thr_1" }, lineRange: null }, x);
    expect(x.calls.at(-1)).toEqual(["code.reveal", { id: "cws_1", path: "a.ts", startLine: 1, endLine: 1 }]);
  });

  it("leaves BB to open its own tab for files VS Code can't take, and when the tab can't open", async () => {
    const { handleOpen } = await import("./file-opener");
    const x = deps();
    expect(await handleOpen({ path: "notes.txt", source: { kind: "thread-storage", threadId: "thr_1" }, lineRange: null }, x)).toBe(false);
    expect(await handleOpen({ path: "a.ts", source: { kind: "workspace", threadId: null }, lineRange: null }, x)).toBe(false);
    expect(x.calls).toEqual([]);
    x.openTab.mockResolvedValueOnce(false);
    await expect(handleOpen({ path: "a.ts", source: { kind: "workspace", threadId: "thr_1" }, lineRange: null }, x)).rejects.toThrow("no side panel");
  });

  it("steps aside for the one open the editor asked BB's preview for", async () => {
    const { handleOpen } = await import("./file-opener");
    const { showBbPreview, wantsBbPreview } = await import("./bb-preview");
    const x = deps();
    showBbPreview("src/shown.ts", 1000);
    expect(wantsBbPreview("/repo/src/shown.ts", 2000)).toBe(true);
    expect(wantsBbPreview("src/other.ts", 2000)).toBe(false);
    expect(wantsBbPreview("src/shown.ts", 7000)).toBe(false);
    showBbPreview("src/shown.ts");
    expect(await handleOpen({ path: "src/shown.ts", source: { kind: "workspace", threadId: "thr_1" }, lineRange: null }, x)).toBe(false);
    expect(x.calls).toEqual([]);
  });

  it("registers the handler on the VS Code opener, beside the tab BB falls back to", async () => {
    const { HANDLE_OPEN, handleOpen, VsCodeFileOpener } = await import("./file-opener");
    expect(HANDLE_OPEN).toEqual({ experimental_handleOpen: handleOpen });
    expect(typeof VsCodeFileOpener).toBe("function");
  });
});
