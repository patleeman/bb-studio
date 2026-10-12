// The user's Bot: an always-on agent with a name, an avatar and a state
// (active, paused, stopped), modelled on ChatGPT's dots. It replaces the
// Chief of Staff. Its thread is an implementation detail: it is the personal
// project's lead (src/project-lead.ts), so a handoff rotates it and the
// project's heartbeat is the Bot's check-in. The `bots` table allows several
// Bots; Studio uses one (BOT_ID).
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
import { PERSONAL_PROJECT_ID, type ProjectLeads } from "./project-lead";

type Sdk = BbPluginApi["sdk"];
type ListedThread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
/** What Activity reads from a thread, listed or fetched. */
type ActivityThread = Pick<ListedThread, "id" | "title" | "titleFallback" | "status" | "projectId" | "updatedAt" | "archivedAt"> & { hasPendingInteraction?: boolean; queuedWork?: ListedThread["queuedWork"] };
export type BotState = "active" | "paused" | "stopped";
export const BOT_ID = "bot_main";
export const DEFAULT_BOT_NAME = "Bot";
export const DEFAULT_BOT_AVATAR = "🤖";
const HEARTBEAT_NAME = `Studio project heartbeat ${PERSONAL_PROJECT_ID}`;
const RUNNING = new Set(["active", "starting", "pending", "stopping"]);
/** Running now; a "pending" thread is waiting to start. */
const WORKING = new Set(["active", "starting", "stopping"]);

