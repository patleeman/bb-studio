// The one trigger engine. Everything in Studio that runs on a schedule or on
// a named event registers here: an owner registers a handler once, then
// keeps triggers (rows in `triggers`) that say when to call it. One tick a
// minute runs what is due. Automations and Todos are built on it; the old
// per-feature timers are gone.
//
// A trigger is one of:
//   interval  every N milliseconds
//   at        once, at a time
//   daily     at a wall-clock time in a time zone
//   schedule  a Schedule (src/schedule.ts): days and times, an interval, a
//             cron or one time; finished when it has no next time
//   event     when someone calls fire(event)
//
// Rows survive restarts, so an interval does not fire twice after a reload
// and a one-time trigger is not lost. A handler that is still running is not
// started again (lease), and a handler that throws is retried at the next
// due time without stopping the others.
import type Database from "better-sqlite3";
import type { Schedule } from "../schedule";
import { nextDailyAt, nextRun } from "./next-run";

export { nextDailyAt };

export type TriggerSpec =
  | { kind: "interval"; everyMs: number }
  | { kind: "at"; at: number }
  | { kind: "daily"; hour: number; minute: number; timeZone: string }
  | { kind: "schedule"; schedule: Schedule; timeZone: string }
  | { kind: "event"; event: string };

export interface Trigger {
  id: string;
  owner: string;
  ownerId: string;
  spec: TriggerSpec;
  nextAt: number | null;
  lastAt: number | null;
  state: "on" | "off" | "done";
}

export interface TriggerRun {
  now: number;
  /** "manual" is a run someone asked for now: it leaves the due time, and a one-time trigger, as they were. */
  reason: "time" | "event" | "manual";
  event?: string;
  payload?: unknown;
}

/** A handler that returns "later" could not run yet: the trigger stays due and is tried again at the next tick. */
export type TriggerHandler = (trigger: Trigger, run: TriggerRun) => void | "later" | Promise<void | "later">;

const LEASE_MS = 10 * 60_000;
const TICK_MS = 60_000;

interface Row { id: string; owner: string; owner_id: string; spec: string; next_at: number | null; last_at: number | null; state: Trigger["state"]; lease_until: number | null }

/** When a trigger with `spec` is next due after it ran (or was saved) at `now`; null when it only fires by event or is finished. */
export function nextAt(spec: TriggerSpec, now: number): number | null {
  if (spec.kind === "interval") return now + Math.max(1000, spec.everyMs);
  if (spec.kind === "at") return spec.at;
  if (spec.kind === "daily") return nextDailyAt(now, spec.hour, spec.minute, spec.timeZone);
  if (spec.kind === "schedule") return nextRun(spec.schedule, now, spec.timeZone);
  return null;
}

