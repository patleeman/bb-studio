import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { SIDE_CHAT_PLUGIN } from "./bot-side-threads";
import { BOT_SHAPES } from "./bot-shapes";
import type { BotActivityView, BotSkillView, BotThreadView, HeartbeatRun } from "./contract";
import { EXTERNAL_PROVIDERS, externalName } from "./external-providers";
import type { OnboardingProviderState } from "./onboarding";
import type { ProjectLeads } from "./project-lead";

/** Thread statuses that mean a turn is under way. */
export const BUSY_CHAT = new Set(["starting", "active", "stopping"]);

export type Sdk = BbPluginApi["sdk"];
export type ListedThread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
/** What Activity reads from a thread, listed or fetched. */
export type ActivityThread = Pick<ListedThread, "id" | "title" | "titleFallback" | "status" | "projectId" | "updatedAt" | "archivedAt"> & Partial<Pick<ListedThread, "providerId" | "sourceThreadId" | "parentThreadId" | "lifecycleOwnerThreadId">> & { hasPendingInteraction?: boolean; queuedWork?: ListedThread["queuedWork"] };
export type BotState = "active" | "paused" | "stopped";
export const BOT_ID = "bot_main";
export const DEFAULT_BOT_NAME = "Bot";
export const DEFAULT_BOT_AVATAR = "🤖";
export const heartbeatName = (key: string) => `Studio project heartbeat ${key}`;
export const RUNNING = new Set(["active", "starting", "pending", "stopping"]);
/** Running now; a "pending" thread is waiting to start. */
const WORKING = new Set(["active", "starting", "stopping"]);

/** The Bot's check-in prompt. What to look at is the "## Check-in" section of its always-on core skill (src/core-skill.ts), not here. */
export function botHeartbeat(name: string): string {
  return `Check-in for ${JSON.stringify(name)}: do what the "## Check-in" section of your always-on skills (in your instructions) says. Do the checks yourself; if a worker thread really helps, reuse the one you used before (bb thread tell) instead of starting a new one each time. Reply only if something changed or needs the user; otherwise reply exactly [PASS]: no "✓", "nothing new" or other filler.`;
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
const SKILLS_LISTED = 8;

export function listedSkills<T extends { name: string; pinned?: boolean; usedAt?: number | null }>(skills: readonly T[]): T[] {
  return [...skills].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.usedAt ?? 0) - (a.usedAt ?? 0) || a.name.localeCompare(b.name)).slice(0, SKILLS_LISTED).sort((a, b) => a.name.localeCompare(b.name));
}

/** Where a session's on-demand skill list goes; src/memory/service.ts fills it with what's left of the host's limit. */
export const SKILLS_SLOT = "\u0000studio-skills\u0000";
/** The slot for one Bot's list: it names the Bot, so the list fills even when the session's role isn't known. */
export const skillsSlotFor = (botId: string) => `\u0000studio-skills:${botId}\u0000`;
/** A skill-list slot in instructions, and the Bot it names (empty for the bare SKILLS_SLOT). */
export function findSkillsSlot(text: string): { slot: string; botId: string | null } | null {
  const match = /\u0000studio-skills(?::([^\u0000]*))?\u0000/.exec(text);
  return match ? { slot: match[0], botId: match[1] || null } : null;
}

/**
 * The skill tools, how to use a skill, and where history is: fixed text in
 * an active Bot's instructions, kept whatever the always-on skills take.
 */
export const SKILLS_LINE = "Skills: bot_skill (list, view, edit; edit patches always-on too); view one before you follow it. History: bot_info (view: history).";

/** The shortest form of the list: how many, and how to list them. */
export const skillsCountLine = (count: number) => `You have ${count}; bot_skill (op: list) lists them.`;

type ListedSkill = { name: string; description: string; pinned?: boolean; usedAt?: number | null };

/**
 * The on-demand skill list at the most detail that fits `room` characters:
 * names with one-line descriptions, else names only, else a count. Empty
 * when the Bot has none and no room for the pointer line either.
 */
export function skillsText(all: readonly ListedSkill[], room = Number.POSITIVE_INFINITY): string {
  if (!all.length) return "";
  const listed = listedSkills(all);
  const more = all.length > listed.length ? `\n${all.length - listed.length} more: bot_skill (op: list).` : "";
  const full = ["Yours:", ...listed.map((skill) => `- ${skill.name}: ${skill.description}`)].join("\n") + more;
  if (full.length <= room) return full;
  const names = `Yours: ${listed.map((skill) => skill.name).join(", ")}.${more}`;
  if (names.length <= room) return names;
  const count = skillsCountLine(all.length);
  return count.length <= room ? count : "";
}

