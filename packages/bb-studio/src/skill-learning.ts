// Skills that learn: a Bot reviews its own work in the background and keeps
// its skills current, and a weekly curator retires the ones it stopped using.
// The ideas follow Hermes Agent's background review and curator
// (NousResearch/hermes-agent: agent/background_review.py, agent/curator.py),
// adapted to Studio's Bot skills (the bot_skills table). External bots learn
// on their own provider, so none of this runs for them.
//
// Counters. Studio watches each Studio Bot's thread. When it goes idle
// (thread.idle) Studio reads the events since the last ones it counted
// (threads.events.list after that sequence): a turn/completed closes a turn,
// and a turn with any tool item (commandExecution, toolCall, mcpToolCall,
// fileChange, ...) counts as a tool turn; a client/turn/requested whose
// initiator is the user counts as a user turn. A bot_skill_write, _patch or
// _delete call resets the tool count (the Bot just saved what it learned).
// The first look at a thread only takes a baseline: old history never trips.
//
// Review. When either count reaches the interval (10 by default) and the Bot
// is active and idle, Studio forks the Bot's thread (threads.fork with
// sourceThreadId; hidden, so it posts no notice), switches the fork to a
// cheap model on the same provider (a thread keeps its provider), and sends
// it the review prompt. Its tools are only the bot skill tools and the
// Memory page's pages_read and pages_edit (agents.configure). It replies
// [PASS] when there's nothing to save. When it goes idle Studio records what
// it did and archives it. One review per Bot at a time; a new turn in the
// Bot's thread, Pause or Stop stops it; one still running after 20 minutes is
// stopped.
//
// Curator. Weekly per Bot, once the Bot's thread has been idle for 2 hours:
// a skill unused for 30 days becomes stale, for 90 days archived (hidden
// from the Bot, kept, restorable). Pinned skills are exempt; nothing is
// deleted. It's listed with the Bot's automations as "Skill curator" and can
// be paused or run now. Optionally it starts a consolidation fork that
// merges overlapping skills (off by default).
//
// Saves apply immediately. Advisory lint findings never block them.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { isPassOutput } from "@bb-studio/kit/silent";
import { isPingRequest } from "./bot-cache";

type Sdk = BbPluginApi["sdk"];
type ThreadLike = { id: string; status?: string; updatedAt?: number | null; archivedAt?: number | null };

export const LEARN_INTERVAL = 10;
export const STALE_AFTER_MS = 30 * 86_400_000;
export const ARCHIVE_AFTER_MS = 90 * 86_400_000;
export const CURATOR_EVERY_MS = 7 * 86_400_000;
export const CURATOR_IDLE_MS = 2 * 3_600_000;
export const REVIEW_TIMEOUT_MS = 20 * 60_000;
export const SKILL_SOFT_LIMIT = 8000;
export const CURATOR_ID = "skill-curator";
/** BB's largest page of thread events. */
const EVENT_PAGE = 100;
/** The tools a review fork gets, and nothing else of Studio's. */
export const REVIEW_TOOLS = ["bot_skill_list", "bot_skill_view", "bot_skill_write", "bot_skill_patch", "bot_skill_delete", "bot_skill_lint", "pages_read", "pages_edit"] as const;
const SKILL_WRITE_TOOL = /bot_skill_(write|patch|delete)$/;
/** Items that aren't tool work. Everything else an agent does in a turn is. */
const NOT_TOOLS = new Set(["agentMessage", "reasoning", "userMessage", "plan", "contextCompaction", "error"]);

export type SkillState = "active" | "stale" | "archived";

// ---- Pure parts ----

type EventRow = { seq?: number; type: string; data?: Record<string, unknown> | null };

