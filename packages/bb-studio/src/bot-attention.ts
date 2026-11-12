// The one "needs you" signal in Studio's Bot UI (docs/needs-you/REDO.md):
// the Bot's own chat has something waiting on the user. The Bot is the triage
// layer: runner reports, urgent alerts, failures and its threads' questions go
// to the Bot, which handles them or brings them to the user in its chat. So
// the user's attention goes to one place, the Bot's row:
//
// - a pending question or approval in the Bot's chat, until it's answered;
// - a reply the Bot posted that the user hasn't read (its chat is the user's
//   inbox: it replies only when something changed or needs them, else
//   [PASS]), until they read the chat.

type Interaction = { id?: string; status?: string; payload?: { kind?: string } | null };

/** The pending interactions a thread waits on. */
export function pendingInteractions<T extends Interaction>(interactions: readonly T[]): T[] {
  return interactions.filter((interaction) => interaction.status === "pending");
}

/** What a thread with pending interactions waits for, in a few words. */
export function interactionReason(interactions: readonly Interaction[]): string {
  const kinds = new Set(pendingInteractions(interactions).map((interaction) => interaction.payload?.kind));
  if (kinds.has("approval")) return "Waiting for approval";
  if (kinds.has("user_question")) return "Asked you a question";
  return "Waiting for your answer";
}

/** A thread the Bot started that waits on an answer: what for. The Bot owns it, so it's no question for the user. */
export function threadWaitingFor(interactions: readonly Interaction[]): string {
  return pendingInteractions(interactions).some((interaction) => interaction.payload?.kind === "approval") ? "Waiting for approval" : "Waiting for an answer";
}

/** A Bot reply the user sees: not empty, not [PASS]. */
export function visibleReply(text: string): boolean {
  const trimmed = text.trim();
  return !!trimmed && trimmed !== "[PASS]";
}

export type BotAttention = { reason: string; count: number; since: number; unread: number };

/**
 * What waits on the user in the Bot's chat, or null when nothing does.
 * `replies` are the Bot's recent messages (agentMessage items) with when
 * they finished; `lastReadAt` is when the user last read the chat.
 */
export function botAttention(input: { loopsEnabled?: boolean; loops?: readonly {id:string;createdAt:number;source?:{kind:string;ref:string}|null}[]; lastReadAt: number | null | undefined; interactions: readonly (Interaction & { createdAt?: number })[]; replies: readonly { createdAt: number; text: string }[] }): BotAttention | null {
  const pending = pendingInteractions(input.interactions);
  const loops = (input.loopsEnabled ? input.loops ?? [] : []).filter(l=>!pending.some(p=>l.source?.kind==='interaction'&&l.source.ref===p.id));
  const unread = input.replies.filter((reply) => reply.createdAt > (input.lastReadAt ?? 0) && visibleReply(reply.text) && !loops.some(l=>reply.text.includes(`::loop{id="${l.id}"}`)));
  const count = pending.length + unread.length + loops.length;
  if (!count) return null;
  const since = Math.min(...[...loops.map(l=>l.createdAt), ...pending.map((each) => each.createdAt ?? Infinity), ...unread.map((each) => each.createdAt)].filter(Number.isFinite), Date.now());
  // A question says what it asks; anything else is just how many (UI text states facts).
  const reason = pending.length ? interactionReason(pending) : String(count);
  return { reason, count, since, unread: unread.length };
}
