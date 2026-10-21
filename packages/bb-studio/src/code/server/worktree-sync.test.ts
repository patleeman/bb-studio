import { describe, expect, it } from "vitest";
import { followWorktree, missingWorktreeMessage } from "./worktree-sync";

describe("following a moved worktree", () => {
  it("keeps folders that already hold the worktree", () => {
    expect(followWorktree(["/w/a"], "/w/a/")).toEqual(["/w/a"]);
  });
  it("moves a single-folder workspace to the new path", () => {
    expect(followWorktree(["/w/old"], "/w/new")).toEqual(["/w/new"]);
  });
  it("adds the worktree to a workspace with other folders", () => {
    expect(followWorktree(["/w/old", "/w/lib"], "/w/new")).toEqual(["/w/old", "/w/lib", "/w/new"]);
  });
  it("says the worktree is gone", () => {
    expect(missingWorktreeMessage("/w/x")).toMatch(/gone/);
  });
});
