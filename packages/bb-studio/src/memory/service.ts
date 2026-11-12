// Memory for a Bot (plan "Memory (replaces the single Memory page)"):
//
// - Core profile: a short Studio page the user edits (who they are, how they
//   work, hard rules, people and places, and the Bot's check-in list). Its
//   page is the Bot's `memory_page_id`, so the check-in, maintenance and the
//   Bot page all find it where the Memory page was. Its text goes into the
//   instructions of every conversation and worker of the Bot, at each
//   session start (agents.configure, see configure below), up to
//   PROFILE_CAP_CHARS.
// - Memory records: facts, decisions and notes in memory_records (./store.ts),
//   found on demand with memory_search.
// - The split: a Bot made before this has an old Memory page and no profile.
//   Studio splits it once, on its own (./split.ts, autoSplit below): at
//   plugin start for every Bot, and on the first load of the Bot's memory if
//   it still hasn't happened. The old page is only ever read, never edited,
//   moved or archived.
import type { MemoryRecordView, MemorySource, MemorySourceInput } from "./contract";
import { planSplit } from "./split";
import type { ListOptions, MemoryRecord, MemoryStore } from "./store";
import { INSTRUCTIONS_LIMIT, PROFILE_CAP_CHARS } from "./shared";

/** The Bot the memory belongs to, as Studio stores it. */
export interface MemoryBot { id: string; name: string; kind?: "studio" | "external"; primary?: boolean; memoryPageId?: string | null }
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

export interface MemoryDeps {
  store: MemoryStore;
  bots: {
    list(): MemoryBot[];
    /** The Bot's stored Memory page id, existing or not (the bots row). */
    pageId(botId: string): string | null;
    /** Points the Bot's Memory page at the core profile. */
    setPage(botId: string, pageId: string): void;
  };
  pages: {
    /** Null when there's no such page or it's archived. */
    meta(pageId: string): { title: string; updatedAt: number } | null;
    markdown(pageId: string): string | null;
    create(input: { title: string; markdown: string; icon: string }): string;
  };
  threads: {
    /** A thread's title and whether it's archived; null when it's gone. */
    get(threadId: string): Promise<{ title: string; archived: boolean } | null>;
  };
  /**
   * Where Studio placed a thread (one Bot, many conversations): the first
   * answer for a thread's Bot and role. Null for a thread it hasn't placed,
   * which falls back to the guesses below (a session starting before the
   * thread is recorded).
   */
  botThread?(threadId: string): BotThreadPlace | null;
  /** The Bot a calling thread works for and how (Bots.actingFor with the runners' lookup). */
  acting(threadId: string): Promise<{ botId: string; via: "own" | "runner" | "started" } | null>;
  /** The Bot whose side thread (a fork at one of its replies) this is. */
  sideBot(threadId: string): string | null;
  /** A runner thread's name ("staff sweep"). */
  runnerName(threadId: string): string | null;
  /** A thread Studio has seen a Bot start or own (src/bot-owned.ts), synchronously. */
  ownedBot(threadId: string): string | null;
  /** The Bot whose chain (its thread and handoffs) holds this thread. */
  chainBot(threadId: string): string | null;
  /** The Bot of a conversation thread itself (Bots.forThread), or of a runner (by its metadata too). */
  ownBot(threadId: string, metadata: Readonly<Record<string, unknown>>): string | null;
  runnerBot(threadId: string, metadata: Readonly<Record<string, unknown>>): string | null;
  changed(): void;
  /** Where a failed automatic split is reported. */
  log?(message: string): void;
}

/** The memory tools every conversation and worker of a Bot gets. */
export const MEMORY_TOOLS = ["memory_search", "memory_add", "memory_update"] as const;

const PROFILE_ICON = "🪪";
/** A new Bot's core profile: the person, then the Bot's check-in list (read by its check-in). */
export const PROFILE_TEMPLATE = `## Who the user is

## How they work

## Hard rules

## People and places

## Check-in

- Anything waiting on the user, or threads I started that finished, failed or stalled?
- Project leads: anything stuck?
`;

