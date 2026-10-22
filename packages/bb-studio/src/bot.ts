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
//
// Stop is narrower (spawnedBy): it stops only threads an agent in the Bot's
// thread spawned, a BB child (parentThreadId) or one that archives with it
// (lifecycleOwnerThreadId). A fork or "continue in new thread" only sets
// sourceThreadId and is often the user's own work, so Stop leaves it running.
// Stop records the automations and runners it paused (bot_stop_paused), and
// Resume turns back on exactly those.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { SIDE_CHAT_PLUGIN } from "./bot-side-threads";
import type { BotActivityView, BotAvatarHistoryView, BotProfileChangeView, BotScheduledView, BotSkillView, BotThreadView, BotView, HeartbeatRun } from "./contract";
import { EXTERNAL_PROVIDERS, externalName, externalNote } from "./external-providers";
export { EXTERNAL_AGENTS_PLUGIN_ID, EXTERNAL_PROVIDERS, externalNote } from "./external-providers";
import { BOT_RUN_PREFIX, PERSONAL_PROJECT_ID, type ProjectLeads } from "./project-lead";
import { BOT_SHAPES } from "./bot-shapes";
import { lineDiff, lintSkill } from "./skill-learning";
import { AvatarImages, avatarImageUrl, type AvatarImageMeta, type AvatarImageRow } from "./bot-avatar";

type Sdk = BbPluginApi["sdk"];
type ListedThread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
/** What Activity reads from a thread, listed or fetched. */
type ActivityThread = Pick<ListedThread, "id" | "title" | "titleFallback" | "status" | "projectId" | "updatedAt" | "archivedAt"> & Partial<Pick<ListedThread, "providerId" | "sourceThreadId" | "parentThreadId" | "lifecycleOwnerThreadId">> & { hasPendingInteraction?: boolean; queuedWork?: ListedThread["queuedWork"] };
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
  return `Check-in for ${JSON.stringify(name)}: read your Memory page and do what its "## Check-in" section says. Do the checks yourself; if a worker thread really helps, reuse the one you used before (bb thread tell) instead of starting a new one each time. Reply only if something changed or needs the user; otherwise reply exactly [PASS]: no "✓", "nothing new" or other filler.`;
}

/** An external bot's check-in: it has no Memory page, so the message carries the ask. */
export function externalHeartbeat(name: string): string {
  return `Check-in for ${JSON.stringify(name)}: look over what you're keeping an eye on for me. Reply only if something changed or needs me; otherwise reply with one short line.`;
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
export function botInstructions(bot: { name: string; state: BotState; role?: string | null; memoryPageId?: string | null; skills?: readonly { name: string; description: string }[]; primary?: boolean }): string {
  const who = `You are ${JSON.stringify(bot.name)}, ${bot.primary === false ? "one of the user's Bots: an always-on agent that sees every project" : "the user's Bot: an always-on agent that leads their personal project and sees every project"}. The user can rename, pause or stop you in Studio.${bot.role?.trim() ? `\nYour role, in the user's words: ${bot.role.trim()}` : ""}`;
  if (bot.state === "active") {
    const memory = bot.memoryPageId ? `Your Memory page is ${bot.memoryPageId}: read it with pages_read when you wake up, keep it short and edit it yourself with pages_edit; its "## Check-in" section is your check-in list.` : "";
    // Progressive disclosure: names and one-line descriptions here, the full skill through bot_skill_view.
    const skills = [
      "Save a reusable procedure as a skill with bot_skill_write (bot_skill_patch fixes one). Search past threads with bot_history_search.",
      ...(bot.skills?.length ? ["Your skills (load one with bot_skill_view before you follow it):", ...bot.skills.map((skill) => `- ${skill.name}: ${skill.description}`)] : []),
    ].join("\n");
    const quiet = "Your chat is the user's inbox: post only what changed or needs them. When nothing did (a check-in with nothing new, a notice that a thread you started finished fine, an automation result like [PASS]), reply exactly [PASS]: no \"✓\", \"noted\" or other acknowledgement.";
    const runners = "Schedule with automation_create: check-ins, reminders, watchers, runners.";
    return [who, memory, quiet, runners, skills].filter(Boolean).join("\n");
  }
  return `${who}\nYou are ${bot.state} by the user. Don't start new work: don't spawn or steer threads, change Studio items or schedule anything. Answer questions, and tell the user to resume you (Studio → Bot → Resume) for anything else.`;
}

/**
 * Whether an agent may pause or stop a Bot from this thread. Only the Bot's
 * own chat (its handoff chain) may, when the user asks there; the user can
 * always use Studio's UI or RPC. Threads the Bot started, its runners and
 * threads that act for no Bot are refused, so delegated or unrelated work
 * can't switch the Bot off. Null: allowed; else the reason to return.
 */
export function botControlRefusal(acting: { via: "own" | "runner" | "started" } | null, action: "pause" | "stop"): string | null {
  if (acting?.via === "own") return null;
  const where = !acting ? "This thread isn't a Bot's chat" : acting.via === "runner" ? "A runner can't" : "A thread the Bot started can't";
  const reason = !acting ? `${where}, so it can't ${action} the Bot.` : `${where} ${action} its Bot.`;
  return `Refused: ${reason} Only the Bot's own chat can, when the user asks there, or the user in Studio → Bot → ${action === "pause" ? "Pause" : "Stop"}. Tell the user instead${acting?.via === "runner" ? " (runner_report)" : ""}.`;
}

/** A skill name as BB and the skill-creator want it: lowercase words joined by hyphens. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A shared skill's SKILL.md. */
export function skillMarkdown(skill: { name: string; description: string; body: string }): string {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body.trim()}\n`;
}

type BotRow = { id: string; name: string; avatar: string; state: BotState; thread_id: string | null; heartbeat_was_on: number; memory_page_id: string | null; shape: string | null; color: string | null; role: string | null; provider_id?: string | null; avatar_image_id?: string | null; avatar_image_prev?: string | null; created_at: number; updated_at: number };

export type PermissionMode = "accept-edits" | "auto" | "full";
export type ReasoningLevel = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | "ultracode";
/** What a thread runs on. */
export type ThreadExecution = { providerId: string | null; model: string | null; reasoning?: ReasoningLevel | null };

/**
 * A bot's kind comes from the provider it runs on now: an external agent
 * (Studio Agents) keeps its own memory and tools, so Studio's Memory page,
 * skills, runners and bot tools are off; every other provider runs BB's tools.
 */
export function botKind(providerId: string | null | undefined): "studio" | "external" {
  return providerId && EXTERNAL_PROVIDERS.some((each) => each.id === providerId) ? "external" : "studio";
}

/** The permission a bot runs with: the asked-for one if its provider supports it, else accept-edits, else the provider's first. */
export function pickPermission(modes: readonly string[], wanted?: string | null): PermissionMode {
  const supported = modes.filter((mode): mode is PermissionMode => mode === "accept-edits" || mode === "auto" || mode === "full");
  if (wanted && supported.includes(wanted as PermissionMode)) return wanted as PermissionMode;
  if (!supported.length || supported.includes("accept-edits")) return "accept-edits";
  return supported[0]!;
}

/**
 * How a thread's model change lands, as BB allows it: a thread keeps its
 * provider for life (threads.update takes a model and reasoning level, not a
 * provider), so the same provider switches the thread in place and another
 * provider hands it off to a new thread there.
 */
export function modelChange(current: ThreadExecution, next: ThreadExecution): "unchanged" | "in-place" | "handoff" {
  if (current.providerId && next.providerId !== current.providerId) return "handoff";
  return next.model === current.model && (next.reasoning ?? current.reasoning ?? null) === (current.reasoning ?? null) ? "unchanged" : "in-place";
}
/**
 * A new Bot's first message from the first-time flow (bot_create's `setup`,
 * what the user wants help with; empty when they didn't say). The Bot
 * introduces itself, asks a couple of questions, and then names and
 * describes itself and picks its look with bot_profile_update.
 */
export function setupPrompt(goal: string): string {
  const want = goal.trim();
  return [
    want ? `Hi! You're my new Bot. I'd like help with: ${want}` : "Hi! You're my new Bot. I haven't decided what you should help with yet.",
    "",
    `Start by introducing yourself in a sentence, then ask me ${want ? "one or two short questions about what I need" : "what I'd like help with"}. Once I've answered, pick a name, a one-line description and a look that fit the job, set them with bot_profile_update, and offer a check-in if one would help.`,
  ].join("\n");
}

