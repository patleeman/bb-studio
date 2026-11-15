// At most one reply push per conversation per window. The first goes out at
// once; later ones in the window wait, and at its end the latest goes out as
// one push, "N new · …", with the same collapse id, so it replaces the one
// before it on the phone instead of stacking.
import type { ExpoMessage } from "./apns.js";

export const PUSH_WINDOW_MS = 3 * 60_000;

type Window = { openedAt: number; until: number; shown: number; held: ExpoMessage[] | null; heldCount: number; timer: ReturnType<typeof setTimeout> | null };

/** Sends the held push. `shown`: the replies it stands for since the first push; `held`: those since the last one went out at `since`. False when nothing went out. */
export type WindowFlush = (input: { key: string; messages: ExpoMessage[]; shown: number; held: number; since: number }) => Promise<boolean>;

/** The window key of a push that is a plain reply on a thread: its conversation, else its thread. Null for everything else. */
export function windowKey(message: ExpoMessage): string | null {
  const data = message.data ?? {};
  if (data.kind !== "turn-finished" && data.kind !== "needs-you") return null;
  if (message.collapseId !== undefined || data.category !== undefined || data.loopId !== undefined || data.interactionId !== undefined) return null;
  const key = typeof data.conversationId === "string" ? data.conversationId : data.threadId;
  return typeof key === "string" && key !== "" ? key : null;
}

export function collapseIdFor(key: string): string {
  return `conversation:${key}`;
}

/** The body of a push that stands for `shown` replies. */
export function summaryBody(body: string | undefined, shown: number): string {
  const text = (body ?? "").trim();
  if (shown <= 1) return text;
  return text ? `${shown} new · ${text}` : `${shown} new`;
}

export class PushWindows {
  private readonly windows = new Map<string, Window>();
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(private readonly flush: WindowFlush, options: { windowMs?: number; now?: () => number } = {}) {
    this.windowMs = options.windowMs ?? PUSH_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  /** True: send now, and a window opens. False: held until the window ends. */
  offer(key: string, messages: ExpoMessage[]): boolean {
    const now = this.now();
    const open = this.windows.get(key);
    if (!open || open.until <= now) {
      if (open?.timer) clearTimeout(open.timer);
      this.windows.set(key, { openedAt: now, until: now + this.windowMs, shown: 1, held: null, heldCount: 0, timer: null });
      return true;
    }
    open.held = messages;
    open.heldCount += 1;
    if (!open.timer) {
      open.timer = setTimeout(() => void this.release(key), Math.max(0, open.until - now));
      open.timer.unref?.();
    }
    return false;
  }

  /** Waiting pushes, by key (for status and tests). */
  held(): Record<string, number> {
    return Object.fromEntries([...this.windows].flatMap(([key, open]) => open.heldCount > 0 ? [[key, open.heldCount]] : []));
  }

  async release(key: string): Promise<void> {
    const open = this.windows.get(key);
    if (!open) return;
    if (open.timer) clearTimeout(open.timer);
    open.timer = null;
    const held = open.held;
    if (!held) { this.windows.delete(key); return; }
    const shown = open.shown + open.heldCount;
    const now = this.now();
    this.windows.set(key, { openedAt: now, until: now + this.windowMs, shown, held: null, heldCount: 0, timer: null });
    const sent = await this.flush({ key, messages: held, shown, held: open.heldCount, since: open.openedAt }).catch(() => false);
    if (!sent) this.windows.delete(key);
  }

  dispose(): void {
    for (const open of this.windows.values()) if (open.timer) clearTimeout(open.timer);
    this.windows.clear();
  }
}
