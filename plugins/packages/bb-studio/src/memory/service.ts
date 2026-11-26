// What every conversation and worker of a Studio Bot is told about its
// memory (plan "BB Studio Memory & Skills Architecture"):
//
// - Always-on skills (src/core-skill.ts): the Bot's skills with always_on
//   set, injected in full at each session start (agents.configure, see
//   withMemory below), core-profile first. They share ALWAYS_ON_CAP; a text
//   over it is kept whole in the skill and only the part that fits the
//   host's instruction limit goes in, with a line saying where the rest is.
// - On-demand skills: listed in the Bot's own instructions (src/bot-model.ts).
// - History: past conversations and their archived summaries, searched with
//   bot_info (view: history).
//
// The memory records subsystem (memory_records, its tools and the old page
// split) is retired: nothing reads or writes it. Its table stays as it was.
import { ALWAYS_ON_CAP } from "../core-skill";
import { INSTRUCTIONS_LIMIT } from "./shared";
import { SKILLS_SLOT, skillsText } from "../bot-model";

/** The Bot the memory belongs to, as Studio stores it. */
export interface MemoryBot { id: string; name: string; kind?: "studio" | "external"; primary?: boolean }
/** What a thread is to its Bot: one of its conversations, or a worker it started. */
export interface ThreadRole { botId: string; role: "conversation" | "worker" }

/** Studio's record of a thread (src/bot-threads.ts `bot_threads`): its Bot, kind, Main or not, and titles. */
export interface BotThreadPlace {
  botId: string;
  kind: "conversation" | "worker";
  isMain: boolean;
  /** A title given in Studio; null uses BB's. */
  title: string | null;
}

/** An always-on skill as it goes into a prompt. */
export interface AlwaysOnSkill { name: string; body: string }

export interface MemoryDeps {
  bots: { list(): MemoryBot[] };
  /** The Bot's always-on skills, core first (made on first need). */
  alwaysOn(botId: string): AlwaysOnSkill[];
  /** The Bot's on-demand skills, for the list in its conversations' instructions (SKILLS_SLOT). */
  onDemand?(botId: string): { name: string; description: string; pinned?: boolean; usedAt?: number | null }[];
  /**
   * Where Studio placed a thread (one Bot, many conversations): the first
   * answer for a thread's Bot and role. Null for a thread it hasn't placed,
   * which falls back to the guesses below (a session starting before the
   * thread is recorded).
   */
  botThread?(threadId: string): BotThreadPlace | null;
  /** The Bot whose side thread (a fork at one of its replies) this is. */
  sideBot(threadId: string): string | null;
  /** A thread Studio has seen a Bot start or own (src/bot-owned.ts), synchronously. */
  ownedBot(threadId: string): string | null;
  /** The Bot whose chain (its thread and handoffs) holds this thread. */
  chainBot(threadId: string): string | null;
  /** The Bot of a conversation thread itself (Bots.forThread), or of a runner (by its metadata too). */
  ownBot(threadId: string, metadata: Readonly<Record<string, unknown>>): string | null;
  runnerBot(threadId: string, metadata: Readonly<Record<string, unknown>>): string | null;
}

/** Room kept for the line that says a skill was cut. */
const CUT_NOTE_ROOM = 160;

/** Text cut at a line break to fit `room`; `over` when anything was left out. */
export function fitText(markdown: string, room: number): { text: string; over: boolean } {
  const text = markdown.trim();
  if (text.length <= room) return { text, over: false };
  if (room <= 0) return { text: "", over: true };
  const cut = text.lastIndexOf("\n", room);
  return { text: text.slice(0, cut > room / 2 ? cut : room).trimEnd(), over: true };
}

/**
 * The block every conversation and worker of a Bot gets: its always-on
 * skills in full, as far as `room` (what's left of the host's instruction
 * limit) allows. Past that, the text is cut at a line break and the block
 * says so, naming the skill to read for the rest: never a silent cut.
 */
