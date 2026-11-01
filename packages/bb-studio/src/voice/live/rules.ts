// The eyes-free rules, enforced in the tool layer (tools.ts), not only in the
// voice's prompt: the model can ask for anything, and Studio decides.
//
// - Reads are free: what's waiting (loops), and threads' replies.
// - A send to the CoS or a thread is a draft until the user says yes out loud.
//   Studio checks the yes itself, in the user's own transcribed words heard
//   after the draft was read back; the model's word for it doesn't count.
// - Done and snooze run at once, with a spoken undo window.
// - Never by voice: spending, email or messages to people, posting, deleting,
//   approvals. Those aren't tools; a send that asks for one is still relayed
//   (as a request, after a yes) but marked so the target asks in its chat.

/** A draft send waits this long for a yes; then it's dropped. */
export const DRAFT_MS = 45_000;
/** Done and snooze can be undone for this long. */
export const UNDO_MS = 10_000;
/** The loop actions voice may take. Drop, hand off, choose and nudge aren't. */
export const VOICE_LOOP_ACTIONS = ["done", "snooze"] as const;
export const VOICE_SNOOZES = ["later_today", "tonight", "tomorrow_morning", "this_weekend"] as const;

const normal = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();

const YES = /^(yes|yeah|yea|yep|yup|ya|sure|correct|confirm|confirmed|affirmative|absolutely|definitely|ok|okay|send|send it|do it|go ahead|go for it|that's right|right|please do)\b/;
const NO = /\b(no|nope|nah|don't|do not|not|never|cancel|stop|wait|hold on|hang on|change|actually|scratch that|undo)\b/;
/** What the voice says when it reads a draft back; heard back in the mic it's an echo, not a yes. */
const ECHO = /\bsay yes\b|\bsay yes to send\b|\bto send\b.*\byes\b/;

export type Answer = "yes" | "no" | "unclear";

/**
 * Whether a user's line is a clear yes. Short and unhedged only: "yes",
 * "yeah send it", "go ahead". Anything with a no, a wait or a change in it is
 * a no; longer talk is unclear (the voice asks again).
 */
export function spokenAnswer(line: string): Answer {
  const text = normal(line);
  if (!text) return "unclear";
  if (ECHO.test(text)) return "unclear";
  if (NO.test(text)) return "no";
  if (YES.test(text) && text.split(" ").length <= 6) return "yes";
  return "unclear";
}

/** Whisper's well-known hallucinations on silence and road noise; never a yes or a request. */
const HALLUCINATIONS = /^(thank you|thanks for watching|thank you for watching|please subscribe|you|bye|\.|okay\.?)$/i;
export function hallucinated(line: string): boolean {
  return HALLUCINATIONS.test(line.trim());
}

const OUTWARD: [RegExp, string][] = [
  [/\b(buy|purchase|order|pay|payment|venmo|wire|transfer|refund|subscribe|checkout|spend|book (a|the)? ?(flight|hotel|table))\b|\$\d/i, "spending money"],
  [/\b(e-?mail|reply to|text|message|dm|slack|call)\b.*\b(him|her|them|dana|[a-z]+@|team|client|customer)\b|\bsend (an? )?(e-?mail|text|message)\b/i, "messaging people"],
  [/\b(post|tweet|publish|announce|share (it|this) (on|to)|go live|deploy|release|merge|push)\b/i, "posting or publishing"],
  [/\b(delete|remove|erase|wipe|archive|drop|cancel (the|my) (subscription|account|order))\b/i, "deleting"],
  [/\b(approve|approval|accept|sign off|grant|authori[sz]e|permission)\b/i, "approving"],
];

/** The never-by-voice kinds a request asks for, if any: the target must ask the user in its chat first. */
export function outwardKinds(message: string): string[] {
  return OUTWARD.filter(([pattern]) => pattern.test(message)).map(([, kind]) => kind);
}

/** The agent-only note on every relayed message. */
export function relayNote(kinds: readonly string[]): string {
  const base = "This came from the user's hands-free voice session; the user heard it read back and said yes out loud. Your final reply is read to them aloud, so end with a short plain summary of the outcome.";
  const rule = "Voice can't approve anything: don't spend money, email or message people, post or publish, delete anything or approve permissions on this message's word. If that's what it takes, ask the user here in the chat and wait.";
  return kinds.length ? `${base} ${rule} This request involves ${kinds.join(" and ")}: ask first.` : `${base} ${rule}`;
}

/** The read-back the voice says before a send. */
export function readBack(targetName: string, message: string): string {
  return `Send to ${targetName}: ${message.trim().replace(/\s+/g, " ")}. Say yes to send.`;
}
