// The user's Bot: an always-on agent with a name, an avatar and a state
// (active, paused, stopped), modelled on ChatGPT's dots. It replaces the
// Chief of Staff. Its thread is an implementation detail: it is the personal
// project's lead (src/project-lead.ts), so a handoff rotates it and the
// project's heartbeat is the Bot's check-in. That is the primary Bot (BOT_ID).
//
// The user can make more Bots ("New bot"). Each has its own thread (stored on
// its row, not a project lead; a handoff moves it, handedOff), Memory page,
// skills, runners and check-in. An additional Bot's check-in is its own
// automation, kept by ProjectRuns under the key `bot:<id>` (BOT_RUN_PREFIX).
// Every Bot has the same powers: it sees every project. Methods take an
// optional bot id; without one they act on the primary Bot.
//
// "Threads it started" come from BB's thread metadata: a thread whose
// sourceThreadId, parentThreadId or lifecycleOwnerThreadId is the Bot's thread,
// or one of the threads it handed off from. originPluginId only says which
// plugin spawned a thread, not which thread, so it isn't used.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { BotActivityView, BotScheduledView, BotSkillView, BotThreadView, BotView, HeartbeatRun } from "./contract";
import { EXTERNAL_PROVIDERS, externalNote } from "./external-providers";
export { EXTERNAL_AGENTS_PLUGIN_ID, EXTERNAL_PROVIDERS, externalNote } from "./external-providers";
import { BOT_RUN_PREFIX, PERSONAL_PROJECT_ID, type ProjectLeads } from "./project-lead";

type Sdk = BbPluginApi["sdk"];
type ListedThread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
/** What Activity reads from a thread, listed or fetched. */
type ActivityThread = Pick<ListedThread, "id" | "title" | "titleFallback" | "status" | "projectId" | "updatedAt" | "archivedAt"> & Partial<Pick<ListedThread, "sourceThreadId" | "parentThreadId" | "lifecycleOwnerThreadId">> & { hasPendingInteraction?: boolean; queuedWork?: ListedThread["queuedWork"] };
export type BotState = "active" | "paused" | "stopped";
export const BOT_ID = "bot_main";
export const DEFAULT_BOT_NAME = "Bot";
export const DEFAULT_BOT_AVATAR = "🤖";
const heartbeatName = (key: string) => `Studio project heartbeat ${key}`;
const RUNNING = new Set(["active", "starting", "pending", "stopping"]);
/** Running now; a "pending" thread is waiting to start. */
const WORKING = new Set(["active", "starting", "stopping"]);

/** The Bot's check-in prompt. What to look at lives on its Memory page, not here. */
export function botHeartbeat(name: string): string {
  return `Check-in for ${JSON.stringify(name)}: read your Memory page and do what its "## Check-in" section says. Do the checks yourself; if a worker thread really helps, reuse the one you used before (bb thread tell) instead of starting a new one each time. Reply only if something changed or needs the user; otherwise finish without a final assistant message: no "✓", "nothing new" or other filler.`;
}

export const CHECKIN_PRESET_IDS = ["morning", "evening", "working", "off"] as const;
export type CheckinPreset = (typeof CHECKIN_PRESET_IDS)[number];
type PresetRun = { enabled: boolean; cadence: HeartbeatRun["cadence"]; time?: string; cron?: string };
/** Proactive check-in presets: less is more, one schedule each. */
export const CHECKIN_PRESETS: Record<CheckinPreset, { label: string; run: PresetRun; line: string | null }> = {
  morning: { label: "Morning brief", run: { enabled: true, cadence: "weekdays", time: "08:00" }, line: "Weekday mornings: a short brief of today, what needs me, and what finished overnight." },
  evening: { label: "Evening wrap-up", run: { enabled: true, cadence: "weekdays", time: "18:00" }, line: "Weekday evenings: wrap up what got done today and what's left for tomorrow." },
  working: { label: "Every 2 hours while I'm working", run: { enabled: true, cadence: "custom", time: "09:00", cron: "0 9-17/2 * * 1-5" }, line: "Every 2 hours on workdays: only tell me what needs me or what changed." },
  off: { label: "Off", run: { enabled: false, cadence: "daily" }, line: null },
};

/** A new Bot's Memory page: the check-in checklist on top, then memory. The Bot and the user edit it. */
export const MEMORY_TEMPLATE = `## Check-in

- Anything waiting on the user, or threads I started that finished, failed or stalled?
- Project leads: anything stuck?

## Memory

`;

/**
 * External bots ("Import bot"): the Studio Agents providers a Bot's thread can
 * run on. Their agent keeps its own memory and tools, so Studio's Memory page,
 * skills, runners and bot_* tools don't reach it; chat, sub-threads, Needs
 * you, check-ins (a message to its thread) and pause/stop still work.
 */
