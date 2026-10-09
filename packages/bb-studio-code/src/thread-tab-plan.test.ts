import { describe, expect, it } from "vitest";
import { needsWorktree, tabView } from "./thread-tab-plan";

describe("thread tab", () => {
  it("looks up the thread's worktree only when no workspace was named", () => {
    expect(needsWorktree("code_1")).toBe(false);
    expect(needsWorktree(null)).toBe(true);
  });
  it("shows the named workspace over the worktree", () => {
    expect(tabView({ openId: "code_1", worktreeId: "code_2", error: "" })).toEqual({ kind: "workspace", id: "code_1" });
    expect(tabView({ openId: null, worktreeId: "code_2", error: "" })).toEqual({ kind: "workspace", id: "code_2" });
  });
  it("shows the error when there is nothing to open", () => {
    expect(tabView({ openId: null, worktreeId: null, error: "No worktree." })).toEqual({ kind: "error", message: "No worktree." });
    expect(tabView({ openId: null, worktreeId: null, error: "" })).toEqual({ kind: "opening" });
  });
});
