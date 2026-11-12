// The eyes-free rules, enforced in the tool layer (live.ts), not only in the
// voice's prompt: the model can ask for anything, and Studio decides
// (classify below).
//
// - Reads are free: what's waiting (todos), and threads' replies.
// - Acts at once, said briefly: relays to the CoS or a thread ("Sent to the
//   Larkspur lead."), and todo actions (done, snooze, add, hand off), with a
//   spoken 10 s undo on the todo actions.
// - Needs a spoken yes, which Studio checks itself in the user's own
//   transcribed words after the question (the model's word doesn't count):
//   only what's destructive or hard to undo. Dropping a todo, stopping or
//   archiving a thread, pausing or deleting an automation.
// - Never by voice: spending money, email or messages to people outside BB,
//   posting publicly, approving credentials. Those aren't tools; a relay that
//   asks for one is still sent, but marked so the target asks in its chat.
import { voiceToolName, type RelayIntent } from "./shared";

/** A destructive action waits this long for a yes; then it's dropped. */
export const DRAFT_MS = 45_000;
/** Todo actions can be undone for this long. */
export const UNDO_MS = 10_000;
/** Todo actions that run at once (with undo). */
export const VOICE_LOOP_ACTIONS = ["done", "snooze", "hand_off"] as const;
/** Todo actions that need a spoken yes. Choose, nudge and keep aren't voice actions. */
export const CONFIRM_LOOP_ACTIONS = ["drop"] as const;

/** What a tool call is, by the eyes-free rules. */
export type ToolClass = "read" | "act" | "confirm" | "unknown";

/** Destructive or hard to undo: each needs the user's spoken yes. */
export const DESTRUCTIVE_TOOLS = ["stop_thread", "archive_thread", "pause_automation", "delete_automation"] as const;
export type DestructiveAction = "drop_loop" | (typeof DESTRUCTIVE_TOOLS)[number];

/** Classifies a tool call. `confirm` and `cancel` answer a pending one. */
export function classify(name: string, args: Record<string, unknown> = {}): ToolClass {
  const tool = voiceToolName(name);
  if (tool === "todos_list" || tool === "read_replies") return "read";
  if (tool === "send_to_cos" || tool === "send_to_thread" || tool === "todos_add" || tool === "undo" || tool === "confirm" || tool === "cancel") return "act";
  if (tool === "todos_act") {
    const action = String(args.action ?? "");
    if ((CONFIRM_LOOP_ACTIONS as readonly string[]).includes(action)) return "confirm";
    return (VOICE_LOOP_ACTIONS as readonly string[]).includes(action) ? "act" : "unknown";
  }
  return (DESTRUCTIVE_TOOLS as readonly string[]).includes(tool) ? "confirm" : "unknown";
}

/** The question the voice asks before a destructive action. */
export function confirmPrompt(action: DestructiveAction, name: string): string {
  switch (action) {
    case "drop_loop": return `Drop the todo '${name}'? Say yes to drop.`;
    case "stop_thread": return `Stop the thread '${name}'? Say yes to stop.`;
    case "archive_thread": return `Archive the thread '${name}'? Say yes to archive.`;
    case "pause_automation": return `Pause the automation '${name}'? Say yes to pause.`;
    case "delete_automation": return `Delete the automation '${name}'? It can't be undone. Say yes to delete.`;
  }
}
export const VOICE_SNOOZES = ["later_today", "tonight", "tomorrow_morning", "this_weekend"] as const;

const normal = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();

const YES = /^(yes|yeah|yea|yep|yup|ya|sure|correct|confirm|confirmed|affirmative|absolutely|definitely|ok|okay|send|send it|do it|go ahead|go for it|that's right|right|please do)\b/;
// Not "stop": "yes, stop it" answers "Stop the thread?". A bare "stop" stays unclear, so still not a yes.
const NO = /\b(no|nope|nah|don't|do not|not|never|cancel|wait|hold on|hang on|change|actually|scratch that|undo)\b/;
/** The voice's own question, heard back in the mic: an echo, not a yes. */
const ECHO = /\bsay yes\b|\byes to (send|drop|stop|archive|pause|delete)\b/;

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
  [/\b(e-?mail|reply to|text|message|dm|call)\b.*\b(him|her|them|dana|[a-z]+@|client|customer|vendor|landlord)\b|\bsend (an? )?(e-?mail|text)\b/i, "messaging people outside BB"],
  [/\b(tweet|post (it |this )?(publicly|on|to)|publish|announce|share (it|this) (on|to|publicly))\b/i, "posting publicly"],
  [/\b(approve|grant|authori[sz]e|share|accept)\b.*\b(credentials?|passwords?|tokens?|api keys?|keys|logins?|access|permissions?)\b/i, "approving credentials"],
];

/** The never-by-voice kinds a request asks for, if any: the target must ask the user in its chat first. */
export function outwardKinds(message: string): string[] {
  return OUTWARD.filter(([pattern]) => pattern.test(message)).map(([, kind]) => kind);
}

/** The agent-only note on every relayed message. */
export function relayNote(kinds: readonly string[], intent: RelayIntent = "answer"): string {
  const base = intent === "answer" ? "The user is on hands-free voice and will hear your reply read aloud. Answer the question fully, in plain speakable sentences, with no markdown, tables, links or code. Lead with the answer." : "This came from the user's hands-free voice session; it was sent at once, without a read-back. Your final reply is read to them aloud, so end with a short plain summary of the outcome.";
  const rule = "Voice can't approve these: don't spend money, email or message people outside BB, post publicly or approve credentials on this message's word. If that's what it takes, ask the user here in the chat and wait.";
  return kinds.length ? `${base} ${rule} This request involves ${kinds.join(" and ")}: ask first.` : `${base} ${rule}`;
}

/** A message as relayed: one line, without the model's trailing period ("…until Monday."). */
export function relayText(message: string): string {
  return message.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
}