/**
 * What a Bot may change about itself (bot_profile_update, and bot_set or
 * bot_avatar_generate from its thread). Every such edit is recorded in
 * bot_profile_changes, and the user can revert it.
 */
export const SELF_EDITABLE = ["name", "role", "avatar", "shape", "color"] as const;
export type SelfEditField = (typeof SELF_EDITABLE)[number];
export type ProfileField = SelfEditField | "avatarImage";
/** The user's alone, with how a Bot that tries is told. Anything not in SELF_EDITABLE is refused too. */
export const USER_ONLY_FIELDS: Readonly<Record<string, string>> = {
  state: "pause, resume or stop a Bot", paused: "pause a Bot", stopped: "stop a Bot", deleted: "delete a Bot", delete: "delete a Bot",
  model: "switch its model", providerId: "switch its provider", provider: "switch its provider", reasoning: "change its reasoning level",
  permissionMode: "change its permission mode", permission: "change its permission mode", enabled: "turn its check-ins and automations on or off",
  threadId: "move it to another thread", primary: "change which Bot is primary",
};
/** Who made an edit: a Bot (from one of its threads) or, with botId null, an agent elsewhere. */
export type ProfileActor = { botId: string | null; threadId?: string | null };
type ProfileChangeRow = { id: number; bot_id: string; actor_bot_id: string | null; thread_id: string | null; field: ProfileField; old_value: string | null; new_value: string | null; reverts: number | null; at: number };

