import { describe, expect, it } from "vitest";
import { activityFrom, addedLines } from "./activity";

const completed = (item: Record<string, unknown>) => ({ type: "item/completed", data: { item } });
const started = (item: Record<string, unknown>) => ({ type: "item/started", data: { item } });

describe("what the agent is doing, from its events", () => {
  it("reads a file (Claude Code's Read)", () => {
    expect(activityFrom(started({ type: "fileRead", path: "/repo/src/a.ts" }), "/repo")).toEqual({ kind: "read", path: "/repo/src/a.ts" });
  });

  it("reads lines through the shell (Codex)", () => {
    expect(activityFrom(started({ type: "commandExecution", command: "/bin/zsh -lc \"sed -n '10,40p' src/retry.ts\"", cwd: "" }), "/repo"))
      .toEqual({ kind: "read", path: "/repo/src/retry.ts", startLine: 10, endLine: 40 });
    expect(activityFrom(started({ type: "commandExecution", command: "cat -n src/queue.ts", cwd: "/repo" }), null))
      .toEqual({ kind: "read", path: "/repo/src/queue.ts" });
    expect(activityFrom(started({ type: "commandExecution", command: "head -n 30 README.md", cwd: "" }), "/repo"))
      .toEqual({ kind: "read", path: "/repo/README.md", startLine: 1, endLine: 30 });
    expect(activityFrom(started({ type: "commandExecution", command: "nl -ba src/a.ts | sed -n '5,9p'", cwd: "" }), "/repo"))
      .toEqual({ kind: "read", path: "/repo/src/a.ts", startLine: 5, endLine: 9 });
  });

  it("ignores commands that aren't plain reads", () => {
    for (const command of ["rg --files", "git diff -- src/a.ts", "pnpm test", "sed -i 's/a/b/' src/a.ts", "cat a.ts > b.ts"])
      expect(activityFrom(started({ type: "commandExecution", command, cwd: "" }), "/repo"), command).toBeNull();
  });

  it("edits files, with the lines they added", () => {
    const diff = "--- a/repo/src/a.ts\n+++ b/repo/src/a.ts\n const x = 1;\n-const y = 2;\n+const y = 3;\n+const z = 4;\n";
    expect(activityFrom(completed({ type: "fileChange", changes: [{ path: "/repo/src/a.ts", kind: "update", diff }] }), "/repo"))
      .toEqual({ kind: "edit", path: "/repo/src/a.ts", added: ["const y = 3;", "const z = 4;"] });
  });

  it("knows when a turn starts and ends", () => {
    expect(activityFrom({ type: "turn/started", data: {} }, null)).toEqual({ kind: "turn", state: "working" });
    expect(activityFrom({ type: "turn/completed", data: {} }, null)).toEqual({ kind: "turn", state: "done" });
  });

  it("counts its live edits (code_edit), with the lines they type", () => {
    expect(activityFrom(completed({ type: "toolCall", tool: "code_edit", arguments: { path: "src/a.ts", edits: [{ oldText: "x", newText: "const y = 1;\nconst z = 2;" }] } }), "/repo"))
      .toEqual({ kind: "edit", path: "/repo/src/a.ts", added: ["const y = 1;", "const z = 2;"] });
    expect(activityFrom(started({ type: "toolCall", tool: "code_show", arguments: { path: "/repo/a.ts" } }), "/repo")).toBeNull();
  });
});

describe("added lines from a diff", () => {
  it("leaves out headers and removed lines", () => {
    expect(addedLines("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n context\n+++plus\n")).toEqual(["new", "++plus"]);
  });
});

describe("several files in one change", () => {
  it("reports each file", async () => {
    const { activitiesFrom } = await import("./activity");
    const event = completed({ type: "fileChange", changes: [{ path: "/repo/a.ts", kind: "update", diff: "+a" }, { path: "/repo/b.ts", kind: "add", diff: "+b" }, { path: "/repo/c.ts", kind: "delete", diff: "" }] });
    expect(activitiesFrom(event).map((each) => each.kind === "edit" && each.path)).toEqual(["/repo/a.ts", "/repo/b.ts"]);
  });
});

describe("compound commands (Codex reads several files at once)", () => {
  it("finds each read among commands joined by ; && ||", async () => {
    const { activitiesFrom } = await import("./activity");
    const event = started({ type: "commandExecution", command: "/bin/zsh -lc \"cat src/queue.ts src/retry.ts; rg -n 'markFailed' .\"", cwd: "/repo" });
    expect(activitiesFrom(event)).toEqual([
      { kind: "read", path: "/repo/src/queue.ts" },
      { kind: "read", path: "/repo/src/retry.ts" },
    ]);
    expect(activitiesFrom(started({ type: "commandExecution", command: "pwd && sed -n '3,9p' a.ts", cwd: "/repo" }))).toEqual([{ kind: "read", path: "/repo/a.ts", startLine: 3, endLine: 9 }]);
  });
});
