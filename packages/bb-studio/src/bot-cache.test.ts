import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BotCacheWarmer, breakEvenHours, CACHE_TTL_MS, coldSendUsd, decideWarm, DEFAULT_WARM, formatTokens, formatUsd, inOverage,
  isPingRequest, isUserRequest, PING_EVERY_MS, PING_TEXT, pingUsd, STARTUP_GRACE_MS, STARTUP_MIN_MS, warmingPerHourUsd, warmSendUsd, type WarmInput,
} from "./bot-cache";
import { MODEL_PRICES, priceFor } from "./bot-prices";
import { rpcContract } from "./contract";
import { MIGRATIONS } from "./migrations";
import { tallyTurns } from "./skill-learning";

const MIN = 60_000, HOUR = 60 * MIN;
const T0 = 1_800_000_000_000;
/** Idle, big, warm (last turn 10 minutes ago), the user wrote 30 minutes ago, long after startup. */
const base = (patch: Partial<WarmInput> = {}): WarmInput => ({
  now: T0, startedAt: T0 - 10 * HOUR, settings: DEFAULT_WARM, botState: "active", busy: false, contextTokens: 300_000, warmable: true,
  lastTurnAt: T0 - 10 * MIN, lastUserAt: T0 - 30 * MIN, overage: false, lastCompactAt: null, ...patch,
});

