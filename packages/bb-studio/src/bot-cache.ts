// Prompt-cache warming for Bot chats. A Bot's chat is long, and Claude's
// prompt cache (Claude Code writes it with a 1-hour TTL) makes each send read
// the history at a tenth of the input price or less. After an hour without a
// turn the cache expires, and the next send writes the whole history again at
// 2x. So while the user is around, Studio sends an idle Bot chat a tiny ping
// about every 55 minutes: the provider reads the cached history, which
// refreshes its TTL, and the Bot replies "[PASS]".
//
// Which threads: each Bot's own chat (its current thread; older threads of
// its handoff chain are archived). Not runners or threads it started: they
// run on their own schedules and are rarely talked to between runs.
//
// When (decideWarm, a pure function): the chat is idle, its context is above
// the Bot's threshold (100k tokens by default), its model has a warmable
// cache (Claude; see src/bot-prices.ts) and the cache is still warm. A ping
// is due 55 minutes after the last turn or ping. Warming stops when:
//   - the user hasn't sent a message for the idle cutoff (3 hours by default);
//     pings, check-ins and Studio's own notices don't count as user messages;
//   - the provider is in overage (its cache lasts 5 minutes there, so
//     warming can't help);
//   - the Bot is paused or stopped, or warming is off for it;
//   - the chat is busy (a turn refreshes the cache anyway).
// There are no waking hours: the idle cutoff alone ends warming.
// Once the cache has expired Studio doesn't ping again: that would pay the
// full write the user's next message pays anyway. A user message makes the
// cache warm again and resumes warming. Nothing is sent in the first
// 5 minutes after Studio starts, unless the cache would expire by then: a
// reload just before a ping was due (plugin development reloads Studio often)
// then sends it 2 minutes before expiry, but not in the first 30 seconds.
//
// Compaction before expiry (compactBeforeExpiry, on by default): when warming
// stops for the idle cutoff while the cache is still warm, Studio compacts the
// chat once instead of the ping that would have been due (55 minutes after the
// last turn). Compaction reads the history from the warm cache, so the user's
// next message writes a short summary instead of the whole history. It's once
// per idle stretch (bot_cache_compactions; a new user message starts another;
// the "/compact" it sends isn't one) and follows the same rules as a ping: not in overage, cold, small or busy.
//
// Pings are as quiet as BB allows. The message is agent-only, so BB shows no
// user row; the Bot's "[PASS]" reply still shows on the desktop (BB has no
// way to hide a core message row) and the iOS app hides it. pluginSubmission
// marks the send for message.dispatch hooks (Smart Queue only holds human
// sends to busy threads, and a ping only goes to an idle one). BB marks a
// thread unread when a turn ends, so Studio marks it read again when it was
// read before the ping. Studio's own counters skip pings: Learn from work's
// user-turn count (isPingRequest) and cache-ping activity baseline (quietSince), and
// a review running beside the chat isn't stopped by one.
//
// Settings are per Bot (bot_cache_settings). Pings are logged (bot_cache_pings),
// compactions before expiry too (bot_cache_compactions).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { priceFor, type ModelPrice } from "./bot-prices";

type Sdk = BbPluginApi["sdk"];

export const PING_MARKER = "[studio:cache-keepalive]";
export const PING_TEXT = `${PING_MARKER} Studio keeps your prompt cache warm while the user is away. This isn't from the user: don't use tools, don't mention it, and reply exactly [PASS].`;
export const PING_EVERY_MS = 55 * 60_000;
/** Claude Code's cache TTL. */
export const CACHE_TTL_MS = 60 * 60_000;
/** OpenAI keeps a prompt cache for minutes; a cold estimate past this. */
const SHORT_TTL_MS = 5 * 60_000;
export const STARTUP_GRACE_MS = 5 * 60_000;
/** The shortest wait after startup, when the cache would expire within STARTUP_GRACE_MS. */
export const STARTUP_MIN_MS = 30_000;
/** A ping's own tokens: the message and the reply written to the cache, and "[PASS]". */
const PING_TAIL_TOKENS = 120;
const PING_OUTPUT_TOKENS = 10;
const HOUR = 3_600_000;

