import { describe, expect, it } from "vitest";
import { chipFor } from "./chip";

const ws = (id: string, folders: string[], extra: Partial<{ threadId: string | null; archived: boolean }> = {}) =>
  ({ id, title: id, folders, threadId: null, archived: false, ...extra });

describe("the thread header's VS Code chip", () => {
  it("opens the workspace made for the thread", () => {
    expect(chipFor({ threadId: "t1", threadPath: "/wt/t1", workspaces: [ws("a", ["/repo"]), ws("mine", ["/wt/t1"], { threadId: "t1" })], touched: null }))
      .toEqual({ workspaceId: "mine", title: "mine", working: false });
  });

  it("opens a workspace holding the thread's folder", () => {
    expect(chipFor({ threadId: "t1", threadPath: "/repo/sub", workspaces: [ws("repo", ["/repo"])], touched: null }))
      .toEqual({ workspaceId: "repo", title: "repo", working: false });
  });

  it("offers to open the worktree once the thread has edited files there", () => {
    expect(chipFor({ threadId: "t1", threadPath: "/wt/t1", workspaces: [], touched: { working: true } }))
      .toEqual({ workspaceId: null, title: "This thread's worktree", working: true });
  });

  it("stays hidden for a thread that hasn't touched code", () => {
    expect(chipFor({ threadId: "t1", threadPath: "/wt/t1", workspaces: [ws("other", ["/elsewhere"])], touched: null })).toBeNull();
    expect(chipFor({ threadId: "t1", threadPath: null, workspaces: [], touched: null })).toBeNull();
  });

  it("ignores archived workspaces", () => {
    expect(chipFor({ threadId: "t1", threadPath: "/wt/t1", workspaces: [ws("old", ["/wt/t1"], { threadId: "t1", archived: true })], touched: null })).toBeNull();
  });
});
