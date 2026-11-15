import type { ExpoMessage } from "./apns.js";

// Mobile has its own copy of Studio's silent-output rule; notifications.test.ts
// checks they agree. See docs/silent-output.md.
const SILENT = /^[\s`*_~]*(?:\[pass\][\s`*_~]*)?$/iu;
const APPROVAL_CARD = /^(?:\s*::approval\{[^}\n]*\}\s*)+$/u;

/** A finished turn whose text is empty or exactly [PASS] has nothing to say: no push. */
export function isQuietCompletion(message: Pick<ExpoMessage, "body" | "data">): boolean {
  if (message.data?.kind !== "turn-finished") return false;
  const body = message.body ?? "";
  return SILENT.test(body) || APPROVAL_CARD.test(body);
}

/** Studio's cache keepalive starts with this (bb-studio src/bot-cache.ts). */
export const KEEPALIVE_MARKER = "[studio:cache-keepalive]";
/** Headers of text BB, Studio, an automation or another thread puts in a thread (bb-studio src/kit/relayed.ts). */
const RELAYED_HEADER = /^\s*\[(?:bb system|bb studio|bb automation due:[^\]\n]*|bb message from thread:[^\]\n]*)\]/u;

/**
 * What started a turn: the user, something relayed (another thread, BB,
 * Studio or an automation), Studio's cache keepalive, or no request at all
 * (the provider went on by itself, e.g. after a background task).
 */
export type TurnTrigger = "user" | "relayed" | "keepalive" | "continuation";

type RequestPart = { type?: string; text?: string; visibility?: string };
type Request = { initiator?: string; senderThreadId?: string | null; input?: RequestPart[]; pluginSubmission?: { data?: { kind?: string } } };

/** A turn's trigger, from its client/turn/requested data (null: the turn had no request). */
export function triggerOf(request: unknown): TurnTrigger {
  if (!request || typeof request !== "object") return "continuation";
  const data = request as Request;
  const parts = Array.isArray(data.input) ? data.input : [];
  if (data.pluginSubmission?.data?.kind === "cache-keepalive" || parts.some((part) => typeof part.text === "string" && part.text.trimStart().startsWith(KEEPALIVE_MARKER))) return "keepalive";
  if (data.initiator !== "user" || data.senderThreadId) return "relayed";
  const shown = parts.filter((part) => part.visibility !== "agent-only");
  if (shown.length === 0) return parts.length > 0 ? "relayed" : "user";
  const text = shown.find((part) => part.type === "text" && typeof part.text === "string")?.text ?? "";
  return RELAYED_HEADER.test(text) ? "relayed" : "user";
}

/** A final reply that says something to the user: not empty, not [PASS], not only an approval card. */
export function isUserFacingReply(text: string | null | undefined): boolean {
  return typeof text === "string" && !SILENT.test(text) && !APPROVAL_CARD.test(text);
}

/**
 * Whether BB's push for a finished turn reaches the phone. A keepalive never
 * does, nor a quiet pass; a turn that ended with no reply (BB's "Finished and
 * waiting for you") only when the user started it.
 */
export function turnPushAllowed(turn: { trigger: TurnTrigger; reply: string | null }): boolean {
  if (turn.trigger === "keepalive") return false;
  if (turn.reply === null) return turn.trigger === "user";
  return isUserFacingReply(turn.reply);
}
