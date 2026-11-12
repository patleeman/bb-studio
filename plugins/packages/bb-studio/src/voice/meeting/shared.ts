// Meeting mode's names the client and server share; no SDK imports.
//
// A meeting agent is a gpt-live-1 session that sits in an in-person meeting
// as a participant with a name (Iris by default). The laptop's mic hears the
// room and its speakers are Iris's voice; the screen is the room's view of
// her (captions, lookups, notes), sized to read from across the table.
// Most of what the room says isn't for her, so she speaks only when she's
// addressed (addressing below), and Studio holds her audio back otherwise.

/** Studio publishes `MeetingSignal` here: a lookup answered, or the meeting ended. */
export const MEETING_CHANNEL = "studio-meeting";
export interface MeetingSignal { sessionId: string; kind: "reply" | "ended" }

export const DEFAULT_AGENT_NAME = "Iris";

/**
 * When she may speak.
 * - "name": someone says her name; then follow-ups count for a short window
 *   after she last spoke, without the name.
 * - "judge": as "name", and she also decides for herself when the room
 *   clearly wants her without saying her name ("can someone look that up?").
 * Either way the room's Quiet switch silences her completely.
 */
export const ADDRESSING = ["name", "judge"] as const;
export type Addressing = (typeof ADDRESSING)[number];
export const DEFAULT_ADDRESSING: Addressing = "name";

/** How long after her name (or her last words) a follow-up still counts, in seconds. */
export const FOLLOW_UP_SECONDS = 25;

export const MEETING_TOOLS = ["look_up", "take_note", "read_lookups"] as const;
export type MeetingToolName = (typeof MEETING_TOOLS)[number];

export const NOTE_KINDS = ["note", "decision", "action"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** Folds a name or a line to lower-case letters and single spaces, for matching. */
const fold = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Whether a line says her name. Whole words only ("Irises" or "Osiris" don't
 * count), with the possessive and common mishearings of the default name.
 */
export function saysName(line: string, name: string): boolean {
  const target = fold(name);
  if (!target) return false;
  const heard = ` ${fold(line).replace(/\b(\w+) s\b/g, "$1")} `;
  const variants = new Set([target]);
  // Speech-to-text hears "Iris" as these often enough to matter.
  if (target === "iris") for (const each of ["irus", "iras", "irish", "eyris", "i ris"]) variants.add(each);
  return [...variants].some((variant) => heard.includes(` ${variant} `));
}

/** "Iris", trimmed to something sayable; the default when empty. */
export function agentName(value: unknown): string {
  const name = typeof value === "string" ? value.replace(/[^\p{L}\p{N} '\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24) : "";
  return name || DEFAULT_AGENT_NAME;
}

export function addressing(value: unknown): Addressing {
  return (ADDRESSING as readonly string[]).includes(String(value)) ? (value as Addressing) : DEFAULT_ADDRESSING;
}

/** The note the client adds when a lookup comes back: she says it now. */
export function lookupNote(question: string, answer: string): string {
  return `(Studio, not the room:) Your lookup "${question.slice(0, 160)}" came back: ${answer}\nTell the room in a sentence or two, then stop.`;
}