describe("decideWarm", () => {
  it("waits until 55 minutes after the last turn, then pings", () => {
    expect(decideWarm(base())).toEqual({ action: "wait", at: T0 - 10 * MIN + PING_EVERY_MS, reason: "due" });
    expect(decideWarm(base({ lastTurnAt: T0 - 55 * MIN, lastUserAt: T0 - 55 * MIN }))).toEqual({ action: "ping" });
  });

  it("needs the context above the threshold", () => {
    expect(decideWarm(base({ contextTokens: 99_999, lastTurnAt: T0 - 56 * MIN }))).toEqual({ action: "off", reason: "small" });
    expect(decideWarm(base({ contextTokens: null }))).toEqual({ action: "off", reason: "small" });
    expect(decideWarm(base({ contextTokens: 50_000, settings: { ...DEFAULT_WARM, thresholdTokens: 40_000 }, lastTurnAt: T0 - 56 * MIN }))).toEqual({ action: "ping" });
  });

  it("stops after the idle cutoff with no user message, and a ping doesn't reset it", () => {
    const noCompact = { ...DEFAULT_WARM, compactBeforeExpiry: false };
    // The user wrote 3 hours ago; a ping 55 minutes ago kept the cache warm, but that isn't the user.
    expect(decideWarm(base({ settings: noCompact, lastUserAt: T0 - 3 * HOUR, lastTurnAt: T0 - 55 * MIN }))).toEqual({ action: "off", reason: "idle" });
    expect(decideWarm(base({ settings: noCompact, lastUserAt: null }))).toEqual({ action: "off", reason: "idle" });
    expect(decideWarm(base({ lastUserAt: T0 - 2.9 * HOUR, lastTurnAt: T0 - 55 * MIN }))).toEqual({ action: "ping" });
    expect(decideWarm(base({ lastUserAt: T0 - 5 * HOUR, settings: { ...DEFAULT_WARM, idleHours: 6 }, lastTurnAt: T0 - 55 * MIN }))).toEqual({ action: "ping" });
  });

  it("resumes when the user writes again", () => {
    expect(decideWarm(base({ lastUserAt: T0 - 4 * HOUR, lastTurnAt: T0 - 55 * MIN })).action).toBe("compact");
    // Their message is a turn too: the cache is fresh, the next ping is 55 minutes on.
    expect(decideWarm(base({ lastUserAt: T0 - MIN, lastTurnAt: T0 - MIN }))).toMatchObject({ action: "wait", at: T0 - MIN + PING_EVERY_MS });
  });

  it("stops in overage, when paused or stopped, and when turned off; there are no waking hours", () => {
    const due = { lastTurnAt: T0 - 55 * MIN };
    expect(decideWarm(base({ ...due, overage: true }))).toEqual({ action: "off", reason: "overage" });
    // 1 AM local is like any other time.
    const oneAm = new Date(2026, 9, 15, 1, 0).getTime();
    expect(decideWarm(base({ now: oneAm, startedAt: oneAm - 10 * HOUR, lastTurnAt: oneAm - 55 * MIN, lastUserAt: oneAm - HOUR }))).toEqual({ action: "ping" });
    expect(decideWarm(base({ ...due, botState: "paused" }))).toEqual({ action: "off", reason: "paused" });
    expect(decideWarm(base({ ...due, botState: "stopped" }))).toEqual({ action: "off", reason: "stopped" });
    expect(decideWarm(base({ ...due, settings: { ...DEFAULT_WARM, enabled: false } }))).toEqual({ action: "off", reason: "disabled" });
    expect(decideWarm(base({ ...due, warmable: false }))).toEqual({ action: "off", reason: "unpriced" });
  });

  it("waits while the thread is busy", () => {
    expect(decideWarm(base({ busy: true, lastTurnAt: T0 - 55 * MIN }))).toEqual({ action: "wait", at: T0 + 2 * MIN, reason: "busy" });
  });

  it("doesn't ping a cache that already expired", () => {
    expect(decideWarm(base({ lastTurnAt: T0 - CACHE_TTL_MS }))).toEqual({ action: "off", reason: "cold" });
    expect(decideWarm(base({ lastTurnAt: T0 - 59.5 * MIN }))).toEqual({ action: "off", reason: "cold" });
    expect(decideWarm(base({ lastTurnAt: null }))).toEqual({ action: "off", reason: "cold" });
  });

  it("sends nothing in the first 5 minutes after startup", () => {
    expect(decideWarm(base({ startedAt: T0 - MIN, lastTurnAt: T0 - 52 * MIN }))).toEqual({ action: "wait", at: T0 - MIN + STARTUP_GRACE_MS, reason: "startup" });
    expect(decideWarm(base({ startedAt: T0 - 5 * MIN, lastTurnAt: T0 - 55 * MIN }))).toEqual({ action: "ping" });
  });

  it("shortens the startup wait to 2 minutes before expiry when a reload lands just before a ping", () => {
    // Studio reloaded 13 seconds after the ping was due: it pings 2 minutes before expiry, not never.
    const reload = { startedAt: T0, lastTurnAt: T0 - 55 * MIN - 13_000 };
    expect(decideWarm(base(reload))).toEqual({ action: "wait", at: reload.lastTurnAt + CACHE_TTL_MS - 2 * MIN, reason: "startup" });
    expect(decideWarm(base({ ...reload, now: reload.lastTurnAt + CACHE_TTL_MS - 2 * MIN }))).toEqual({ action: "ping" });
    // Never in the first 30 seconds: a reload 90 seconds before expiry loses the cache.
    expect(decideWarm(base({ startedAt: T0, lastTurnAt: T0 - 58.5 * MIN }))).toEqual({ action: "off", reason: "cold" });
    expect(decideWarm(base({ startedAt: T0 - 15_000, lastTurnAt: T0 - 58.5 * MIN }))).toEqual({ action: "wait", at: T0 + STARTUP_MIN_MS - 15_000, reason: "startup" });
    // Compaction before expiry gets the same shortened wait.
    expect(decideWarm(base({ ...reload, lastUserAt: T0 - 4 * HOUR }))).toEqual({ action: "compact", at: reload.lastTurnAt + CACHE_TTL_MS - 2 * MIN });
  });

});