export function memoryInstructions(input: { botName: string; role: ThreadRole["role"]; skills: readonly AlwaysOnSkill[]; room?: number }): string {
  const lines = ["## Memory"];
  if (input.role === "worker") lines.push(`You work for ${JSON.stringify(input.botName)}. Its always-on skills (the user's standing rules and what's true right now) follow; they apply to you too.`);
  else lines.push(`Always on ("## Check-in": your check-ins); patch only a changed rule, quoting it.`);
  if (!input.skills.length) return lines.join("\n");
  const total = input.skills.reduce((sum, skill) => sum + skill.body.trim().length, 0);
  const tags = input.skills.reduce((sum, skill) => sum + `<always-on skill="${skill.name}">\n\n</always-on>\n`.length, 0);
  // The cut note's room is kept only when they don't all fit whole.
  const whole = lines.join("\n").length + tags + total;
  let room = (input.room ?? Number.POSITIVE_INFINITY) - lines.join("\n").length - tags - (whole <= (input.room ?? Number.POSITIVE_INFINITY) ? 0 : CUT_NOTE_ROOM);
  const cut: string[] = [];
  for (const skill of input.skills) {
    const { text, over } = fitText(skill.body, Math.max(0, room));
    room -= text.length;
    if (over) cut.push(skill.name);
    if (text) lines.push(`<always-on skill="${skill.name}">\n${text}\n</always-on>`);
  }
  if (cut.length) {
    const where = input.role === "worker" ? "ask the Bot or open its Memory page" : `read the rest with bot_skill (op: view, name: ${JSON.stringify(cut[0])})`;
    lines.push(`(Cut here: ${cut.join(", ")} didn't fit${total > ALWAYS_ON_CAP ? `; always-on skills are ${total.toLocaleString("en-US")} characters, over their ${ALWAYS_ON_CAP.toLocaleString("en-US")} budget` : ""}. ${where}.)`);
  }
  return lines.join("\n");
}

export class MemoryService {
  constructor(private readonly deps: MemoryDeps) {}

  /** A Studio Bot (not external) by id, or null. */
  private studioBot(botId: string): MemoryBot | null {
    const bot = this.deps.bots.list().find((each) => each.id === botId);
    return bot && bot.kind !== "external" ? bot : null;
  }

  /**
   * Which Bot a starting session belongs to and as what, synchronously
   * (agents.configure): Studio's record first (a conversation, Main
   * included, or a worker), then the older guesses for a thread it hasn't
   * placed yet.
   */
  threadRole(context: { thread: { id: string; parentThreadId: string | null; sourceThreadId: string | null }; pluginMetadata: Readonly<Record<string, unknown>> }): ThreadRole | null {
    const { thread, pluginMetadata } = context;
    const place = this.deps.botThread?.(thread.id) ?? null;
    if (place) return { botId: place.botId, role: place.kind };
    const side = typeof pluginMetadata.botSideThread === "string" ? pluginMetadata.botSideThread : this.deps.sideBot(thread.id);
    if (side) return { botId: side, role: "conversation" };
    const own = this.deps.ownBot(thread.id, pluginMetadata);
    if (own) return { botId: own, role: "conversation" };
    const runner = this.deps.runnerBot(thread.id, pluginMetadata);
    if (runner) return { botId: runner, role: "worker" };
    const parent = thread.parentThreadId ? this.deps.chainBot(thread.parentThreadId) ?? this.deps.ownedBot(thread.parentThreadId) : null;
    if (parent) return { botId: parent, role: "worker" };
    // A fork of the Bot's chat (not a side thread Studio recorded) is another conversation with it.
    const fork = thread.sourceThreadId ? this.deps.chainBot(thread.sourceThreadId) : null;
    if (fork) return { botId: fork, role: "conversation" };
    const owned = this.deps.ownedBot(thread.id);
    return owned ? { botId: owned, role: "worker" } : null;
  }

  /** The Bot's on-demand skill list, at the detail `room` allows (src/bot-model.ts skillsText). */
  skillsFor(botId: string, room: number): string {
    return skillsText(this.deps.onDemand?.(botId) ?? [], room);
  }

  instructionsFor(who: ThreadRole, room?: number): string | null {
    const bot = this.studioBot(who.botId);
    if (!bot) return null;
    return memoryInstructions({ botName: bot.name, role: who.role, skills: this.deps.alwaysOn(bot.id), ...(room === undefined ? {} : { room }) });
  }
}

type ConfigureContext = Parameters<MemoryService["threadRole"]>[0];

/**
 * Where the memory block goes in Studio's instructions: put it in the list
 * right after the Bot's own instructions and the conversation note, so a
 * host's 4,096-character cut (INSTRUCTIONS_LIMIT) takes the short pointers
 * after it, not the always-on skills. Without the slot the block is appended.
 */
