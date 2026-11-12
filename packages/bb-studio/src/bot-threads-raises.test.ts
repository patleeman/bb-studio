import { expect, it } from "vitest";
import { conversationWorkers, staleRaises, type BotThreadRecord, type ThreadFacts } from "./bot-threads";

const NOW = 1_800_000_000_000;
const rec = (over: Partial<BotThreadRecord>): BotThreadRecord => ({
  threadId: "t", botId: "bot", kind: "conversation", isMain: false, title: null, forkedFrom: null, ownerConversationId: null, archivedAt: null,
  finishedSummary: null, needsYou: null, latest: null, activityAt: null, createdAt: NOW - 60_000, source: "created",
  ...over,
} as BotThreadRecord);

it("clears a worker's mark on its conversation once BB says the worker no longer waits, and only then", () => {
  const records = [
    rec({ threadId: "conv", needsYou: { reason: "Approve: git push", at: NOW - 60_000, source: "w_lead" } }),
    rec({ threadId: "main", isMain: true, needsYou: { reason: "Approve: rm", at: NOW - 60_000, source: "w_codex" } }),
    rec({ threadId: "talk", needsYou: { reason: "Pick a date", at: NOW - 60_000, source: "user" } }),
    rec({ threadId: "w_lead", kind: "worker", ownerConversationId: "conv" }),
    rec({ threadId: "w_codex", kind: "worker", ownerConversationId: "main" }),
  ];
  const threads = new Map<string, ThreadFacts>([["w_lead", { id: "w_lead", hasPendingInteraction: false }], ["w_codex", { id: "w_codex", hasPendingInteraction: true }]]);
  expect(staleRaises(records, threads, NOW)).toEqual(["w_lead"]);
  // A read from just around the mark isn't believed: the approval may have arrived after it.
  expect(staleRaises(records.map((each) => each.needsYou ? { ...each, needsYou: { ...each.needsYou, at: NOW - 1_000 } } : each), threads, NOW)).toEqual([]);
  // Unknown to BB's list: nothing is cleared.
  expect(staleRaises(records, new Map(), NOW)).toEqual([]);
});

it("the line above a conversation's composer lists the workers the sidebar would, the ones that need attention first", () => {
  const day = 24 * 60 * 60_000;
  const workers = [
    rec({ threadId: "old", kind: "worker", activityAt: NOW - 5 * day }),
    rec({ threadId: "done", kind: "worker", activityAt: NOW - 60_000 }),
    rec({ threadId: "run", kind: "worker", activityAt: NOW - 3 * day }),
    rec({ threadId: "ask", kind: "worker", activityAt: NOW - 10 * day }),
  ];
  const threads = new Map<string, ThreadFacts>([["run", { id: "run", status: "active" }], ["ask", { id: "ask", status: "active", hasPendingInteraction: true }], ["done", { id: "done", status: "idle" }], ["old", { id: "old", status: "idle" }]]);
  expect(conversationWorkers(workers, threads, NOW).map((row) => [row.threadId, row.status])).toEqual([["ask", "needs-you"], ["run", "running"], ["done", "done"]]);
});