describe("decideWarm: compaction before expiry", () => {
  // The user wrote 4 hours ago (past the 3-hour cutoff); a ping 10 minutes ago kept the cache warm.
  const idle = (patch: Partial<WarmInput> = {}) => base({ lastUserAt: T0 - 4 * HOUR, lastTurnAt: T0 - 10 * MIN, ...patch });

  it("compacts once at the ping's due time while the cache is still warm", () => {
    expect(decideWarm(idle())).toEqual({ action: "compact", at: T0 - 10 * MIN + PING_EVERY_MS });
    expect(decideWarm(idle({ lastTurnAt: T0 - 55 * MIN }))).toEqual({ action: "compact", at: T0 });
  });

  it("not again in the same idle stretch, and again after a user message", () => {
    expect(decideWarm(idle({ lastCompactAt: T0 - 5 * MIN, lastTurnAt: T0 - 5 * MIN }))).toEqual({ action: "off", reason: "compacted" });
    expect(decideWarm(idle({ lastUserAt: null, lastCompactAt: T0 - 5 * MIN }))).toEqual({ action: "off", reason: "compacted" });
    // The user wrote after the compaction: warming resumes, and the next idle stretch compacts again.
    expect(decideWarm(base({ lastCompactAt: T0 - 5 * HOUR, lastUserAt: T0 - 30 * MIN }))).toMatchObject({ action: "wait", reason: "due" });
    expect(decideWarm(idle({ lastCompactAt: T0 - 5 * HOUR }))).toMatchObject({ action: "compact" });
  });

  it("doesn't compact in overage, cold, small, busy, disabled, paused or with the setting off", () => {
    expect(decideWarm(idle({ overage: true }))).toEqual({ action: "off", reason: "overage" });
    expect(decideWarm(idle({ lastTurnAt: T0 - 59.5 * MIN }))).toEqual({ action: "off", reason: "cold" });
    expect(decideWarm(idle({ lastTurnAt: null }))).toEqual({ action: "off", reason: "cold" });
    expect(decideWarm(idle({ contextTokens: 50_000 }))).toEqual({ action: "off", reason: "small" });
    expect(decideWarm(idle({ busy: true }))).toMatchObject({ action: "wait", reason: "busy" });
    expect(decideWarm(idle({ settings: { ...DEFAULT_WARM, enabled: false } }))).toEqual({ action: "off", reason: "disabled" });
    expect(decideWarm(idle({ botState: "paused" }))).toEqual({ action: "off", reason: "paused" });
    expect(decideWarm(idle({ warmable: false }))).toEqual({ action: "off", reason: "unpriced" });
    expect(decideWarm(idle({ settings: { ...DEFAULT_WARM, compactBeforeExpiry: false } }))).toEqual({ action: "off", reason: "idle" });
  });
});

describe("pings and user messages", () => {
  const ping = { initiator: "user", senderThreadId: null, input: [{ type: "text", text: PING_TEXT, visibility: "agent-only" }] };
  const user = { initiator: "user", senderThreadId: null, input: [{ type: "text", text: "What's on today?" }] };
  it("tells pings from the user's messages and Studio's notices", () => {
    expect(isPingRequest(ping)).toBe(true);
    expect(isUserRequest(ping)).toBe(false);
    expect(isPingRequest(user)).toBe(false);
    expect(isUserRequest(user)).toBe(true);
    expect(isUserRequest({ ...user, input: [user.input[0], { type: "text", text: "note", visibility: "agent-only" }] })).toBe(false);
    expect(isUserRequest({ ...user, input: [{ type: "text", text: "Check-in for \"Dot\": read your Memory page" }] })).toBe(false);
    expect(isUserRequest({ ...user, senderThreadId: "thr_runner" })).toBe(false);
    expect(isUserRequest({ ...user, initiator: "agent" })).toBe(false);
    // Studio's compaction before expiry sends "/compact" as the user; it isn't the user writing.
    expect(isUserRequest({ ...user, input: [{ type: "text", text: "/compact" }] })).toBe(false);
    expect(isUserRequest({ ...user, input: [{ type: "text", text: "/compact is that a command?" }] })).toBe(true);
  });

  it("aren't user turns for Learn from work", () => {
    const tally = tallyTurns([
      { seq: 1, type: "client/turn/requested", data: user },
      { seq: 2, type: "turn/completed" },
      { seq: 3, type: "client/turn/requested", data: ping },
      { seq: 4, type: "turn/completed" },
    ]);
    expect(tally.userTurns).toBe(1);
  });
});

