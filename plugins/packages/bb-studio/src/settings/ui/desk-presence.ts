// "At the desk" for "Hold phone notifications while I'm at my Mac". On the
// desktop app and in a web tab on a computer, Studio's overlay tells the
// Mobile plugin whether the user is here: "active" every BEAT_MS while they
// are, "away" once when they leave. The Mobile plugin holds phone pushes
// while any client is active (bb-studio-mobile/desk.ts).
//
// Here means: the Mac is unlocked and had keyboard or mouse input in the last
// two minutes (from BB Studio's desktop app, `experimental_systemActivity`),
// or this window had input or gained focus in the last two minutes. A desktop
// app without the system reading still reports its own window, and a phone or
// tablet reports nothing, so pushes go out as before.
import type { DeskBeat } from "../contract";

/** Away after this long without input, and when the Mac locks. */
export const IDLE_MS = 2 * 60_000;
/** An "active" heartbeat this often; the Mobile plugin trusts one for two minutes. */
export const BEAT_MS = 45_000;
/** How often the overlay looks at the system's idle time (a local call, not the server). */
export const CHECK_MS = 15_000;
/** After the Mobile plugin can't take a beat, or the switch is off, wait this long before the next. */
export const BACKOFF_MS = 5 * 60_000;

export type SystemActivity = { idleSeconds: number; locked: boolean };
/** BB Studio's desktop bridge additions (packages/desktop-contract info.fork.ts). Old apps have neither. */
export type DesktopActivityBridge = {
  experimental_systemActivity?(): Promise<SystemActivity>;
  experimental_onSystemActivity?(listener: (activity: SystemActivity) => void): () => void;
};

export function deskState(input: { now: number; lastInputAt: number; system: SystemActivity | null }): DeskBeat["state"] {
  if (input.system?.locked) return "away";
  if (input.system && input.system.idleSeconds * 1000 < IDLE_MS) return "active";
  return input.now - input.lastInputAt < IDLE_MS ? "active" : "away";
}

/** Whether this client should report at all: the desktop app, or a browser on a computer. Not the phone app, not a phone or tablet browser. */
export function reportsPresence(win: Window & { bbDesktop?: unknown; bb?: unknown }): boolean {
  if (win.bbDesktop) return true;
  if (win.bb && typeof win.bb === "object" && "native" in win.bb) return false;
  return !(win.matchMedia?.("(pointer: coarse)").matches ?? false);
}

export type PresenceDeps = {
  now(): number;
  bridge: DesktopActivityBridge | null;
  /** Sends a beat; null means the Mobile plugin can't take it, `enabled: false` that the switch is off. */
  send(state: DeskBeat["state"], source: DeskBeat["source"]): Promise<{ enabled: boolean } | null>;
  windowActive(): boolean;
};

/** The overlay's loop, apart from the DOM so it can be tested. */
export class DeskPresence {
  lastInputAt: number;
  private system: SystemActivity | null = null;
  private lastSent: { state: DeskBeat["state"]; at: number } | null = null;
  private quietUntil = 0;
  private sending = false;

  constructor(private readonly deps: PresenceDeps) {
    this.lastInputAt = deps.windowActive() ? deps.now() : -Infinity;
  }

  /** Keyboard, pointer or focus in this window. A beat goes out at once when it brings the user back. */
  input(): void {
    this.lastInputAt = this.deps.now();
    if (this.lastSent?.state !== "active") void this.tick();
  }

  /** The Mac locked or unlocked. */
  systemChanged(activity: SystemActivity): void {
    this.system = activity;
    void this.tick(false);
  }

  async tick(readSystem = true): Promise<void> {
    if (readSystem && this.deps.bridge?.experimental_systemActivity) {
      this.system = await this.deps.bridge.experimental_systemActivity().catch(() => null);
    }
    const now = this.deps.now();
    const state = deskState({ now, lastInputAt: this.lastInputAt, system: this.system });
    const changed = this.lastSent?.state !== state;
    if (!changed && (state === "away" || now - this.lastSent!.at < BEAT_MS)) return;
    if (!changed && now < this.quietUntil) return;
    if (this.sending) return;
    this.sending = true;
    try {
      const answer = await this.deps.send(state, this.system ? "system" : "window").catch(() => null);
      this.lastSent = { state, at: now };
      this.quietUntil = answer?.enabled ? 0 : now + BACKOFF_MS;
    } finally {
      this.sending = false;
    }
  }
}

/** A stable id for this window, so the Mobile plugin can tell several windows and computers apart. */
export function presenceClientId(storage: Pick<Storage, "getItem" | "setItem"> | null, random: () => string): string {
  const key = "bb-studio:desk-client";
  const existing = storage?.getItem(key);
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const id = random().replace(/[^A-Za-z0-9]/g, "").slice(0, 32).padEnd(8, "0");
  storage?.setItem(key, id);
  return id;
}