/** The profile text a Bot is given, cut at a line break to fit `cap`. */
export function cappedProfile(markdown: string, cap = PROFILE_CAP_CHARS): { text: string; over: boolean } {
  const text = markdown.trim();
  if (text.length <= cap) return { text, over: false };
  if (cap <= 0) return { text: "", over: true };
  const cut = text.lastIndexOf("\n", cap);
  return { text: text.slice(0, cut > cap / 2 ? cut : cap).trimEnd(), over: true };
}

/** Room kept for the line that says the profile was cut. */
const CUT_NOTE_ROOM = 120;

/**
 * What every conversation and worker of a Bot is told about memory, with
 * the core profile when there is one. `room` is how many characters the
 * whole block may take; the profile is cut to fit it and PROFILE_CAP_CHARS.
 */
export function memoryInstructions(input: {
  botName: string;
  role: ThreadRole["role"];
  profile: { pageId: string; markdown: string } | null;
  legacy: { pageId: string; title: string } | null;
  room?: number;
}): string {
  const lines = ["## Memory"];
  const records = "memory_search before you rely on what you remember, memory_add for something new worth keeping, memory_update to correct a record (it keeps the old one as history)";
  if (input.role === "worker") lines.push(`You work for ${JSON.stringify(input.botName)}. Its memory records hold facts, decisions and notes: ${records}.`);
  else lines.push(`Facts, decisions and notes are memory records shared by all your conversations: ${records}. Don't keep them on a page.`);
  if (input.legacy && !input.profile) lines.push(`Your old Memory page ${input.legacy.pageId} (${JSON.stringify(input.legacy.title)}) hasn't been split into a core profile and records yet: read it with pages_read when you need it, and don't edit it.`);
  if (input.profile) {
    lines.push(input.role === "worker"
      ? `${input.botName}'s core profile of the user (page ${input.profile.pageId}); its rules apply to you too:`
      : `Your core profile (page ${input.profile.pageId}) follows, in every conversation and worker of yours. Its "## Check-in" section is your check-in list. The user edits it; change it with pages_edit only when they ask.`);
    const fixed = lines.join("\n").length + "\n<core-profile>\n\n</core-profile>".length;
    const room = Math.min(PROFILE_CAP_CHARS, (input.room ?? Number.POSITIVE_INFINITY) - fixed - CUT_NOTE_ROOM);
    const { text, over } = cappedProfile(input.profile.markdown, room);
    lines.push(`<core-profile>\n${text || "(empty)"}\n</core-profile>`);
    if (over) lines.push(`(Cut here: the rest of the core profile is on page ${input.profile.pageId}; read it with pages_read.)`);
  }
  return lines.join("\n");
}

export class MemoryService {
  constructor(private readonly deps: MemoryDeps) {}

  get store(): MemoryStore { return this.deps.store; }

  /** A Studio Bot by id, or the primary; external Bots keep their own memory. */
  bot(botId?: string | null): MemoryBot {
    const bots = this.deps.bots.list();
    const bot = botId ? bots.find((each) => each.id === botId) : bots.find((each) => each.primary) ?? bots[0];
    if (!bot) throw new Error(botId ? `No Bot "${botId}".` : "Make your Bot first.");
    if (bot.kind === "external") throw new Error(`${bot.name} runs on an external agent, which keeps its own memory.`);
    return bot;
  }

  // Core profile and split state ---------------------------------------------

  /** The Bot's core profile page, when it has one that exists. */
  profilePage(botId: string): { pageId: string; title: string; updatedAt: number } | null {
    const row = this.deps.store.profile(botId);
    const pageId = row?.profile_page_id;
    const meta = pageId ? this.deps.pages.meta(pageId) : null;
    return pageId && meta ? { pageId, ...meta } : null;
  }

