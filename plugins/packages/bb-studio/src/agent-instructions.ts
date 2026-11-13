// What Studio's agent configuration tells every session, in order (server.ts
// `bb.agents.configure`): the Bot's own instructions, which conversation this
// is, a runner's job, the memory slot (the core profile, src/memory), then a
// short pointer each for Pages, apps, the Next row (or Explore) and the
// kinds routing. The long guidance behind the pointers is in the studio skill
// (skills/studio/SKILL.md, "Agent guide"), which the agent loads on demand.
//
// Why short: older BB hosts keep only the first INSTRUCTIONS_LIMIT (4,096)
// characters of a plugin's instructions and drop the rest, and these are
// sent with every session. The Bot's instructions, the conversation note and
// the core profile go first so a cut never takes them.
import { MEMORY_SLOT } from "./memory/service";

/** Pages: the editing rule and the card; formats are in the skill. */
export const PAGE_POINTER = 'Pages: read with pages_read, change with small pages_edit operations on block ids, and put ::page{id="pg_…"} on its own line after you make or change one. Page formats (charts, embeds, html, mentions): load the studio skill.';

/** Apps: the two types, when to make an interactive one and its card line (::mini, or ::app with the App cards setting). */
export const MINI_POINTER = 'An app is a saved output (artifacts_save) or an interactive tool with its own data (minis_create). For something the user will interact with or come back to, make an interactive app with minis_create and show ::mini{id="mini_…"} on its own line; details are in the studio skill.';
export const APP_POINTER = 'An app is a saved output (artifacts_save) or an interactive tool with its own data (minis_create). For something the user will interact with or come back to, make an interactive app with minis_create; show any app with ::app{id="…"} on its own line; details are in the studio skill.';

export const WORK_POINTER = 'For work that runs a while (a worker, a release, a long job), post one live work card: work_card_create gives a ::work{id="wc_…"} line to post once; report progress with work_card_update, not new status messages.';

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
  work: boolean;
  /** endOfReplyPointer's line, or null. */
  endOfReply: string | null;
  /** The kinds routing line (src/kinds.ts routingInstructions), or "". */
  routing: string;
}

/** The instructions with MEMORY_SLOT where the memory block goes (src/memory/service.ts withMemory fills it). */
export function studioInstructions(parts: InstructionParts): string {
  return [parts.bot, parts.conversation, parts.runner, MEMORY_SLOT, parts.pages ? PAGE_POINTER : "", parts.minis ? (parts.appCards ? APP_POINTER : MINI_POINTER) : "", parts.work ? WORK_POINTER : "", parts.endOfReply ?? "", parts.routing]
    .filter(Boolean).join("\n\n");
}