/** An external bot's instructions: who it is, nothing about Studio tools it can't call. */
export function externalBotInstructions(bot: { name: string; state: BotState; role?: string | null }): string {
  const who = `You are ${JSON.stringify(bot.name)}, one of the user's bots in BB Studio. The user can rename, pause or stop you in Studio, and Studio sends you a check-in message on their schedule.${bot.role?.trim() ? `\nYour role, in the user's words: ${bot.role.trim()}` : ""}`;
  return bot.state === "active" ? who : `${who}\nYou are ${bot.state} by the user. Answer questions, but don't start new work until they resume you.`;
}

/** Instructions for the Bot's own thread, given at each session start. Short: they point at the page and tools. */
export function botInstructions(bot: { name: string; state: BotState; role?: string | null; memoryPageId?: string | null; skills?: readonly string[]; primary?: boolean }): string {
  const who = `You are ${JSON.stringify(bot.name)}, ${bot.primary === false ? "one of the user's Bots: an always-on agent that sees every project" : "the user's Bot: an always-on agent that leads their personal project and sees every project"}. The user can rename, pause or stop you in Studio.${bot.role?.trim() ? `\nYour role, in the user's words: ${bot.role.trim()}` : ""}`;
  if (bot.state === "active") {
    const memory = bot.memoryPageId ? `Your Memory page is ${bot.memoryPageId}: read it with pages_read when you wake up, keep it short and edit it yourself with pages_edit; its "## Check-in" section is your check-in list.` : "";
    const skills = `Save a reusable procedure as your own skill with bot_skill_write${bot.skills?.length ? `; yours: ${bot.skills.join(", ")} (bot_skill_read)` : ""}. Search your past threads with bot_history_search.`;
    const quiet = "Your chat is the user's inbox: post only what changed or needs them. When nothing did (a check-in with nothing new, a notice that a thread you started finished fine, an automation result like [PASS]), finish without a final assistant message: no \"✓\", \"noted\" or other acknowledgement.";
    const runners = "Give recurring work to a runner (runner_create).";
    return [who, memory, quiet, runners, skills].filter(Boolean).join("\n");
  }
  return `${who}\nYou are ${bot.state} by the user. Don't start new work: don't spawn or steer threads, change Studio items or schedule anything. Answer questions, and tell the user to resume you (Studio → Bot → Resume) for anything else.`;
}

