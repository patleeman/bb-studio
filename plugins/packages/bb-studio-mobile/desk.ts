// Hold phone pushes while the user is at their desk (README, "At the desk").
//
// Clients that can see the user (BB Studio's desktop app and web tabs, through
// Studio's overlay) send a small heartbeat: "active" every 30 to 60 seconds
// while the user is there, "away" when the Mac goes idle or locks. While any
// client's last word is "active" and under DESK_FRESH_MS old, phone pushes
// about a thread are held instead of sent. When every client is away or has
// gone quiet, the held pushes whose thread is still unread (or whose ask is
// still open) go out: the newest one when it is one thread, else one summary.
// Pushes held longer than HOLD_MAX_MS are dropped: the user was at the desk
// that whole time. No heartbeat at all means pushes go out as before.
import type { ExpoMessage } from "./apns.js";

/** A heartbeat counts this long; the overlay beats well inside it. */
export const DESK_FRESH_MS = 2 * 60_000;
/** A held push is sent only if the user goes away within this long. */
export const HOLD_MAX_MS = 10 * 60_000;
/** Max wait per seen() check before treating the thread as unseen so one hung check can't stall releases. */
export const SEEN_TIMEOUT_MS = 10_000;
/** Clients forgotten after this long without a beat. */
const CLIENT_TTL_MS = 60 * 60_000;
const MAX_CLIENTS = 50;
/** Collapse id of the "while you were away" summary. */
export const AWAY_COLLAPSE_ID = "desk-away";

export type DeskState = "active" | "away";
export type DeskBeat = { clientId: string; state: DeskState; source: "system" | "window" };
type Client = DeskBeat & { at: number };

const HOLDABLE_KINDS = new Set(["turn-finished", "needs-you", "pending-interaction", "thread-error"]);

/** A phone push about a thread, which a user at the desk sees there: replies, asks and errors. Loops, tests and keyed alerts are not held. */
export function holdable(message: ExpoMessage): boolean {
  const data = message.data ?? {};
  return typeof data.threadId === "string" && data.threadId !== ""
    && typeof data.kind === "string" && HOLDABLE_KINDS.has(data.kind)
    && data.category === undefined && data.loopId === undefined && message.collapseId === undefined;
}

export type HeldPush = { message: ExpoMessage; heldAt: number };

/** The thread and worker whose read state decides whether a held push was seen. */
export function seenKey(message: ExpoMessage): { threadId: string; workerId?: string } {
  const data = message.data ?? {};
  const threadId = String(data.threadId);
  return typeof data.workerId === "string" && data.workerId !== threadId ? { threadId, workerId: data.workerId } : { threadId };
}

/**
 * What goes out for the unseen held pushes of one device: the newest push when
 * they are all one thread (it keeps its actions), else one summary that opens
 * the newest thread.
 */
export function awayMessages(held: HeldPush[]): ExpoMessage[] {
  const byDevice = new Map<string, HeldPush[]>();
  for (const push of held) byDevice.set(push.message.to, [...(byDevice.get(push.message.to) ?? []), push]);
  const out: ExpoMessage[] = [];
  for (const [to, pushes] of byDevice) {
    const newest = new Map<string, HeldPush>();
    for (const push of [...pushes].sort((a, b) => a.heldAt - b.heldAt)) {
      const key = String(push.message.data?.conversationId ?? push.message.data?.threadId);
      newest.delete(key);
      newest.set(key, push);
    }
    const threads = [...newest.values()].reverse();
    if (threads.length === 1) { out.push(threads[0]!.message); continue; }
    const latest = threads[0]!.message;
    const titles = threads.map((push) => push.message.title?.trim()).filter((title): title is string => !!title);
    const data = latest.data ?? {};
    out.push({
      to,
      title: `${threads.length} updates while you were away`,
      body: [...new Set(titles)].join(" · "),
      sound: "default",
      collapseId: AWAY_COLLAPSE_ID,
      data: {
        threadId: data.conversationId ?? data.threadId,
        ...(typeof data.projectId === "string" ? { projectId: data.projectId } : {}),
        ...(typeof data.botId === "string" ? { botId: data.botId } : {}),
        ...(typeof data.conversationId === "string" ? { conversationId: data.conversationId } : {}),
        awaySummary: threads.length,
      },
    });
  }
  return out;
}

export type DeskHoldDeps = {
  now?: () => number;
  /** Whether the user saw the thread: true seen, false unseen, undefined unknown (treated as unseen). */
  seen(key: { threadId: string; workerId?: string }): Promise<boolean | undefined>;
  /** Sends the pushes that go out when the user leaves. */
  send(messages: ExpoMessage[]): Promise<void>;
  log?(message: string): void;
  seenTimeoutMs?: number;
};

export type DeskStatus = { atDesk: boolean | null; held: number; clients: number; lastBeatAt: number | null };