/** Checks a self-edit: only SELF_EDITABLE fields, each valid; throws naming what's the user's. */
export function checkSelfEdit(changes: Record<string, unknown>): Partial<Record<SelfEditField, string | null>> {
  const refused = Object.keys(changes).filter((key) => !(SELF_EDITABLE as readonly string[]).includes(key));
  if (refused.length) {
    const why = [...new Set(refused.map((key) => USER_ONLY_FIELDS[key] ?? `change "${key}"`))];
    throw new Error(`Only the user can ${why.join(", ")}. A Bot can change its own ${SELF_EDITABLE.join(", ")} and avatar image.`);
  }
  const out: Partial<Record<SelfEditField, string | null>> = {};
  for (const [key, raw] of Object.entries(changes) as [SelfEditField, unknown][]) {
    if (raw === undefined) continue;
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (key === "shape") {
      if (value !== null && !(BOT_SHAPES as readonly unknown[]).includes(value)) throw new Error(`shape is one of ${BOT_SHAPES.join(", ")}, or null for the emoji.`);
      out.shape = value as string | null;
      continue;
    }
    if (typeof value !== "string") throw new Error(`${key} must be text.`);
    if (key === "name" && (!value || value.length > 60)) throw new Error("A name is 1 to 60 characters.");
    if (key === "role" && value.length > 400) throw new Error("A description is at most 400 characters.");
    if (key === "avatar" && (!value || value.length > 16)) throw new Error("avatar is one emoji.");
    if (key === "color" && !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error("color is #rrggbb.");
    out[key] = value;
  }
  return out;
}

type SkillRow = { bot_id: string; name: string; description: string; body: string; created_at: number; updated_at: number; state: "active" | "stale" | "archived"; pinned: number; used_at: number | null };
const skillView = (skill: SkillRow): BotSkillView => ({ name: skill.name, description: skill.description, updatedAt: skill.updated_at, state: skill.state, pinned: !!skill.pinned, usedAt: skill.used_at ?? null });

/** A provider's display name for a handoff note. */
function providerName(providerId: string | null | undefined): string {
  const names: Record<string, string> = { claude: "Claude", "claude-code": "Claude", codex: "Codex", pi: "Pi", opencode: "OpenCode" };
  return (providerId && names[providerId]) ?? externalName(providerId);
}

/** Sorts threads into the Bot's Activity. Pending interactions win; then running; then queued; the rest are done. */
export function classifyActivity(threads: readonly ActivityThread[], botThreadId: string | null, limit = 15): Pick<BotActivityView, "needsYou" | "inProgress" | "waiting" | "completed"> {
  // A thread started by another listed thread nests under it; the rest hang off the Bot.
  const listed = new Set(threads.map((thread) => thread.id).filter((id) => id !== botThreadId));
  const parentOf = (thread: ActivityThread) => [thread.parentThreadId, thread.sourceThreadId, thread.lifecycleOwnerThreadId].find((id) => !!id && id !== thread.id && listed.has(id)) ?? null;
  const view = (thread: ActivityThread): BotThreadView & { queued: boolean } => ({
    id: thread.id,
    title: thread.title || thread.titleFallback || "Untitled thread",
    status: thread.status,
    providerId: thread.providerId ?? null,
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

/**
 * Whether an agent in one of `botThreads` spawned this thread: BB's child
 * (parentThreadId, set only by an explicit parent) or a dependent that
 * archives with it (lifecycleOwnerThreadId). A fork's sourceThreadId alone
 * doesn't count: the user forks or continues a Bot's chat too. Stop uses it.
 */
export function spawnedBy(thread: Partial<Pick<ListedThread, "parentThreadId" | "lifecycleOwnerThreadId" | "originPluginId">>, botThreads: ReadonlySet<string>): boolean {
  // BB's side-chat makes the chat a side chat's lifecycle owner: it's the user's conversation, not the Bot's work.
  if (thread.originPluginId === SIDE_CHAT_PLUGIN) return false;
  return [thread.parentThreadId, thread.lifecycleOwnerThreadId].some((id) => !!id && botThreads.has(id));
}

/** A hidden fork: a side chat (BB's side-chat, or one without an owner) or a skill review, not work the Bot owns. */
function hiddenFork(thread: Partial<Pick<ListedThread, "visibility" | "originKind" | "parentThreadId" | "lifecycleOwnerThreadId" | "originPluginId">>): boolean {
  if (thread.visibility !== "hidden" || thread.originKind !== "fork") return false;
  return thread.originPluginId === SIDE_CHAT_PLUGIN || (!thread.parentThreadId && !thread.lifecycleOwnerThreadId);
}

/** Whether BB's metadata says one of `botThreads` started this thread, forks included (Activity and history). */
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
  runners?: {
    threads(botId?: string): Map<string, { urgent: boolean }>;
    pauseAll(botId?: string, onPaused?: (id: string) => void): Promise<string[]>;
    /** Turns a runner Stop paused back on; false when it was deleted since. */
    restore(id: string): Promise<boolean>;
  };
  /** Skill review forks (src/skill-learning.ts): background work, kept out of Activity. */
  hiddenThreads?(): ReadonlySet<string>;
  /** Threads a Bot owns that BB doesn't link to it, such as its automations' runs (src/bot-owned.ts): Activity lists them. */
  ownedThreads?(botId: string): ReadonlySet<string>;
  /** A Bot got a thread (made, set or handed off): its chain leaves BB's thread list (src/bot-owned.ts). */
  claimChains?(): Promise<unknown>;
  /** Automations BB kept turning off that Studio stopped resuming (src/auto-resume.ts): Needs you until they're on again. */
  automationAlerts?(botId: string): readonly { name: string; message: string; at: number }[];
  /** Check-ins, reminders and watchers (src/automations.ts): Pause and Stop turn them off, Resume back on. */
  automations?: {
    pauseAll(botId: string, onPaused?: (id: string) => void): Promise<string[]>;
    restore(id: string): Promise<boolean>;
    /** The Bot's thread changed: check-ins and reminders follow it. */
    follow(botId: string): Promise<void>;
  };
}

export class Bots {
  /** Its image avatars (src/bot-avatar.ts). */
  readonly images: AvatarImages;
  constructor(private readonly deps: BotDeps) {
    this.images = new AvatarImages(deps.db);
  }

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

  /** Where a Bot's original check-in (heartbeat) lives in ProjectRuns. */
  heartbeatKey(botId?: string): string | null {
    const row = this.row(botId);
    return row ? this.runKey(row) : null;
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
    return { id: row.id, name: row.name, avatar: row.avatar, state: row.state, threadId, memoryPageId, shape: row.shape ?? null, color: row.color ?? null, role: row.role ?? null, avatarImageUrl: row.avatar_image_id ? avatarImageUrl(row.id, row.avatar_image_id) : null, primary, kind: botKind(row.provider_id), providerId: row.provider_id ?? null, model: (threadId ? this.models.get(threadId) : null) ?? null, createdAt: row.created_at, updatedAt: row.updated_at };
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
    return row ? (botKind(row.provider_id) === "external" ? externalHeartbeat(row.name) : botHeartbeat(row.name)) : null;
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
    if (named) return { ...named, threadId };
    // A handoff's new thread starts before the bot moves to it.
    const from = typeof metadata?.handoffFrom === "string" ? bots.find((bot) => bot.threadId === metadata.handoffFrom) : undefined;
    return from ? { ...from, threadId } : null;
  }

  /**
   * The Bot a thread acts for, and how: its own thread or one it handed off
   * from ("own"), a runner's thread (`runnerBot` names the runner's Bot), or a
   * thread it started, walking parent, source and lifecycle owner up to a Bot
   * or runner thread (depth-limited). Null: no Bot's, so tools fall back to
   * the primary Bot.
   */
  async actingFor(threadId: string | undefined | null, runnerBot?: (threadId: string) => string | null | undefined): Promise<{ botId: string; via: "own" | "runner" | "started" } | null> {
    if (!threadId) return null;
    const bots = this.list();
    const chains = bots.flatMap((bot) => bot.threadId ? [[bot.id, new Set(this.threadChain(bot.threadId))] as const] : []);
    const seen = new Set<string>();
    let id: string | null | undefined = threadId;
    for (let depth = 0; id && depth < 8 && !seen.has(id); depth++) {
      seen.add(id);
      const own = chains.find(([, chain]) => chain.has(id!));
      if (own) return { botId: own[0], via: depth === 0 ? "own" : "started" };
      const runner = runnerBot?.(id);
      if (runner && bots.some((bot) => bot.id === runner)) return { botId: runner, via: depth === 0 ? "runner" : "started" };
      const thread: Partial<ListedThread> | null = await this.deps.sdk.threads.get({ threadId: id }).catch(() => null);
      id = thread ? thread.parentThreadId ?? thread.sourceThreadId ?? thread.lifecycleOwnerThreadId : null;
    }
    return null;
  }

  async get(botId?: string | null): Promise<BotView> {
    let row = this.row(botId);
    if (botId && !row) throw new Error(`No Bot "${botId}".`);
    if (row) row = await this.refresh(row);
    if (!row || this.isPrimary(row)) {
      const lead = await this.deps.leads.get(PERSONAL_PROJECT_ID);
      return { bot: this.stored(row?.id), run: lead.run };
    }
    return { bot: this.view(row), run: this.deps.leads.runs.get(this.runKey(row)) };
  }

  private insert(id: string, name: string, avatar: string, shape: string | null = null, color: string | null = null, providerId: string | null = null) {
    const now = Date.now();
    this.deps.db.prepare("INSERT OR IGNORE INTO bots (id, name, avatar, shape, color, state, thread_id, heartbeat_was_on, provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', NULL, 0, ?, ?, ?)")
      .run(id, name, avatar, shape, color, providerId, now, now);
  }

  /** The current thread's model, by thread id: read off BB, never a bot setting. */
  private readonly models = new Map<string, string>();

  /**
   * Reads what the bot's current thread runs on. The model and provider are
   * the thread's (BB's composer changes them); `provider_id` only caches the
   * provider so the bot's kind is known where reads must be synchronous
   * (agents.configure, requireStudio).
   */
  private async refresh(row: BotRow): Promise<BotRow> {
    const threadId = this.view(row).threadId;
    if (!threadId) return row;
    const [thread, options] = await Promise.all([
      this.deps.sdk.threads.get({ threadId }).catch(() => null),
      this.deps.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null),
    ]);
    if (options?.model) this.models.set(threadId, options.model);
    if (!thread?.providerId || thread.providerId === row.provider_id) return row;
    this.deps.db.prepare("UPDATE bots SET provider_id = ? WHERE id = ?").run(thread.providerId, row.id);
    return this.need(row.id);
  }

  /** BB's agent provider entry (permission modes, reasoning levels), or null when it isn't registered. */
  private async provider(providerId: string): Promise<{ modes: string[]; levels: string[] } | null> {
    let providers: Awaited<ReturnType<Sdk["providers"]["list"]>> = [];
    try { providers = await this.deps.sdk.providers.list(); } catch { /* No provider list. */ }
    const provider = providers.find((each) => each.id === providerId) as { capabilities?: { permissionModes?: readonly string[] }; reasoningLevels?: readonly ({ id: string } | string)[] } | undefined;
    if (!provider) return null;
    return { modes: [...(provider.capabilities?.permissionModes ?? [])], levels: (provider.reasoningLevels ?? []).map((each) => typeof each === "string" ? each : each.id) };
  }

  /**
   * Switches any thread's model. BB keeps a thread on its provider, so the
   * same provider changes it in place (threads.update, as BB's composer
   * does) and another provider hands it off: a new thread there with a
   * summary of this one, its permission carried forward, the old one archived.
   * A bot's thread hands off along its chain (check-in and runners follow).
   */
  async switchModel(threadId: string, input: { providerId: string; model: string; reasoning?: ReasoningLevel }): Promise<{ change: "unchanged" | "in-place" | "handoff"; threadId: string }> {
    const [thread, options] = await Promise.all([
      this.deps.sdk.threads.get({ threadId }),
      this.deps.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null),
    ]);
    const provider = await this.provider(input.providerId);
    if (!provider) throw new Error(`${input.providerId} isn't an agent provider BB has right now.`);
    const bot = this.forThread(threadId);
    const external = botKind(input.providerId) === "external";
    if (bot?.primary && external) throw new Error(`${bot.name} leads your personal project with Studio's tools, so it can't run on ${externalName(input.providerId)}. Import another bot for that.`);
    const levels = provider.levels;
    const fits = (level: string | null | undefined): level is ReasoningLevel => !!level && (!levels.length || levels.includes(level));
    const reasoning: ReasoningLevel = external ? "none" : fits(input.reasoning) ? input.reasoning : fits(options?.reasoningLevel) ? options!.reasoningLevel as ReasoningLevel : (levels[0] as ReasoningLevel | undefined) ?? "medium";
    const change = modelChange({ providerId: thread.providerId, model: options?.model ?? null, reasoning: (options?.reasoningLevel ?? null) as ReasoningLevel | null }, { providerId: input.providerId, model: input.model, reasoning: input.reasoning ?? null });
    if (change === "unchanged") return { change, threadId };
    if (change === "in-place") {
      await this.deps.sdk.threads.update({ threadId, model: input.model, ...(input.reasoning ? { reasoningLevel: input.reasoning } : {}) });
      this.models.set(threadId, input.model);
      this.deps.changed();
      return { change, threadId };
    }
    const permission = pickPermission(provider.modes, options?.permissionMode);
    const { threadId: newId } = await this.deps.leads.handoff(threadId, {
      projectId: thread.projectId, providerId: input.providerId, model: input.model, reasoningLevel: reasoning, permissionMode: permission,
      executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
      environment: { type: "project-default" },
      input: [{ type: "text", text: `You were moved from ${providerName(thread.providerId)} to ${providerName(input.providerId)} (${input.model}). Say in a sentence that you're here and carry on.`, mentions: [], visibility: "agent-only" }],
    } as never);
    await this.handedOff(threadId, newId);
    if (bot) this.deps.db.prepare("UPDATE bots SET provider_id = ?, updated_at = ? WHERE id = ?").run(input.providerId, Date.now(), bot.id);
    this.models.set(newId, input.model);
    this.deps.changed();
    return { change, threadId: newId };
  }

  /** Throws for an external bot: `what` (its Memory page, skills, runners) lives on its provider. */
  requireStudio(botId: string | undefined, what: string): void {
    const row = this.row(botId);
    if (row && botKind(row.provider_id) === "external") throw new Error(`${row.name} has no Studio ${what}. ${externalNote(row.provider_id)}`);
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
  async create(input: { name: string; avatar: string; shape?: string; color?: string; threadId?: string; prompt?: string; setup?: string; external?: { providerId: string; model: string; permissionMode?: PermissionMode } }): Promise<BotView> {
    let external = input.external;
    if (external && !EXTERNAL_PROVIDERS.some((each) => each.id === external!.providerId)) throw new Error(`${external.providerId} isn't an external agent provider.`);
    // Accept edits unless asked otherwise, where the provider supports it.
    if (external) external = { ...external, permissionMode: pickPermission((await this.provider(external.providerId))?.modes ?? [], external.permissionMode ?? "accept-edits") };
    if (external && input.threadId) throw new Error("An imported bot starts its own thread on its provider.");
    // The primary Bot leads the personal project with Studio's tools, so an import is always an additional Bot.
    if (external && !this.row()) throw new Error("Make your first bot in Studio, then import others.");
    const primary = !this.row();
    const id = primary ? BOT_ID : `bot_${Math.random().toString(36).slice(2, 12)}`;
    // The row comes first, so the new thread's first turn gets the Bot's instructions (forThread).
    this.insert(id, input.name, input.avatar, input.shape ?? null, input.color ?? null, external?.providerId ?? null);
    let threadId = input.threadId;
    try {
      if (threadId && this.forThread(threadId)) throw new Error("That thread is already a Bot's.");
      if (!threadId) {
        const thread = await this.deps.sdk.threads.spawn({
          projectId: PERSONAL_PROJECT_ID,
          title: input.name,
          environment: { type: "project-default" },
          pluginMetadata: { bot: id },
          // Studio Agents' providers take no reasoning levels; the permission is the bot's (accept edits by default).
          ...(external ? { providerId: external.providerId, model: external.model, reasoningLevel: "none", permissionMode: external.permissionMode, executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" } } : {}),
          // Its instructions come from agents.configure (botInstructions), so the first message is the user's.
          input: [{ type: "text", text: input.prompt ?? (input.setup !== undefined ? setupPrompt(input.setup) : `Hi ${input.name}. Introduce yourself in a sentence and ask what I'd like you to keep an eye on.`), mentions: [] }],
        } as never);
        threadId = thread.id;
      }
      if (primary) await this.deps.leads.setLead(PERSONAL_PROJECT_ID, threadId);
      else this.deps.db.prepare("UPDATE bots SET thread_id = ?, updated_at = ? WHERE id = ?").run(threadId, Date.now(), id);
    } catch (error) {
      this.deps.db.prepare("DELETE FROM bots WHERE id = ?").run(id);
      throw error;
    }
    await this.claimChains();
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

  /** The image a Bot shows, by id; undefined when it's gone. For the avatar route. */
  avatarImage(botId: string, imageId: string): AvatarImageRow | undefined {
    return this.images.get(botId, imageId);
  }

  /** A Bot's image avatars, newest first: the one shown, and the one Revert goes back to ("" for the drawn avatar, null for nothing). */
  avatarHistory(botId?: string): BotAvatarHistoryView {
    const row = this.need(botId);
    const view = (image: AvatarImageMeta) => ({ id: image.id, url: avatarImageUrl(row.id, image.id), mime: image.mime, source: image.source, prompt: image.prompt, provider: image.provider, createdAt: image.created_at });
    return { current: row.avatar_image_id ?? null, previous: row.avatar_image_prev ?? null, images: this.images.list(row.id).map(view) };
  }

  /**
   * Shows one of the Bot's images, or the drawn avatar (null). What it
   * replaces becomes Revert's target, so Revert flips between the two.
   */
  useAvatarImage(botId: string | undefined, imageId: string | null): NonNullable<BotView["bot"]> {
    const row = this.need(botId);
    if (imageId && !this.images.get(row.id, imageId)) throw new Error("That avatar image is gone; Bots keep their last few.");
    const current = row.avatar_image_id ?? null;
    if (imageId === current) return this.view(row);
    this.deps.db.prepare("UPDATE bots SET avatar_image_id = ?, avatar_image_prev = ?, updated_at = ? WHERE id = ?").run(imageId, current ?? "", Date.now(), row.id);
    this.images.prune(row.id, [imageId, current]);
    this.deps.changed();
    return this.view(this.need(row.id));
  }

  /** Saves a new image and shows it. With an `actor` (an agent's edit), it's recorded for the user to see and revert. */
  addAvatarImage(botId: string | undefined, image: { data: Buffer; mime: string; source: "generated" | "upload"; prompt?: string | null; provider?: string | null }, actor?: ProfileActor): NonNullable<BotView["bot"]> {
    const row = this.need(botId);
    const saved = this.images.add({ botId: row.id, ...image });
    const view = this.useAvatarImage(row.id, saved.id);
    if (actor) this.recordChange(row.id, actor, "avatarImage", row.avatar_image_id ?? "", saved.id);
    return view;
  }

  // -------------------------------------------------------------------------
  // Self-edits: a Bot changing its own profile, recorded in bot_profile_changes
  // (append-only) so the user sees "Changed by <Bot>" and can revert.
  // -------------------------------------------------------------------------

  private recordChange(botId: string, actor: ProfileActor, field: ProfileField, oldValue: string | null, newValue: string | null, reverts: number | null = null): void {
    this.deps.db.prepare("INSERT INTO bot_profile_changes (bot_id, actor_bot_id, thread_id, field, old_value, new_value, reverts, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(botId, actor.botId, actor.threadId ?? null, field, oldValue, newValue, reverts, Date.now());
  }

  /**
   * A Bot (or an agent elsewhere, actor.botId null) edits a Bot's profile:
   * only SELF_EDITABLE fields (checkSelfEdit throws on the rest, state, model
   * and permissions included). Each field that changed is recorded.
   */
  async selfEdit(botId: string | undefined, changes: Record<string, unknown>, actor: ProfileActor): Promise<{ view: BotView; changed: SelfEditField[] }> {
    const input = checkSelfEdit(changes);
    const before = this.need(botId);
    const changed = (Object.keys(input) as SelfEditField[]).filter((key) => (before[key] ?? null) !== (key === "role" ? input.role || null : input[key]));
    if (!changed.length) return { view: await this.get(before.id), changed };
    const view = await this.set({
      botId: before.id,
      ...(changed.includes("name") ? { name: input.name! } : {}), ...(changed.includes("avatar") ? { avatar: input.avatar! } : {}),
      ...(changed.includes("shape") ? { shape: input.shape ?? null } : {}), ...(changed.includes("color") ? { color: input.color! } : {}),
      ...(changed.includes("role") ? { role: input.role ?? "" } : {}),
    });
    for (const field of changed) this.recordChange(before.id, actor, field, before[field] ?? null, field === "role" ? input.role || null : input[field] ?? null);
    this.deps.changed();
    return { view, changed };
  }

  /** The Bot's own edits and the user's reverts, newest first. */
  profileChanges(botId?: string, limit = 50): BotProfileChangeView[] {
    const row = this.need(botId);
    const rows = this.deps.db.prepare("SELECT * FROM bot_profile_changes WHERE bot_id = ? ORDER BY id DESC LIMIT ?").all(row.id, limit) as ProfileChangeRow[];
    const reverted = new Map((this.deps.db.prepare("SELECT reverts, at FROM bot_profile_changes WHERE bot_id = ? AND reverts IS NOT NULL").all(row.id) as { reverts: number; at: number }[]).map((each) => [each.reverts, each.at]));
    const names = new Map(this.rows().map((each) => [each.id, each.name]));
    const imageUrl = (field: ProfileField, value: string | null) => field === "avatarImage" && value && this.images.get(row.id, value) ? avatarImageUrl(row.id, value) : null;
    return rows.map((each) => ({
      id: each.id, field: each.field, oldValue: each.old_value, newValue: each.new_value,
      oldImageUrl: imageUrl(each.field, each.old_value), newImageUrl: imageUrl(each.field, each.new_value),
      actorBotId: each.actor_bot_id, actorName: each.actor_bot_id ? names.get(each.actor_bot_id) ?? null : null, threadId: each.thread_id,
      at: each.at, reverts: each.reverts, revertedAt: reverted.get(each.id) ?? null,
    }));
  }

  /** The user restores what a Bot's edit replaced; the revert is recorded too, so it can't be reverted twice. */
  async revertChange(botId: string | undefined, changeId: number): Promise<BotView> {
    const row = this.need(botId);
    const change = this.deps.db.prepare("SELECT * FROM bot_profile_changes WHERE id = ? AND bot_id = ?").get(changeId, row.id) as ProfileChangeRow | undefined;
    if (!change) throw new Error("No such change.");
    if (change.reverts !== null) throw new Error("That's a revert; change it in Bot info → Profile instead.");
    if (this.deps.db.prepare("SELECT 1 FROM bot_profile_changes WHERE reverts = ?").get(change.id)) throw new Error("That change is already reverted.");
    const user: ProfileActor = { botId: null };
    if (change.field === "avatarImage") {
      const current = row.avatar_image_id ?? "";
      this.useAvatarImage(row.id, change.old_value || null);
      this.recordChange(row.id, user, "avatarImage", current, change.old_value, change.id);
      return this.get(row.id);
    }
    const field = change.field as SelfEditField;
    const current = row[field] ?? null;
    if (field === "name") await this.set({ botId: row.id, name: change.old_value ?? DEFAULT_BOT_NAME });
    else this.update(row, { [field]: field === "avatar" ? change.old_value ?? DEFAULT_BOT_AVATAR : change.old_value });
    this.recordChange(row.id, user, field, current, change.old_value, change.id);
    this.deps.changed();
    return this.get(row.id);
  }

  /** Back to the avatar the last change replaced (an image or the drawn one). */
  revertAvatar(botId?: string): NonNullable<BotView["bot"]> {
    const row = this.need(botId);
    if (row.avatar_image_prev == null) throw new Error(`${row.name} has no earlier avatar to go back to.`);
    return this.useAvatarImage(row.id, row.avatar_image_prev || null);
  }

  /** Makes a thread the primary Bot's ("Make this my Bot"), making the Bot if there is none. */
  async setThread(threadId: string): Promise<BotView> {
    const other = this.forThread(threadId);
    if (other && !other.primary) throw new Error(`That thread is ${other.name}'s.`);
    await this.deps.leads.setLead(PERSONAL_PROJECT_ID, threadId);
    if (!this.row()) this.insert(BOT_ID, DEFAULT_BOT_NAME, DEFAULT_BOT_AVATAR);
    await this.claimChains();
    this.deps.changed();
    return this.get();
  }

  /** Hides the Bots' chains from BB's thread list; a failure waits for the next sweep. */
  private async claimChains(): Promise<void> {
    await this.deps.claimChains?.().catch(() => {});
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

  /** The chain with each thread's title, read by id (hidden threads don't show in BB's own title lookup). "Untitled" only when BB has neither title. */
  async chainThreads(botId?: string): Promise<{ id: string; title: string }[]> {
    return Promise.all(this.chain(botId).map(async (id) => {
      const thread = await this.deps.sdk.threads.get({ threadId: id }).catch(() => null);
      return { id, title: thread?.title?.trim() || thread?.titleFallback?.trim() || "Untitled" };
    }));
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
    // Check-ins and reminders follow whichever Bot's thread this was (the primary's too).
    let bot = false;
    for (const row of this.rows()) {
      if (this.view(row).threadId !== newThreadId) continue;
      bot = true;
      await this.deps.automations?.follow(row.id).catch(() => {});
    }
    if (bot) await this.claimChains();
  }

  /** Heartbeat off, remembering whether it was on; the Bot is told it's paused (botInstructions). */
  async pause(botId?: string): Promise<BotView> {
    const row = this.need(botId);
    if (row.state === "active") {
      const run = this.deps.leads.runs.get(this.runKey(row));
      if (run?.enabled) await this.writeRun(row, { ...run, enabled: false });
      // Its other check-ins, reminders and watchers too; Resume turns back on these.
      await this.deps.automations?.pauseAll(row.id, (id) => this.rememberPaused(row.id, "bot-automation", id));
      this.update(this.need(row.id), { state: "paused", heartbeat_was_on: run?.enabled ? 1 : 0 });
    }
    return this.get(row.id);
  }

  async resume(botId?: string): Promise<BotView> {
    const row = this.need(botId);
    if (row.state !== "active") {
      // The heartbeat comes back first: if that fails the Bot stays paused and remembers it, so Resume can be retried.
      const run = this.deps.leads.runs.get(this.runKey(row));
      if (row.heartbeat_was_on && run && this.view(row).threadId) await this.writeRun(row, { ...run, enabled: true });
      // Then what Stop paused; one that fails stays recorded and the Bot stays as it was.
      await this.restorePaused(row.id);
      this.update(this.need(row.id), { state: "active", heartbeat_was_on: 0 });
    }
    return this.get(row.id);
  }

  /**
   * Turns back on the automations and runners Stop paused, forgetting each
   * one restored. Ones deleted since are forgotten quietly. Tries them all,
   * then throws the first failure, keeping the failed ones for a retry.
   */
  private async restorePaused(botId: string): Promise<void> {
    const rows = this.deps.db.prepare("SELECT kind, item_id, project_id FROM bot_stop_paused WHERE bot_id = ? ORDER BY rowid").all(botId) as { kind: string; item_id: string; project_id: string | null }[];
    const forget = this.deps.db.prepare("DELETE FROM bot_stop_paused WHERE bot_id = ? AND kind = ? AND item_id = ?");
    const listed = new Map<string, Promise<Map<string, boolean>>>();
    const failures: unknown[] = [];
    for (const each of rows) {
      try {
        if (each.kind === "automation") {
          const projectId = each.project_id ?? PERSONAL_PROJECT_ID;
          if (!listed.has(projectId)) listed.set(projectId, this.automationStates(projectId));
          const enabled = (await listed.get(projectId)!).get(each.item_id);
          if (enabled === false) await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_resume", input: { projectId, automationId: each.item_id } as never, outputSchema: z.unknown() });
        } else if (each.kind === "runner") {
          await this.deps.runners?.restore(each.item_id);
        } else if (each.kind === "bot-automation") {
          await this.deps.automations?.restore(each.item_id);
        }
        forget.run(botId, each.kind, each.item_id);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  }

  /** Every automation in a project and whether it's on. Throws when the list fails, so nothing is taken for deleted. */
  private async automationStates(projectId: string): Promise<Map<string, boolean>> {
    const raw = await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_list", input: { projectId } as never, outputSchema: z.unknown() });
    const rows = z.array(z.object({ id: z.string(), enabled: z.boolean() }).passthrough()).parse(raw);
    return new Map(rows.map((row) => [row.id, row.enabled]));
  }

  /** Records what Stop paused, for Resume. */
  private rememberPaused(botId: string, kind: "automation" | "runner" | "bot-automation", itemId: string, projectId: string | null = null): void {
    this.deps.db.prepare("INSERT OR IGNORE INTO bot_stop_paused (bot_id, kind, item_id, project_id) VALUES (?, ?, ?, ?)").run(botId, kind, itemId, projectId);
  }

  /** Pause, stop the running threads it spawned (spawnedBy; not forks of its chat), and pause automations that wake its thread and its runners; Resume restores those. */
  async stop(botId?: string): Promise<BotView & { stoppedThreadIds: string[]; pausedAutomationIds: string[] }> {
    const id = this.need(botId).id;
    await this.pause(id);
    const stoppedThreadIds: string[] = [];
    const pausedAutomationIds: string[] = [];
    const bot = this.stored(id);
    if (bot?.threadId) {
      const chain = new Set(this.threadChain(bot.threadId));
      for (const thread of await this.startedThreads(bot.threadId)) {
        // startedThreads merges overlapping lists: stop each thread once.
        if (thread.id === bot.threadId || stoppedThreadIds.includes(thread.id) || thread.archivedAt || !RUNNING.has(thread.status) || !spawnedBy(thread, chain)) continue;
        await this.deps.sdk.threads.stop({ threadId: thread.id });
        stoppedThreadIds.push(thread.id);
      }
      const { projectId, rows } = await this.automations(bot.threadId);
      for (const automation of rows) {
        if (!automation.enabled) continue;
        await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_pause", input: { projectId, automationId: automation.id } as never, outputSchema: z.unknown() });
        this.rememberPaused(id, "automation", automation.id, projectId);
        pausedAutomationIds.push(automation.id);
      }
    }
    await this.deps.runners?.pauseAll(id, (runnerId) => this.rememberPaused(id, "runner", runnerId));
    this.update(this.need(id), { state: "stopped" });
    return { ...(await this.get(id)), stoppedThreadIds, pausedAutomationIds };
  }

  /** A Bot's Memory page, made on first need. Null without a Bot or Pages. */
  memoryPage(botId?: string): string | null {
    const row = this.row(botId);
    const pages = this.deps.memory;
    if (!row || !pages || botKind(row.provider_id) === "external") return null;
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
    return botInstructions({ ...bot, memoryPageId, skills: this.skills(bot.id).filter((skill) => skill.state !== "archived") });
  }

  skills(botId?: string): BotSkillView[] {
    const row = this.row(botId);
    if (!row) return [];
    return (this.deps.db.prepare("SELECT * FROM bot_skills WHERE bot_id = ? ORDER BY name").all(row.id) as SkillRow[]).map(skillView);
  }

  skill(name: string, botId?: string): (BotSkillView & { body: string }) | null {
    const row = this.row(botId);
    const skill = row ? this.deps.db.prepare("SELECT * FROM bot_skills WHERE bot_id = ? AND name = ?").get(row.id, name) as SkillRow | undefined : undefined;
    return skill ? { ...skillView(skill), body: skill.body } : null;
  }

  /** The Bot loaded a skill (bot_skill_view): it's in use, so a stale one is active again. */
  touchSkill(name: string, botId?: string): void {
    const row = this.row(botId);
    if (row) this.deps.db.prepare("UPDATE bot_skills SET used_at = ?, state = CASE WHEN state = 'stale' THEN 'active' ELSE state END WHERE bot_id = ? AND name = ?").run(Date.now(), row.id, name);
  }

  /** The curator's and Restore's state change; archived skills are hidden from the Bot, never deleted. */
  setSkillState(name: string, state: "active" | "stale" | "archived", botId?: string): boolean {
    const row = this.row(botId);
    // Restored counts as used, so the next curator run doesn't archive it again.
    const changed = row ? this.deps.db.prepare(`UPDATE bot_skills SET state = ?${state === "active" ? ", used_at = ?" : ""} WHERE bot_id = ? AND name = ?`).run(...(state === "active" ? [state, Date.now()] : [state]), row.id, name).changes > 0 : false;
    if (changed) this.deps.changed();
    return changed;
  }

  /** Pinned skills are exempt from the curator. */
  pinSkill(name: string, pinned: boolean, botId?: string): boolean {
    const row = this.row(botId);
    const changed = row ? this.deps.db.prepare("UPDATE bot_skills SET pinned = ? WHERE bot_id = ? AND name = ?").run(pinned ? 1 : 0, row.id, name).changes > 0 : false;
    if (changed) this.deps.changed();
    return changed;
  }

  /** Adds or replaces one of a Bot's own skills. Only its thread loads them. */
  writeSkill(input: { name: string; description: string; body: string }, botId?: string): BotSkillView {
    const row = this.need(botId);
    if (!SKILL_NAME.test(input.name)) throw new Error("A skill name is lowercase words joined by hyphens, like weekly-review.");
    const now = Date.now();
    this.deps.db.prepare(`INSERT INTO bot_skills (bot_id, name, description, body, created_at, updated_at, state, used_at, lint_warnings) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT (bot_id, name) DO UPDATE SET description = excluded.description, body = excluded.body, updated_at = excluded.updated_at, state = 'active', used_at = excluded.used_at, lint_warnings = excluded.lint_warnings`)
      .run(row.id, input.name, input.description.trim(), input.body, now, now, now, JSON.stringify(lintSkill(input, this.skills(row.id).map((skill) => skill.name))));
    this.deps.changed();
    return this.skills(row.id).find((skill) => skill.name === input.name)!;
  }

  /** All content versions, including removed skills; reverting appends another version. */
  skillHistory(botId?: string, before?: number) {
    const bot = this.need(botId);
    const rows = this.deps.db.prepare("SELECT * FROM bot_skill_versions WHERE bot_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT 50").all(bot.id, before ?? null, before ?? null) as { id: number; name: string; description: string | null; body: string | null; old_body: string; warnings: string; at: number }[];
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, body: row.body, at: row.at,
      diff: lineDiff(row.old_body, row.body ?? ""),
      warnings: [...JSON.parse(row.warnings) as string[], ...(this.deps.db.prepare("SELECT warning FROM bot_skill_lints WHERE version_id = ? ORDER BY id").all(row.id) as { warning: string }[]).map((lint) => lint.warning)],
    }));
  }

  revertSkill(versionId: number, botId?: string): void {
    const version = this.deps.db.prepare("SELECT name, description, body FROM bot_skill_versions WHERE bot_id = ? AND id = ?").get(this.need(botId).id, versionId) as { name: string; description: string | null; body: string | null } | undefined;
    if (!version) throw new Error("That skill version is gone.");
    if (version.body === null) this.deleteSkill(version.name, botId);
    else this.writeSkill({ name: version.name, description: version.description ?? version.name, body: version.body }, botId);
  }

  /** Model findings are advisory and belong to the exact version inspected. */
  lintSkillVersion(versionId: number, warnings: string[], botId?: string): void {
    if (!this.deps.db.prepare("SELECT 1 FROM bot_skill_versions WHERE bot_id = ? AND id = ?").get(this.need(botId).id, versionId)) throw new Error("That skill version is gone.");
    this.deps.db.transaction(() => {
      for (const warning of warnings) this.deps.db.prepare("INSERT INTO bot_skill_lints(version_id, warning) VALUES (?, ?)").run(versionId, warning);
    })();
    this.deps.changed();
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
    return (await this.workThreads(bot.threadId, bot.id)).filter((thread) => thread.id !== bot.threadId)
      .map((thread) => ({ id: thread.id, title: thread.title || thread.titleFallback || "Untitled thread", projectId: thread.projectId ?? null, parentThreadId: thread.parentThreadId ?? null }));
  }

  /**
   * The Bot's thread and every thread it started. Hidden threads count: the
   * threads a Bot owns are hidden from BB's list and live here
   * (src/bot-owned.ts). A hidden fork doesn't (a side chat, a skill review).
   */
  private async startedThreads(threadId: string): Promise<(ActivityThread & Partial<ListedThread>)[]> {
    const chain = new Set(this.threadChain(threadId));
    const threads = this.deps.sdk.threads;
    const lists = await Promise.all([
      ...[...chain].flatMap((id) => [threads.list({ sourceThreadId: id, archived: false, includeHidden: true, limit: 100 }), threads.list({ parentThreadId: id, archived: false, includeHidden: true, limit: 100 })]),
      threads.list({ archived: false, includeHidden: true, limit: 200 }),
    ].map((list) => list.catch(() => [] as ListedThread[])));
    // A listed thread says whether it waits on the user; a fetched one doesn't,
    // so its pending interactions say. The Bot's chat is hidden from BB's
    // list (and its attention), and Needs you still finds its question.
    const own = lists.flat().find((thread) => thread.id === threadId) ?? await this.fetched(threadId);
    return [...(own ? [own as ActivityThread] : []), ...lists.flat().filter((thread) => thread.id !== threadId && !hiddenFork(thread) && startedBy(thread, chain))];
  }

  /** One thread by id, with whether an interaction waits on the user. */
  private async fetched(threadId: string): Promise<(ActivityThread & Partial<ListedThread>) | null> {
    const [thread, interactions] = await Promise.all([
      this.deps.sdk.threads.get({ threadId }).catch(() => null),
      this.deps.sdk.threads.interactions.list({ threadId }).catch(() => [] as { status?: string }[]),
    ]);
    return thread ? { ...thread, hasPendingInteraction: interactions.some((interaction) => (interaction as { status?: string }).status === "pending") } as ActivityThread & Partial<ListedThread> : null;
  }

  /** startedThreads, the threads the Bot owns otherwise (its automations' runs), and the threads those started, at any depth, from the recent list. */
  private async workThreads(threadId: string, botId?: string): Promise<(ActivityThread & Partial<ListedThread>)[]> {
    const [started, recent] = await Promise.all([
      this.startedThreads(threadId),
      this.deps.sdk.threads.list({ archived: false, includeHidden: true, limit: 200 }).catch(() => [] as ListedThread[]),
    ]);
    const owned = botId ? this.deps.ownedThreads?.(botId) ?? new Set<string>() : new Set<string>();
    // A fork the user handed the Bot is hidden now too, but it's the Bot's.
    const visible = recent.filter((thread) => owned.has(thread.id) || !hiddenFork(thread));
    const startedIds = new Set(started.map((thread) => thread.id));
    const runs = visible.filter((thread) => owned.has(thread.id) && !startedIds.has(thread.id) && thread.id !== threadId);
    return [...started, ...runs, ...descendants(visible, new Set([...started, ...runs].map((thread) => thread.id).filter((id) => id !== threadId)))];
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
      this.workThreads(bot.threadId, bot.id),
      this.automations(bot.threadId),
      this.deps.sdk.threads.output({ threadId: bot.threadId }).catch(() => ({ output: null })),
    ]);
    // Runners have their own group; an urgent report puts its thread in Needs you.
    const runnerThreads = this.deps.runners?.threads(bot.id) ?? new Map<string, { urgent: boolean }>();
    const hidden = this.deps.hiddenThreads?.() ?? new Set<string>();
    const { needsYou, inProgress, waiting, completed } = classifyActivity(threads.filter((thread) => !runnerThreads.has(thread.id) && !hidden.has(thread.id)), bot.threadId);
    const urgent = [...runnerThreads].filter(([, runner]) => runner.urgent).map(([id]) => id).filter((id) => !needsYou.some((thread) => thread.id === id));
    for (const thread of await Promise.all(urgent.map((threadId) => this.deps.sdk.threads.get({ threadId }).catch(() => null)))) {
      if (thread && !thread.archivedAt) needsYou.push({ id: thread.id, title: thread.title || thread.titleFallback || "Untitled runner", status: thread.status, providerId: thread.providerId ?? null, projectId: thread.projectId ?? null, updatedAt: thread.updatedAt ?? 0, relation: "started", needsYou: true, parentId: null });
    }
    // An automation or thread past its auto-resume cap: one entry, opening the Bot's chat, where its line is.
    const alerts = this.deps.automationAlerts?.(bot.id) ?? [];
    if (alerts.length && !needsYou.some((thread) => thread.id === bot.threadId)) {
      needsYou.unshift({
        id: bot.threadId, title: alerts.length === 1 ? alerts[0]!.message : `${alerts.length} automations or threads stopped after failing: ${alerts.map((each) => each.name).join(", ")}`,
        status: "idle", providerId: threads.find((thread) => thread.id === bot.threadId)?.providerId ?? null, projectId: threads.find((thread) => thread.id === bot.threadId)?.projectId ?? PERSONAL_PROJECT_ID, updatedAt: Math.max(...alerts.map((each) => each.at)), relation: "self", needsYou: true, parentId: null,
      });
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
    const compactions = (this.deps.db.prepare("SELECT thread_id AS threadId, at, tokens FROM bot_cache_compactions WHERE bot_id = ? ORDER BY at").all(bot.id) as { threadId: string; at: number; tokens: number | null }[]);
    return { needsYou, inProgress, waiting, scheduled, completed, latest, compactions };
  }
}