export type WarmSettings = { enabled: boolean; thresholdTokens: number; idleHours: number; compactBeforeExpiry: boolean };
export const DEFAULT_WARM: WarmSettings = { enabled: true, thresholdTokens: 100_000, idleHours: 3, compactBeforeExpiry: true };
/** Waking hours are gone; their NOT NULL columns still get the old defaults. */
const OLD_WAKE_START = 7 * 60, OLD_WAKE_END = 23 * 60;

export type WarmOffReason = "unpriced" | "disabled" | "paused" | "stopped" | "small" | "cold" | "overage" | "idle" | "compacted";
export type WarmDecision =
  | { action: "ping" }
  /** Compact the chat once it's `at` (the ping's due time), before the cache expires. */
  | { action: "compact"; at: number }
  | { action: "wait"; at: number; reason: "due" | "busy" | "startup" }
  | { action: "off"; reason: WarmOffReason };

export interface WarmInput {
  now: number;
  /** When Studio started; nothing is sent before STARTUP_GRACE_MS after it (STARTUP_MIN_MS when the cache expires sooner). */
  startedAt: number;
  settings: WarmSettings;
  botState: "active" | "paused" | "stopped";
  busy: boolean;
  contextTokens: number | null;
  warmable: boolean;
  /** The last turn of any kind, pings included: when the cache was last read or written. */
  lastTurnAt: number | null;
  /** The user's last message; pings and Studio's notices aren't. */
  lastUserAt: number | null;
  overage: boolean;
  /** When Studio last compacted this chat before expiry. */
  lastCompactAt: number | null;
}

/** Whether to ping a Bot's chat now, wait, or not warm it (and why). */
export function decideWarm(input: WarmInput): WarmDecision {
  const { now, settings } = input;
  if (!input.warmable) return { action: "off", reason: "unpriced" };
  if (!settings.enabled) return { action: "off", reason: "disabled" };
  if (input.botState !== "active") return { action: "off", reason: input.botState };
  if (input.busy) return { action: "wait", at: now + 2 * 60_000, reason: "busy" };
  if (input.contextTokens == null || input.contextTokens < settings.thresholdTokens) return { action: "off", reason: "small" };
  if (input.lastTurnAt == null) return { action: "off", reason: "cold" };
  const expires = input.lastTurnAt + CACHE_TTL_MS;
  // A minute's margin: a ping that lands after expiry pays the full write.
  if (now >= expires - 60_000) return { action: "off", reason: "cold" };
  if (input.overage) return { action: "off", reason: "overage" };
  const due = input.lastTurnAt + PING_EVERY_MS;
  // A reload just before expiry shortens the startup wait to 2 minutes before it.
  const grace = Math.max(input.startedAt + STARTUP_MIN_MS, Math.min(input.startedAt + STARTUP_GRACE_MS, expires - 2 * 60_000));
  // A cache that expires before Studio may send is lost.
  if (grace >= expires - 60_000) return { action: "off", reason: "cold" };
  if (input.lastUserAt == null || now - input.lastUserAt >= settings.idleHours * HOUR) {
    // Once per idle stretch: a compaction after the user's last message ends it.
    const compacted = input.lastCompactAt != null && (input.lastUserAt == null || input.lastCompactAt >= input.lastUserAt);
    if (compacted) return { action: "off", reason: "compacted" };
    if (!settings.compactBeforeExpiry) return { action: "off", reason: "idle" };
    return { action: "compact", at: Math.max(due, grace) };
  }
  if (now < Math.max(due, grace)) return { action: "wait", at: Math.max(due, grace), reason: due >= grace ? "due" : "startup" };
  return { action: "ping" };
}

export const OFF_REASON: Record<WarmOffReason, string> = {
  unpriced: "This model's cache can't be kept warm",
  disabled: "Warming is off for this Bot",
  paused: "The Bot is paused",
  stopped: "The Bot is stopped",
  small: "The chat is below the size threshold",
  cold: "The cache expired; your next message refills it",
  overage: "The provider is in overage, where the cache lasts 5 minutes",
  idle: "No message from you for a while",
  compacted: "Compacted before the cache expired; no message from you since",
};