export const MEMORY_SLOT = "\u0000studio-memory\u0000";

/** The instructions with the slot replaced by `block`, or dropped. A slot inside a paragraph (SKILLS_SLOT in the Bot's lines) is joined by one line break. */
export function fillSlot(instructions: string, block: string | null, slot = MEMORY_SLOT): string {
  const at = instructions.indexOf(slot);
  if (at < 0) return [instructions, block].filter(Boolean).join("\n\n");
  const head = instructions.slice(0, at), tail = instructions.slice(at + slot.length);
  const sepBefore = /\n\n$/.test(head) || !head ? "\n\n" : "\n", sepAfter = /^\n\n/.test(tail) || !tail ? "\n\n" : "\n";
  const before = head.replace(/\n{1,2}$/, ""), after = tail.replace(/^\n{1,2}/, "");
  if (!block) return [before, after].filter(Boolean).join(sepBefore === "\n\n" || sepAfter === "\n\n" ? "\n\n" : "\n");
  return `${before}${before ? sepBefore : ""}${block}${after ? sepAfter : ""}${after}`;
}

/**
 * Wraps Studio's agent configuration: every conversation and worker of a
 * Studio Bot also gets its always-on skills, at each session start or
 * resume. `skip` leaves a session alone (Visual Chat's canvas, skill review
 * forks, which have their own tool list). `memory` is read when a session
 * starts, after Studio has set up. It adds no tools.
 */
/** The text without a slot, joined as fillSlot would join an empty one. */
const dropSlot = (text: string, slot: string) => fillSlot(text, null, slot);

/**
 * Wraps Studio's agent configuration: every conversation and worker of a
 * Studio Bot also gets its always-on skills, at each session start or
 * resume. `skip` leaves a session alone (Visual Chat's canvas, skill review
 * forks, which have their own tool list). `memory` is read when a session
 * starts, after Studio has set up. It adds no tools.
 *
 * The budget (INSTRUCTIONS_LIMIT): everything but the two slots is fixed and
 * kept whole, the pointers after the memory slot included. The always-on
 * skills get what that leaves, less a reserve for the shortest skill-list
 * line; the on-demand skill list (SKILLS_SLOT) then gets what is left after
 * them, at the most detail that fits (descriptions, names, or a count).
 */
export function withMemory<Context extends ConfigureContext, Result extends { tools: readonly unknown[]; instructions?: string }>(memory: () => MemoryService, skip: (context: Context) => boolean, inner: (context: Context) => Result): (context: Context) => Result {
  return (context) => {
    // `rescope` (Studio's tool scope, src/tool-scope.ts) is for a caller that adds tools; memory adds none.
    const { rescope: _rescope, ...plain } = inner(context) as Result & { rescope?: unknown };
    const result = plain as unknown as Result;
    const instructions = result.instructions ?? "";
    if (!instructions.includes(MEMORY_SLOT) && !instructions.includes(SKILLS_SLOT) && skip(context)) return result;
    let service: MemoryService | null = null;
    let who: ThreadRole | null = null;
    if (!skip(context)) {
      try { service = memory(); who = service.threadRole(context); } catch { /* Memory unavailable: the session starts without it. */ }
    }
    const hasSkills = instructions.includes(SKILLS_SLOT);
    const skillsReserve = hasSkills && who ? SKILLS_RESERVE : 0;
    // The fixed text: both slots out, each block's separator counted.
    const fixed = dropSlot(dropSlot(instructions, SKILLS_SLOT), MEMORY_SLOT).length;
    let block: string | null = null;
    try { block = service && who ? service.instructionsFor(who, INSTRUCTIONS_LIMIT - fixed - 2 - skillsReserve - (hasSkills ? 2 : 0)) : null; } catch { block = null; }
    let filled = fillSlot(instructions, block);
    if (hasSkills) {
      const room = INSTRUCTIONS_LIMIT - dropSlot(filled, SKILLS_SLOT).length - 2;
      const list = service && who ? service.skillsFor(who.botId, room) : "";
      filled = fillSlot(filled, list || null, SKILLS_SLOT);
    }
    return filled === instructions ? result : { ...result, instructions: filled };
  };
}

/** The shortest skill-list line ("Skills: you have N; …"), kept free for it whatever the always-on skills take. */
const SKILLS_RESERVE = 53;
