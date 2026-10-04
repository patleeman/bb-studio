import { describe, expect, it } from "vitest";
import { mentionContext } from "./mention";

describe("mentionContext", () => {
  it("gives the agent the task, its links and its thread's state", () => {
    const text = mentionContext(
      {
        id: "tsk_0123456789abcdef",
        title: "Write the [launch] post",
        description: "Aim for 500 words.",
        status: "in_progress",
        due: "2026-10-02",
        assignee: "agent",
        handoff: { state: "needs-input", note: null },
        links: ["Launch plan"],
      },
      new Date(2026, 9, 1, 12),
    );
    expect(text).toContain('Studio task "Write the [launch] post" (id tsk_0123456789abcdef): In progress, assigned to an agent, due Tomorrow (2026-10-02).');
    expect(text).toContain("[Write the launch post](/plugins/studio-tasks/tasks/tsk_0123456789abcdef)");
    expect(text).toContain("Linked: Launch plan");
    expect(text).toContain("Its thread: Agent needs your input");
  });
});