// ---- Costs ----

const usd = (tokens: number, perMTok: number) => (tokens / 1e6) * perMTok;
/** The next send's cost to read the history from a warm cache. */
export function warmSendUsd(tokens: number, price: ModelPrice): number { return usd(tokens, price.cacheRead); }
/** The next send's cost to write the history again once the cache expired (Claude Code writes 1-hour entries). */
export function coldSendUsd(tokens: number, price: ModelPrice): number { return usd(tokens, price.cacheWrite1h); }
/** One ping: a cache read of the history, its own short tail written, and "[PASS]". */
export function pingUsd(tokens: number, price: ModelPrice): number { return usd(tokens, price.cacheRead) + usd(PING_TAIL_TOKENS, price.cacheWrite1h) + usd(PING_OUTPUT_TOKENS, price.output); }
/** Warming's cost per hour: a ping every 55 minutes. */
export function warmingPerHourUsd(tokens: number, price: ModelPrice): number { return pingUsd(tokens, price) * (HOUR / PING_EVERY_MS); }
/** Idle hours of warming that cost as much as one cold re-write saves. */
export function breakEvenHours(tokens: number, price: ModelPrice): number { return (coldSendUsd(tokens, price) - warmSendUsd(tokens, price)) / warmingPerHourUsd(tokens, price); }

export { formatTokens, formatUsd } from "./bot-cache-format";

// ---- Reading a thread ----

type EventRow = { type: string; createdAt?: number; data?: unknown };
type Part = { type?: string; text?: string; visibility?: string };
type Requested = { initiator?: string; senderThreadId?: string | null; input?: Part[] };

/** A client/turn/requested event's data is one of Studio's pings. */
export function isPingRequest(data: unknown): boolean {
  const input = (data as Requested | null)?.input;
  return Array.isArray(input) && input.length > 0 && input.every((part) => part.visibility === "agent-only") && input.some((part) => typeof part.text === "string" && part.text.startsWith(PING_MARKER));
}

/**
 * A client/turn/requested event's data is a message from the user: sent as
 * the user, not by another thread, with something the user sees. Studio's
 * notices (runner reports, watchers) carry an agent-only note and check-ins
 * start "Check-in for", so neither counts; pings are agent-only. A bare
 * "/compact" isn't either: it's how Studio's compaction before expiry (and
 * Compact) reaches the chat, and counting it would start a new idle stretch.
 */
export function isUserRequest(data: unknown): boolean {
  const request = data as Requested | null;
  if (!request || request.initiator !== "user" || request.senderThreadId || !Array.isArray(request.input)) return false;
  if (request.input.some((part) => part.visibility === "agent-only")) return false;
  const text = request.input.find((part) => part.type === "text")?.text ?? "";
  if (/^Check-in for /.test(text) || text.trim() === "/compact") return false;
  return request.input.length > 0;
}

type RateLimits = { status?: string; kind?: string; overageStatus?: string | null; windows?: { status?: string; resetsAtMs?: number | null }[] };

/** The provider is in overage: billed as extra usage (credits), or a window is blocked and overage lets it go on. */
export function inOverage(rateLimits: RateLimits | null | undefined, at: number | undefined, now: number): boolean {
  if (!rateLimits) return false;
  const live = (rateLimits.windows ?? []).filter((window) => window.resetsAtMs == null || window.resetsAtMs > now);
  const blocked = live.some((window) => window.status === "blocked");
  const overageOk = rateLimits.overageStatus === "allowed" || rateLimits.overageStatus === "warning";
  if (blocked && overageOk) return true;
  // Credits with no known reset: trust it for 5 hours, a subscription window.
  return rateLimits.kind === "credits" && (live.length > 0 || (at != null && now - at < 5 * HOUR));
}

// ---- The warmer ----

export type CacheBot = { id: string; name: string; state: "active" | "paused" | "stopped"; threadId: string | null; kind?: "studio" | "external" };