export function botInstructions(bot: { name: string; state: BotState; role?: string | null; memoryPageId?: string | null; skills?: readonly ListedSkill[]; primary?: boolean; skillsSlot?: string }): string {
  const who = `You are ${JSON.stringify(bot.name)}, ${bot.primary === false ? "one of the user's Bots: an always-on agent that sees every project" : "the user's always-on Bot: you lead their personal project and see every project"}.${bot.role?.trim() ? `\nYour role, in their words: ${bot.role.trim()}` : ""}`;
  if (bot.state === "active") {
    // Progressive disclosure: names and one-line descriptions here, the full skill through bot_skill_view.
    // In a session, the list is a slot: what's left after the always-on skills decides how much of it shows.
    const skills = [SKILLS_LINE, bot.skillsSlot ? skillsSlotFor(bot.skillsSlot) : skillsText(bot.skills ?? [])].filter(Boolean).join("\n");
    // The Bot is the triage layer (docs/needs-you/REDO.md): reports, alerts and its threads' questions come
    // to it, and nothing else in Studio asks the user for attention.
    const quiet = "You triage: reports, alerts and your threads' questions come to you. Post only what changed or needs the user; else (nothing new, a thread finished fine) reply exactly [PASS], no \"✓\".";
    const runners = "Schedule with schedule (op: create): check-ins, reminders, watchers, runners.";
    // Always-on skills come in full from src/memory, in every conversation and worker.
    return [who, quiet, runners, skills].filter(Boolean).join("\n");
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

export type BotRow = { id: string; name: string; avatar: string; state: BotState; thread_id: string | null; heartbeat_was_on: number; memory_page_id: string | null; shape: string | null; color: string | null; role: string | null; provider_id?: string | null; appearance_json?: string | null; presence_json?: string | null; default_provider_id?: string | null; default_model?: string | null; default_reasoning?: string | null; main_provider_id?: string | null; main_model?: string | null; main_reasoning?: string | null; created_at: number; updated_at: number };

export type PermissionMode = "accept-edits" | "auto" | "full";
export type ReasoningLevel = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | "ultracode";
const REASONING_LEVELS: readonly ReasoningLevel[] = ["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"];
export const asReasoning = (value: string | null | undefined): ReasoningLevel | null => (REASONING_LEVELS as readonly (string | null | undefined)[]).includes(value) ? value as ReasoningLevel : null;
/** A Bot's default model: what its new conversations start on. */
export type DefaultModel = { providerId: string; model: string; reasoning: ReasoningLevel | null };
export const storedDefault = (row: BotRow): DefaultModel | null =>
  row.default_provider_id && row.default_model ? { providerId: row.default_provider_id, model: row.default_model, reasoning: asReasoning(row.default_reasoning) } : null;
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
 * what the user wants help with; empty when they didn't say): a short hello
 * the user sees, and an agent-only note that has the Bot introduce itself,
 * ask a couple of questions, and then name, describe and pick its look with
 * bot_profile_update.
 */
export function setupInput(goal: string): { type: "text"; text: string; mentions: never[]; visibility?: "agent-only" }[] {
  const want = goal.trim();
  return [
    { type: "text", text: want ? `Hi! You're my new Bot. I'd like help with: ${want}` : "Hi! You're my new Bot.", mentions: [] },
    {
      type: "text", mentions: [], visibility: "agent-only",
      text: `${want ? "" : "The user hasn't said what they want help with yet. "}Start by introducing yourself in a sentence, then ask ${want ? "one or two short questions about what they need" : "what they'd like help with"}. Once they've answered, pick a name, a one-line description and a look that fit the job, set them with bot_profile_update, and offer a check-in if one would help.`,
    },
  ];
}

/**
 * What a Bot may change about itself (bot_profile_update from its own thread
 * or one it started). Every such edit is recorded in
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
export type ProfileChangeRow = { id: number; bot_id: string; actor_bot_id: string | null; thread_id: string | null; field: ProfileField; old_value: string | null; new_value: string | null; reverts: number | null; at: number };

/** Checks a self-edit: only SELF_EDITABLE fields, each valid; throws naming what's the user's. */
export function checkSelfEdit(changes: Record<string, unknown>): Partial<Record<SelfEditField, string | null>> {
  const refused = Object.keys(changes).filter((key) => !(SELF_EDITABLE as readonly string[]).includes(key));
  if (refused.length) {
    const why = [...new Set(refused.map((key) => USER_ONLY_FIELDS[key] ?? `change "${key}"`))];
    throw new Error(`Only the user can ${why.join(", ")}. A Bot can change its own ${SELF_EDITABLE.join(", ")}.`);
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

export type SkillRow = import("./bot-skill-record").BotSkillRecord;
export const skillView = (skill: SkillRow): BotSkillView => ({ name: skill.name, description: skill.description, updatedAt: skill.updated_at, state: skill.state, pinned: !!skill.pinned, usedAt: skill.used_at ?? null, alwaysOn: !!skill.always_on });

/** A provider's display name for a handoff note. */
export function providerName(providerId: string | null | undefined): string {
  const names: Record<string, string> = { claude: "Claude", "claude-code": "Claude", codex: "Codex", pi: "Pi", opencode: "OpenCode" };
  return (providerId && names[providerId]) ?? externalName(providerId);
}

/**
 * Sorts threads into the Bot's Activity: running (with threads waiting on an
 * answer, which the Bot owns), then queued; the rest are done. Nothing here
 * waits on the user: the Bot does (src/bot-attention.ts).
 */
export function classifyActivity(threads: readonly ActivityThread[], botThreadId: string | null, limit = 15): Pick<BotActivityView, "inProgress" | "waiting" | "completed"> {
  // A thread started by another listed thread nests under it; the rest hang off the Bot.
  const listed = new Set(threads.map((thread) => thread.id).filter((id) => id !== botThreadId));
  const parentOf = (thread: ActivityThread) => [thread.parentThreadId, thread.sourceThreadId, thread.lifecycleOwnerThreadId].find((id) => !!id && id !== thread.id && listed.has(id)) ?? null;
  const view = (thread: ActivityThread): BotThreadView & { queued: boolean; answer: boolean } => ({
    id: thread.id,
    title: thread.title || thread.titleFallback || "Untitled thread",
    status: thread.status,
    providerId: thread.providerId ?? null,
    projectId: thread.projectId ?? null,
    updatedAt: thread.updatedAt ?? 0,
    relation: thread.id === botThreadId ? "self" : "started",
    answer: !!thread.hasPendingInteraction,
    parentId: thread.id === botThreadId ? null : parentOf(thread),
    queued: thread.status === "pending" || (thread.queuedWork === "waiting" && !WORKING.has(thread.status)),
  });
  const seen = new Set<string>();
  const unique = threads.filter((thread) => !thread.archivedAt && !seen.has(thread.id) && !!seen.add(thread.id)).map(view);
  const newest = (a: BotThreadView, b: BotThreadView) => b.updatedAt - a.updatedAt;
  const strip = ({ queued: _queued, answer, ...thread }: BotThreadView & { queued: boolean; answer: boolean }): BotThreadView => answer ? { ...thread, waitingFor: "Waiting for an answer" } : thread;
  // A question or approval holds the thread's turn open: it's still going.
  const live = (thread: { status: string; answer: boolean }) => thread.answer || WORKING.has(thread.status);
  const waiting = unique.filter((thread) => !thread.answer && thread.queued).sort(newest).map(strip);
  const inProgress = unique.filter((thread) => !(thread.queued && !thread.answer) && live(thread)).sort(newest).map(strip);
  const completed = unique.filter((thread) => !thread.queued && !live(thread) && thread.relation === "started").sort(newest).slice(0, limit).map(strip);
  return { inProgress, waiting, completed };
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
export function hiddenFork(thread: Partial<Pick<ListedThread, "visibility" | "originKind" | "parentThreadId" | "lifecycleOwnerThreadId" | "originPluginId">>): boolean {
  if (thread.visibility !== "hidden" || thread.originKind !== "fork") return false;
  return thread.originPluginId === SIDE_CHAT_PLUGIN || (!thread.parentThreadId && !thread.lifecycleOwnerThreadId);
}

/** Whether BB's metadata says one of `botThreads` started this thread, forks included (Activity and history). */
export function startedBy(thread: Pick<ListedThread, "sourceThreadId" | "parentThreadId" | "lifecycleOwnerThreadId">, botThreads: ReadonlySet<string>): boolean {
  return [thread.sourceThreadId, thread.parentThreadId, thread.lifecycleOwnerThreadId].some((id) => !!id && botThreads.has(id));
}

export const automationRow = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: z.object({ cron: z.string().optional() }).passthrough(),
  execution: z.object({ targetThreadId: z.string().nullish() }).passthrough(),
  nextRunAt: z.number().nullish(),
}).passthrough();
export type AutomationRow = z.infer<typeof automationRow>;

/**
 * The Bot's old core profile page, a Studio page (src/pages). Its text moved
 * into the Bot's always-on skill (src/core-skill-migrate.ts); the page is
 * kept, read once for that move, and no longer made for new Bots.
 */
export interface BotMemoryPages {
  exists(pageId: string): boolean;
  /** A page's Markdown, archived pages too; null when there's no such page. */
  markdown?(pageId: string): string | null;
  retitle?(pageId: string, from: string, to: string): boolean;
}

export interface BotDeps {
  loopsEnabled?: () => boolean;
  /** When a BB Studio copy's import from bb ran; null (or absent) on an install without it. */
  importedAt?: () => number | null;
  db: Database.Database;
  sdk: Sdk;
  leads: ProjectLeads;
  changed(): void;
  presenceChanged(botId: string): void;
  memory?: BotMemoryPages;
  /** BB's user skills directory (`<data dir>/skills`), where a shared skill goes. */
  userSkillsDir?: string;
  /** Runner threads (src/runners.ts): kept out of Activity's thread lists (they have their own group). */
  runners?: {
    threads(botId?: string): ReadonlySet<string>;
    pauseAll(botId?: string, onPaused?: (id: string) => void): Promise<string[]>;
    /** Turns a runner Stop paused back on; false when it was deleted since. */
    restore(id: string): Promise<boolean>;
  };
  /** Kept out of Activity: skill review forks (src/skill-learning.ts), background work, and side threads (src/bot-side-threads.ts), which show as their reply's row. */
  hiddenThreads?(): ReadonlySet<string>;
  /** Threads a Bot owns that BB doesn't link to it, such as its automations' runs (src/bot-owned.ts): Activity lists them. */
  ownedThreads?(botId: string): ReadonlySet<string>;
  /** A Bot got a thread (made, set or handed off): its chain leaves BB's thread list (src/bot-owned.ts). */
  claimChains?(): Promise<unknown>;
  /** The Bot's Main moved (a new Main, or Make this the Main): the conversation records follow (src/bot-threads.ts). */
  mainMoved?(botId: string, threadId: string, previous: string | null): void;
  /** Turns back on schedules a lost Main turned off (EngineScheduler.revive); true when one came back. */
  revive?(key: { owner: "heartbeat" | "automation"; ownerId: string }): boolean;
  /** The Bot a thread is a conversation or worker of (src/bot-threads.ts), or null. */
  conversationBot?(threadId: string): string | null;
  providerStates?(): Promise<readonly OnboardingProviderState[]>;
  /** Check-ins, reminders and watchers (src/automations.ts): Pause and Stop turn them off, Resume back on. */
  automations?: {
    pauseAll(botId: string, onPaused?: (id: string) => void): Promise<string[]>;
    restore(id: string): Promise<boolean>;
    /** The Bot's thread changed: check-ins and reminders follow it. */
    follow(botId: string): Promise<void>;
    /** Its check-ins and reminders, which run on Studio's scheduler (not in BB's automations list), for Activity. */
    scheduled?(botId: string): { id: string; name: string; cron: string | null; enabled: boolean; nextRunAt: number | null }[];
  };
}

/** No model anywhere for a new Main: not the old Main's, the Bot's, its provider's or the project's. */
export class NoMainModel extends Error {
  constructor(name: string) {
    super(`No model is set up for ${name}'s new Main. Choose one in Default model.`);
  }
}

/** The new Main's provider is signed out, and no other provider is signed in: the sidebar says to sign in or choose a model. */
export class MainProviderSignedOut extends NoMainModel {
  constructor(name: string, readonly providerName: string) {
    super(name);
    this.message = `${providerName} is signed out, so ${name}'s new Main can't start. Sign in to ${providerName} or choose a model.`;
  }
}

/** How often the heal looks for a Bot whose Main is gone, and the longest it waits while a new Main keeps failing. */
export const MAIN_HEAL_MS = 5 * 60_000;
export const MAIN_HEAL_MAX_MS = 60 * 60_000;

/** The wait after `failures` failed new Mains in a row: 5 minutes, doubling up to an hour (like onboarding's back-off). */
export function mainHealDelay(failures: number): number {
  return Math.min(MAIN_HEAL_MS * 2 ** Math.max(0, failures - 1), MAIN_HEAL_MAX_MS);
}

/** BB's answer for a thread made before any provider was ready: it has no model to run with. */
export function noStoredModel(error: unknown): boolean {
  return /has no stored execution model/i.test(String((error as Error)?.message ?? error));
}

/** Start a new Main with no signed-in provider (or none with a model): what to do, not BB's error. */
export const SIGN_IN_FOR_MAIN = "No signed-in provider has a model, so a new Main can't start. Sign in to a provider in Settings → Providers (or choose the Bot's default model in Bot settings), then try again.";

/** The first words in a Bot's new Main, made because the old one was deleted or archived. */
export function newMainNote(name: string, gone: "deleted" | "archived"): string {
  return `Your previous Main conversation was ${gone}, so this is ${name}'s new Main. Check-ins, runners and automations report here now. Read your memory for context and don't redo finished work. Reply with one short line that you're here.`;
}
