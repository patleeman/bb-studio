// Skills that learn: a Bot reviews its own work in the background and keeps
// its skills current. Maintenance retires the skills it stopped using.
// The ideas follow Hermes Agent's background review and curator
// (NousResearch/hermes-agent: agent/background_review.py, agent/curator.py),
// adapted to Studio's Bot skills (the bot_skills table). External bots learn
// on their own provider, so none of this runs for them.
//
// When. A review runs at two boundaries, never by turn count:
// - when a conversation is archived (BotFinish calls `archived`): one pass
//   over the finished conversation;
// - once a day: a sweep over the Bot's Main and its unarchived conversations,
//   queuing each that has new events since its last review.
// Reviews wait in bot_skill_review_queue (so a restart keeps them) and run one
// at a time per Bot, from the minute tick, when the Bot is active and the
// thread idle.
//
// Review. Studio forks the thread under review (threads.fork with
// sourceThreadId; hidden, so it posts no notice), switches the fork to a
// cheap model on the same provider (a thread keeps its provider), and sends
// it the review prompt. Its tools are only the bot skill tools and pages_read
// (agents.configure). It patches on-demand skills or the always-on skill
// (src/core-skill.ts), or replies [PASS]. When it goes idle Studio records
// what it did and archives it. A new turn in the reviewed thread, Pause or
// Stop stops it; one still running after 20 minutes is stopped.
//
// Curator. The Bot's built-in Maintenance runs skill curation:
// a skill unused for 30 days becomes stale, for 90 days archived (hidden
// from the Bot, kept, restorable). Pinned skills are exempt; nothing is
// deleted. Maintenance settings control scheduled curation. Optionally it
// starts a consolidation fork that merges overlapping skills (off by default).
//
// Saves apply immediately. Advisory lint findings never block them.
import { presentScope } from "./merged-tools";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { isPassOutput } from "./kit/silent";
import { formatModelName } from "./model-names";

type Sdk = BbPluginApi["sdk"];
type ThreadLike = { id: string; status?: string; updatedAt?: number | null; archivedAt?: number | null };

export const STALE_AFTER_MS = 30 * 86_400_000;
export const ARCHIVE_AFTER_MS = 90 * 86_400_000;
export const REVIEW_TIMEOUT_MS = 20 * 60_000;
export const SKILL_SOFT_LIMIT = 8000;
/** Reviews a Bot starts in one local day, daily and archive passes together; Run now isn't counted against it. */
export const DAILY_REVIEW_CAP = 6;
/** Tries a queued review gets when it fails before its fork exists (a transient error reading or forking the thread). */
export const START_ATTEMPTS = 3;
/** When the daily sweep may run (local hour) and how far apart sweeps are at least. */
const DAILY_HOUR = 3;
const DAY_MS = 86_400_000;
/** The tools a review fork gets, and nothing else of Studio's. */
export const REVIEW_TOOLS = ["bot_skill_list", "bot_skill_view", "bot_skill_edit", "bot_skill_lint", "pages_read"] as const;
/** The names a review fork's session offers (merged: bot_skill, pages_read). */
const REVIEW_NAMES = presentScope({ loaded: REVIEW_TOOLS, onDemand: [] }).loaded;

export type SkillState = "active" | "stale" | "archived";

// ---- Pure parts ----

type EventRow = { seq?: number; type: string; data?: Record<string, unknown> | null };

/**
 * The cheapest model in a provider's list: by the price in its description
 * ("$0.10/$0.50 per Mtok") when it gives one, else by words that mean small
 * (haiku, luna, flash, mini...). Null when nothing says it's cheap.
 */
export function cheapestModel(models: readonly { model: string; description?: string | null; displayName?: string | null }[]): string | null {
  const priced = models.flatMap((each) => { const match = /\$(\d+(?:\.\d+)?)\s*\/\s*\$(\d+(?:\.\d+)?)\s*per\s*mtok/i.exec(each.description ?? ""); return match ? [{ model: each.model, cost: Number(match[1]) + Number(match[2]) }] : []; });
  if (priced.length) return priced.sort((a, b) => a.cost - b.cost)[0]!.model;
  const cheap = /\b(haiku|luna|flash|mini|nano|lite|small|fast(est)?|affordable)\b/i;
  return models.find((each) => cheap.test(`${each.model} ${each.displayName ?? ""} ${each.description ?? ""}`))?.model ?? null;
}

/** Advisory notes on a skill; they never block a save. */
export function lintSkill(skill: { name: string; body: string }, others: readonly string[]): string[] {
  const notes: string[] = [];
  const body = skill.body;
  if (/\b20\d\d-\d\d-\d\d\b/.test(body) || /\b(PR|pull request)\s*#?\d+|(^|\s)#\d{2,}\b/i.test(body) || /\b(we|I) tried\b|\b(yesterday|this session|last time)\b/i.test(body)) {
    notes.push("It reads like a log of one session (dates, PR numbers or \"we tried\"). Write the rule a future run follows instead.");
  }
  if (body.length > SKILL_SOFT_LIMIT) notes.push(`It's ${body.length} characters; keep a skill under about ${SKILL_SOFT_LIMIT}. Split it or cut what a future run doesn't need.`);
  const close = others.filter((other) => other !== skill.name && nearName(other, skill.name));
  if (close.length) notes.push(`Its name is close to ${close.join(", ")}. If they cover the same kind of task, merge them into one.`);
  return notes;
}