/** The Bot's check-in prompt. What to look at lives on its Memory page, not here. */
export function botHeartbeat(name: string): string {
  return `Check-in for ${JSON.stringify(name)}: read your Memory page and do what its "## Check-in" section says. Reply only if something matters to the user; otherwise finish without a final assistant message.`;
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

/** Instructions for the Bot's own thread, given at each session start. Short: they point at the page and tools. */
export function botInstructions(bot: { name: string; state: BotState; role?: string | null; memoryPageId?: string | null; skills?: readonly string[] }): string {
  const who = `You are ${JSON.stringify(bot.name)}, the user's Bot: an always-on agent that leads their personal project and sees every project. The user can rename, pause or stop you in Studio.${bot.role?.trim() ? `\nYour role, in the user's words: ${bot.role.trim()}` : ""}`;
  if (bot.state === "active") {
    const memory = bot.memoryPageId ? `Your Memory page is ${bot.memoryPageId}: read it with pages_read when you wake up, keep it short and edit it yourself with pages_edit; its "## Check-in" section is your check-in list.` : "";
    const skills = `Save a reusable procedure as your own skill with bot_skill_write${bot.skills?.length ? `; yours: ${bot.skills.join(", ")} (bot_skill_read)` : ""}. Search your past threads with bot_history_search.`;
    return [who, memory, skills].filter(Boolean).join("\n");
  }
  return `${who}\nYou are ${bot.state} by the user. Don't start new work: don't spawn or steer threads, change Studio items or schedule anything. Answer questions, and tell the user to resume you (Studio → Bot → Resume) for anything else.`;
}

/** A skill name as BB and the skill-creator want it: lowercase words joined by hyphens. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A shared skill's SKILL.md. */
export function skillMarkdown(skill: { name: string; description: string; body: string }): string {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body.trim()}\n`;
}

type BotRow = { id: string; name: string; avatar: string; state: BotState; thread_id: string | null; heartbeat_was_on: number; memory_page_id: string | null; shape: string | null; color: string | null; role: string | null; created_at: number; updated_at: number };
type SkillRow = { bot_id: string; name: string; description: string; body: string; created_at: number; updated_at: number };

/** Sorts threads into the Bot's Activity. Pending interactions win; then running; then queued; the rest are done. */
export function classifyActivity(threads: readonly ActivityThread[], botThreadId: string | null, limit = 15): Pick<BotActivityView, "needsYou" | "inProgress" | "waiting" | "completed"> {
  const view = (thread: ActivityThread): BotThreadView & { queued: boolean } => ({
    id: thread.id,
    title: thread.title || thread.titleFallback || "Untitled thread",
    status: thread.status,
    projectId: thread.projectId ?? null,
    updatedAt: thread.updatedAt ?? 0,
    relation: thread.id === botThreadId ? "self" : "started",
    needsYou: !!thread.hasPendingInteraction,
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
}

export class Bots {
  constructor(private readonly deps: BotDeps) {}

  private row(): BotRow | undefined {
    return this.deps.db.prepare("SELECT * FROM bots ORDER BY created_at, id LIMIT 1").get() as BotRow | undefined;
  }

  /** The Bot as stored, its thread read from the personal project's lead. */
  stored(): BotView["bot"] {
    const row = this.row();
    if (!row) return null;
    const threadId = this.deps.leads.storedLead(PERSONAL_PROJECT_ID);
    if (threadId !== row.thread_id) this.deps.db.prepare("UPDATE bots SET thread_id = ?, updated_at = ? WHERE id = ?").run(threadId, Date.now(), row.id);
    const memoryPageId = row.memory_page_id && this.deps.memory?.exists(row.memory_page_id) ? row.memory_page_id : null;
    return { id: row.id, name: row.name, avatar: row.avatar, state: row.state, threadId, memoryPageId, shape: row.shape ?? null, color: row.color ?? null, role: row.role ?? null, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  /** The heartbeat prompt for the personal project. */
  prompt(): string {
    return botHeartbeat(this.row()?.name ?? DEFAULT_BOT_NAME);
  }

  /**
   * The Bot whose thread this is, if any. A new Bot's thread starts before it
   * becomes the lead, so its spawn metadata (`{ bot: BOT_ID }`) counts while
   * the Bot has no thread yet.
   */
  forThread(threadId: string | undefined | null, metadata?: { readonly [key: string]: unknown }): NonNullable<BotView["bot"]> | null {
    if (!threadId) return null;
    const bot = this.stored();
    if (!bot) return null;
    if (bot.threadId === threadId) return bot;
    return !bot.threadId && metadata?.bot === bot.id ? { ...bot, threadId } : null;
  }

  async get(): Promise<BotView> {
    const lead = await this.deps.leads.get(PERSONAL_PROJECT_ID);
    return { bot: this.stored(), run: lead.run };
  }

  private insert(name: string, avatar: string, shape: string | null = null, color: string | null = null) {
    const now = Date.now();
    this.deps.db.prepare("INSERT OR IGNORE INTO bots (id, name, avatar, shape, color, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', NULL, 0, ?, ?)").run(BOT_ID, name, avatar, shape, color, now, now);
  }

  private update(fields: Partial<Pick<BotRow, "name" | "avatar" | "shape" | "color" | "role" | "state" | "heartbeat_was_on">>) {
    const row = this.row();
    if (!row) throw new Error("Make your Bot first.");
    const next = { ...row, ...fields };
    this.deps.db.prepare("UPDATE bots SET name = ?, avatar = ?, shape = ?, color = ?, role = ?, state = ?, heartbeat_was_on = ?, updated_at = ? WHERE id = ?").run(next.name, next.avatar, next.shape ?? null, next.color ?? null, next.role ?? null, next.state, next.heartbeat_was_on, Date.now(), row.id);
    this.deps.changed();
  }

  /** Makes the Bot from a thread, or a new chat in the personal project. */
  async create(input: { name: string; avatar: string; shape?: string; color?: string; threadId?: string; prompt?: string }): Promise<BotView> {
    if (this.row()) throw new Error("You already have a Bot.");
    // The row comes first, so the new thread's first turn gets the Bot's instructions (forThread).
    this.insert(input.name, input.avatar, input.shape ?? null, input.color ?? null);
    let threadId = input.threadId;
    try {
      if (!threadId) {
        const thread = await this.deps.sdk.threads.spawn({
          projectId: PERSONAL_PROJECT_ID,
          title: input.name,
          environment: { type: "project-default" },
          pluginMetadata: { bot: BOT_ID },
          // Its instructions come from agents.configure (botInstructions), so the first message is the user's.
          input: [{ type: "text", text: input.prompt ?? `Hi ${input.name}. Introduce yourself in a sentence and ask what I'd like you to keep an eye on.`, mentions: [] }],
        } as never);
        threadId = thread.id;
      }
      await this.deps.leads.setLead(PERSONAL_PROJECT_ID, threadId);
    } catch (error) {
      this.deps.db.prepare("DELETE FROM bots WHERE id = ?").run(BOT_ID);
      throw error;
    }
    this.deps.changed();
    return this.get();
  }

  async set(input: { name?: string; avatar?: string; shape?: string | null; color?: string; role?: string }): Promise<BotView> {
    const before = this.row();
    this.update({
      ...(input.name ? { name: input.name } : {}), ...(input.avatar ? { avatar: input.avatar } : {}),
      ...(input.shape !== undefined ? { shape: input.shape } : {}), ...(input.color ? { color: input.color } : {}),
      ...(input.role !== undefined ? { role: input.role.trim() || null } : {}),
    });
    // The heartbeat's prompt carries the name.
    const run = this.deps.leads.runs.get(PERSONAL_PROJECT_ID);
    if (input.name && input.name !== before?.name && run?.enabled) await this.deps.leads.setRun(PERSONAL_PROJECT_ID, run);
    return this.get();
  }

  /** Makes a thread the Bot's ("Make this my Bot"), making the Bot if there is none. */
  async setThread(threadId: string): Promise<BotView> {
    await this.deps.leads.setLead(PERSONAL_PROJECT_ID, threadId);
    if (!this.row()) this.insert(DEFAULT_BOT_NAME, DEFAULT_BOT_AVATAR);
    this.deps.changed();
    return this.get();
  }

  async setRun(input: { enabled: boolean; cadence: HeartbeatRun["cadence"]; time?: string; cron?: string }): Promise<BotView> {
    const row = this.row();
    if (input.enabled && row && row.state !== "active") throw new Error(`Your Bot is ${row.state}. Resume it before turning its heartbeat on.`);
    await this.deps.leads.setRun(PERSONAL_PROJECT_ID, input);
    return this.get();
  }

  /**
   * A check-in preset: one schedule and, unless it's Off, one line on the
   * Memory page's Check-in section saying what to do then.
   */
  async checkinPreset(preset: CheckinPreset): Promise<BotView> {
    const spec = CHECKIN_PRESETS[preset];
    if (!spec.run.enabled) {
      const run = this.deps.leads.runs.get(PERSONAL_PROJECT_ID);
      if (run?.enabled) await this.deps.leads.setRun(PERSONAL_PROJECT_ID, { ...run, enabled: false });
      return this.get();
    }
    const view = await this.setRun(spec.run);
    const pageId = this.memoryPage();
    if (pageId && spec.line) this.deps.memory?.addCheckin?.(pageId, spec.line);
    return view;
  }

  /** The Bot's thread and the ones it handed off from, oldest first: one continuous chat. */
  chain(): string[] {
    const bot = this.stored();
    return bot?.threadId ? this.threadChain(bot.threadId).reverse() : [];
  }

  /** Heartbeat off, remembering whether it was on; the Bot is told it's paused (botInstructions). */
  async pause(): Promise<BotView> {
    const row = this.row();
    if (!row) throw new Error("Make your Bot first.");
    if (row.state === "active") {
      const run = this.deps.leads.runs.get(PERSONAL_PROJECT_ID);
      if (run?.enabled) await this.deps.leads.setRun(PERSONAL_PROJECT_ID, { ...run, enabled: false });
      this.update({ state: "paused", heartbeat_was_on: run?.enabled ? 1 : 0 });
    }
    return this.get();
  }

  async resume(): Promise<BotView> {
    const row = this.row();
    if (!row) throw new Error("Make your Bot first.");
    if (row.state !== "active") {
      this.update({ state: "active", heartbeat_was_on: 0 });
      const run = this.deps.leads.runs.get(PERSONAL_PROJECT_ID);
      if (row.heartbeat_was_on && run && this.deps.leads.storedLead(PERSONAL_PROJECT_ID)) await this.deps.leads.setRun(PERSONAL_PROJECT_ID, { ...run, enabled: true });
    }
    return this.get();
  }

  /** Pause, stop the running threads it started, and pause automations that wake its thread. */
  async stop(): Promise<BotView & { stoppedThreadIds: string[]; pausedAutomationIds: string[] }> {
    await this.pause();
    const stoppedThreadIds: string[] = [];
    const pausedAutomationIds: string[] = [];
    const bot = this.stored();
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
    this.update({ state: "stopped" });
    return { ...(await this.get()), stoppedThreadIds, pausedAutomationIds };
  }

  /** The Bot's Memory page, made on first need. Null without a Bot or Pages. */
  memoryPage(): string | null {
    const row = this.row();
    const pages = this.deps.memory;
    if (!row || !pages) return null;
    if (row.memory_page_id && pages.exists(row.memory_page_id)) return row.memory_page_id;
    const pageId = pages.create({ title: `${row.name}'s Memory`, markdown: MEMORY_TEMPLATE });
    this.deps.db.prepare("UPDATE bots SET memory_page_id = ?, updated_at = ? WHERE id = ?").run(pageId, Date.now(), row.id);
    this.deps.changed();
    return pageId;
  }

  /** What the Bot's own thread is told; its Memory page is made here on first need. */
  instructions(bot: NonNullable<BotView["bot"]>): string {
    if (bot.state !== "active") return botInstructions(bot);
    let memoryPageId: string | null = null;
    try { memoryPageId = this.memoryPage(); } catch { /* Pages unavailable: no memory line. */ }
    return botInstructions({ ...bot, memoryPageId, skills: this.skills().map((skill) => skill.name) });
  }

  skills(): BotSkillView[] {
    const row = this.row();
    if (!row) return [];
    return (this.deps.db.prepare("SELECT * FROM bot_skills WHERE bot_id = ? ORDER BY name").all(row.id) as SkillRow[])
      .map((skill) => ({ name: skill.name, description: skill.description, updatedAt: skill.updated_at }));
  }

  skill(name: string): (BotSkillView & { body: string }) | null {
    const row = this.row();
    const skill = row ? this.deps.db.prepare("SELECT * FROM bot_skills WHERE bot_id = ? AND name = ?").get(row.id, name) as SkillRow | undefined : undefined;
    return skill ? { name: skill.name, description: skill.description, updatedAt: skill.updated_at, body: skill.body } : null;
  }

  /** Adds or replaces one of the Bot's own skills. Only its thread loads them. */
  writeSkill(input: { name: string; description: string; body: string }): BotSkillView {
    const row = this.row();
    if (!row) throw new Error("Make your Bot first.");
    if (!SKILL_NAME.test(input.name)) throw new Error("A skill name is lowercase words joined by hyphens, like weekly-review.");
    const now = Date.now();
    this.deps.db.prepare(`INSERT INTO bot_skills (bot_id, name, description, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (bot_id, name) DO UPDATE SET description = excluded.description, body = excluded.body, updated_at = excluded.updated_at`)
      .run(row.id, input.name, input.description.trim(), input.body, now, now);
    this.deps.changed();
    return { name: input.name, description: input.description.trim(), updatedAt: now };
  }

  deleteSkill(name: string): boolean {
    const row = this.row();
    const deleted = row ? this.deps.db.prepare("DELETE FROM bot_skills WHERE bot_id = ? AND name = ?").run(row.id, name).changes > 0 : false;
    if (deleted) this.deps.changed();
    return deleted;
  }

  /** Share: moves a skill into BB's user skills, where every agent finds it. */
  async shareSkill(name: string): Promise<{ path: string }> {
    const skill = this.skill(name);
    if (!skill) throw new Error(`Your Bot has no skill "${name}".`);
    if (!this.deps.userSkillsDir) throw new Error("BB's skills folder isn't available.");
    const dir = join(this.deps.userSkillsDir, skill.name);
    if (existsSync(dir)) throw new Error(`A skill named "${skill.name}" is already shared. Rename the Bot's or delete the other first.`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    await writeFile(path, skillMarkdown(skill), { flag: "wx" });
    this.deleteSkill(name);
    return { path };
  }

  /** Searches the Bot's own threads (its handoff chain and threads it started) through BB's thread search. */
  async historySearch(query: string, limit = 10): Promise<{ threadId: string; title: string; text: string }[]> {
    const bot = this.stored();
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

  /** The Bot's thread and the ones it handed off from, newest first. */
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

  async activity(): Promise<BotActivityView> {
    const { bot, run } = await this.get();
    if (!bot?.threadId) return { needsYou: [], inProgress: [], waiting: [], scheduled: [], completed: [], latest: null };
    const [threads, automations, output] = await Promise.all([
      this.startedThreads(bot.threadId),
      this.automations(bot.threadId),
      this.deps.sdk.threads.output({ threadId: bot.threadId }).catch(() => ({ output: null })),
    ]);
    const { needsYou, inProgress, waiting, completed } = classifyActivity(threads, bot.threadId);
    const scheduled: BotScheduledView[] = automations.rows.map((automation) => ({
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
