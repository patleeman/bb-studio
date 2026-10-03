import { expect, it } from "vitest";
import { officeTask } from "./task";

it.each([
  ["needs-input", "in_progress", "waiting"], ["failed", "review", "waiting"],
  ["ready", "in_progress", "review"], ["replied", "in_progress", "review"],
  ["working", "in_progress", "working"], ["failed", "done", "done"],
])("projects handoff %s and task %s as %s", (state, status, expected) => {
  expect(officeTask({ id: "task", title: "Work", description: "", status, statusLabel: "Doing", projectId: "project", assignee: "bot:helper", archived: false, updatedAt: 1, recurrence: "daily", handoff: { threadId: "thread", state, note: "Progress" } })).toMatchObject({ status: expected, botId: "helper", note: "Progress", recurring: "daily" });
});
