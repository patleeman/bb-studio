import { describe, expect, it } from "vitest";
import type { HandoffState, TaskStatus } from "../shared";
import { firstLine, nextHandoff, type ThreadSignal } from "./handoff";

const step = (state: HandoffState, status: TaskStatus, signal: ThreadSignal, latest = true, note: string | null = null) =>
  nextHandoff({ state, note }, { status }, latest, signal);

describe("handoff transitions", () => {
  it("follows a thread from working to replied, moving the task to Review", () => {
    expect(step("starting", "in_progress", { type: "active" })).toEqual({ state: "working", note: null, status: null });
    expect(step("working", "in_progress", { type: "idle", text: "## Done\nI wrote the post." })).toEqual({
      state: "replied",
      note: "Done",
      status: "review",
    });
  });

  it("moves a reviewed task back to In progress when the thread works again", () => {
    expect(step("replied", "review", { type: "active" }, true, "Done")).toEqual({ state: "working", note: null, status: "in_progress" });
  });

  it("keeps the agent's own ready note when its turn ends", () => {
    const ready = step("working", "in_progress", { type: "ready", note: "Drafted the post; see the page." });
    expect(ready).toEqual({ state: "ready", note: "Drafted the post; see the page.", status: "review" });
    expect(step("ready", "review", { type: "idle", text: "All set!" }, true, ready!.note)).toBeNull();
  });

  it("doesn't undo a manual Done or To do", () => {
    expect(step("working", "done", { type: "idle", text: "Finished" })).toEqual({ state: "replied", note: "Finished", status: null });
    expect(step("replied", "done", { type: "active" })).toEqual({ state: "working", note: null, status: null });
    expect(step("working", "todo", { type: "ready", note: "Ready" })).toEqual({ state: "ready", note: "Ready", status: null });
  });

  it("only lets the latest handoff move the task", () => {
    expect(step("working", "in_progress", { type: "idle", text: "Old thread" }, false)).toEqual({ state: "replied", note: "Old thread", status: null });
  });

  it("tracks questions until they're answered", () => {
    expect(step("working", "in_progress", { type: "needs-input" })).toEqual({ state: "needs-input", note: null, status: null });
    expect(step("needs-input", "in_progress", { type: "input-resolved" })).toEqual({ state: "working", note: null, status: null });
    expect(step("working", "in_progress", { type: "input-resolved" })).toBeNull();
  });

  it("records failures, archiving and deletion without moving the task", () => {
    expect(step("working", "in_progress", { type: "failed", error: "Out of credits" })).toEqual({ state: "failed", note: "Out of credits", status: null });
    expect(step("replied", "review", { type: "archived" }, true, "Done")).toEqual({ state: "archived", note: "Done", status: null });
    expect(step("archived", "review", { type: "unarchived" }, true, "Done")).toEqual({ state: "replied", note: "Done", status: null });
    expect(step("replied", "review", { type: "unarchived" })).toBeNull();
    expect(step("replied", "review", { type: "deleted" }, true, "Done")).toEqual({ state: "deleted", note: "Done", status: null });
  });

  it("returns null when nothing changes", () => {
    expect(step("working", "in_progress", { type: "active" })).toBeNull();
  });
});

describe("firstLine", () => {
  it("takes the first line with words, without Markdown", () => {
    expect(firstLine("\n\n> **Summary:** see [the page](https://x.test)\nmore")).toBe("Summary: see the page");
    expect(firstLine("- `code` item")).toBe("code item");
    expect(firstLine("   \n")).toBeNull();
    expect(firstLine(null)).toBeNull();
  });

  it("shortens long lines", () => {
    const line = firstLine("word ".repeat(100))!;
    expect(line.length).toBeLessThanOrEqual(160);
    expect(line.endsWith("…")).toBe(true);
  });
});