export class TriggerEngine {
  private readonly handlers = new Map<string, TriggerHandler>();
  private readonly running = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Database.Database, private readonly options: { now?: () => number; warn?: (message: string) => void } = {}) {}

  private now() { return this.options.now?.() ?? Date.now(); }
  private toTrigger(row: Row): Trigger { return { id: row.id, owner: row.owner, ownerId: row.owner_id, spec: JSON.parse(row.spec) as TriggerSpec, nextAt: row.next_at, lastAt: row.last_at, state: row.state }; }

  /** The code that runs an owner's triggers. One handler per owner. */
  handle(owner: string, handler: TriggerHandler): void { this.handlers.set(owner, handler); }

  /**
   * Save a trigger. The same owner and ownerId replace the earlier one. An
   * unchanged spec keeps its due time, so re-registering at startup does not
   * push an interval back or fire it early.
   */
  upsert(input: { owner: string; ownerId: string; spec: TriggerSpec; state?: "on" | "off" }): Trigger {
    const id = `${input.owner}:${input.ownerId}`;
    const spec = JSON.stringify(input.spec);
    const existing = this.db.prepare("SELECT * FROM triggers WHERE id = ?").get(id) as Row | undefined;
    const state = input.state ?? "on";
    if (existing && existing.spec === spec && existing.state !== "done") {
      if (existing.state !== state) this.setState(input.owner, input.ownerId, state);
      return this.get(input.owner, input.ownerId)!;
    }
    const due = nextAt(input.spec, this.now());
    // A schedule with no next time is over.
    const saved = input.spec.kind === "schedule" && due === null ? "done" : state;
    this.db.prepare("INSERT INTO triggers (id, owner, owner_id, spec, next_at, last_at, state, lease_until) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET spec = excluded.spec, next_at = excluded.next_at, state = excluded.state, lease_until = NULL")
      .run(id, input.owner, input.ownerId, spec, due, existing?.last_at ?? null, saved);
    return this.toTrigger(this.db.prepare("SELECT * FROM triggers WHERE id = ?").get(id) as Row);
  }

  get(owner: string, ownerId: string): Trigger | null {
    const row = this.db.prepare("SELECT * FROM triggers WHERE owner = ? AND owner_id = ?").get(owner, ownerId) as Row | undefined;
    return row ? this.toTrigger(row) : null;
  }

  /**
   * Turn a trigger on or off. Turning one on works out its next time from
   * now, so a long pause does not fire the runs it missed; a one-time
   * schedule keeps its time, and runs at the next tick if that passed while
   * it was off. A finished trigger stays finished.
   */
  setState(owner: string, ownerId: string, state: "on" | "off"): void {
    const row = this.db.prepare("SELECT * FROM triggers WHERE owner = ? AND owner_id = ?").get(owner, ownerId) as Row | undefined;
    if (!row || row.state === "done" || row.state === state) return;
    if (state === "off") { this.db.prepare("UPDATE triggers SET state = 'off' WHERE id = ?").run(row.id); return; }
    const spec = JSON.parse(row.spec) as TriggerSpec;
    const once = spec.kind === "at" || (spec.kind === "schedule" && spec.schedule.type === "once");
    const due = once ? row.next_at : nextAt(spec, this.now());
    this.db.prepare("UPDATE triggers SET state = ?, next_at = ? WHERE id = ?").run(spec.kind === "schedule" && due === null ? "done" : "on", due, row.id);
  }

  remove(owner: string, ownerId: string): void { this.db.prepare("DELETE FROM triggers WHERE owner = ? AND owner_id = ?").run(owner, ownerId); }

  list(owner?: string): Trigger[] {
    const rows = (owner === undefined ? this.db.prepare("SELECT * FROM triggers ORDER BY owner, owner_id").all() : this.db.prepare("SELECT * FROM triggers WHERE owner = ? ORDER BY owner_id").all(owner)) as Row[];
    return rows.map((row) => this.toTrigger(row));
  }

  private async run(row: Row, run: TriggerRun): Promise<boolean> {
    const handler = this.handlers.get(row.owner);
    if (!handler || this.running.has(row.id)) return false;
    const trigger = this.toTrigger(row);
    this.running.add(row.id);
    this.db.prepare("UPDATE triggers SET lease_until = ? WHERE id = ?").run(run.now + LEASE_MS, row.id);
    let later = false;
    try {
      later = (await handler(trigger, run)) === "later";
    } catch (error) {
      this.options.warn?.(`Trigger ${row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running.delete(row.id);
      if (later || run.reason !== "time") {
        // Not a scheduled run, or one that could not start: the due time stays.
        this.db.prepare("UPDATE triggers SET last_at = CASE WHEN ? THEN last_at ELSE ? END, lease_until = NULL WHERE id = ?").run(later ? 1 : 0, run.now, row.id);
      } else {
        const due = trigger.spec.kind === "at" ? null : nextAt(trigger.spec, this.now());
        const finished = trigger.spec.kind === "at" || (trigger.spec.kind === "schedule" && due === null);
        this.db.prepare("UPDATE triggers SET last_at = ?, next_at = ?, state = CASE WHEN ? THEN 'done' ELSE state END, lease_until = NULL WHERE id = ?").run(run.now, due, finished ? 1 : 0, row.id);
      }
    }
    return true;
  }

  /** Run every trigger that is due. Returns how many ran. */
  async tick(): Promise<number> {
    const now = this.now();
    const due = this.db.prepare("SELECT * FROM triggers WHERE state = 'on' AND next_at IS NOT NULL AND next_at <= ? AND (lease_until IS NULL OR lease_until <= ?) ORDER BY next_at").all(now, now) as Row[];
    const ran = await Promise.all(due.map((row) => this.run(row, { now, reason: "time" })));
    return ran.filter(Boolean).length;
  }

  /** Run every event trigger waiting for `event`. Returns how many ran. */
  async fire(event: string, payload?: unknown): Promise<number> {
    const now = this.now();
    const rows = (this.db.prepare("SELECT * FROM triggers WHERE state = 'on'").all() as Row[]).filter((row) => { const spec = JSON.parse(row.spec) as TriggerSpec; return spec.kind === "event" && spec.event === event; });
    const ran = await Promise.all(rows.map((row) => this.run(row, { now, reason: "event", event, payload })));
    return ran.filter(Boolean).length;
  }

  /** Run one owner's trigger now, whatever its due time or state. Its due time stays, and a one-time trigger is not used up. */
  async runNow(owner: string, ownerId: string): Promise<boolean> {
    const row = this.db.prepare("SELECT * FROM triggers WHERE owner = ? AND owner_id = ?").get(owner, ownerId) as Row | undefined;
    return row ? this.run(row, { now: this.now(), reason: "manual" }) : false;
  }

  /** Register a handler and an interval trigger for it in one call: the common case of "run this every N ms". */
  every(name: string, everyMs: number, work: () => unknown): void {
    this.handle(name, async () => { await work(); });
    this.upsert({ owner: name, ownerId: "tick", spec: { kind: "interval", everyMs } });
  }

  start(): void {
    if (this.timer) return;
    this.db.prepare("UPDATE triggers SET lease_until = NULL").run();
    this.timer = setInterval(() => void this.tick().catch((error) => this.options.warn?.(`Trigger tick failed: ${String(error)}`)), TICK_MS);
    void this.tick().catch(() => {});
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