/** Counts tool turns and user turns in events, oldest first; `skillWrite` says the Bot saved a skill (tool turns count from after it). */
export function tallyTurns(events: readonly EventRow[]): { toolTurns: number; userTurns: number; skillWrite: boolean; lastSeq: number } {
  let toolTurns = 0, userTurns = 0, inTurn = 0, skillWrite = false, lastSeq = 0;
  for (const event of events) {
    lastSeq = Math.max(lastSeq, event.seq ?? 0);
    const data = (event.data ?? {}) as { initiator?: string; item?: { type?: string; tool?: string; name?: string } };
    // Studio's cache-warming pings (src/bot-cache.ts) are sent as the user but aren't from them.
    if (event.type === "client/turn/requested" && data.initiator === "user" && !isPingRequest(data)) userTurns++;
    else if (event.type === "item/completed" && data.item?.type && !NOT_TOOLS.has(data.item.type)) {
      inTurn++;
      if (SKILL_WRITE_TOOL.test(String(data.item.tool ?? data.item.name ?? ""))) { skillWrite = true; toolTurns = 0; inTurn = 0; }
    } else if (event.type === "turn/completed") {
      if (inTurn) toolTurns++;
      inTurn = 0;
    }
  }
  return { toolTurns, userTurns, skillWrite, lastSeq };
}

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
export function curatorPlan(skills: readonly { name: string; state: SkillState; pinned: boolean; usedAt: number | null; updatedAt: number }[], now: number): { name: string; from: SkillState; to: SkillState }[] {
  const plan: { name: string; from: SkillState; to: SkillState }[] = [];
  for (const skill of skills) {
    if (skill.pinned || skill.state === "archived") continue;
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
const TOOLS_CONNECTED = `These tools are on the bb-bridge MCP server (mcp__bb-bridge__<name>) and they work here. If a note says bb-bridge disconnected or its tools are no longer available, it's stale: load them with ToolSearch ("select:${REVIEW_TOOLS.map((name) => `mcp__bb-bridge__${name}`).join(",")}") and call them.`;

/** The follow-up a review gets, once, when it gave up on its tools. */
export const RETRY_PROMPT = `Your tools are connected now. Load them with ToolSearch ("select:${REVIEW_TOOLS.map((name) => `mcp__bb-bridge__${name}`).join(",")}"), do the review and reply as asked: one short line, or exactly [PASS].`;

/** A reply that says the review's tools weren't there, rather than that nothing was worth saving. */
export function gaveUpOnTools(text: string | null): boolean {
  return !!text && /\b(disconnected|not (?:available|connected)|unavailable|no longer available|can'?t (?:access|reach|use|call) (?:the |my )?(?:skill|tools|bb-bridge))/i.test(text);
}

/** The review fork's prompt. */
export function reviewPrompt(input: { name: string; memoryPageId: string | null; reason: "tools" | "user" | "both" | "manual" }): string {
  const why = input.reason === "user" ? "You've had a run of turns with the user since the last review." : input.reason === "manual" ? "The user asked for a review." : "You did a run of tool work since you last saved a skill.";
  return [
    `Background skill review for ${JSON.stringify(input.name)}. ${why} The user doesn't see this thread. Look back over the conversation above and save what the next session should already know.`,
    "",
    "What to look for:",
    "- The user correcting you (tone, format, length, approach, the order of steps), or saying \"remember this\". These matter most: put them where the next run will follow them.",
    "- A technique, fix, workaround or tool pattern that took effort to find and will come up again.",
    "- A skill you used that turned out wrong, missing a step or out of date. Fix it now.",
    input.memoryPageId ? `- Facts about the user, their people or their setup: those go on your Memory page (${input.memoryPageId}, pages_read then pages_edit), not in a skill.` : null,
    "",
    "How to write:",
    "- Lessons, not logs. Write the rule a future run follows, not the story of today: no dates, PR numbers or \"we tried\".",
    "- One skill per kind of task, not per incident. Check what you have first (bot_skill_list, bot_skill_view) and prefer bot_skill_patch on the skill that covers it over a new skill.",
    "- When the same lesson shows up again, merge it into one rule. Fix a wrong line in place; don't add one that contradicts it.",
    "- Keep each skill short: when to use it, the steps, the pitfalls. The tool result may carry notes on shape; heed them.",
    "",
    `Use only ${REVIEW_TOOLS.join(", ")}. Don't run commands, edit files, message anyone or start threads. Skill changes apply immediately. After saving, inspect the saved versions with bot_skill_lint and attach any quality or safety warnings to the exact version you inspected; warnings never block saving.`,
    TOOLS_CONNECTED,
    "When you're done, reply with one short line saying what you saved. If nothing is worth saving, reply exactly [PASS].",
  ].filter((line) => line !== null).join("\n");
}

/** The curator's consolidation prompt. */
export function consolidatePrompt(name: string): string {
  return [
    `Skill curator for ${JSON.stringify(name)}. The user doesn't see this thread. Read your skills (bot_skill_list, then bot_skill_view each one that might overlap).`,
    "Where two or more cover the same kind of task, merge them into one class-level skill: write or patch the one that stays, then delete the others. Keep every rule that still holds; drop repeats.",
    "Don't touch skills that don't overlap. Don't delete a pinned skill. Don't run commands or start threads.",
    TOOLS_CONNECTED,
    "Reply with one short line saying what you merged, or exactly [PASS] when nothing overlaps.",
  ].join("\n");
}

// ---- The service ----

type LearningRow = {
  bot_id: string; enabled: number; every_turns: number; review_model: string | null; consolidate: number; curator_paused: number;
  thread_id: string | null; seen_seq: number; tool_turns: number; user_turns: number;
  last_review_at: number | null; last_review_result: string | null; curator_since: number | null; curator_last_at: number | null; curator_last_result: string | null;
};
type ReviewRow = { thread_id: string; bot_id: string; kind: "review" | "consolidate"; status: "running" | "done"; saved: number; memory: number; started_at: number; finished_at: number | null; result: string | null };

export interface LearningBot { id: string; name: string; threadId: string | null; state: string; kind?: string; memoryPageId?: string | null }
export interface LearningSkill { name: string; description: string; body: string; state: SkillState; pinned: boolean; usedAt: number | null; updatedAt: number }
export interface LearningDeps {
  db: Database.Database;
  sdk: Sdk;
  changed(): void;
  bots(): LearningBot[];
  bot(botId: string): LearningBot | null;
  /** The Bot's Memory page id (made on first need); null when there's none. */
  memoryPage(botId: string): string | null;
  skills(botId: string): LearningSkill[];
  setState(botId: string, name: string, state: SkillState): void;
  log?(message: string): void;
  /** When a Bot's chat was last really active, discounting cache-warming pings (BotCacheWarmer.quietSince). */
  quietSince?(threadId: string, updatedAt: number | null): number | null;
  /** How often to look for a fork's workspace; tests make it fast. */
  pollMs?: number;
}

export type LearningView = {
  enabled: boolean; interval: number; reviewModel: string | null; defaultModel: string | null; models: string[];
  approval: boolean; consolidate: boolean; curatorPaused: boolean;
  toolTurns: number; userTurns: number; reviewing: boolean;
  lastReview: { at: number; result: string } | null;
  lastCurator: { at: number; result: string } | null;
  nextCuratorAt: number | null;
  pending: { id: string; name: string; action: "write" | "delete"; description: string | null; diff: string; createdAt: number }[];
};

export class SkillLearning {
  /** Bots a review is being started for, before its row exists. */
  private readonly starting = new Set<string>();
  /** Review forks that have started their turn: a fork is idle before the prompt lands, and that idle isn't the end. */
  private readonly started = new Set<string>();
  /** Review forks already told once that their tools are connected. */
  private readonly retried = new Set<string>();
  /** Threads being counted now, so two idles don't count the same events. */
  private readonly counting = new Set<string>();

  constructor(private readonly deps: LearningDeps) {}

  private row(botId: string): LearningRow {
    this.deps.db.prepare("INSERT OR IGNORE INTO bot_learning (bot_id, curator_since) VALUES (?, ?)").run(botId, Date.now());
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
    if (bot?.threadId) {
      const options = await this.providerModels(bot.threadId).catch(() => null);
      models = options?.map((each) => each.model) ?? [];
      defaultModel = options ? cheapestModel(options) : null;
    }
    return {
      enabled: !!row.enabled, interval: row.every_turns, reviewModel: row.review_model, defaultModel, models,
      approval: false, consolidate: !!row.consolidate, curatorPaused: !!row.curator_paused,
      toolTurns: row.tool_turns, userTurns: row.user_turns, reviewing: !!this.running(botId),
      lastReview: row.last_review_at && row.last_review_result ? { at: row.last_review_at, result: row.last_review_result } : null,
      lastCurator: row.curator_last_at && row.curator_last_result ? { at: row.curator_last_at, result: row.curator_last_result } : null,
      nextCuratorAt: null, // Built-in Maintenance owns the schedule.
      pending: [],
    };
  }

  async set(botId: string, input: { enabled?: boolean; interval?: number; reviewModel?: string | null; approval?: boolean; consolidate?: boolean; curatorPaused?: boolean }): Promise<LearningView> {
    if (input.interval !== undefined && (!Number.isInteger(input.interval) || input.interval < 2 || input.interval > 200)) throw new Error("The interval is 2 to 200 turns.");
    this.save(botId, {
      ...(input.enabled !== undefined ? { enabled: input.enabled ? 1 : 0 } : {}),
      ...(input.interval !== undefined ? { every_turns: input.interval } : {}),
      ...(input.reviewModel !== undefined ? { review_model: input.reviewModel || null } : {}),
      ...(input.consolidate !== undefined ? { consolidate: input.consolidate ? 1 : 0 } : {}),
      ...(input.curatorPaused !== undefined ? { curator_paused: input.curatorPaused ? 1 : 0, ...(input.curatorPaused ? {} : { curator_since: Date.now() }) } : {}),
    });
    this.deps.changed();
    return this.view(botId);
  }

  // ---- Counting ----

  /** A thread went idle: a review fork finishes; a Bot's thread is counted and may start a review. */
  async idle(thread: ThreadLike, lastAssistantText: string | null): Promise<void> {
    const review = this.review(thread.id);
    if (review) {
      if (review.status === "running" && this.started.delete(thread.id)) await this.finish(review, lastAssistantText);
      return;
    }
    const bot = this.deps.bots().find((each) => each.threadId === thread.id);
    if (!bot || bot.kind === "external") return;
    await this.count(bot);
    await this.maybeReview(bot.id);
  }

  /** Reads the Bot thread's new events and adds them to its counters. */
  async count(bot: LearningBot): Promise<void> {
    if (!bot.threadId || this.counting.has(bot.threadId)) return;
    this.counting.add(bot.threadId);
    try {
      const row = this.row(bot.id);
      const threadId = bot.threadId;
      if (row.thread_id !== threadId) {
        // A new thread (first look or a handoff): start from its tip, keep the counts.
        const tip = await this.deps.sdk.threads.events.list({ threadId, order: "desc", limit: "1" }).catch(() => []);
        this.save(bot.id, { thread_id: threadId, seen_seq: (tip as EventRow[])[0]?.seq ?? 0 });
        return;
      }
      let after = row.seen_seq;
      let tools = row.tool_turns, users = row.user_turns;
      // BB pages events 100 at a time.
      for (let page = 0; page < 100; page++) {
        const events = await this.deps.sdk.threads.events.list({ threadId, afterSeq: String(after), order: "asc", limit: String(EVENT_PAGE), types: ["client/turn/requested", "item/completed", "turn/completed"] }) as EventRow[];
        if (!events.length) break;
        const tally = tallyTurns(events);
        tools = tally.skillWrite ? tally.toolTurns : tools + tally.toolTurns;
        users += tally.userTurns;
        after = Math.max(after, tally.lastSeq);
        if (events.length < EVENT_PAGE) break;
      }
      this.save(bot.id, { seen_seq: after, tool_turns: tools, user_turns: users });
    } finally {
      this.counting.delete(bot.threadId);
    }
  }

  /** Starts a review when a counter tripped, learning is on, the Bot is active and idle, and none is running. */
  async maybeReview(botId: string): Promise<boolean> {
    const row = this.row(botId);
    if (!row.enabled) return false;
    const tools = row.tool_turns >= row.every_turns, users = row.user_turns >= row.every_turns;
    if (!tools && !users) return false;
    return this.start(botId, "review", tools && users ? "both" : tools ? "tools" : "user");
  }

  // ---- The review fork ----

  /** Forks the Bot's thread for a review or consolidation. False when one is running or the Bot isn't ready. */
  async start(botId: string, kind: "review" | "consolidate", reason: "tools" | "user" | "both" | "manual" = "manual"): Promise<boolean> {
    const bot = this.studioBot(botId);
    if (!bot?.threadId || bot.state !== "active" || this.starting.has(botId) || this.running(botId)) return false;
    this.starting.add(botId);
    try {
      const source = await this.deps.sdk.threads.get({ threadId: bot.threadId });
      if (source.status !== "idle" || source.archivedAt) return false;
      const row = this.row(botId);
      const models = await this.providerModels(bot.threadId).catch(() => null);
      const model = row.review_model ?? (models ? cheapestModel(models) : null);
      const fork = await this.deps.sdk.threads.fork({
        sourceThreadId: bot.threadId, title: `${bot.name} · ${kind === "review" ? "skill review" : "skill curator"}`,
        visibility: "hidden", pluginMetadata: { botReview: botId },
      } as never);
      const now = Date.now();
      this.deps.db.prepare("INSERT INTO bot_skill_reviews (thread_id, bot_id, kind, status, started_at) VALUES (?, ?, ?, 'running', ?)").run(fork.id, botId, kind, now);
      if (kind === "review") this.save(botId, { tool_turns: 0, user_turns: 0 });
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
        const prompt = kind === "review"
          ? reviewPrompt({ name: bot.name, memoryPageId: this.deps.memoryPage(botId), reason })
          : consolidatePrompt(bot.name);
        await this.deps.sdk.threads.send({ threadId: fork.id, mode: "auto", input: [{ type: "text", text: prompt, mentions: [] }] } as never);
      } catch (error) {
        await this.close(this.review(fork.id)!, `Couldn't start: ${error instanceof Error ? error.message : String(error)}`, true);
        throw error;
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

  /** A review's tool wrote something: counted for its result line. */
  noteWrite(threadId: string | undefined, what: "saved" | "memory"): void {
    const review = this.review(threadId);
    if (review?.status === "running") this.deps.db.prepare(`UPDATE bot_skill_reviews SET ${what} = ${what} + 1 WHERE thread_id = ?`).run(review.thread_id);
  }

  private async finish(review: ReviewRow, text: string | null): Promise<void> {
    // Memory edits go through Pages' own tool: read them off the fork's events.
    const events: EventRow[] = [];
    for (let page = 0, after = 0; page < 20; page++) {
      const batch = await this.deps.sdk.threads.events.list({ threadId: review.thread_id, afterSeq: String(after), order: "asc", limit: String(EVENT_PAGE), types: ["item/completed"] }).catch(() => []) as EventRow[];
      events.push(...batch);
      after = batch.at(-1)?.seq ?? after;
      if (batch.length < EVENT_PAGE) break;
    }
    const memory = events.filter((event) => /pages_edit$/.test(String((event.data as { item?: { tool?: string } } | undefined)?.item?.tool ?? ""))).length;
    if (memory) this.deps.db.prepare("UPDATE bot_skill_reviews SET memory = ? WHERE thread_id = ?").run(memory, review.thread_id);
    const fresh = this.review(review.thread_id)!;
    const parts = [
      fresh.saved ? `Saved ${fresh.saved} skill${fresh.saved === 1 ? "" : "s"}` : "",
      fresh.memory ? "Updated Memory" : "",
    ].filter(Boolean);
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

  /** A thread became active: a new turn in a Bot's thread stops its running review. */
  async active(threadId: string): Promise<void> {
    if (this.review(threadId)?.status === "running") { this.started.add(threadId); return; }
    const bot = this.deps.bots().find((each) => each.threadId === threadId);
    const review = bot ? this.running(bot.id) : undefined;
    if (review) await this.close(review, "Stopped: you started a turn", true);
  }

  /** A review fork failed. */
  async failed(threadId: string, error: string | null): Promise<void> {
    const review = this.review(threadId);
    if (review?.status === "running") await this.close(review, `Failed${error ? `: ${error.slice(0, 120)}` : ""}`);
  }

  // ---- Curator ----

  /** The curator’s last result. Built-in Maintenance owns its schedule. */
  curatorState(botId: string): { paused: boolean; lastRunAt: number | null; lastOutcome: string | null; nextRunAt: number | null } {
    const row = this.row(botId);
    return { paused: !!row.curator_paused, lastRunAt: row.curator_last_at, lastOutcome: row.curator_last_result, nextRunAt: null };
  }

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

  /** The minute tick: times out stuck reviews and stops reviews of paused Bots. */
  async tick(now = Date.now()): Promise<void> {
    for (const review of this.deps.db.prepare("SELECT * FROM bot_skill_reviews WHERE status = 'running'").all() as ReviewRow[]) {
      const bot = this.deps.bot(review.bot_id);
      if (!bot || bot.state !== "active") await this.close(review, `Stopped: ${bot?.name ?? "the bot"} is ${bot?.state ?? "gone"}`, true);
      else if (now - review.started_at > REVIEW_TIMEOUT_MS) await this.close(review, "Stopped: took too long", true);
    }

  }
}
