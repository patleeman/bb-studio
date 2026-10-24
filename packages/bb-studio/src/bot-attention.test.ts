import { expect, it } from "vitest";
import { botAttention, interactionReason, threadWaitingFor, visibleReply } from "./bot-attention";

const question = { id: "q", status: "pending", payload: { kind: "user_question" }, createdAt: 50 };
const approval = { id: "a", status: "pending", payload: { kind: "approval" }, createdAt: 60 };

it("says why the Bot needs you, in a few words", () => {
  expect(botAttention({ lastReadAt: 100, interactions: [], replies: [] })).toBeNull();
  expect(botAttention({ lastReadAt: 100, interactions: [question], replies: [] })).toEqual({ reason: "Asked you a question", count: 1, since: 50 });
  expect(botAttention({ lastReadAt: 100, interactions: [question, approval], replies: [] })?.reason).toBe("Waiting for approval");
  expect(botAttention({ lastReadAt: 100, interactions: [{ ...question, status: "resolved" }], replies: [] })).toBeNull();
  expect(botAttention({ lastReadAt: 100, interactions: [], replies: [{ createdAt: 120, text: "Staging is down. Roll back?" }] })).toEqual({ reason: "1 thing for you", count: 1, since: 120 });
  expect(botAttention({ lastReadAt: 100, interactions: [], replies: [{ createdAt: 120, text: "One" }, { createdAt: 130, text: "Two" }] })?.reason).toBe("2 things for you");
});

it("counts only replies the user sees and hasn't read", () => {
  const replies = [{ createdAt: 90, text: "Read already" }, { createdAt: 110, text: " [PASS] " }, { createdAt: 120, text: "" }];
  expect(botAttention({ lastReadAt: 100, interactions: [], replies })).toBeNull();
  expect(botAttention({ lastReadAt: null, interactions: [], replies })?.count).toBe(1);
  expect(visibleReply("[PASS]")).toBe(false);
  expect(visibleReply("Done.")).toBe(true);
});

it("a thread the Bot started says what it's waiting for, not that it needs you", () => {
  expect(threadWaitingFor([question])).toBe("Waiting for an answer");
  expect(threadWaitingFor([approval])).toBe("Waiting for approval");
  expect(interactionReason([{ status: "pending", payload: { kind: "plugin" } }])).toBe("Waiting for your answer");
});