export interface WarmerDeps {
  db: Database.Database;
  sdk: Sdk;
  bots(): CacheBot[];
  /** Studio's plugin id, for pluginSubmission. */
  pluginId: string;
  changed?(): void;
  log?(message: string): void;
  now?(): number;
}

type Observed = {
  at: number; botId: string; threadId: string; model: string | null; price: ModelPrice | null;
  busy: boolean; contextTokens: number | null; lastTurnAt: number | null; lastUserAt: number | null; overage: boolean;
  updatedAt: number | null; wasRead: boolean;
};

export type CacheStateView = {
  botId: string | null;
  threadId: string;
  state: "warm" | "cold" | "off";
  label: string;
  warmUntil: number | null;
  model: string | null;
  contextTokens: number | null;
  warming: { active: boolean; nextPingAt: number | null; reason: string | null; lastPingAt: number | null; lastCompactAt: number | null; compactAt: number | null };
  costs: { warmingPerHour: number | null; coldSend: number | null; warmSend: number | null };
  /** Show the cold-send banner in the composer. */
  banner: boolean;
  settings: WarmSettings;
};

type SettingsRow = { bot_id: string; enabled: number; threshold_tokens: number; idle_hours: number; compact_before_expiry: number };
type Pending = { sentAt: number; wasRead: boolean };

export class BotCacheWarmer {
  readonly startedAt: number;
  private readonly observed = new Map<string, Observed>();
  private readonly nextCheck = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  private ticking = false;

  constructor(private readonly deps: WarmerDeps) {
    this.startedAt = this.now();
  }

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  settings(botId: string): WarmSettings {
    const row = this.deps.db.prepare("SELECT * FROM bot_cache_settings WHERE bot_id = ?").get(botId) as SettingsRow | undefined;
    return row ? { enabled: !!row.enabled, thresholdTokens: row.threshold_tokens, idleHours: row.idle_hours, compactBeforeExpiry: !!row.compact_before_expiry } : { ...DEFAULT_WARM };
  }

  setSettings(botId: string, patch: Partial<WarmSettings>): WarmSettings {
    const current = this.settings(botId);
    const next: WarmSettings = { enabled: patch.enabled ?? current.enabled, thresholdTokens: patch.thresholdTokens ?? current.thresholdTokens, idleHours: patch.idleHours ?? current.idleHours, compactBeforeExpiry: patch.compactBeforeExpiry ?? current.compactBeforeExpiry };
    this.deps.db.prepare(`INSERT INTO bot_cache_settings (bot_id, enabled, threshold_tokens, idle_hours, compact_before_expiry, wake_start, wake_end, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (bot_id) DO UPDATE SET enabled = excluded.enabled, threshold_tokens = excluded.threshold_tokens, idle_hours = excluded.idle_hours, compact_before_expiry = excluded.compact_before_expiry, updated_at = excluded.updated_at`)
      .run(botId, next.enabled ? 1 : 0, next.thresholdTokens, next.idleHours, next.compactBeforeExpiry ? 1 : 0, OLD_WAKE_START, OLD_WAKE_END, this.now());
    for (const bot of this.deps.bots()) if (bot.id === botId && bot.threadId) this.nextCheck.delete(bot.threadId);
    this.deps.changed?.();
    return next;
  }

  /** The Bot whose chat this is (its current thread), if any. */
  botFor(threadId: string): CacheBot | null {
    return this.deps.bots().find((bot) => bot.threadId === threadId && bot.kind !== "external") ?? null;
  }

  lastPing(threadId: string): { sentAt: number; quietSince: number | null } | null {
    const row = this.deps.db.prepare("SELECT sent_at, quiet_since FROM bot_cache_pings WHERE thread_id = ? ORDER BY sent_at DESC LIMIT 1").get(threadId) as { sent_at: number; quiet_since: number | null } | undefined;
    return row ? { sentAt: row.sent_at, quietSince: row.quiet_since } : null;
  }

