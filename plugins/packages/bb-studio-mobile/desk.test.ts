import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpoMessage } from "./apns.js";
import { AWAY_COLLAPSE_ID, awayMessages, DESK_FRESH_MS, DeskHold, HOLD_MAX_MS, holdable } from "./desk.js";

const PHONE = "apns:phone";
const reply = (threadId: string, title = `Reply on ${threadId}`, extra: Record<string, unknown> = {}): ExpoMessage =>
  ({ to: PHONE, title, body: "Done", data: { kind: "turn-finished", threadId, projectId: "proj_demo", ...extra } });

function setup(seen: Record<string, boolean | undefined> = {}) {
  const sent: ExpoMessage[][] = [];
  const hold = new DeskHold({
    seen: async ({ threadId }) => seen[threadId],
    send: async (messages) => { sent.push(messages); },
  });
  return { hold, sent };
}
const active = { clientId: "desktop-main", state: "active", source: "system" } as const;
const away = { ...active, state: "away" } as const;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe("desk hold", () => {
  it("fails open: no heartbeat at all sends as today", () => {
    const { hold } = setup();
    expect(hold.status().atDesk).toBeNull();
    expect(hold.hold([reply("thr_a")])).toBe(false);
  });

  it("holds while a client is active", () => {
    const { hold, sent } = setup();
    hold.beat(active);
    expect(hold.hold([reply("thr_a")])).toBe(true);
    expect(hold.status()).toMatchObject({ atDesk: true, held: 1 });
    expect(sent).toEqual([]);
  });

  it("fails open when the heartbeat is older than two minutes", () => {
    const { hold } = setup();
    hold.beat(active);
    vi.advanceTimersByTime(DESK_FRESH_MS + 1);
    expect(hold.status().atDesk).toBeNull();
    expect(hold.hold([reply("thr_a")])).toBe(false);
  });

  it("an away beat sends at once", () => {
    const { hold } = setup();
    hold.beat(away);
    expect(hold.status().atDesk).toBe(false);
    expect(hold.hold([reply("thr_a")])).toBe(false);
  });

  it("sends a held push when the user goes away and the thread is still unread", async () => {
    const { hold, sent } = setup({ thr_a: false });
    hold.beat(active);
    const message = reply("thr_a");
    hold.hold([message]);
    hold.beat(away);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([[message]]);
    expect(hold.status().held).toBe(0);
  });

  it("sends when the heartbeat stops (the app quit or the Mac slept)", async () => {
    const { hold, sent } = setup();
    hold.beat(active);
    hold.hold([reply("thr_a")]);
    await vi.advanceTimersByTimeAsync(DESK_FRESH_MS + 2);
    expect(sent).toHaveLength(1);
  });

  it("drops a held push the user saw before going away", async () => {
    const { hold, sent } = setup({ thr_a: true });
    hold.beat(active);
    hold.hold([reply("thr_a")]);
    hold.beat(away);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([]);
  });

  it("an unknown read state counts as unseen", async () => {
    const { hold, sent } = setup({ thr_a: undefined });
    hold.beat(active);
    hold.hold([reply("thr_a")]);
    hold.beat(away);
    await vi.runAllTimersAsync();
    expect(sent).toHaveLength(1);
  });

  it("drops pushes held longer than ten minutes", async () => {
    const { hold, sent } = setup();
    hold.beat(active);
    hold.hold([reply("thr_a")]);
    for (let elapsed = 0; elapsed <= HOLD_MAX_MS; elapsed += 45_000) {
      await vi.advanceTimersByTimeAsync(45_000);
      hold.beat(active);
    }
    expect(hold.status().held).toBe(0);
    hold.beat(away);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([]);
  });

  it("stays held while another client is still active", async () => {
    const { hold, sent } = setup();
    hold.beat(active);
    hold.beat({ clientId: "web-laptop1", state: "active", source: "window" });
    hold.hold([reply("thr_a")]);
    hold.beat(away);
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual([]);
    expect(hold.status()).toMatchObject({ atDesk: true, held: 1 });
  });

  it("sends one summary instead of a burst", async () => {
    const { hold, sent } = setup({ thr_seen: true });
    hold.beat(active);
    hold.hold([reply("thr_a", "Alpha")]);
    vi.advanceTimersByTime(1000);
    hold.hold([reply("thr_a", "Alpha again"), reply("thr_b", "Beta")]);
    vi.advanceTimersByTime(1000);
    hold.hold([reply("thr_c", "Gamma"), reply("thr_seen", "Seen")]);
    hold.beat(away);
    await vi.runAllTimersAsync();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([{
      to: PHONE,
      title: "3 updates while you were away",
      body: "Gamma · Beta · Alpha again",
      sound: "default",
      collapseId: AWAY_COLLAPSE_ID,
      data: { threadId: "thr_c", projectId: "proj_demo", awaySummary: 3 },
    }]);
  });

  it("sends only the newest push when every held push is one thread", async () => {
    const { hold, sent } = setup();
    hold.beat(active);
    hold.hold([reply("thr_a", "First")]);
    vi.advanceTimersByTime(1000);
    const newest = reply("thr_a", "Second");
    hold.hold([newest]);
    hold.beat(away);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([[newest]]);
  });

  it("releaseNow sends what is held even at the desk (the switch went off)", async () => {
    const { hold, sent } = setup();
    hold.beat(active);
    hold.hold([reply("thr_a")]);
    await hold.releaseNow();
    expect(sent).toHaveLength(1);
  });

  it("lets an already-running release finish sending after dispose(), while post-dispose hold()/beat() do nothing", async () => {
    let resolveSeen!: (value: boolean) => void;
    const sent: ExpoMessage[][] = [];
    const logs: string[] = [];
    const hold = new DeskHold({
      seen: () => new Promise<boolean>((resolve) => { resolveSeen = resolve; }),
      send: async (messages) => { sent.push(messages); },
      log: (line) => logs.push(line),
    });
    hold.beat(active);
    const msg = reply("thr_a");
    hold.hold([msg]);
    const releasing = hold.releaseNow();
    await Promise.resolve();

    hold.dispose();
    resolveSeen(false);
    await releasing;

    // Pushes already in flight still go out; post-dispose logging is suppressed.
    expect(sent).toEqual([[msg]]);
    expect(logs).toEqual([]);
    // Post-dispose beat/hold do not hold or schedule timers.
    hold.beat(active);
    expect(hold.hold([reply("thr_b")])).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a hung seen() check to undefined (unseen) so releases are never blocked", async () => {
    const sent: ExpoMessage[][] = [];
    const hold = new DeskHold({
      seen: ({ threadId }) => (threadId === "thr_hung" ? new Promise(() => {}) : Promise.resolve(false)),
      send: async (messages) => { sent.push(messages); },
      seenTimeoutMs: 500,
    });
    hold.beat(active);
    hold.hold([reply("thr_hung"), reply("thr_ok")]);
    const releasing = hold.releaseNow();
    await vi.advanceTimersByTimeAsync(500);
    await releasing;

    expect(sent).toHaveLength(1);
    expect(sent[0]![0]!.title).toBe("2 updates while you were away");
  });

  it("checks unique seen() keys in parallel during release()", async () => {
    const started: string[] = [];
    const resolvers: Array<() => void> = [];
    const sent: ExpoMessage[][] = [];
    const hold = new DeskHold({
      seen: ({ threadId }) => {
        started.push(threadId);
        return new Promise<boolean>((resolve) => {
          resolvers.push(() => resolve(false));
        });
      },
      send: async (messages) => { sent.push(messages); },
    });
    hold.beat(active);
    hold.hold([reply("thr_a"), reply("thr_b"), reply("thr_c"), reply("thr_a")]);
    const releasing = hold.releaseNow();
    await Promise.resolve();

    // All 3 unique threads must be queried before any single seen() resolves.
    expect(started).toEqual(["thr_a", "thr_b", "thr_c"]);
    for (const resolve of resolvers) resolve();
    await releasing;
    expect(sent).toHaveLength(1);
  });
});

