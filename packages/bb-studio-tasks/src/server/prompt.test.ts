import { describe, expect, it } from "vitest";
import { handoffInput } from "./prompt";

const task = { id: "tsk_0123456789abcdef", title: "Write the launch post", description: "Aim for 500 words.", due: "2026-10-02" };

describe("handoffInput", () => {
  it("puts the task, its links as mentions, and the note in the first message", () => {
    const input = handoffInput(
      task,
      [
        { target: "item", plugin_id: "pages", item_id: "pg_1", label: "Launch  plan", href: "/plugins/pages/pages/pg_1" },
        { target: "thread", plugin_id: null, item_id: "thr_9", label: "Research", href: "/threads/thr_9" },
        { target: "item", plugin_id: "elsewhere", item_id: "x_1", label: "Board [v2]", href: "/plugins/elsewhere/x_1" },
      ],
      "Keep it upbeat.",
      new Date(2026, 9, 1, 12),
    );
    expect(input.type).toBe("text");
    expect(input.text).toContain('"Write the launch post"');
    expect(input.text).toContain("Aim for 500 words.");
    expect(input.text).toContain("Due: Tomorrow (2026-10-02)");
    expect(input.text).toContain("[Board v2](/plugins/elsewhere/x_1)");
    expect(input.text).toContain("Keep it upbeat.");
    expect(input.text).toContain("tasks_update");
    expect(input.text).toContain(task.id);
    expect(input.mentions.map((mention) => input.text.slice(mention.start, mention.end))).toEqual(["@Launch plan", "@Research"]);
    expect(input.mentions.map((mention) => mention.resource)).toEqual([
      { kind: "plugin", pluginId: "pages", itemId: "page:pg_1", label: "Launch plan" },
      { kind: "thread", threadId: "thr_9", label: "Research" },
    ]);
  });

  it("leaves out what the task doesn't have", () => {
    const input = handoffInput({ ...task, title: "", description: " ", due: null }, [], null);
    expect(input.text).toMatch(/^Work on this task from Studio Tasks: "Untitled"\n\nThis thread follows the task/);
    expect(input.mentions).toEqual([]);
  });
});
