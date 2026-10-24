// What "Needs you" means in a Bot's Activity: an open question or decision
// for the user, not "something raised attention once" (docs/needs-you/REDO.md).
//
// - A pending interaction (a question, an approval) stays until it's answered.
// - A runner's urgent report stays until the user reads its thread after the
//   report, replies there, or a later run of the runner finishes (it reported
//   log or tell, or ended [PASS], with no new urgent report).
// - An automation or thread Studio stopped resuming (a line in the Bot's chat)
//   stays until the user reads the Bot's chat after it.
// - Any of them leaves when the user marks it handled, until its signal
//   changes: a new question, a new urgent report, a new failure.
import { isUserRequest } from "./bot-cache";

/** How long a reason line's quoted words run before they're cut. */
const QUOTE_WORDS = 8;

/** The first few words of a report, for a one-line reason. */
export function firstWords(text: string, words = QUOTE_WORDS): string {
  const all = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  return all.length > words ? `${all.slice(0, words).join(" ")}…` : all.join(" ");
}

export type UrgentKind = "report" | "failed";

/** An urgent runner's reason line: what it reported, or that it failed. */
export function urgentReason(kind: UrgentKind | null, report: string | null): string {
  const words = report ? firstWords(report) : "";
  if (kind === "failed") return words ? `Failed: ${words}` : "Failed";
  return words ? `Urgent report: ${words}` : "Urgent report";
}

type Interaction = { id?: string; status?: string; payload?: { kind?: string } | null };

/** The pending interactions a thread waits on. */
export function pendingInteractions<T extends Interaction>(interactions: readonly T[]): T[] {
  return interactions.filter((interaction) => interaction.status === "pending");
}

/** A thread with pending interactions: what it waits for. */
export function interactionReason(interactions: readonly Interaction[]): string {
  const kinds = new Set(pendingInteractions(interactions).map((interaction) => interaction.payload?.kind));
  if (kinds.has("approval")) return "Waiting for approval";
  if (kinds.has("user_question")) return "Asked you a question";
  return "Waiting for your answer";
}

/** An alert line in the Bot's chat (Studio stopped resuming something). */
export function failedReason(count: number): string {
  return count === 1 ? "Failed" : `${count} failed`;
}

type EventRow = { seq?: number; type: string; createdAt?: number; data?: unknown };

/** A runner run's own prompt (src/runners.ts runnerPrompt), which may arrive as the user's. */
const RUN_PROMPT = /^Run of the runner /;

function userReply(data: unknown): boolean {
  if (!isUserRequest(data)) return false;
  const text = (data as { input?: { type?: string; text?: string }[] }).input?.find((part) => part.type === "text")?.text ?? "";
  return !RUN_PROMPT.test(text.trim());
}

export type UrgentSettled = "read" | "replied" | "later-run";

/**
 * Why an urgent runner report no longer needs the user, or null while it
 * does. `turn` is the sequence of the turn request that made the report (the
 * events after it are newer); without one, the report's time is the line.
 * `events` are the runner thread's client/turn/requested and turn/completed
 * events, in any order.
 */
export function urgentSettled(urgent: { at: number; turn: number | null }, thread: { lastReadAt?: number | null } | null, events: readonly EventRow[]): UrgentSettled | null {
  if (thread?.lastReadAt != null && thread.lastReadAt >= urgent.at) return "read";
  const after = (event: EventRow) => urgent.turn != null ? (event.seq ?? 0) > urgent.turn : (event.createdAt ?? 0) > urgent.at;
  const newer = events.filter(after).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (newer.some((event) => event.type === "client/turn/requested" && userReply(event.data))) return "replied";
  // A run that started after the report and finished: it had nothing urgent
  // (an urgent report would have moved `turn` past it).
  let started = false;
  for (const event of newer) {
    if (event.type === "client/turn/requested") started = true;
    else if (event.type === "turn/completed" && started) return "later-run";
  }
  return null;
}

/** An attention-only signal (no question waits): read after it, it's seen. */
export function readSince(thread: { lastReadAt?: number | null } | null | undefined, at: number): boolean {
  return thread?.lastReadAt != null && thread.lastReadAt >= at;
}