describe("holdable", () => {
  it("holds replies, asks and errors about a thread", () => {
    for (const kind of ["turn-finished", "needs-you", "pending-interaction", "thread-error"]) {
      expect(holdable({ to: PHONE, data: { kind, threadId: "thr_a" } })).toBe(true);
    }
  });
  it("never holds a test push, a loop, a keyed alert or a push without a thread", () => {
    expect(holdable({ to: PHONE, body: "Test", data: {} })).toBe(false);
    expect(holdable({ to: PHONE, data: { kind: "turn-finished", threadId: "thr_a", category: "BB_LOOP", loopId: "loop_1" } })).toBe(false);
    expect(holdable({ to: PHONE, collapseId: "k", data: { kind: "turn-finished", threadId: "thr_a" } })).toBe(false);
    expect(holdable({ to: PHONE, data: { kind: "turn-finished" } })).toBe(false);
  });
});

describe("awayMessages", () => {
  it("groups a Bot's workers under their conversation and keeps each device apart", () => {
    const other = "apns:tablet";
    const messages = awayMessages([
      { heldAt: 1, message: reply("thr_w1", "Worker one", { botId: "bot_1", conversationId: "thr_conv" }) },
      { heldAt: 2, message: reply("thr_conv", "Conversation", { botId: "bot_1", conversationId: "thr_conv" }) },
      { heldAt: 3, message: { ...reply("thr_x", "Other"), to: other } },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.title).toBe("Conversation");
    expect(messages[1]).toMatchObject({ to: other, title: "Other" });
  });
});