export class DeskHold {
  private readonly clients = new Map<string, Client>();
  private held: HeldPush[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wasAtDesk = false;
  private releasing: Promise<void> = Promise.resolve();
  private releaseAll = false;
  private disposed = false;
  private readonly now: () => number;

  constructor(private readonly deps: DeskHoldDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** At the desk: some client said "active" under DESK_FRESH_MS ago. */
  atDesk(now = this.now()): boolean {
    for (const client of this.clients.values()) if (client.state === "active" && now - client.at <= DESK_FRESH_MS) return true;
    return false;
  }

  status(now = this.now()): DeskStatus {
    const beats = [...this.clients.values()].map((client) => client.at);
    const fresh = beats.some((at) => now - at <= DESK_FRESH_MS);
    return { atDesk: this.atDesk(now) ? true : fresh ? false : null, held: this.held.length, clients: this.clients.size, lastBeatAt: beats.length ? Math.max(...beats) : null };
  }

  beat(beat: DeskBeat): DeskStatus {
    const now = this.now();
    if (this.disposed) return this.status(now);
    for (const [id, client] of this.clients) if (now - client.at > CLIENT_TTL_MS) this.clients.delete(id);
    this.clients.delete(beat.clientId);
    this.clients.set(beat.clientId, { ...beat, at: now });
    while (this.clients.size > MAX_CLIENTS) this.clients.delete(this.clients.keys().next().value!);
    this.check();
    return this.status(now);
  }

  /** Holds the pushes when the user is at the desk; false when they should go out now. */
  hold(messages: ExpoMessage[]): boolean {
    if (this.disposed) return false;
    const now = this.now();
    if (messages.length === 0 || !this.atDesk(now)) return false;
    this.wasAtDesk = true;
    for (const message of messages) this.held.push({ message, heldAt: now });
    this.schedule();
    return true;
  }

  /** Sends what is held now (the switch was turned off). */
  releaseNow(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.releaseAll = true;
    return this.release();
  }

  /** Re-evaluates: drops old pushes and releases the rest once the user is away. */
  check(): void {
    if (this.disposed) return;
    const now = this.now();
    this.held = this.held.filter((push) => now - push.heldAt <= HOLD_MAX_MS);
    const here = this.atDesk(now);
    if (this.wasAtDesk && !here) void this.release();
    this.wasAtDesk = here;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed || this.held.length === 0) return;
    const now = this.now();
    // The next moment something changes: the oldest push expires, or the last fresh "active" beat goes stale.
    const expires = Math.min(...this.held.map((push) => push.heldAt + HOLD_MAX_MS + 1));
    const fresh = [...this.clients.values()].filter((client) => client.state === "active" && now - client.at <= DESK_FRESH_MS);
    const leaves = fresh.length ? Math.max(...fresh.map((client) => client.at + DESK_FRESH_MS + 1)) : Infinity;
    const next = Math.min(expires, leaves);
    this.timer = setTimeout(() => { this.timer = null; this.check(); }, Math.max(0, next - now));
    this.timer.unref?.();
  }

  private release(): Promise<void> {
    const task = this.releasing.then(async () => {
      if (this.disposed) return;
      const now = this.now();
      // Pushes held after the user came back stay held for the next time they leave.
      const pushes = this.held.filter((push) => now - push.heldAt <= HOLD_MAX_MS);
      if (this.atDesk(now) && !this.releaseAll) return;
      this.releaseAll = false;
      this.held = [];
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (pushes.length === 0) return;
      const unique = new Map<string, { key: { threadId: string; workerId?: string }; seen: boolean | undefined }>();
      const ids = pushes.map((push) => {
        const key = seenKey(push.message);
        const id = `${key.threadId}\u0000${key.workerId ?? ""}`;
        if (!unique.has(id)) unique.set(id, { key, seen: undefined });
        return id;
      });
      const seenTimeoutMs = this.deps.seenTimeoutMs ?? SEEN_TIMEOUT_MS;
      await Promise.all([...unique.values()].map(async (entry) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), seenTimeoutMs);
          timer.unref?.();
        });
        entry.seen = await Promise.race([
          this.deps.seen(entry.key).catch(() => undefined),
          late,
        ]).finally(() => { if (timer) clearTimeout(timer); });
      }));
      const unseen = pushes.filter((_, index) => unique.get(ids[index]!)?.seen !== true);
      const messages = awayMessages(unseen);
      if (messages.length > 0) await this.deps.send(messages);
      if (this.disposed) return;
      this.deps.log?.(`desk: away; ${pushes.length} held, ${unseen.length} unseen, sent ${messages.length}${messages.length ? `: ${messages.map((message) => JSON.stringify(message.title ?? "")).join(", ")}` : ""}`);
    }).catch((error: unknown) => {
      if (!this.disposed) this.deps.log?.(`desk: release failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.releasing = task;
    return task;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.held = [];
    this.clients.clear();
  }
}
