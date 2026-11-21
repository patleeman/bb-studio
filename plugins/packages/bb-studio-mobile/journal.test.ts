import { describe, expect, it } from "vitest";
import { appendJournal, JOURNAL_MAX, journalEntry, journalSummary } from "./journal.js";

describe("journal entries", () => {
  it("keep the kind, ids and outcome, never the title, body or device", () => {
    const entry = journalEntry({ to: "apns:abc", title: "Secret plan", body: "Private", collapseId: "k", data: { kind: "turn-finished", threadId: "thr_w", conversationId: "thr_c", workerId: "thr_w" } }, "sent", 5, { category: "BB_REPLY", later: "window" });
    expect(entry).toEqual({ at: 5, kind: "turn-finished", outcome: "sent", threadId: "thr_w", conversationId: "thr_c", category: "BB_REPLY", keyed: true, later: "window" });
    expect(journalEntry({ to: "x", data: { awaySummary: 3 } }, "sent", 1).kind).toBe("away-summary");
  });

  it("keep only the newest entries", () => {
    const many = Array.from({ length: JOURNAL_MAX }, (_, at) => ({ at, kind: "k", outcome: "sent" as const }));
    const next = appendJournal(many, [{ at: JOURNAL_MAX, kind: "k", outcome: "quiet" }]);
    expect(next).toHaveLength(JOURNAL_MAX);
    expect(next.at(-1)!.outcome).toBe("quiet");
    expect(next[0]!.at).toBe(1);
  });

  it("sum up per hour", () => {
    const hourOf = (at: number) => (at < 100 ? "21:00" : "22:00");
    const summary = journalSummary([
      { at: 1, kind: "turn-finished", outcome: "sent" },
      { at: 2, kind: "turn-finished", outcome: "quiet" },
      { at: 150, kind: "needs-you", outcome: "sent", later: "desk" },
      { at: 160, kind: "needs-you", outcome: "desk" },
    ], 0, hourOf);
    expect(summary).toEqual([
      { hour: "21:00", outcomes: { sent: 1, quiet: 1 }, sent: { "turn-finished": 1 } },
      { hour: "22:00", outcomes: { sent: 1, desk: 1 }, sent: { "needs-you (desk)": 1 } },
    ]);
  });
});
