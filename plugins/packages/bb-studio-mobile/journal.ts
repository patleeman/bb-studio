// A short record of what the relay did with each push, so "what reached the
// phone?" has an answer: when, what kind, which thread, and what happened to
// it. No titles, bodies or device tokens. `bb mobile deliveries` reads it.
import type { ExpoMessage } from "./apns.js";

export const JOURNAL_KEY = "delivery-journal";
export const JOURNAL_MAX = 1000;

/** sent: went to APNs or Expo. quiet: a pass or a turn nobody needs. muted: a phone mute. desk: held while at the desk. window: folded into the conversation's next push. error: delivery failed. */
export type JournalOutcome = "sent" | "quiet" | "muted" | "desk" | "window" | "error";

export type JournalEntry = {
  at: number;
  kind: string;
  outcome: JournalOutcome;
  threadId?: string;
  conversationId?: string;
  workerId?: string;
  category?: string;
  /** Pushes that replace each other on the phone. */
  keyed?: boolean;
  /** Sent by the desk hold's release or a window's end, not when it came in. */
  later?: "desk" | "window";
};

const id = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

export function journalEntry(message: ExpoMessage, outcome: JournalOutcome, at: number, extra: { category?: string; later?: "desk" | "window" } = {}): JournalEntry {
  const data = message.data ?? {};
  const entry: JournalEntry = { at, kind: typeof data.kind === "string" ? data.kind : data.awaySummary !== undefined ? "away-summary" : "other", outcome };
  const threadId = id(data.threadId);
  const conversationId = id(data.conversationId);
  const workerId = id(data.workerId);
  if (threadId) entry.threadId = threadId;
  if (conversationId && conversationId !== threadId) entry.conversationId = conversationId;
  if (workerId && workerId !== threadId) entry.workerId = workerId;
  if (extra.category) entry.category = extra.category;
  if (message.collapseId !== undefined) entry.keyed = true;
  if (extra.later) entry.later = extra.later;
  return entry;
}

export function appendJournal(journal: readonly JournalEntry[], entries: readonly JournalEntry[]): JournalEntry[] {
  const next = [...journal, ...entries];
  return next.length > JOURNAL_MAX ? next.slice(next.length - JOURNAL_MAX) : next;
}

/** Per hour (local time of the host), how many pushes had each outcome, and the sent ones by kind. */
export function journalSummary(journal: readonly JournalEntry[], since: number, hourOf: (at: number) => string): { hour: string; outcomes: Partial<Record<JournalOutcome, number>>; sent: Record<string, number> }[] {
  const hours = new Map<string, { outcomes: Partial<Record<JournalOutcome, number>>; sent: Record<string, number> }>();
  for (const entry of journal) {
    if (entry.at < since) continue;
    const hour = hourOf(entry.at);
    const row = hours.get(hour) ?? { outcomes: {}, sent: {} };
    row.outcomes[entry.outcome] = (row.outcomes[entry.outcome] ?? 0) + 1;
    if (entry.outcome === "sent") {
      const kind = entry.later ? `${entry.kind} (${entry.later})` : entry.kind;
      row.sent[kind] = (row.sent[kind] ?? 0) + 1;
    }
    hours.set(hour, row);
  }
  return [...hours].map(([hour, row]) => ({ hour, ...row }));
}