  split(botId: string): { state: "needed" | "done" | "none"; legacyPageId: string | null; legacyTitle: string | null; splitAt: number | null } {
    const row = this.deps.store.profile(botId);
    if (row?.split_at) return { state: "done", legacyPageId: row.legacy_page_id, legacyTitle: row.legacy_page_id ? this.deps.pages.meta(row.legacy_page_id)?.title ?? null : null, splitAt: row.split_at };
    if (row) return { state: "none", legacyPageId: null, legacyTitle: null, splitAt: null };
    const pageId = this.deps.bots.pageId(botId);
    const meta = pageId ? this.deps.pages.meta(pageId) : null;
    return pageId && meta ? { state: "needed", legacyPageId: pageId, legacyTitle: meta.title, splitAt: null } : { state: "none", legacyPageId: null, legacyTitle: null, splitAt: null };
  }

  /**
   * A new Bot's memory page (Bots.memoryPage, on first need): a core profile,
   * so there's nothing to split. Remade after the profile page was deleted,
   * keeping an earlier split's marker.
   */
  newProfile(botId: string, botName: string): string {
    const pageId = this.deps.pages.create({ title: `${botName}'s core profile`, markdown: PROFILE_TEMPLATE, icon: PROFILE_ICON });
    this.deps.store.setProfile(botId, pageId);
    return pageId;
  }

  profileInfo(botId: string): { pageId: string; title: string; updatedAt: number; chars: number; cap: number; over: boolean; markdown: string } | null {
    const page = this.profilePage(botId);
    if (!page) return null;
    const markdown = this.deps.pages.markdown(page.pageId) ?? "";
    const chars = markdown.trim().length;
    return { ...page, markdown, chars, cap: PROFILE_CAP_CHARS, over: chars > PROFILE_CAP_CHARS };
  }

  /** The view's header and left column. A Bot whose old page still needs splitting is split first. */
  overview(botId?: string | null) {
    const bot = this.bot(botId);
    this.autoSplitSafely(bot.id);
    const profile = this.profileInfo(bot.id);
    return {
      bot: { id: bot.id, name: bot.name },
      profile: profile ? { pageId: profile.pageId, title: profile.title, updatedAt: profile.updatedAt, chars: profile.chars, cap: profile.cap, over: profile.over } : null,
      split: this.split(bot.id),
      counts: this.deps.store.counts(bot.id),
      topics: this.deps.store.topics(bot.id),
    };
  }

  /**
   * Splits a Bot's old Memory page, once and on its own: a NEW core profile
   * page (the check-in list and how the user works, cut to the cap), the
   * records (source: the old page and its section), the marker, and the
   * Bot's memory page pointed at the profile. The old page is only read.
   * Null when there is nothing to split: no old page, or the marker says it
   * was split already.
   */
  autoSplit(botId: string, now = Date.now()): { profilePageId: string; records: number; legacyPageId: string } | null {
    const bot = this.studioBot(botId);
    if (!bot) return null;
    const split = this.split(bot.id);
    if (split.state !== "needed" || !split.legacyPageId) return null;
    const legacyPageId = split.legacyPageId;
    const meta = this.deps.pages.meta(legacyPageId);
    if (!meta) return null;
    const plan = planSplit({ markdown: this.deps.pages.markdown(legacyPageId) ?? "", page: { id: legacyPageId, title: meta.title, updatedAt: meta.updatedAt }, botName: bot.name });
    const profilePageId = this.deps.pages.create({ title: plan.profile.title, markdown: plan.profile.markdown, icon: PROFILE_ICON });
    const source = (section: string | null): MemorySource => ({ kind: "page", id: legacyPageId, title: meta.title, section });
    this.deps.store.db.transaction(() => {
      this.deps.store.addMany(plan.records.map((record) => ({ botId: bot.id, topic: record.topic, text: record.text, createdAt: record.createdAt, source: source(record.section) })), now);
      this.deps.store.markSplit(bot.id, profilePageId, legacyPageId, now);
      this.deps.bots.setPage(bot.id, profilePageId);
    })();
    this.deps.changed();
    return { profilePageId, records: plan.records.length, legacyPageId };
  }

  /** Splits every Studio Bot's old Memory page that still needs it (at plugin start). */
  autoSplitAll(now = Date.now()): void {
    for (const bot of this.deps.bots.list()) this.autoSplitSafely(bot.id, now);
  }

