// What Studio's agent configuration tells every session, in order (server.ts
// `bb.agents.configure`): the Bot's own instructions, which conversation this
// is, a runner's job, the memory slot (the core profile, src/memory), then a
// short pointer each for Pages, apps, strands, the Next row (or Explore) and the
// kinds routing. The long guidance behind the pointers is in the studio skill
// (skills/studio/SKILL.md, "Agent guide"), which the agent loads on demand.
//
// Why short: older BB hosts keep only the first INSTRUCTIONS_LIMIT (4,096)
// characters of a plugin's instructions and drop the rest, and these are
// sent with every session. The Bot's instructions, the conversation note and
// the core profile go first so a cut never takes them.
import { MEMORY_SLOT } from "./memory/service";

/** Pages: the editing rule and the card; formats are in the skill. */
export const PAGE_POINTER = 'Pages: read with pages_read, edit with small pages_edit operations on block ids; after making or changing one, put ::page{id="pg_…"} on its own line. No @thread: or page/design ids in backticks: code isn\'t linked. Page formats and what to save where: load the studio skill.';

/** Apps: the two types, when to make an interactive one and its card line (::mini, or ::app with the App cards setting). */
export const MINI_POINTER = 'An app is a saved output or an interactive tool with its own data: apps (op: create), type "artifact" or "mini". What the user will use or come back to is a "mini"; show it with ::mini{id="mini_…"} on its own line; details are in the studio skill.';
export const APP_POINTER = 'An app is a saved output or an interactive tool with its own data: apps (op: create), type "artifact" or "mini". What the user will use or come back to is a "mini"; show any app with ::app{id="…"} on its own line; details are in the studio skill.';

export const CONTINUE_POINTER = 'New topic? Offer a new conversation; call conversation_continue_new only when they agree or ask.';

/** Strands: what each conversation's lines of work are, and the one tool for them. No task tools or work cards. */
export const STRAND_POINTER = 'Strands track each line of work by themselves; say in the chat what you are doing. When one waits on someone or something, or is finished, call strand_note.';

/**
 * The end-of-reply line: the Next row (with which attributes are on and the
 * preferred quick replies) or Explore's line, or nothing when both are off.
 */
export function endOfReplyPointer(input: { next: boolean; explore: boolean; replies: readonly string[] | null }): string | null {
  if (input.next) {
    const attributes = [input.replies ? 'reply="…"' : null, input.explore ? 'btw="…"' : null, 'do="…"'].filter(Boolean).join(" ");
    const replies = input.replies?.length ? ` Quick replies to prefer: ${input.replies.join(" | ")}.` : input.replies ? "" : " No reply= (quick replies are off).";
    return `When a reply has next steps, end it with one ::next{${attributes}} line; load the studio skill ("The Next row") for its rules before you write one.${replies}`;
  }
  if (input.explore) return 'After an answer that read code, you may end with one ::explore{items="🐛 …|🏗️ …"} line of things you noticed; its rules are in the studio skill ("Explore").';
  return null;
}

/** The parts of a session's instructions, in the order they are joined. */
export interface InstructionParts {
  /** The Bot's own instructions (src/bot.ts botInstructions); "" for a thread no Bot has. */
  bot: string;
  /** Which conversation this is (src/bot-threads.ts conversationInstructions). */
  conversation: string;
  /** A runner's job and how it reports. */
  runner: string;
  pages: boolean;
  minis: boolean;
  appCards: boolean;
  /** endOfReplyPointer's line, or null. */
  endOfReply: string | null;
  /** The kinds routing line (src/kinds.ts routingInstructions), or "". */
  routing: string;
  /**
   * Whether the session has strand_note (src/tool-scope.ts): Main, a Bot
   * conversation and a project lead. Default: a conversation or runner note
   * is set, as before tool scope.
   */
  strands?: boolean;
  /** False when the session lists none of Studio's skills (lean context): the pointers then don't send the agent to one. */
  skills?: boolean;
}

/** The pointers' "load the studio skill" phrases, for a session without Studio's skills. */
const SKILL_PHRASES: readonly [string, string][] = [
  [" Page formats and what to save where: load the studio skill.", ""],
  ["; details are in the studio skill.", "."],
  ['; load the studio skill ("The Next row") for its rules before you write one.', "."],
  ['; its rules are in the studio skill ("Explore").', "."],
];

export function withoutSkillPointers(text: string): string {
  return SKILL_PHRASES.reduce((out, [phrase, replacement]) => out.split(phrase).join(replacement), text);
}

/** The instructions with MEMORY_SLOT where the memory block goes (src/memory/service.ts withMemory fills it). */
export function studioInstructions(parts: InstructionParts): string {
  const strands = parts.strands ?? !!(parts.conversation || parts.runner);
  const text = [parts.bot, parts.conversation, parts.runner, MEMORY_SLOT, parts.pages ? PAGE_POINTER : "", parts.minis ? (parts.appCards ? APP_POINTER : MINI_POINTER) : "", strands ? STRAND_POINTER : "", parts.conversation ? CONTINUE_POINTER : "", parts.endOfReply ?? "", parts.routing]
    .filter(Boolean).join("\n\n");
  return parts.skills === false ? withoutSkillPointers(text) : text;
}