describe("overage", () => {
  it("is a blocked window that overage lets go on, or credits", () => {
    const now = T0;
    expect(inOverage({ status: "allowed", kind: "subscription-window", overageStatus: "allowed", windows: [{ status: "blocked", resetsAtMs: now + HOUR }] }, now - MIN, now)).toBe(true);
    expect(inOverage({ status: "allowed", kind: "subscription-window", overageStatus: "allowed", windows: [{ status: "blocked", resetsAtMs: now - MIN }] }, now - 2 * HOUR, now)).toBe(false);
    expect(inOverage({ status: "blocked", kind: "subscription-window", overageStatus: "rejected", windows: [{ status: "blocked", resetsAtMs: now + HOUR }] }, now, now)).toBe(false);
    expect(inOverage({ status: "allowed", kind: "credits", overageStatus: null, windows: [] }, now - HOUR, now)).toBe(true);
    expect(inOverage({ status: "allowed", kind: "credits", overageStatus: null, windows: [] }, now - 6 * HOUR, now)).toBe(false);
    expect(inOverage(null, undefined, now)).toBe(false);
  });
});

describe("costs", () => {
  it("finds a model's prices by id, alias, context marker and date", () => {
    expect(priceFor("claude-opus-5-5")).toBe(MODEL_PRICES["claude-opus-5-5"]);
    expect(priceFor("claude-opus-4-8[1m]")).toBe(MODEL_PRICES["claude-opus-4-8"]);
    expect(priceFor("claude-haiku-4-5-20251001")).toBe(MODEL_PRICES["claude-haiku-4-5"]);
    expect(priceFor("opus")).toBe(MODEL_PRICES["claude-opus-5-5"]);
    expect(priceFor("gpt-5.2-codex")).toBe(MODEL_PRICES["gpt-5.2"]);
    expect(priceFor("gpt-5.5-pro")).toBeNull();
    expect(priceFor("mystery")).toBeNull();
    expect(priceFor(null)).toBeNull();
    expect(priceFor("claude-sonnet-5-5")).toMatchObject({ input: 2, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4, output: 10, warmable: true });
    expect(priceFor("gpt-5.5")?.warmable).toBe(false);
  });

  it("prices a 300k-token Opus 5.5 chat: warm read, cold re-write and warming per hour", () => {
    const price = MODEL_PRICES["claude-opus-5-5"]!;
    expect(warmSendUsd(300_000, price)).toBeCloseTo(0.06);
    expect(coldSendUsd(300_000, price)).toBeCloseTo(2.4);
    expect(pingUsd(300_000, price)).toBeCloseTo(0.06 + 120 / 1e6 * 8 + 10 / 1e6 * 20, 6);
    expect(warmingPerHourUsd(300_000, price)).toBeCloseTo(pingUsd(300_000, price) * 60 / 55, 6);
    expect(formatUsd(warmingPerHourUsd(300_000, price))).toBe("$0.07");
    expect(formatUsd(coldSendUsd(300_000, price))).toBe("$2.40");
  });

  it("breaks even around 20 idle hours at a 0.1x read and a 2x write", () => {
    const price = MODEL_PRICES["claude-sonnet-5-5"]!;
    // (2 - 0.1) / (0.1 * 60/55), less a little for the pings' own tokens.
    expect(breakEvenHours(1_000_000, price)).toBeGreaterThan(17);
    expect(breakEvenHours(1_000_000, price)).toBeLessThan(17.5);
  });

  it("formats", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(12.4)).toBe("$12");
    expect(formatTokens(312_400)).toBe("312k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });
});

// ---- The warmer and its RPC ----

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

async function warmer(options: { model?: string; tokens?: number; lastTurnAt?: number; lastUserAt?: number; status?: string; read?: boolean } = {}) {
  let now = T0;
  const events: Record<string, { type: string; createdAt: number; data: unknown }[]> = {
    "thread/tokenUsage/updated": [{ type: "thread/tokenUsage/updated", createdAt: options.lastTurnAt ?? T0 - 50 * MIN, data: {} }],
    "client/turn/requested": [{ type: "client/turn/requested", createdAt: options.lastUserAt ?? T0 - 50 * MIN, data: { initiator: "user", senderThreadId: null, input: [{ type: "text", text: "hi" }] } }],
    "provider/rateLimits/updated": [],
  };
  const send = vi.fn(async (_args: unknown) => ({ ok: true, delivery: "sent" }));
  const compact = vi.fn(async (_args: unknown) => ({ ok: true }));
  const markRead = vi.fn(async () => ({}));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      get: (async ({ threadId }: { threadId: string }) => ({ id: threadId, status: options.status ?? "idle", updatedAt: T0 - 50 * MIN, lastReadAt: options.read === false ? null : T0, latestAttentionAt: T0 - 50 * MIN })) as never,
      context: (async () => ({ usage: { usedTokens: options.tokens ?? 300_000, modelContextWindow: 1_000_000, estimated: false } })) as never,
      defaultExecutionOptions: (async () => ({ model: options.model ?? "claude-opus-5-5" })) as never,
      events: { list: (async ({ types }: { types: string[] }) => events[types[0]!] ?? []) as never },
      send: send as never,
      markRead: markRead as never,
      compact: compact as never,
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const bots = [{ id: "bot_main", name: "Dot", state: "active" as const, threadId: "thr_main" }, { id: "bot_ext", name: "Herm", state: "active" as const, threadId: "thr_ext", kind: "external" as const }];
  const w = new BotCacheWarmer({ db, sdk: bb.sdk, pluginId: "studio", bots: () => bots, now: () => now });
  return { w, send, compact, markRead, events, db, advance: (ms: number) => { now += ms; } };
}

describe("BotCacheWarmer", () => {
  it("sends nothing in the first 5 minutes, then one agent-only ping tagged for hooks", async () => {
    const x = await warmer();
    expect(await x.w.tick()).toBe(0);
    x.advance(4 * MIN);
    expect(await x.w.tick()).toBe(0);
    x.advance(2 * MIN);
    expect(await x.w.tick()).toBe(1);
    expect(x.send).toHaveBeenCalledTimes(1);
    expect(x.send.mock.calls[0]![0]).toMatchObject({
      threadId: "thr_main", mode: "start",
      input: [{ type: "text", text: PING_TEXT, visibility: "agent-only" }],
      pluginSubmission: { pluginId: "studio", data: { kind: "cache-keepalive" } },
    });
    expect(x.w.pinging("thr_main")).toBe(true);
    // Not again while it runs; read again once it's idle, as it was before.
    expect(await x.w.tick()).toBe(0);
    await x.w.idle("thr_main");
    expect(x.markRead).toHaveBeenCalledWith({ threadId: "thr_main" });
    expect(x.w.pinging("thr_main")).toBe(false);
  });

  it("leaves an unread chat unread, and keeps the curator's quiet time from before the pings", async () => {
    const x = await warmer({ read: false });
    x.advance(6 * MIN);
    await x.w.tick();
    await x.w.idle("thr_main");
    expect(x.markRead).not.toHaveBeenCalled();
    expect(x.w.quietSince("thr_main", T0 + 7 * MIN)).toBe(T0 - 50 * MIN);
    expect(x.w.quietSince("thr_main", T0 + 30 * MIN)).toBe(T0 + 30 * MIN);
  });

  it("doesn't ping small chats, external bots, OpenAI models or busy threads", async () => {
    for (const options of [{ tokens: 50_000 }, { model: "gpt-5.5" }, { status: "active" }]) {
      const x = await warmer(options);
      x.advance(6 * MIN);
      expect(await x.w.tick()).toBe(0);
    }
  });

  it("answers bot_cache_state: warm with minutes left, costs, and no banner", async () => {
    const x = await warmer({ lastTurnAt: T0 - 18 * MIN });
    const state = rpcContract.bot_cache_state.output.parse(await x.w.state("thr_main"));
    expect(state).toMatchObject({ botId: "bot_main", state: "warm", label: "Warm · 42m", model: "claude-opus-5-5", contextTokens: 300_000, banner: false, settings: DEFAULT_WARM });
    expect(state.warming).toMatchObject({ active: true, nextPingAt: T0 - 18 * MIN + PING_EVERY_MS });
    expect(state.costs.coldSend).toBeCloseTo(2.4);
    expect(state.costs.warmingPerHour).toBeGreaterThan(0.06);
  });

  it("answers bot_cache_state: cold with the banner until hidden, and Warming off when turned off", async () => {
    const x = await warmer({ lastTurnAt: T0 - 2 * HOUR, lastUserAt: T0 - 2 * HOUR });
    const cold = await x.w.state("thr_main");
    expect(cold).toMatchObject({ state: "cold", label: "Cold", banner: true, warming: { active: false, reason: "The cache expired; your next message refills it" } });
    x.w.hideBanner("thr_main");
    x.w.setSettings("bot_main", { enabled: false });
    expect(await x.w.state("thr_main")).toMatchObject({ state: "off", label: "Warming off", banner: false, settings: { enabled: false } });
    expect(x.w.settings("bot_main")).toEqual({ ...DEFAULT_WARM, enabled: false });
  });

  it("compacts an idle chat once before its cache expires, then not again until the user writes", async () => {
    // The user wrote 4 hours ago; the last turn (a ping) 50 minutes ago.
    const x = await warmer({ lastUserAt: T0 - 4 * HOUR });
    expect(await x.w.state("thr_main")).toMatchObject({ warming: { active: false, compactAt: T0 + 5 * MIN } });
    x.advance(6 * MIN);
    await x.w.tick();
    expect(x.compact).toHaveBeenCalledWith({ threadId: "thr_main" });
    expect(x.send).not.toHaveBeenCalled();
    await x.w.idle("thr_main");
    expect(x.w.lastCompact("thr_main")).toBe(T0 + 6 * MIN);
    // The size from before compaction is stale: no "re-reads ~300k" banner.
    x.advance(2 * HOUR);
    const state = await x.w.state("thr_main");
    expect(state).toMatchObject({ banner: false, contextTokens: null, warming: { lastCompactAt: T0 + 6 * MIN } });
    // A turn after compaction reports the new size; still once per idle stretch.
    x.events["thread/tokenUsage/updated"] = [{ type: "thread/tokenUsage/updated", createdAt: T0 + 2 * HOUR, data: {} }];
    x.advance(10 * MIN);
    await x.w.tick();
    expect(x.compact).toHaveBeenCalledTimes(1);
    expect(await x.w.state("thr_main")).toMatchObject({ warming: { reason: "Compacted before the cache expired; no message from you since" } });
  });

  it("stores compactBeforeExpiry and ignores waking hours", async () => {
    const x = await warmer();
    expect(x.w.setSettings("bot_main", { compactBeforeExpiry: false })).toEqual({ ...DEFAULT_WARM, compactBeforeExpiry: false });
    expect(x.db.prepare("SELECT wake_start, wake_end FROM bot_cache_settings").get()).toEqual({ wake_start: 420, wake_end: 1380 });
  });

  it("answers bot_cache_state for a thread that isn't a Bot's chat", async () => {
    const x = await warmer();
    expect(await x.w.state("thr_other")).toMatchObject({ botId: null, label: "", banner: false });
    expect(await x.w.state("thr_ext")).toMatchObject({ botId: null });
  });
});