/** A skill name as BB and the skill-creator want it: lowercase words joined by hyphens. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A shared skill's SKILL.md. */
export function skillMarkdown(skill: { name: string; description: string; body: string }): string {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body.trim()}\n`;
}

type BotRow = { id: string; name: string; avatar: string; state: BotState; thread_id: string | null; heartbeat_was_on: number; memory_page_id: string | null; shape: string | null; color: string | null; role: string | null; kind?: string | null; provider_id?: string | null; model?: string | null; created_at: number; updated_at: number };
type SkillRow = { bot_id: string; name: string; description: string; body: string; created_at: number; updated_at: number };

/** Sorts threads into the Bot's Activity. Pending interactions win; then running; then queued; the rest are done. */
export function classifyActivity(threads: readonly ActivityThread[], botThreadId: string | null, limit = 15): Pick<BotActivityView, "needsYou" | "inProgress" | "waiting" | "completed"> {
  // A thread started by another listed thread nests under it; the rest hang off the Bot.
  const listed = new Set(threads.map((thread) => thread.id).filter((id) => id !== botThreadId));
  const parentOf = (thread: ActivityThread) => [thread.parentThreadId, thread.sourceThreadId, thread.lifecycleOwnerThreadId].find((id) => !!id && id !== thread.id && listed.has(id)) ?? null;
  const view = (thread: ActivityThread): BotThreadView & { queued: boolean } => ({
    id: thread.id,
    title: thread.title || thread.titleFallback || "Untitled thread",
    status: thread.status,
    projectId: thread.projectId ?? null,
    updatedAt: thread.updatedAt ?? 0,
    relation: thread.id === botThreadId ? "self" : "started",
    needsYou: !!thread.hasPendingInteraction,
    parentId: thread.id === botThreadId ? null : parentOf(thread),
    queued: thread.status === "pending" || (thread.queuedWork === "waiting" && !WORKING.has(thread.status)),
  });
  const seen = new Set<string>();
  const unique = threads.filter((thread) => !thread.archivedAt && !seen.has(thread.id) && !!seen.add(thread.id)).map(view);
  const newest = (a: BotThreadView, b: BotThreadView) => b.updatedAt - a.updatedAt;
  const strip = ({ queued: _queued, ...thread }: BotThreadView & { queued: boolean }): BotThreadView => thread;
  const needsYou = unique.filter((thread) => thread.needsYou).sort(newest).map(strip);
  const waiting = unique.filter((thread) => !thread.needsYou && thread.queued).sort(newest).map(strip);
  const inProgress = unique.filter((thread) => !thread.needsYou && !thread.queued && WORKING.has(thread.status)).sort(newest).map(strip);
  const completed = unique.filter((thread) => !thread.needsYou && !thread.queued && !WORKING.has(thread.status) && thread.relation === "started").sort(newest).slice(0, limit).map(strip);
  return { needsYou, inProgress, waiting, completed };
}

/** Threads in `threads` started (at any depth) by one of `roots`, not including the roots. */
export function descendants<T extends Pick<ListedThread, "id" | "sourceThreadId" | "parentThreadId" | "lifecycleOwnerThreadId">>(threads: readonly T[], roots: ReadonlySet<string>): T[] {
  const known = new Set(roots);
  const found: T[] = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const thread of threads) {
      if (known.has(thread.id) || !startedBy(thread, known)) continue;
      known.add(thread.id);
      found.push(thread);
      grew = true;
    }
  }
  return found;
}

/** Whether BB's metadata says one of `botThreads` started this thread. */
export function startedBy(thread: Pick<ListedThread, "sourceThreadId" | "parentThreadId" | "lifecycleOwnerThreadId">, botThreads: ReadonlySet<string>): boolean {
  return [thread.sourceThreadId, thread.parentThreadId, thread.lifecycleOwnerThreadId].some((id) => !!id && botThreads.has(id));
}

const automationRow = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: z.object({ cron: z.string().optional() }).passthrough(),
  execution: z.object({ targetThreadId: z.string().nullish() }).passthrough(),
  nextRunAt: z.number().nullish(),
}).passthrough();
type AutomationRow = z.infer<typeof automationRow>;

/** The Bot's Memory page, a Studio page (src/pages). */
export interface BotMemoryPages {
  exists(pageId: string): boolean;
  /** Makes a page in the personal project and returns its id. */
  create(input: { title: string; markdown: string }): string;
  /** Adds a line to the page's "## Check-in" section (made if missing); false when it was already there. */
  addCheckin?(pageId: string, line: string): boolean;
}

export interface BotDeps {
  db: Database.Database;
  sdk: Sdk;
  leads: ProjectLeads;
  changed(): void;
  memory?: BotMemoryPages;
  /** BB's user skills directory (`<data dir>/skills`), where a shared skill goes. */
  userSkillsDir?: string;
  /** Runner threads (src/runners.ts): kept out of Activity's thread lists; an urgent one is in Needs you. */
  runners?: { threads(botId?: string): Map<string, { urgent: boolean }>; pauseAll(botId?: string): Promise<string[]> };
}

export class Bots {
  constructor(private readonly deps: BotDeps) {}

  /** Every Bot, the primary first (BOT_ID, else the oldest). */
  private rows(): BotRow[] {
    return this.deps.db.prepare("SELECT * FROM bots ORDER BY (id = ?) DESC, created_at, id").all(BOT_ID) as BotRow[];
  }

  /** One Bot by id, or the primary without one. */
  private row(botId?: string | null): BotRow | undefined {
    if (botId) return this.deps.db.prepare("SELECT * FROM bots WHERE id = ?").get(botId) as BotRow | undefined;
    return this.rows()[0];
  }

  private need(botId?: string | null): BotRow {
    const row = this.row(botId);
    if (!row) throw new Error(botId ? `No Bot "${botId}".` : "Make your Bot first.");
    return row;
  }

  /** The primary Bot's id: the personal project's lead. */
  primaryId(): string | null {
    return this.rows()[0]?.id ?? null;
  }

  private isPrimary(row: BotRow): boolean {
    return row.id === this.primaryId();
  }

  /** Where the Bot's check-in lives in ProjectRuns: the personal project's for the primary, its own otherwise. */
  private runKey(row: BotRow): string {
    return this.isPrimary(row) ? PERSONAL_PROJECT_ID : `${BOT_RUN_PREFIX}${row.id}`;
  }

  private view(row: BotRow): NonNullable<BotView["bot"]> {
    const primary = this.isPrimary(row);
    let threadId = row.thread_id;
    if (primary) {
      threadId = this.deps.leads.storedLead(PERSONAL_PROJECT_ID);
      if (threadId !== row.thread_id) this.deps.db.prepare("UPDATE bots SET thread_id = ?, updated_at = ? WHERE id = ?").run(threadId, Date.now(), row.id);
    }
    const memoryPageId = row.memory_page_id && this.deps.memory?.exists(row.memory_page_id) ? row.memory_page_id : null;
    return { id: row.id, name: row.name, avatar: row.avatar, state: row.state, threadId, memoryPageId, shape: row.shape ?? null, color: row.color ?? null, role: row.role ?? null, primary, kind: row.kind === "external" ? "external" as const : "studio" as const, providerId: row.provider_id ?? null, model: row.model ?? null, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  /** A Bot as stored (the primary without an id); its thread read from the personal project's lead for the primary. */
  stored(botId?: string | null): BotView["bot"] {
    const row = this.row(botId);
    return row ? this.view(row) : null;
  }

  /** Every Bot, the primary first. */
  list(): NonNullable<BotView["bot"]>[] {
    return this.rows().map((row) => this.view(row));
  }

  /** The heartbeat prompt for the personal project (the primary Bot's). */
  prompt(): string {
    return botHeartbeat(this.row()?.name ?? DEFAULT_BOT_NAME);
  }

  /** An additional Bot's check-in prompt, by its run key (`bot:<id>`). */
  promptFor(key: string): string | null {
    if (!key.startsWith(BOT_RUN_PREFIX)) return null;
    const row = this.row(key.slice(BOT_RUN_PREFIX.length));
    return row ? botHeartbeat(row.name) : null;
  }

  /** An additional Bot's thread for its run key, for ProjectRuns.repair. */
  threadForRunKey(key: string): string | null {
    return key.startsWith(BOT_RUN_PREFIX) ? this.stored(key.slice(BOT_RUN_PREFIX.length))?.threadId ?? null : null;
  }

  /**
   * The Bot whose thread this is, if any. A new Bot's thread starts before it
   * is saved as the Bot's, so its spawn metadata (`{ bot: <id> }`) counts
   * while that Bot has no thread yet.
   */
  forThread(threadId: string | undefined | null, metadata?: { readonly [key: string]: unknown }): NonNullable<BotView["bot"]> | null {
    if (!threadId) return null;
    const bots = this.list();
    const own = bots.find((bot) => bot.threadId === threadId);
    if (own) return own;
    const named = bots.find((bot) => !bot.threadId && metadata?.bot === bot.id);
    return named ? { ...named, threadId } : null;
  }

  async get(botId?: string | null): Promise<BotView> {
    const row = this.row(botId);
    if (botId && !row) throw new Error(`No Bot "${botId}".`);
    if (!row || this.isPrimary(row)) {
      const lead = await this.deps.leads.get(PERSONAL_PROJECT_ID);
      return { bot: this.stored(row?.id), run: lead.run };
    }
    return { bot: this.view(row), run: this.deps.leads.runs.get(this.runKey(row)) };
  }

  private insert(id: string, name: string, avatar: string, shape: string | null = null, color: string | null = null, external?: { providerId: string; model: string }) {
    const now = Date.now();
    this.deps.db.prepare("INSERT OR IGNORE INTO bots (id, name, avatar, shape, color, state, thread_id, heartbeat_was_on, kind, provider_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', NULL, 0, ?, ?, ?, ?, ?)")
      .run(id, name, avatar, shape, color, external ? "external" : "studio", external?.providerId ?? null, external?.model ?? null, now, now);
  }

  /** Throws for an external bot: `what` (its Memory page, skills, runners) lives on its provider. */
  requireStudio(botId: string | undefined, what: string): void {
    const row = this.row(botId);
    if (row?.kind === "external") throw new Error(`${row.name} has no Studio ${what}. ${externalNote(row.provider_id)}`);
  }

  private update(row: BotRow, fields: Partial<Pick<BotRow, "name" | "avatar" | "shape" | "color" | "role" | "state" | "heartbeat_was_on">>) {
    const next = { ...row, ...fields };
    this.deps.db.prepare("UPDATE bots SET name = ?, avatar = ?, shape = ?, color = ?, role = ?, state = ?, heartbeat_was_on = ?, updated_at = ? WHERE id = ?").run(next.name, next.avatar, next.shape ?? null, next.color ?? null, next.role ?? null, next.state, next.heartbeat_was_on, Date.now(), row.id);
    this.deps.changed();
  }

  /**
   * Makes a Bot from a thread, or a new chat in the personal project. The
   * first is the primary (the personal project's lead); later ones are
   * additional Bots with their own thread.
   */
  async create(input: { name: string; avatar: string; shape?: string; color?: string; threadId?: string; prompt?: string; external?: { providerId: string; model: string } }): Promise<BotView> {
    const external = input.external;
    if (external && !EXTERNAL_PROVIDERS.some((each) => each.id === external.providerId)) throw new Error(`${external.providerId} isn't an external agent provider.`);
    if (external && input.threadId) throw new Error("An imported bot starts its own thread on its provider.");
    // The primary Bot leads the personal project with Studio's tools, so an import is always an additional Bot.
    if (external && !this.row()) throw new Error("Make your first bot in Studio, then import others.");
    const primary = !this.row();
    const id = primary ? BOT_ID : `bot_${Math.random().toString(36).slice(2, 12)}`;
    // The row comes first, so the new thread's first turn gets the Bot's instructions (forThread).
    this.insert(id, input.name, input.avatar, input.shape ?? null, input.color ?? null, external);
    let threadId = input.threadId;
    try {
      if (threadId && this.forThread(threadId)) throw new Error("That thread is already a Bot's.");
      if (!threadId) {
        const thread = await this.deps.sdk.threads.spawn({
          projectId: PERSONAL_PROJECT_ID,
          title: input.name,
          environment: { type: "project-default" },
          pluginMetadata: { bot: id },
          ...(external ? { providerId: external.providerId, model: external.model, executionInputSources: { providerId: "explicit", model: "explicit" } } : {}),
          // Its instructions come from agents.configure (botInstructions), so the first message is the user's.
          input: [{ type: "text", text: input.prompt ?? `Hi ${input.name}. Introduce yourself in a sentence and ask what I'd like you to keep an eye on.`, mentions: [] }],
        } as never);
        threadId = thread.id;
      }
      if (primary) await this.deps.leads.setLead(PERSONAL_PROJECT_ID, threadId);
      else this.deps.db.prepare("UPDATE bots SET thread_id = ?, updated_at = ? WHERE id = ?").run(threadId, Date.now(), id);
    } catch (error) {
      this.deps.db.prepare("DELETE FROM bots WHERE id = ?").run(id);
      throw error;
    }
    this.deps.changed();
    return this.get(id);
  }

  async set(input: { botId?: string; name?: string; avatar?: string; shape?: string | null; color?: string; role?: string }): Promise<BotView> {
    const before = this.need(input.botId);
    this.update(before, {
      ...(input.name ? { name: input.name } : {}), ...(input.avatar ? { avatar: input.avatar } : {}),
      ...(input.shape !== undefined ? { shape: input.shape } : {}), ...(input.color ? { color: input.color } : {}),
      ...(input.role !== undefined ? { role: input.role.trim() || null } : {}),
    });
    // The heartbeat's prompt carries the name.
    const key = this.runKey(before);
    const run = this.deps.leads.runs.get(key);
    if (input.name && input.name !== before.name && run?.enabled) {
      if (key === PERSONAL_PROJECT_ID) await this.deps.leads.setRun(PERSONAL_PROJECT_ID, run);
      else await this.deps.leads.runs.set(key, this.view(before).threadId, run);
    }
    return this.get(before.id);
  }

  /** Makes a thread the primary Bot's ("Make this my Bot"), making the Bot if there is none. */
  async setThread(threadId: string): Promise<BotView> {
    const other = this.forThread(threadId);
    if (other && !other.primary) throw new Error(`That thread is ${other.name}'s.`);
    await this.deps.leads.setLead(PERSONAL_PROJECT_ID, threadId);
    if (!this.row()) this.insert(BOT_ID, DEFAULT_BOT_NAME, DEFAULT_BOT_AVATAR);
    this.deps.changed();
    return this.get();
  }

  /** Turns a Bot's check-in on or off. An additional Bot's is its own automation on its thread. */
  private async writeRun(row: BotRow, run: HeartbeatRun): Promise<void> {
    const key = this.runKey(row);
    if (key === PERSONAL_PROJECT_ID) await this.deps.leads.setRun(PERSONAL_PROJECT_ID, run);
    else await this.deps.leads.runs.set(key, this.view(row).threadId, run);
  }

  async setRun(input: { botId?: string; enabled: boolean; cadence: HeartbeatRun["cadence"]; time?: string; cron?: string }): Promise<BotView> {
    const { botId, ...run } = input;
    const row = this.row(botId);
    if (botId && !row) throw new Error(`No Bot "${botId}".`);
    if (run.enabled && row && row.state !== "active") throw new Error(`${row.name} is ${row.state}. Resume it before turning its check-ins on.`);
    if (!row || this.isPrimary(row)) {
      await this.deps.leads.setRun(PERSONAL_PROJECT_ID, run);
      return this.get();
    }
    const current = this.deps.leads.runs.get(this.runKey(row));
    await this.writeRun(row, { enabled: run.enabled, cadence: run.cadence, time: run.time ?? current?.time ?? "09:00", ...(run.cron ?? current?.cron ? { cron: run.cron ?? current?.cron } : {}) });
    return this.get(row.id);
  }

  /**
   * A check-in preset: one schedule and, unless it's Off, one line on the
   * Memory page's Check-in section saying what to do then.
   */
  async checkinPreset(preset: CheckinPreset, botId?: string): Promise<BotView> {
    const row = this.row(botId);
    const spec = CHECKIN_PRESETS[preset];
    if (!spec.run.enabled) {
      if (row) {
        const run = this.deps.leads.runs.get(this.runKey(row));
        if (run?.enabled) await this.writeRun(row, { ...run, enabled: false });
      }
      return this.get(row?.id);
    }
    const view = await this.setRun({ ...spec.run, ...(botId ? { botId } : {}) });
    const pageId = this.memoryPage(row?.id);
    if (pageId && spec.line) this.deps.memory?.addCheckin?.(pageId, spec.line);
    return view;
  }

  /** A Bot's thread and the ones it handed off from, oldest first: one continuous chat. */
  chain(botId?: string): string[] {
    const bot = this.stored(botId);
    return bot?.threadId ? this.threadChain(bot.threadId).reverse() : [];
  }

  /** A thread was handed off (thread_handoff): an additional Bot follows its thread, check-in included. */
  async handedOff(oldThreadId: string, newThreadId: string): Promise<void> {
    for (const row of this.rows()) {
      if (this.isPrimary(row) || row.thread_id !== oldThreadId) continue;
      this.deps.db.prepare("UPDATE bots SET thread_id = ?, updated_at = ? WHERE id = ?").run(newThreadId, Date.now(), row.id);
      const run = this.deps.leads.runs.get(this.runKey(row));
      if (run?.enabled) await this.deps.leads.runs.set(this.runKey(row), newThreadId, run);
      this.deps.changed();
    }
  }

  /** Heartbeat off, remembering whether it was on; the Bot is told it's paused (botInstructions). */
  async pause(botId?: string): Promise<BotView> {
    const row = this.need(botId);
    if (row.state === "active") {
      const run = this.deps.leads.runs.get(this.runKey(row));
      if (run?.enabled) await this.writeRun(row, { ...run, enabled: false });
      this.update(row, { state: "paused", heartbeat_was_on: run?.enabled ? 1 : 0 });
    }
    return this.get(row.id);
  }

  async resume(botId?: string): Promise<BotView> {
    const row = this.need(botId);
    if (row.state !== "active") {
      // The heartbeat comes back first: if that fails the Bot stays paused and remembers it, so Resume can be retried.
      const run = this.deps.leads.runs.get(this.runKey(row));
      if (row.heartbeat_was_on && run && this.view(row).threadId) await this.writeRun(row, { ...run, enabled: true });
      this.update(this.need(row.id), { state: "active", heartbeat_was_on: 0 });
    }
    return this.get(row.id);
  }

  /** Pause, stop the running threads it started, and pause automations that wake its thread. */
  async stop(botId?: string): Promise<BotView & { stoppedThreadIds: string[]; pausedAutomationIds: string[] }> {
    const id = this.need(botId).id;
    await this.pause(id);
    const stoppedThreadIds: string[] = [];
    const pausedAutomationIds: string[] = [];
    const bot = this.stored(id);
    if (bot?.threadId) {
      for (const thread of await this.startedThreads(bot.threadId)) {
        if (thread.id === bot.threadId || thread.archivedAt || !RUNNING.has(thread.status)) continue;
        await this.deps.sdk.threads.stop({ threadId: thread.id });
        stoppedThreadIds.push(thread.id);
      }
      const { projectId, rows } = await this.automations(bot.threadId);
      for (const automation of rows) {
        if (!automation.enabled) continue;
        await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_pause", input: { projectId, automationId: automation.id } as never, outputSchema: z.unknown() });
        pausedAutomationIds.push(automation.id);
      }
    }
    await this.deps.runners?.pauseAll(id);
    this.update(this.need(id), { state: "stopped" });
    return { ...(await this.get(id)), stoppedThreadIds, pausedAutomationIds };
  }

  /** A Bot's Memory page, made on first need. Null without a Bot or Pages. */
  memoryPage(botId?: string): string | null {
    const row = this.row(botId);
    const pages = this.deps.memory;
    if (!row || !pages || row.kind === "external") return null;
    if (row.memory_page_id && pages.exists(row.memory_page_id)) return row.memory_page_id;
    const pageId = pages.create({ title: `${row.name}'s Memory`, markdown: MEMORY_TEMPLATE });
    this.deps.db.prepare("UPDATE bots SET memory_page_id = ?, updated_at = ? WHERE id = ?").run(pageId, Date.now(), row.id);
    this.deps.changed();
    return pageId;
  }

  /** What a Bot's own thread is told; its Memory page is made here on first need. */
  instructions(bot: NonNullable<BotView["bot"]>): string {
    if (bot.kind === "external") return externalBotInstructions(bot);
    if (bot.state !== "active") return botInstructions(bot);
    let memoryPageId: string | null = null;
    try { memoryPageId = this.memoryPage(bot.id); } catch { /* Pages unavailable: no memory line. */ }
    return botInstructions({ ...bot, memoryPageId, skills: this.skills(bot.id).map((skill) => skill.name) });
  }

  skills(botId?: string): BotSkillView[] {
    const row = this.row(botId);
    if (!row) return [];
    return (this.deps.db.prepare("SELECT * FROM bot_skills WHERE bot_id = ? ORDER BY name").all(row.id) as SkillRow[])
      .map((skill) => ({ name: skill.name, description: skill.description, updatedAt: skill.updated_at }));
  }

  skill(name: string, botId?: string): (BotSkillView & { body: string }) | null {
    const row = this.row(botId);
    const skill = row ? this.deps.db.prepare("SELECT * FROM bot_skills WHERE bot_id = ? AND name = ?").get(row.id, name) as SkillRow | undefined : undefined;
    return skill ? { name: skill.name, description: skill.description, updatedAt: skill.updated_at, body: skill.body } : null;
  }

  /** Adds or replaces one of a Bot's own skills. Only its thread loads them. */
  writeSkill(input: { name: string; description: string; body: string }, botId?: string): BotSkillView {
    const row = this.need(botId);
    if (!SKILL_NAME.test(input.name)) throw new Error("A skill name is lowercase words joined by hyphens, like weekly-review.");
    const now = Date.now();
    this.deps.db.prepare(`INSERT INTO bot_skills (bot_id, name, description, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (bot_id, name) DO UPDATE SET description = excluded.description, body = excluded.body, updated_at = excluded.updated_at`)
      .run(row.id, input.name, input.description.trim(), input.body, now, now);
    this.deps.changed();
    return { name: input.name, description: input.description.trim(), updatedAt: now };
  }

  deleteSkill(name: string, botId?: string): boolean {
    const row = this.row(botId);
    const deleted = row ? this.deps.db.prepare("DELETE FROM bot_skills WHERE bot_id = ? AND name = ?").run(row.id, name).changes > 0 : false;
    if (deleted) this.deps.changed();
    return deleted;
  }

  /** Share: moves a skill into BB's user skills, where every agent finds it. */
  async shareSkill(name: string, botId?: string): Promise<{ path: string }> {
    const skill = this.skill(name, botId);
    if (!skill) throw new Error(`Your Bot has no skill "${name}".`);
    if (!this.deps.userSkillsDir) throw new Error("BB's skills folder isn't available.");
    const dir = join(this.deps.userSkillsDir, skill.name);
    if (existsSync(dir)) throw new Error(`A skill named "${skill.name}" is already shared. Rename the Bot's or delete the other first.`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    await writeFile(path, skillMarkdown(skill), { flag: "wx" });
    this.deleteSkill(name, botId);
    return { path };
  }

  /** Searches a Bot's own threads (its handoff chain and threads it started) through BB's thread search. */
  async historySearch(query: string, limit = 10, botId?: string): Promise<{ threadId: string; title: string; text: string }[]> {
    const bot = this.stored(botId);
    if (!bot?.threadId) return [];
    const mine = new Set([...this.threadChain(bot.threadId), ...(await this.startedThreads(bot.threadId)).map((thread) => thread.id)]);
    const found = await this.deps.sdk.threads.search({ query, limitPerGroup: "50" });
    const hits: { threadId: string; title: string; text: string }[] = [];
    for (const result of [...found.active.results, ...found.archived.results]) {
      if (!mine.has(result.thread.id)) continue;
      const title = result.thread.title || result.thread.titleFallback || "Untitled thread";
      for (const match of result.matches.slice(0, 2)) hits.push({ threadId: result.thread.id, title, text: match.text.slice(0, 400) });
      if (hits.length >= limit) break;
    }
    return hits.slice(0, limit);
  }

  /** A Bot's thread and the ones it handed off from, newest first. */
  private threadChain(threadId: string): string[] {
    const chain = [threadId];
    const previous = this.deps.db.prepare("SELECT old_thread_id FROM project_thread_handoffs WHERE new_thread_id = ?");
    for (let i = 0; i < 20; i++) {
      const row = previous.get(chain.at(-1)) as { old_thread_id: string } | undefined;
      if (!row || chain.includes(row.old_thread_id)) break;
      chain.push(row.old_thread_id);
    }
    return chain;
  }

  /** Threads a Bot started (any depth), its own excluded: where adoptable runners come from. */
  async started(botId?: string): Promise<{ id: string; title: string; projectId: string | null; parentThreadId?: string | null }[]> {
    const bot = this.stored(botId);
    if (!bot?.threadId) return [];
    return (await this.workThreads(bot.threadId)).filter((thread) => thread.id !== bot.threadId)
      .map((thread) => ({ id: thread.id, title: thread.title || thread.titleFallback || "Untitled thread", projectId: thread.projectId ?? null, parentThreadId: thread.parentThreadId ?? null }));
  }

  /** The Bot's thread and every thread it started. */
  private async startedThreads(threadId: string): Promise<(ActivityThread & Partial<ListedThread>)[]> {
    const chain = new Set(this.threadChain(threadId));
    const threads = this.deps.sdk.threads;
    const lists = await Promise.all([
      ...[...chain].flatMap((id) => [threads.list({ sourceThreadId: id, archived: false, limit: 100 }), threads.list({ parentThreadId: id, archived: false, limit: 100 })]),
      threads.list({ archived: false, limit: 200 }),
    ].map((list) => list.catch(() => [] as ListedThread[])));
    // A listed thread says whether it waits on the user; a fetched one doesn't.
    const own = lists.flat().find((thread) => thread.id === threadId) ?? await threads.get({ threadId }).catch(() => null);
    return [...(own ? [own as ActivityThread] : []), ...lists.flat().filter((thread) => thread.id !== threadId && startedBy(thread, chain))];
  }

  /** startedThreads plus the threads those started, at any depth, from the recent list. */
  private async workThreads(threadId: string): Promise<(ActivityThread & Partial<ListedThread>)[]> {
    const [started, recent] = await Promise.all([
      this.startedThreads(threadId),
      this.deps.sdk.threads.list({ archived: false, limit: 200 }).catch(() => [] as ListedThread[]),
    ]);
    return [...started, ...descendants(recent, new Set(started.map((thread) => thread.id).filter((id) => id !== threadId)))];
  }

  private async automations(threadId: string): Promise<{ projectId: string | null; rows: AutomationRow[] }> {
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null);
    const projectId = thread?.projectId ?? PERSONAL_PROJECT_ID;
    const raw = await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_list", input: { projectId } as never, outputSchema: z.unknown() }).catch(() => []);
    const rows = (Array.isArray(raw) ? raw : []).flatMap((entry) => {
      const parsed = automationRow.safeParse(entry);
      return parsed.success && parsed.data.execution.targetThreadId === threadId ? [parsed.data] : [];
    });
    return { projectId, rows };
  }

  async activity(botId?: string): Promise<BotActivityView> {
    const { bot, run } = await this.get(botId);
    if (!bot?.threadId) return { needsYou: [], inProgress: [], waiting: [], scheduled: [], completed: [], latest: null };
    const [threads, automations, output] = await Promise.all([
      this.workThreads(bot.threadId),
      this.automations(bot.threadId),
      this.deps.sdk.threads.output({ threadId: bot.threadId }).catch(() => ({ output: null })),
    ]);
    // Runners have their own group; an urgent report puts its thread in Needs you.
    const runnerThreads = this.deps.runners?.threads(bot.id) ?? new Map<string, { urgent: boolean }>();
    const { needsYou, inProgress, waiting, completed } = classifyActivity(threads.filter((thread) => !runnerThreads.has(thread.id)), bot.threadId);
    const urgent = [...runnerThreads].filter(([, runner]) => runner.urgent).map(([id]) => id).filter((id) => !needsYou.some((thread) => thread.id === id));
    for (const thread of await Promise.all(urgent.map((threadId) => this.deps.sdk.threads.get({ threadId }).catch(() => null)))) {
      if (thread && !thread.archivedAt) needsYou.push({ id: thread.id, title: thread.title || thread.titleFallback || "Untitled runner", status: thread.status, projectId: thread.projectId ?? null, updatedAt: thread.updatedAt ?? 0, relation: "started", needsYou: true, parentId: null });
    }
    const HEARTBEAT_NAME = heartbeatName(bot.primary === false ? `${BOT_RUN_PREFIX}${bot.id}` : PERSONAL_PROJECT_ID);
    const scheduled: BotScheduledView[] = automations.rows.filter((automation) => !automation.execution.targetThreadId || !runnerThreads.has(automation.execution.targetThreadId)).map((automation) => ({
      id: automation.id,
      kind: automation.name === HEARTBEAT_NAME ? "heartbeat" : "automation",
      name: automation.name === HEARTBEAT_NAME ? "Check-in (heartbeat)" : automation.name,
      cron: automation.trigger.cron ?? null,
      enabled: automation.enabled,
      nextRunAt: automation.nextRunAt ?? null,
    }));
    if (run && !scheduled.some((each) => each.kind === "heartbeat")) {
      scheduled.unshift({ id: "heartbeat", kind: "heartbeat", name: "Check-in (heartbeat)", cron: null, enabled: run.enabled, nextRunAt: null });
    }
    scheduled.sort((a, b) => Number(b.kind === "heartbeat") - Number(a.kind === "heartbeat") || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
    const latest = output?.output ? output.output.slice(-1200) : null;
    return { needsYou, inProgress, waiting, scheduled, completed, latest };
  }
}