function nearName(a: string, b: string): boolean {
  if (a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split("-")), tb = new Set(b.split("-"));
  const shared = [...ta].filter((word) => tb.has(word)).length;
  if (shared / new Set([...ta, ...tb]).size >= 0.5) return true;
  return editDistance(a, b) <= 2;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

/** A targeted edit: replaces `find` (which must occur once, unless `all`) with `replace`. */
export function patchText(body: string, find: string, replace: string, all = false): string {
  if (!find) throw new Error("Say which text to replace.");
  const count = body.split(find).length - 1;
  if (!count) throw new Error("That text isn't in the skill. View it and copy the exact lines.");
  if (count > 1 && !all) throw new Error(`That text is in the skill ${count} times. Include more of the lines around it, or set all.`);
  return all ? body.split(find).join(replace) : body.replace(find, () => replace);
}

/** A line diff, "-" removed and "+" added, unchanged lines with two spaces. */
export function lineDiff(before: string, after: string): string {
  const a = before ? before.split("\n") : [], b = after ? after.split("\n") : [];
  // Bound memory for long skills with many short lines; a full replacement
  // is still an exact diff when the LCS matrix would be too large.
  if ((a.length + 1) * (b.length + 1) > 1_000_000) return [...a.map((line) => `- ${line}`), ...b.map((line) => `+ ${line}`)].join("\n");
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push(`  ${a[i]}`); i++; j++; }
    else if (i < a.length && (j >= b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  return out.join("\n");
}

/** What the curator changes: unused skills go active → stale → archived; pinned ones stay. */
export function curatorPlan(skills: readonly { name: string; state: SkillState; pinned: boolean; usedAt: number | null; updatedAt: number; alwaysOn?: boolean }[], now: number): { name: string; from: SkillState; to: SkillState }[] {
  const plan: { name: string; from: SkillState; to: SkillState }[] = [];
  for (const skill of skills) {
    // Always-on skills are in every prompt, so they are always in use.
    if (skill.pinned || skill.alwaysOn || skill.state === "archived") continue;
    const idle = now - Math.max(skill.usedAt ?? 0, skill.updatedAt);
    const to: SkillState = idle >= ARCHIVE_AFTER_MS ? "archived" : idle >= STALE_AFTER_MS ? "stale" : skill.state;
    if (to !== skill.state) plan.push({ name: skill.name, from: skill.state, to });
  }
  return plan;
}

/**
 * A fork's Claude Code session starts with the Bot's history, which lists the
 * bridge's tools, before the fork's own bridge connection is up. Claude Code
 * then notes that every mcp__bb-bridge__* tool "is no longer available (MCP
 * server disconnected)", and a cheap review model takes that at its word and
 * gives up, though ToolSearch finds the tools and they work.
 */
const TOOLS_CONNECTED = `These tools are on the bb-bridge MCP server (mcp__bb-bridge__<name>) and they work here. If a note says bb-bridge disconnected or its tools are no longer available, it's stale: load them with ToolSearch ("select:${REVIEW_NAMES.map((name) => `mcp__bb-bridge__${name}`).join(",")}") and call them.`;

/** The follow-up a review gets, once, when it gave up on its tools. */
export const RETRY_PROMPT = `Your tools are connected now. Load them with ToolSearch ("select:${REVIEW_NAMES.map((name) => `mcp__bb-bridge__${name}`).join(",")}"), do the review and reply as asked: one short line, or exactly [PASS].`;

/** A reply that says the review's tools weren't there, rather than that nothing was worth saving. */
export function gaveUpOnTools(text: string | null): boolean {
  return !!text && /\b(disconnected|not (?:available|connected)|unavailable|no longer available|can'?t (?:access|reach|use|call) (?:the |my )?(?:skill|tools|bb-bridge))/i.test(text);
}

/** Why a review runs: a conversation was archived, the daily sweep, or the user asked (Run now). */
export type ReviewReason = "archive" | "daily" | "manual";

/** What to save and where, and what never to save: the rules every skill write follows (plan "Internal agent guide"). */
export const SAVE_RULES = [
  "Where it goes:",
  "- A standing rule for working with the user, or a personal boundary: one line in your always-on skill's \"## Preferences\" (at most 25 lines).",
  "- A temporary constraint true this month across projects that an agent could easily break: one line in \"## Right now\" (at most 10 lines).",
  "- A repeatable procedure, a tool or CLI gotcha, or a topic-specific preference: an on-demand skill.",
  "- Repo paths, setup and architecture: the repo's own docs (AGENTS.md), not a skill.",
  "- What happened, was decided or shipped: nowhere. It stays in the conversation history (bot_info (view: history)).",
  "Never save: build, deploy or release logs (build numbers, commit hashes, PR numbers); conversation summaries; thread, automation or other volatile ids and live state; dated stories of what happened (\"On Nov 24 we tried X\"); tombstones (\"Retired …\"); copies of repo docs or pages.",
  "Default to saving nothing: reply [PASS] unless a future session would repeat a mistake without it. Write one-line rules that say how to behave or what boundary applies. Patch in place: replace or delete the old line, never append one that contradicts it. At a cap, prune or merge a line before you add one.",
].join("\n");

/** The review fork's prompt. */
export function reviewPrompt(input: { name: string; reason: ReviewReason; since?: number | null }): string {
  const since = input.since ? ` Focus on what happened since the last review (${new Date(input.since).toISOString().slice(0, 10)}); older turns were reviewed already.` : "";
  const why = input.reason === "archive" ? "The user just archived this conversation: look back over all of it." : input.reason === "manual" ? `The user asked for a review.${since}` : `This is the daily review of this conversation.${since}`;
  return [
    `Background skill review for ${JSON.stringify(input.name)}. ${why} The user doesn't see this thread. Save only what the next session should already know.`,
    "",
    "What to look for:",
    "- The user correcting you (tone, format, length, approach, the order of steps), or saying \"remember this\". These matter most: put them where the next run will follow them.",
    "- A technique, fix, workaround or tool pattern that took effort to find and will come up again.",
    "- A skill you used that turned out wrong, missing a step or out of date. Fix it now.",
    "",
    SAVE_RULES,
    "",
    "How to write:",
    "- One skill per kind of task, not per incident. Check what you have first (bot_skill op list, op view) and prefer bot_skill op edit with change \"patch\" on the skill that covers it over a new skill. Your always-on skills (Preferences, Right now, Check-in) are in your instructions; view one before you patch it.",
    "- Keep each skill short: when to use it, the steps, the pitfalls. The tool result may carry notes on shape and caps; heed them.",
    "",
    `Use only ${REVIEW_NAMES.join(", ")}. Don't run commands, edit files, message anyone or start threads. Skill changes apply immediately. After saving, inspect the saved versions with bot_skill op lint and attach any quality or safety warnings to the exact version you inspected; warnings never block saving.`,
    TOOLS_CONNECTED,
    "When you're done, reply with one short line saying what you saved. If nothing is worth saving, reply exactly [PASS].",
  ].join("\n");
}

/** The curator's consolidation prompt. */
export function consolidatePrompt(name: string): string {
  return [
    `Skill curator for ${JSON.stringify(name)}. The user doesn't see this thread. Read your skills (bot_skill op list, then op view on each one that might overlap).`,
    "Where two or more cover the same kind of task, merge them into one class-level skill: write or patch the one that stays, then delete the others. Keep every rule that still holds; drop repeats.",
    "Don't touch skills that don't overlap. Don't delete a pinned skill. Don't run commands or start threads.",
    TOOLS_CONNECTED,
    "Reply with one short line saying what you merged, or exactly [PASS] when nothing overlaps.",
  ].join("\n");
}

// ---- The service ----

type LearningRow = {
  bot_id: string; enabled: number; review_model: string | null; consolidate: number;
  last_review_at: number | null; last_review_result: string | null; curator_last_at: number | null; curator_last_result: string | null;
  daily_at: number | null;
};
type ReviewRow = { thread_id: string; bot_id: string; kind: "review" | "consolidate"; status: "running" | "done"; saved: number; memory: number; started_at: number; finished_at: number | null; result: string | null; source_thread_id: string | null; source_seq: number | null };
type QueueRow = { thread_id: string; bot_id: string; reason: ReviewReason; queued_at: number; attempts: number };

export interface LearningBot { id: string; name: string; threadId: string | null; state: string; kind?: string }
export interface LearningSkill { name: string; description: string; body: string; state: SkillState; pinned: boolean; usedAt: number | null; updatedAt: number; alwaysOn?: boolean }
export interface LearningDeps {
  db: Database.Database;
  sdk: Sdk;
  changed(): void;
  bots(): LearningBot[];
  bot(botId: string): LearningBot | null;
  /** The Bot's unarchived conversations' threads (Main among them): what the daily sweep looks at. */
  conversations(botId: string): string[];
  skills(botId: string): LearningSkill[];
  setState(botId: string, name: string, state: SkillState): void;
  log?(message: string): void;
  /** How often to look for a fork's workspace; tests make it fast. */
  pollMs?: number;
}

export type LearningView = {
  enabled: boolean; reviewModel: string | null; defaultModel: string | null; models: string[];
  modelNames: Record<string, string>;
  consolidate: boolean;
  /** When reviews run: once a day and when a conversation is archived. */
  cadence: "daily-and-archive";
  reviewing: boolean;
  /** Conversations waiting for their review. */
  queued: number;
  lastSweepAt: number | null;
  lastReview: { at: number; result: string } | null;
  lastCurator: { at: number; result: string } | null;
};

/** When the local day `at` falls on began. */
const dayStart = (at: number) => { const date = new Date(at); date.setHours(0, 0, 0, 0); return date.getTime(); };

/** The local day a time falls on, as "YYYY-M-D". */
const localDay = (at: number) => { const date = new Date(at); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; };

/** Whether the daily sweep is due: never ran, or last ran on an earlier local day and it's past DAILY_HOUR. */
export function sweepDue(lastAt: number | null, now: number): boolean {
  if (!lastAt) return true;
  if (now - lastAt >= 2 * DAY_MS) return true;
  return localDay(lastAt) !== localDay(now) && new Date(now).getHours() >= DAILY_HOUR;
}

export class SkillLearning {
  /** Bots a review is being started for, before its row exists. */
  private readonly starting = new Set<string>();
  /** Review forks that have started their turn: a fork is idle before the prompt lands, and that idle isn't the end. */
  private readonly started = new Set<string>();
  /** Review forks already told once that their tools are connected. */
  private readonly retried = new Set<string>();
  /** Running reviews this process has looked at since it started (settle), so a reload's orphans are checked once. */
  private readonly seen = new Set<string>();
  /** A minute tick still running: the next one waits for it rather than overlapping. */
  private ticking = false;

  constructor(private readonly deps: LearningDeps) {}

  private row(botId: string): LearningRow {
    this.deps.db.prepare("INSERT OR IGNORE INTO bot_learning (bot_id) VALUES (?)").run(botId);
    return this.deps.db.prepare("SELECT * FROM bot_learning WHERE bot_id = ?").get(botId) as LearningRow;
  }

  private save(botId: string, fields: Partial<LearningRow>): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.row(botId);
    this.deps.db.prepare(`UPDATE bot_learning SET ${keys.map((key) => `${key} = @${key}`).join(", ")} WHERE bot_id = @bot_id`).run({ ...fields, bot_id: botId });
  }

  private running(botId: string): ReviewRow | undefined {
    return this.deps.db.prepare("SELECT * FROM bot_skill_reviews WHERE bot_id = ? AND status = 'running' ORDER BY started_at DESC").get(botId) as ReviewRow | undefined;
  }

  /** The review fork a thread is, if it is one (running or done). */
  review(threadId: string | null | undefined): ReviewRow | null {
    if (!threadId) return null;
    return (this.deps.db.prepare("SELECT * FROM bot_skill_reviews WHERE thread_id = ?").get(threadId) as ReviewRow | undefined) ?? null;
  }

  /** Every review fork's thread id, so Activity leaves them out. */
  reviewThreads(): Set<string> {
    return new Set((this.deps.db.prepare("SELECT thread_id FROM bot_skill_reviews").all() as { thread_id: string }[]).map((row) => row.thread_id));
  }

  private studioBot(botId: string): LearningBot | null {
    const bot = this.deps.bot(botId);
    return bot && bot.kind !== "external" ? bot : null;
  }

  // ---- Settings and view ----

  async view(botId: string): Promise<LearningView> {
    const row = this.row(botId);
    const bot = this.studioBot(botId);
    let models: string[] = [];
    let defaultModel: string | null = null;
    const modelNames: Record<string, string> = {};
    if (bot?.threadId) {
      const options = await this.providerModels(bot.threadId).catch(() => null);
      models = options?.map((each) => each.model) ?? [];
      defaultModel = options ? cheapestModel(options) : null;
      for (const each of options ?? []) modelNames[each.model] = each.displayName?.trim() || formatModelName(each.model);
    }
    if (row.review_model && !modelNames[row.review_model]) modelNames[row.review_model] = formatModelName(row.review_model);
    return {
      enabled: !!row.enabled, reviewModel: row.review_model, defaultModel, models, modelNames,
      consolidate: !!row.consolidate, cadence: "daily-and-archive",
      reviewing: !!this.running(botId), queued: this.queued(botId).length, lastSweepAt: row.daily_at,
      lastReview: row.last_review_at && row.last_review_result ? { at: row.last_review_at, result: row.last_review_result } : null,
      lastCurator: row.curator_last_at && row.curator_last_result ? { at: row.curator_last_at, result: row.curator_last_result } : null,
    };
  }

  async set(botId: string, input: { enabled?: boolean; reviewModel?: string | null; consolidate?: boolean }): Promise<LearningView> {
    this.save(botId, {
      ...(input.enabled !== undefined ? { enabled: input.enabled ? 1 : 0 } : {}),
      ...(input.reviewModel !== undefined ? { review_model: input.reviewModel || null } : {}),
      ...(input.consolidate !== undefined ? { consolidate: input.consolidate ? 1 : 0 } : {}),
    });
    // Off: what was waiting won't run.
    if (input.enabled === false) this.deps.db.prepare("DELETE FROM bot_skill_review_queue WHERE bot_id = ?").run(botId);
    this.deps.changed();
    return this.view(botId);
  }

  // ---- When reviews run ----

  private queued(botId: string): QueueRow[] {
    return this.deps.db.prepare("SELECT * FROM bot_skill_review_queue WHERE bot_id = ? ORDER BY reason = 'archive' DESC, queued_at, thread_id").all(botId) as QueueRow[];
  }

  private enqueue(botId: string, threadId: string, reason: ReviewReason, now = Date.now()): void {
    // An archive pass outranks a daily one for the same thread; otherwise the first queued stays.
    this.deps.db.prepare(`INSERT INTO bot_skill_review_queue (thread_id, bot_id, reason, queued_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (thread_id) DO UPDATE SET reason = CASE WHEN excluded.reason = 'archive' THEN 'archive' ELSE bot_skill_review_queue.reason END`).run(threadId, botId, reason, now);
  }

  /** The last event a thread has, or null when it can't be read. */
  private async tip(threadId: string): Promise<number | null> {
    const events = await this.deps.sdk.threads.events.list({ threadId, order: "desc", limit: "1" }).catch(() => null) as EventRow[] | null;
    return events ? events[0]?.seq ?? 0 : null;
  }

  /** A conversation was archived (src/bot-finish.ts): one review pass over it, when learning is on. */
  archived(botId: string, threadId: string, now = Date.now()): boolean {
    const bot = this.studioBot(botId);
    if (!bot || !this.row(botId).enabled) return false;
    this.enqueue(botId, threadId, "archive", now);
    this.deps.changed();
    return true;
  }

  /**
   * The daily sweep: Main and each unarchived conversation with events since
   * its last review are queued. `reason` "manual" is Run now. Returns how
   * many it queued.
   */
  async sweep(botId: string, now = Date.now(), reason: ReviewReason = "daily"): Promise<number> {
    const bot = this.studioBot(botId);
    if (!bot) return 0;
    this.save(botId, { daily_at: now });
    const threads = [...new Set([...(bot.threadId ? [bot.threadId] : []), ...this.deps.conversations(botId)])];
    let queued = 0;
    for (const threadId of threads) {
      const tip = await this.tip(threadId);
      if (tip === null) continue;
      const mark = this.deps.db.prepare("SELECT seq FROM bot_skill_review_marks WHERE thread_id = ?").get(threadId) as { seq: number } | undefined;
      if (mark && tip <= mark.seq) continue;
      this.enqueue(botId, threadId, reason, now);
      queued++;
    }
    if (queued) this.deps.changed();
    return queued;
  }

  /**
   * The first look at a Bot (right after the upgrade, or when learning is
   * first on): every thread's current tip becomes its mark, and the day's
   * sweep counts as done, so old history never queues a backlog of reviews.
   */
  async baseline(botId: string, now = Date.now()): Promise<void> {
    const bot = this.studioBot(botId);
    if (!bot) return;
    const threads = [...new Set([...(bot.threadId ? [bot.threadId] : []), ...this.deps.conversations(botId)])];
    for (const threadId of threads) {
      const tip = await this.tip(threadId);
      if (tip !== null) this.deps.db.prepare("INSERT OR IGNORE INTO bot_skill_review_marks (thread_id, bot_id, seq, at) VALUES (?, ?, ?, ?)").run(threadId, botId, tip, now);
    }
    this.save(botId, { daily_at: now });
  }

  /** Reviews the Bot started today: daily and archive passes, not Run now's or the curator's. */
  startedToday(botId: string, now = Date.now()): number {
    // A start that failed (no prompt sent) isn't a review.
    return (this.deps.db.prepare("SELECT COUNT(*) AS n FROM bot_skill_reviews WHERE bot_id = ? AND kind = 'review' AND started_at >= ? AND COALESCE(reason, '') != 'manual' AND COALESCE(result, '') NOT LIKE 'Couldn''t start%'").get(botId, dayStart(now)) as { n: number }).n;
  }

  /** Run now: the sweep at once, and the first review starts. True when something was queued or is running. */
  async runNow(botId: string, now = Date.now()): Promise<boolean> {
    if (this.studioBot(botId)?.state !== "active") return false;
    // Before the first tick's baseline: take it now, so Run now never queues old history.
    if (this.row(botId).daily_at === null) await this.baseline(botId, now);
    const queued = await this.sweep(botId, now, "manual");
    await this.next(botId, now);
    return queued > 0 || !!this.running(botId);
  }

  /**
   * Starts the Bot's next queued review, when none is running. An entry
   * leaves the queue only once its review started, or when its thread is
   * gone; a thread that's busy, or a start that can't happen yet, waits for
   * a later tick. Daily and archive passes stop at DAILY_REVIEW_CAP a day.
   */
  async next(botId: string, now = Date.now()): Promise<boolean> {
    if (this.running(botId) || this.starting.has(botId)) return false;
    const bot = this.studioBot(botId);
    if (!bot || bot.state !== "active") return false;
    for (const entry of this.queued(botId)) {
      if (entry.reason !== "manual" && this.startedToday(botId, now) >= DAILY_REVIEW_CAP) continue;
      const thread = await this.deps.sdk.threads.get({ threadId: entry.thread_id }).catch(() => null) as ThreadLike | null;
      // Gone: nothing to review. Archived since a daily or manual pass was queued: its archive pass covers it
      // (start() refuses an archived thread for any other pass, which would jam the queue). Busy: a later tick.
      if (!thread) { this.dequeue(entry.thread_id); continue; }
      if (thread.archivedAt && entry.reason !== "archive") { this.dequeue(entry.thread_id); continue; }
      if (thread.status && thread.status !== "idle" && !thread.archivedAt) continue;
      let started = false;
      try {
        started = await this.start(botId, "review", entry.reason, entry.thread_id);
      } catch (error) {
        this.deps.log?.(`Skill review of ${entry.thread_id}: ${error instanceof Error ? error.message : String(error)}`);
        // After its fork existed (the fork is closed as "Couldn't start"): dropped, so a broken thread doesn't retry
        // every minute. Before the fork (reading or forking the thread failed): tried again on later ticks, a few times.
        const attempts = entry.attempts + 1;
        if ((error as { forked?: boolean }).forked || attempts >= START_ATTEMPTS) this.dequeue(entry.thread_id);
        else this.deps.db.prepare("UPDATE bot_skill_review_queue SET attempts = ? WHERE thread_id = ?").run(attempts, entry.thread_id);
        return false;
      }
      if (!started) return false;
      this.dequeue(entry.thread_id);
      return true;
    }
    return false;
  }

  private dequeue(threadId: string): void {
    this.deps.db.prepare("DELETE FROM bot_skill_review_queue WHERE thread_id = ?").run(threadId);
  }

  /** A thread went idle: a review fork finishes. */
  async idle(thread: ThreadLike, lastAssistantText: string | null): Promise<void> {
    const review = this.review(thread.id);
    if (review?.status === "running" && this.started.delete(thread.id)) {
      await this.finish(review, lastAssistantText);
      await this.next(review.bot_id);
    }
  }

  // ---- The review fork ----

  /**
   * Forks a thread for a review (the queued thread, else the Bot's Main) or
   * the Bot's Main for a consolidation. False when one is running or the Bot
   * or thread isn't ready. An archived conversation can be forked: its
   * archive pass runs after it is archived.
   */
  async start(botId: string, kind: "review" | "consolidate", reason: ReviewReason = "manual", threadId?: string): Promise<boolean> {
    const bot = this.studioBot(botId);
    const sourceId = threadId ?? bot?.threadId;
    if (!bot || !sourceId || bot.state !== "active" || this.starting.has(botId) || this.running(botId)) return false;
    this.starting.add(botId);
    try {
      const source = await this.deps.sdk.threads.get({ threadId: sourceId }) as ThreadLike;
      if (source.status && source.status !== "idle" && !source.archivedAt) return false;
      if (source.archivedAt && reason !== "archive") return false;
      const row = this.row(botId);
      const models = await this.providerModels(sourceId).catch(() => null);
      const model = row.review_model ?? (models ? cheapestModel(models) : null);
      const mark = this.deps.db.prepare("SELECT at FROM bot_skill_review_marks WHERE thread_id = ?").get(sourceId) as { at: number } | undefined;
      const tip = await this.tip(sourceId);
      const fork = await this.deps.sdk.threads.fork({
        sourceThreadId: sourceId, title: `${bot.name} · ${kind === "review" ? "skill review" : "skill curator"}`,
        visibility: "hidden", pluginMetadata: { botReview: botId },
      } as never);
      const now = Date.now();
      // The tip it reviews up to; the thread's mark moves there only when the review finishes (finish).
      this.deps.db.prepare("INSERT INTO bot_skill_reviews (thread_id, bot_id, kind, status, started_at, source_thread_id, source_seq, reason) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)").run(fork.id, botId, kind, now, sourceId, tip, reason);
      try {
        // A message sent while the fork's workspace is still provisioning waits in its queue and
        // isn't sent on its own: wait until it's ready.
        await this.provisioned(fork.id);
        if (model) {
          const picked = models?.find((each) => each.model === model);
          const efforts = picked?.supportedReasoningEfforts?.map((each) => each.reasoningEffort) ?? [];
          const low = ["none", "low", "medium"].find((each) => efforts.includes(each));
          await this.deps.sdk.threads.update({ threadId: fork.id, model, ...(low ? { reasoningLevel: low } : {}) } as never);
        }
        const prompt = kind === "review" ? reviewPrompt({ name: bot.name, reason, since: reason === "archive" ? null : mark?.at ?? null }) : consolidatePrompt(bot.name);
        await this.deps.sdk.threads.send({ threadId: fork.id, mode: "auto", input: [{ type: "text", text: prompt, mentions: [] }] } as never);
      } catch (error) {
        await this.close(this.review(fork.id)!, `Couldn't start: ${error instanceof Error ? error.message : String(error)}`, true);
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { forked: true });
      }
      this.deps.changed();
      return true;
    } finally {
      this.starting.delete(botId);
    }
  }

  /** Waits (up to a minute) for a new thread's provisioning to finish. */
  private async provisioned(threadId: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const events = await this.deps.sdk.threads.events.list({ threadId, order: "desc", limit: "5", types: ["system/thread-provisioning"] }).catch(() => []) as EventRow[];
      const status = (events[0]?.data as { status?: string } | undefined)?.status;
      if (status === "completed") return;
      if (status === "failed") throw new Error("The review's workspace didn't start.");
      await new Promise((done) => setTimeout(done, this.deps.pollMs ?? 1000));
    }
    throw new Error("The review's workspace took too long to start.");
  }

  private async providerModels(threadId: string) {
    const thread = await this.deps.sdk.threads.get({ threadId });
    if (!thread.providerId) return null;
    return (await this.deps.sdk.providers.models({ providerId: thread.providerId })).models as { model: string; description?: string | null; displayName?: string | null; supportedReasoningEfforts?: { reasoningEffort: string }[] }[];
  }

  /** A review's tool saved a skill: counted for its result line. */
  noteWrite(threadId: string | undefined, _what: "saved" = "saved"): void {
    const review = this.review(threadId);
    if (review?.status === "running") this.deps.db.prepare("UPDATE bot_skill_reviews SET saved = saved + 1 WHERE thread_id = ?").run(review.thread_id);
  }

  private async finish(review: ReviewRow, text: string | null): Promise<void> {
    const fresh = this.review(review.thread_id)!;
    const parts = fresh.saved ? [`Saved ${fresh.saved} skill${fresh.saved === 1 ? "" : "s"}`] : [];
    // [PASS] (or any reply without a write) saved nothing; the writes are what count.
    // The tools looked disconnected to it (TOOLS_CONNECTED): tell it once they're there, and wait for that turn.
    if (!parts.length && gaveUpOnTools(text) && !this.retried.has(fresh.thread_id)) {
      this.retried.add(fresh.thread_id);
      const sent = await this.deps.sdk.threads.send({ threadId: fresh.thread_id, mode: "auto", input: [{ type: "text", text: RETRY_PROMPT, mentions: [] }] } as never).then(() => true, () => false);
      if (sent) return;
    }
    this.retried.delete(fresh.thread_id);
    const result = parts.length ? parts.join(" · ") : fresh.kind === "consolidate" ? "Nothing to merge" : "Nothing to save";
    if (!parts.length && text && !isPassOutput(text)) this.deps.log?.(`Skill review ${fresh.thread_id} wrote nothing but replied: ${text.slice(0, 200)}`);
    // Done: the reviewed thread's mark moves to the tip the review started from. Only here; a review that
    // fails, is stopped or never got its prompt leaves the mark where it was.
    if (fresh.kind === "review" && fresh.source_thread_id && fresh.source_seq !== null) {
      this.deps.db.prepare(`INSERT INTO bot_skill_review_marks (thread_id, bot_id, seq, at) VALUES (?, ?, ?, ?)
        ON CONFLICT (thread_id) DO UPDATE SET seq = MAX(bot_skill_review_marks.seq, excluded.seq), at = excluded.at`).run(fresh.source_thread_id, fresh.bot_id, fresh.source_seq, fresh.started_at);
    }
    await this.close(fresh, result);
  }

  /** Ends a review: stops it if asked, archives the fork and records the result. */
  private async close(review: ReviewRow, result: string, stop = false): Promise<void> {
    if (stop) await this.deps.sdk.threads.stop({ threadId: review.thread_id }).catch(() => {});
    // Maintenance archives finished workers after its ownership and workspace checks.
    const now = Date.now();
    this.deps.db.prepare("UPDATE bot_skill_reviews SET status = 'done', finished_at = ?, result = ? WHERE thread_id = ?").run(now, result, review.thread_id);
    if (review.kind === "review") this.save(review.bot_id, { last_review_at: now, last_review_result: result });
    else if (result !== "Nothing to merge") this.save(review.bot_id, { curator_last_result: `${this.row(review.bot_id).curator_last_result ?? ""} · merge: ${result}` });
    this.deps.changed();
  }

  /**
   * What a running review's fork really did, for one this process lost
   * track of (a reload) or one past REVIEW_TIMEOUT_MS: its thread gone, it's
   * released; idle after its turn, it finishes as if its idle had been seen
   * (its result recorded, the mark moved); still working past the timeout,
   * it's stopped. A fork that's idle without having taken its turn waits for
   * the timeout, then is released.
   */
  private async settle(review: ReviewRow, now: number): Promise<void> {
    this.seen.add(review.thread_id);
    const fork = await this.deps.sdk.threads.get({ threadId: review.thread_id }).catch(() => null) as ThreadLike | null;
    const late = now - review.started_at > REVIEW_TIMEOUT_MS;
    if (!fork) { await this.close(review, "Stopped: its thread is gone"); return; }
    if (fork.status && fork.status !== "idle") { if (late) await this.close(review, "Stopped: took too long", true); else this.started.add(review.thread_id); return; }
    const events = await this.deps.sdk.threads.events.list({ threadId: review.thread_id, order: "desc", limit: "50", types: ["item/completed", "turn/completed"] }).catch(() => []) as EventRow[];
    if (events.some((event) => event.type === "turn/completed")) {
      const reply = events.map((event) => (event.data as { item?: { type?: string; text?: string } } | null | undefined)?.item).find((item) => item?.type === "agentMessage" && item.text)?.text ?? null;
      this.retried.add(review.thread_id);
      await this.finish(review, reply);
      return;
    }
    if (late) await this.close(review, "Stopped: took too long", true);
  }

  /** A thread became active: a new turn in the thread under review stops its review (the next sweep picks it up again). */
  async active(threadId: string): Promise<void> {
    if (this.review(threadId)?.status === "running") { this.started.add(threadId); return; }
    const review = this.deps.db.prepare("SELECT * FROM bot_skill_reviews WHERE status = 'running' AND source_thread_id = ?").get(threadId) as ReviewRow | undefined;
    // Its mark stays where it was (it moves only when a review finishes), so the next sweep reviews this part again.
    if (review) await this.close(review, "Stopped: you started a turn", true);
  }

  /** A review fork failed. */
  async failed(threadId: string, error: string | null): Promise<void> {
    const review = this.review(threadId);
    if (review?.status === "running") await this.close(review, `Failed${error ? `: ${error.slice(0, 120)}` : ""}`);
  }

  // ---- Curator ----

  /** Runs the curator now: the transitions (applied unless dryRun) and, if on, a consolidation fork. */
  async curate(botId: string, options: { dryRun?: boolean; now?: number } = {}): Promise<{ changes: { name: string; from: SkillState; to: SkillState }[]; consolidating: boolean; result: string }> {
    const now = options.now ?? Date.now();
    const plan = curatorPlan(this.deps.skills(botId), now);
    const stale = plan.filter((each) => each.to === "stale").length, archived = plan.filter((each) => each.to === "archived").length;
    const result = plan.length ? [stale ? `${stale} stale` : "", archived ? `${archived} archived` : ""].filter(Boolean).join(" · ") : "Nothing to retire";
    if (options.dryRun) return { changes: plan, consolidating: false, result: `Dry run: ${result}` };
    for (const change of plan) this.deps.setState(botId, change.name, change.to);
    this.save(botId, { curator_last_at: now, curator_last_result: result });
    let consolidating = false;
    const row = this.row(botId);
    if (row.consolidate && this.deps.skills(botId).filter((skill) => skill.state !== "archived").length >= 2) {
      consolidating = await this.start(botId, "consolidate").catch(() => false);
    }
    this.deps.changed();
    return { changes: plan, consolidating, result };
  }

  /** The minute tick: times out stuck reviews, stops reviews of paused Bots, runs the daily sweep and starts queued reviews. */
  async tick(now = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try { await this.tickOnce(now); } finally { this.ticking = false; }
  }

  private async tickOnce(now: number): Promise<void> {
    for (const review of this.deps.db.prepare("SELECT * FROM bot_skill_reviews WHERE status = 'running'").all() as ReviewRow[]) {
      const bot = this.deps.bot(review.bot_id);
      if (!bot || bot.state !== "active") { await this.close(review, `Stopped: ${bot?.name ?? "the bot"} is ${bot?.state ?? "gone"}`, true); continue; }
      // A review this process didn't start (Studio reloaded while it ran), or one past its time: look at the fork itself.
      const orphan = !this.started.has(review.thread_id) && !this.seen.has(review.thread_id);
      if (orphan || now - review.started_at > REVIEW_TIMEOUT_MS) await this.settle(review, now);
    }
    for (const bot of this.deps.bots()) {
      if (bot.kind === "external" || bot.state !== "active") continue;
      const row = this.row(bot.id);
      if (!row.enabled) continue;
      const report = (error: unknown) => this.deps.log?.(`Skill sweep for ${bot.id}: ${error instanceof Error ? error.message : String(error)}`);
      // First look (the upgrade, or learning just turned on): a baseline, no backlog.
      if (row.daily_at === null) { await this.baseline(bot.id, now).catch(report); continue; }
      if (sweepDue(row.daily_at, now)) await this.sweep(bot.id, now).catch(report);
      await this.next(bot.id, now);
    }
  }
}