  /** When Studio last compacted this chat before its cache expired. */
  lastCompact(threadId: string): number | null {
    const row = this.deps.db.prepare("SELECT MAX(at) AS at FROM bot_cache_compactions WHERE thread_id = ?").get(threadId) as { at: number | null } | undefined;
    return row?.at ?? null;
  }

  /** A ping is on its way or running in this thread. */
  pinging(threadId: string): boolean { return this.pending.has(threadId); }

  /**
   * When the thread's update timestamp came from a recent cache ping, return
   * the saved pre-ping timestamp so cache warming does not look like activity.
   */
  quietSince(threadId: string, updatedAt: number | null | undefined): number | null {
    if (updatedAt == null) return null;
    const ping = this.lastPing(threadId);
    if (ping && updatedAt >= ping.sentAt && updatedAt - ping.sentAt < 15 * 60_000) return ping.quietSince ?? updatedAt;
    return updatedAt;
  }

  hideBanner(threadId: string): void {
    this.deps.db.prepare("INSERT OR IGNORE INTO bot_cache_banner_off (thread_id, at) VALUES (?, ?)").run(threadId, this.now());
    this.deps.changed?.();
  }
  private bannerOff(threadId: string): boolean {
    return !!this.deps.db.prepare("SELECT 1 FROM bot_cache_banner_off WHERE thread_id = ?").get(threadId);
  }