  private autoSplitSafely(botId: string, now = Date.now()): void {
    try { this.autoSplit(botId, now); } catch (error) { this.deps.log?.(`Memory split for ${botId}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  // Records ---------------------------------------------------------------

  /** Adds the thread state ("finished" once archived) to records with a thread source. */
  async views(records: readonly MemoryRecord[]): Promise<MemoryRecordView[]> {
    const ids = [...new Set(records.flatMap((record) => record.source.id && ["conversation", "worker", "thread"].includes(record.source.kind) ? [record.source.id] : []))];
    const states = new Map(await Promise.all(ids.map(async (id) => {
      const thread = await this.deps.threads.get(id).catch(() => undefined);
      return [id, thread === undefined ? null : thread === null ? "missing" : thread.archived ? "finished" : "live"] as const;
    })));
    return records.map((record) => ({ ...record, sourceState: record.source.id ? states.get(record.source.id) ?? null : null }));
  }

  async list(input: { botId?: string; query?: string; topic?: string; sort?: ListOptions["sort"]; includeReplaced?: boolean; includeArchived?: boolean; limit?: number }): Promise<{ records: MemoryRecordView[]; total: number }> {
    const bot = this.bot(input.botId);
    const query = input.query?.trim() || undefined;
    const result = this.deps.store.list({
      botId: bot.id, query, topic: input.topic,
      sort: input.sort ?? (query ? "relevance" : "newest"),
      includeReplaced: input.includeReplaced ?? true,
      includeArchived: input.includeArchived ?? false,
      limit: input.limit ?? 200,
    });
    return { records: await this.views(result.records), total: result.total };
  }

  /** A source as stored, its title looked up when the caller left it out. */
  async source(input: MemorySourceInput): Promise<MemorySource> {
    if (input.kind === "manual") return { kind: "manual", id: null, title: input.title ?? "Added by you", section: input.section ?? null };
    const id = input.id!;
    let title = input.title;
    if (!title && input.kind === "page") title = this.deps.pages.meta(id)?.title;
    if (!title && input.kind !== "page") title = (await this.deps.threads.get(id).catch(() => null))?.title;
    return { kind: input.kind, id, title: title?.trim() || (input.kind === "page" ? "A page" : "A thread"), section: input.section ?? null };
  }

  /**
   * The calling thread as a source and its Bot, from Studio's record of it:
   * Main is "Main", another conversation its title, a worker its title (a
   * runner's "Runner: <name>"). A thread Studio hasn't placed falls back to
   * the older guesses: the Bot's own chat, a side thread, a runner, a thread
   * the Bot started. A thread no Bot owns counts for the primary Bot.
   */
  async caller(threadId: string | undefined): Promise<{ botId: string; source: MemorySource }> {
    if (!threadId) return { botId: this.bot().id, source: { kind: "manual", id: null, title: "Added by an agent", section: null } };
    const place = this.deps.botThread?.(threadId) ?? null;
    if (place && this.studioBot(place.botId)) {
      if (place.isMain) return { botId: place.botId, source: { kind: "conversation", id: threadId, title: "Main", section: null } };
      const thread = place.title?.trim() ? null : await this.deps.threads.get(threadId).catch(() => null);
      const title = place.title?.trim() || thread?.title?.trim() || (place.kind === "worker" ? "Worker" : "Untitled conversation");
      const runner = place.kind === "worker" ? this.deps.runnerName(threadId) : null;
      return { botId: place.botId, source: { kind: place.kind, id: threadId, title: runner ? `Runner: ${runner}` : title, section: null } };
    }
    const side = this.deps.sideBot(threadId);
    const acting = side ? { botId: side, via: "started" as const } : await this.deps.acting(threadId);
    const owned = acting ? null : this.deps.ownedBot(threadId);
    const botId = acting?.botId ?? owned ?? this.bot().id;
    this.bot(botId);
    const thread = await this.deps.threads.get(threadId).catch(() => null);
    const title = thread?.title?.trim() || "Untitled thread";
    if (acting?.via === "own") return { botId, source: { kind: "conversation", id: threadId, title: "Main", section: null } };
    if (side) return { botId, source: { kind: "conversation", id: threadId, title, section: null } };
    if (acting?.via === "runner") return { botId, source: { kind: "worker", id: threadId, title: `Runner: ${this.deps.runnerName(threadId) ?? title}`, section: null } };
    if (acting || owned) return { botId, source: { kind: "worker", id: threadId, title, section: null } };
    return { botId, source: { kind: "thread", id: threadId, title, section: null } };
  }

  // Session instructions ----------------------------------------------------

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

  instructionsFor(who: ThreadRole, room?: number): string | null {
    const bot = this.deps.bots.list().find((each) => each.id === who.botId);
    if (!bot || bot.kind === "external") return null;
    const profile = this.profilePage(bot.id);
    const split = this.split(bot.id);
    return memoryInstructions({
      botName: bot.name,
      role: who.role,
      profile: profile ? { pageId: profile.pageId, markdown: this.deps.pages.markdown(profile.pageId) ?? "" } : null,
      legacy: split.state === "needed" && split.legacyPageId ? { pageId: split.legacyPageId, title: split.legacyTitle ?? "Memory" } : null,
      ...(room === undefined ? {} : { room }),
    });
  }
}

type ConfigureContext = Parameters<MemoryService["threadRole"]>[0];

/**
 * Where the memory block goes in Studio's instructions: put it in the list
 * right after the Bot's own instructions and the conversation note, so a
 * host's 4,096-character cut (INSTRUCTIONS_LIMIT) takes the short pointers
 * after it, not the profile. Without the slot the block is appended.
 */
export const MEMORY_SLOT = "\u0000studio-memory\u0000";

/** The instructions with the slot replaced by `block`, or dropped. */
export function fillSlot(instructions: string, block: string | null): string {
  const at = instructions.indexOf(MEMORY_SLOT);
  const before = at < 0 ? instructions : instructions.slice(0, at).replace(/\n\n$/, "");
  const after = at < 0 ? "" : instructions.slice(at + MEMORY_SLOT.length).replace(/^\n\n/, "");
  return [before, block, after].filter(Boolean).join("\n\n");
}

/**
 * Wraps Studio's agent configuration: every conversation and worker of a
 * Studio Bot also gets the memory tools and the memory instructions with the
 * core profile, at each session start or resume. `skip` leaves a session
 * alone (Visual Chat's canvas, skill review forks, which have their own tool
 * list). `memory` is read when a session starts, after Studio has set up.
 */
export function withMemory<Context extends ConfigureContext, Result extends { tools: readonly unknown[]; instructions?: string }>(memory: () => MemoryService, skip: (context: Context) => boolean, inner: (context: Context) => Result): (context: Context) => Result {
  return (context) => {
    const result = inner(context);
    const instructions = result.instructions ?? "";
    let block: string | null = null;
    if (!skip(context)) {
      try {
        const service = memory();
        const who = service.threadRole(context);
        // The profile gets what the Bot's instructions and the note leave of INSTRUCTIONS_LIMIT: it stays whole before the short pointers after it.
        const at = instructions.indexOf(MEMORY_SLOT);
        const before = at < 0 ? instructions.length : at;
        block = who ? service.instructionsFor(who, INSTRUCTIONS_LIMIT - before - 2) : null;
      } catch { /* Memory unavailable: the session starts without it. */ }
    }
    const filled = fillSlot(instructions, block);
    if (!block) return instructions.includes(MEMORY_SLOT) ? { ...result, instructions: filled } : result;
    const tools = [...result.tools, ...MEMORY_TOOLS.filter((name) => !result.tools.includes(name))];
    return { ...result, tools, instructions: filled };
  };
}

/** Points a Bot's Memory page (bots.memory_page_id) at its core profile. */
export function setBotMemoryPage(db: MemoryStore["db"], botId: string, pageId: string, now = Date.now()): void {
  db.prepare("UPDATE bots SET memory_page_id = ?, updated_at = ? WHERE id = ?").run(pageId, now, botId);
}
