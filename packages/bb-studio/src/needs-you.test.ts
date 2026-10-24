import { expect, it } from "vitest";
import { failedReason, firstWords, interactionReason, readSince, urgentReason, urgentSettled } from "./needs-you";

it("says why in one short line", () => {
  expect(firstWords("  The   payment\nfailed ")).toBe("The payment failed");
  expect(firstWords("one two three four five six seven eight nine ten")).toBe("one two three four five six seven eight…");
  expect(urgentReason("report", "Port 22 is open on red4")).toBe("Urgent report: Port 22 is open on red4");
  expect(urgentReason("failed", "Inbox stopped after failing")).toBe("Failed: Inbox stopped after failing");
  expect(urgentReason(null, null)).toBe("Urgent report");
  expect(interactionReason([{ status: "pending", payload: { kind: "user_question" } }])).toBe("Asked you a question");
  expect(interactionReason([{ status: "pending", payload: { kind: "user_question" } }, { status: "pending", payload: { kind: "approval" } }])).toBe("Waiting for approval");
  expect(interactionReason([{ status: "pending", payload: { kind: "plugin" } }])).toBe("Waiting for your answer");
  expect(failedReason(1)).toBe("Failed");
  expect(failedReason(3)).toBe("3 failed");
});

it("settles an urgent report: read after it, a reply, or a later run that finished", () => {
  const urgent = { at: 1000, turn: 5 };
  const user = { initiator: "user", input: [{ type: "text", text: "Done." }] };
  const run = { initiator: "user", input: [{ type: "text", text: "Run of the runner \"Security\". Your job: …" }] };
  expect(urgentSettled(urgent, { lastReadAt: 999 }, [])).toBeNull();
  expect(urgentSettled(urgent, { lastReadAt: 1000 }, [])).toBe("read");
  // The urgent run's own completion, after the report, isn't a later run.
  expect(urgentSettled(urgent, null, [{ seq: 5, type: "client/turn/requested", data: run }, { seq: 7, type: "turn/completed" }])).toBeNull();
  expect(urgentSettled(urgent, null, [{ seq: 8, type: "client/turn/requested", data: user }])).toBe("replied");
  expect(urgentSettled(urgent, null, [{ seq: 8, type: "client/turn/requested", data: run }])).toBeNull();
  expect(urgentSettled(urgent, null, [{ seq: 9, type: "turn/completed" }, { seq: 8, type: "client/turn/requested", data: run }])).toBe("later-run");
  // An agent-only notice in the thread isn't the user.
  expect(urgentSettled(urgent, null, [{ seq: 8, type: "client/turn/requested", data: { initiator: "user", input: [{ type: "text", text: "note", visibility: "agent-only" }] } }])).toBeNull();
  // Without the report's turn, its time is the line.
  expect(urgentSettled({ at: 1000, turn: null }, null, [{ seq: 1, createdAt: 900, type: "client/turn/requested", data: user }])).toBeNull();
  expect(urgentSettled({ at: 1000, turn: null }, null, [{ seq: 2, createdAt: 1100, type: "client/turn/requested", data: user }])).toBe("replied");
  expect(readSince({ lastReadAt: 5 }, 5)).toBe(true);
  expect(readSince({ lastReadAt: null }, 5)).toBe(false);
});