  /** Reads what the decision needs from BB; cached for `maxAgeMs`. */
  async observe(bot: CacheBot, threadId: string, maxAgeMs = 20_000): Promise<Observed> {
    const now = this.now();
    const cached = this.observed.get(threadId);
    if (cached && now - cached.at < maxAgeMs) return cached;
    const { sdk } = this.deps;
    const [thread, context, options, usage, limits, requests, compactions, interactions] = await Promise.all([
      sdk.threads.get({ threadId }).catch(() => null),
      sdk.threads.context({ threadId }).catch(() => null),
      sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null),
      sdk.threads.events.list({ threadId, types: ["thread/tokenUsage/updated"], order: "desc", limit: "1" }).catch(() => []),
      sdk.threads.events.list({ threadId, types: ["provider/rateLimits/updated"], order: "desc", limit: "1" }).catch(() => []),
      sdk.threads.events.list({ threadId, types: ["client/turn/requested"], order: "desc", limit: "30" }).catch(() => []),
      sdk.threads.events.list({ threadId, types: ["thread/compacted"], order: "desc", limit: "1" }).catch(() => []),
      sdk.threads.interactions.list({ threadId }).catch(() => null),
    ]);
    const lastUsage = (usage as EventRow[])[0];
    const lastLimit = (limits as EventRow[])[0];
    const userRequest = (requests as EventRow[]).find((event) => isUserRequest(event.data));
    const model = (options as { model?: string | null } | null)?.model ?? null;
    const usedTokens = (context as { usage?: { usedTokens?: number } | null } | null)?.usage?.usedTokens;
    const lastPing = this.lastPing(threadId)?.sentAt ?? null;
    const lastTurnAt = Math.max(lastUsage?.createdAt ?? 0, lastPing ?? 0) || null;
    // Compacted since the last usage report: the context size from before is stale until the next turn.
    const compactedAt = (compactions as EventRow[])[0]?.createdAt ?? this.lastCompact(threadId);
    const stale = compactedAt != null && compactedAt >= (lastUsage?.createdAt ?? 0);
    const observed: Observed = {
      at: now, botId: bot.id, threadId, model, price: priceFor(model),
      busy: !thread || ["active", "pending", "starting", "stopping"].includes(thread.status) || thread.queuedMessageCount > 0 || thread.activeBackgroundAgentCount > 0 || !interactions || interactions.some((i) => i.status === "pending" || i.status === "resolving"),
      contextTokens: typeof usedTokens === "number" && !stale ? usedTokens : null,
      lastTurnAt,
      lastUserAt: userRequest?.createdAt ?? null,
      overage: inOverage((lastLimit?.data as { rateLimits?: RateLimits } | undefined)?.rateLimits, lastLimit?.createdAt, now),
      updatedAt: thread?.updatedAt ?? null,
      wasRead: thread?.lastReadAt != null && thread.latestAttentionAt != null && thread.lastReadAt >= thread.latestAttentionAt,
    };
    this.observed.set(threadId, observed);
    return observed;
  }

  decide(bot: CacheBot, observed: Observed): WarmDecision {
    const now = this.now();
    return decideWarm({
      now, startedAt: this.startedAt, settings: this.settings(bot.id), botState: bot.state,
      busy: observed.busy || this.pending.has(observed.threadId), contextTokens: observed.contextTokens,
      warmable: !!observed.price?.warmable, lastTurnAt: observed.lastTurnAt, lastUserAt: observed.lastUserAt,
      overage: observed.overage, lastCompactAt: this.lastCompact(observed.threadId),
    });
  }

  /** The cache state of a thread, for the header chip, the banner, Bot info and the iOS app. */
  async state(threadId: string): Promise<CacheStateView> {
    const bot = this.botFor(threadId);
    const settings = bot ? this.settings(bot.id) : { ...DEFAULT_WARM };
    const empty: CacheStateView = { botId: null, threadId, state: "off", label: "", warmUntil: null, model: null, contextTokens: null, warming: { active: false, nextPingAt: null, reason: null, lastPingAt: null, lastCompactAt: null, compactAt: null }, costs: { warmingPerHour: null, coldSend: null, warmSend: null }, banner: false, settings };
    if (!bot) return empty;
    const observed = await this.observe(bot, threadId);
    const now = this.now();
    const decision = this.decide(bot, observed);
    const ttl = observed.price?.warmable === false ? SHORT_TTL_MS : CACHE_TTL_MS;
    const warmUntil = observed.lastTurnAt != null && now < observed.lastTurnAt + ttl ? observed.lastTurnAt + ttl : null;
    const active = decision.action !== "off";
    const state = warmUntil != null ? "warm" : active || (settings.enabled && observed.price?.warmable) ? "cold" : "off";
    const label = state === "warm" ? `Warm · ${Math.max(1, Math.ceil((warmUntil! - now) / 60_000))}m` : state === "cold" ? "Cold" : "Warming off";
    const tokens = observed.contextTokens;
    const price = observed.price;
    const big = tokens != null && tokens >= settings.thresholdTokens;
    return {
      botId: bot.id, threadId, state, label, warmUntil, model: observed.model, contextTokens: tokens,
      warming: {
        active: decision.action === "ping" || decision.action === "wait", nextPingAt: decision.action === "wait" ? decision.at : decision.action === "ping" ? now : null,
        reason: decision.action === "off" ? OFF_REASON[decision.reason] : decision.action === "wait" && decision.reason === "busy" ? "Working; a turn refreshes the cache" : decision.action === "compact" ? "No message from you for a while; compacts before the cache expires" : null,
        lastPingAt: this.lastPing(threadId)?.sentAt ?? null,
        lastCompactAt: this.lastCompact(threadId),
        compactAt: decision.action === "compact" ? decision.at : null,
      },
      costs: {
        warmingPerHour: price && tokens != null ? warmingPerHourUsd(tokens, price) : null,
        coldSend: price && tokens != null ? coldSendUsd(tokens, price) : null,
        warmSend: price && tokens != null ? warmSendUsd(tokens, price) : null,
      },
      // Claude only: OpenAI's cache lasts minutes and its expiry isn't known, so a banner would always show.
      banner: warmUntil == null && big && !observed.busy && !!price?.warmable && !this.bannerOff(threadId),
      settings,
    };
  }

  /** Looks at each Bot chat that's due a look, and pings those that should be. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let sent = 0;
    try {
      const now = this.now();
      if (now < this.startedAt + STARTUP_MIN_MS) return 0;
      // A ping that never reported idle (BB restarted, the event was lost) is done.
      for (const [threadId, pending] of this.pending) if (now - pending.sentAt > 15 * 60_000) this.pending.delete(threadId);
      for (const bot of this.deps.bots()) {
        if (!bot.threadId || bot.kind === "external" || this.pending.has(bot.threadId)) continue;
        if ((this.nextCheck.get(bot.threadId) ?? 0) > now) continue;
        const observed = await this.observe(bot, bot.threadId, 0);
        const decision = this.decide(bot, observed);
        if (decision.action === "ping") {
          if (await this.ping(bot, observed)) sent++;
          this.nextCheck.set(bot.threadId, now + 5 * 60_000);
        } else if (decision.action === "compact") {
          if (decision.at > now) this.nextCheck.set(bot.threadId, decision.at);
          else { await this.autoCompact(bot, observed); this.nextCheck.set(bot.threadId, now + 5 * 60_000); }
        } else {
          this.nextCheck.set(bot.threadId, decision.action === "wait" ? decision.at : now + 10 * 60_000);
        }
      }
    } finally {
      this.ticking = false;
    }
    return sent;
  }

  private async ping(bot: CacheBot, observed: Observed): Promise<boolean> {
    const threadId = observed.threadId;
    const now = this.now();
    // Preserve the thread's activity timestamp before this cache ping.
    const quiet = this.quietSince(threadId, observed.updatedAt);
    this.pending.set(threadId, { sentAt: now, wasRead: observed.wasRead });
    try {
      await this.deps.sdk.threads.send({
        threadId, mode: "start",
        input: [{ type: "text", text: PING_TEXT, mentions: [], visibility: "agent-only" }],
        pluginSubmission: { pluginId: this.deps.pluginId, data: { kind: "cache-keepalive" } },
      } as never);
    } catch (error) {
      this.pending.delete(threadId);
      this.deps.log?.(`Cache warming: the ping to ${threadId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    this.deps.db.prepare("INSERT INTO bot_cache_pings (bot_id, thread_id, sent_at, quiet_since) VALUES (?, ?, ?, ?)").run(bot.id, threadId, now, quiet);
    this.deps.db.prepare("DELETE FROM bot_cache_pings WHERE sent_at < ?").run(now - 30 * 24 * HOUR);
    this.observed.delete(threadId);
    this.deps.changed?.();
    return true;
  }

  /** Compacts an idle chat before its cache expires (decideWarm's "compact"), once per idle stretch. */
  private async autoCompact(bot: CacheBot, observed: Observed): Promise<boolean> {
    const threadId = observed.threadId;
    const now = this.now();
    this.pending.set(threadId, { sentAt: now, wasRead: observed.wasRead });
    try {
      await this.deps.sdk.threads.compact({ threadId });
    } catch (error) {
      this.pending.delete(threadId);
      this.deps.log?.(`Cache warming: compacting ${threadId} before expiry failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    this.deps.db.prepare("INSERT INTO bot_cache_compactions (bot_id, thread_id, at, tokens) VALUES (?, ?, ?, ?)").run(bot.id, threadId, now, observed.contextTokens);
    this.deps.db.prepare("DELETE FROM bot_cache_compactions WHERE at < ?").run(now - 30 * 24 * HOUR);
    this.observed.delete(threadId);
    this.deps.changed?.();
    return true;
  }

  /** A thread went idle: a ping finished (read again if it was read before), or a real turn ended. */
  async idle(threadId: string): Promise<void> {
    const pending = this.pending.get(threadId);
    this.observed.delete(threadId);
    if (!pending) {
      // A real turn: look again at the next tick (a user message resumes warming).
      this.nextCheck.delete(threadId);
      return;
    }
    this.pending.delete(threadId);
    if (pending.wasRead) await this.deps.sdk.threads.markRead({ threadId }).catch(() => {});
    this.deps.changed?.();
  }

  /** A thread failed: a ping that failed is done. */
  failed(threadId: string): void {
    this.pending.delete(threadId);
    this.observed.delete(threadId);
  }

  /** Starts BB's compaction of an idle Bot chat (asked for by the user). */
  async compact(threadId: string): Promise<void> {
    if (!this.botFor(threadId)) throw new Error("Only a Bot's chat is compacted from here.");
    await this.deps.sdk.threads.compact({ threadId });
    this.observed.delete(threadId);
  }
}

export { priceFor };
