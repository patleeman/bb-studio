// Studio's own scheduler for agent runs: the one place that wakes a thread on
// a schedule. The Bot's check-in (project heartbeats), runners Studio made and
// check-in and reminder automations run here, on the trigger engine, so they
// keep running when BB's automations plugin is off. Watchers (they need BB to
// run a script and keep its output) and adopted runners (they wrap the user's
// own BB automation) stay on the automations plugin while it is on. With it
// off (a BB Studio copy imports it off), watchers run here too, as owner
// "watcher": a script run (`script`), not a message to a thread.
//
// A run does what the automations plugin does for an agent automation that
// targets a thread: one message to that thread, starting with the marker
// `[bb automation due:<id>]`, sent with `steer-if-active`. The id is
// `trg_<owner>_<ownerId>`; features keep it in the column that used to hold
// the BB automation's id, so everything that matches the marker still does.
//
// Each feature gives a resolver that reads its own row when the run is due:
// the thread to wake and the prompt. So moving a runner to another thread is
// a row update, with nothing to change here.
//
// Rules, the same as the plugin's:
//   - no host connected for the thread, or the thread is still starting or
//     stopping: not now; the run stays due and is tried at the next tick;
//   - missed runs are not replayed: one overdue run fires, the next time is
//     worked out from now;
//   - the thread is deleted or archived: a successor (a Bot's new Main, from
//     onThreadGone) takes the run; with none, or nothing to run, the trigger
//     turns off;
//   - one run at a time: while a run of this trigger is going, a due run is
//     skipped;
//   - a run ends when its thread goes idle (succeeded) or fails (failed).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { Schedule } from "../schedule";
import type { Trigger, TriggerEngine, TriggerRun } from "./engine";
import { parseCron } from "./next-run";
import { missingModel, threadModel, type PreferredModel } from "../thread-model";

type Sdk = BbPluginApi["sdk"];
export type SchedulerOwner = "heartbeat" | "runner" | "automation" | "watcher";
export interface SchedulerKey { owner: SchedulerOwner; ownerId: string }
/** `skip`: not this run, and why (its Bot is paused); the schedule stays on and the next run comes as usual. */
export interface RunTarget { threadId: string; prompt: string; permissionMode?: string; skip?: string }
export type RunResolver = (ownerId: string) => RunTarget | null | Promise<RunTarget | null>;
/** Runs an owner's script and says how it went; null when there is nothing to run any more. */
/** A thread a run was for is gone: the thread that takes its place, or null. */
export type ThreadGoneHook = (threadId: string) => Promise<string | null>;
export type RunStartHook = (key: SchedulerKey, threadId: string) => { prompt: string; sent?(): void; failed(error: string): void } | null;
export type ScriptRunner = (ownerId: string) => Promise<{ status: "succeeded" | "failed"; output: string | null; error: string | null } | null>;
export type RunStatus = "succeeded" | "failed" | "running" | "skipped";
export interface RunView {
  id: string; status: RunStatus; reason: "time" | "manual"; threadId: string | null;
  scheduledFor: number | null; startedAt: number; finishedAt: number | null;
  /** Why it was skipped or failed. */
  error: string | null;
  /** The end of the thread's reply when the run finished. */
  output: string | null;
}
export interface ScheduleStatus {
  on: boolean;
  /** The schedule is over: a one-time run that ran, or an end date that passed. */
  done: boolean;
  nextRunAt: number | null; lastRunAt: number | null; lastRunStatus: RunStatus | null;
}

const OWNERS: readonly SchedulerOwner[] = ["heartbeat", "runner", "automation", "watcher"];
/** A script run still "running" after this was cut off by a restart (scripts time out at 15 minutes). */
const SCRIPT_STALE_MS = 20 * 60_000;
const PREFIX = "trg_";
/** Statuses in which a thread can't take a message yet; it will soon. */
const NOT_READY = new Set(["pending", "starting", "stopping"]);
const KEEP_RUNS = 200;
/** How long a due run waits for a thread that is pending, starting or stopping before that run is skipped. */
export const STUCK_MS = 30 * 60_000;
const OUTPUT_LIMIT = 4000;

type RunRow = { id: number; trigger_id: string; thread_id: string | null; status: RunStatus; reason: "time" | "manual"; scheduled_for: number | null; started_at: number; finished_at: number | null; error: string | null; output: string | null };

/** The id a feature stores for its trigger, and the id in the run's marker. */
export const scheduleId = (key: SchedulerKey) => `${PREFIX}${key.owner}_${key.ownerId}`;
/** Whether a stored id is one of this scheduler's (not a BB automation's). */
export const isScheduleId = (id: string | null | undefined): id is string => !!id && id.startsWith(PREFIX);
/** The key behind a stored id; null for a BB automation's id. */
export function scheduleKey(id: string | null | undefined): SchedulerKey | null {
  if (!isScheduleId(id)) return null;
  const rest = id.slice(PREFIX.length);
  const cut = rest.indexOf("_");
  const owner = rest.slice(0, cut) as SchedulerOwner;
  return cut > 0 && OWNERS.includes(owner) && rest.length > cut + 1 ? { owner, ownerId: rest.slice(cut + 1) } : null;
}
/** The first message of a run, as the automations plugin writes it. */
export const dueMessage = (id: string, prompt: string) => `[bb automation due:${id}]\n\n${prompt}`;

const errorText = (error: unknown) => String((error as Error)?.message ?? error).slice(0, 500);
const notFound = (error: unknown) => (error as { status?: number })?.status === 404 || /not found/i.test(String((error as Error)?.message ?? ""));

/** A run whose thread has no model and nothing to fall back on: what to do, not BB's error. */
export function noModelText(thread: { title?: string | null }): string {
  const name = thread.title?.trim() ? `"${thread.title.trim()}"` : "Its thread";
  return `${name} has no model yet, so it can't run. Open it and choose a model, or set the Bot's default model in Bot settings.`;
}

/** Why a run turned its trigger off when its thread was gone; revive() looks for it. */
export const THREAD_GONE = "Its thread was deleted or archived.";

export class EngineScheduler {
  private readonly resolvers = new Map<SchedulerOwner, RunResolver>();
  private readonly scripts = new Map<SchedulerOwner, ScriptRunner>();
  private startHook: RunStartHook | null = null;
  private goneHook: ThreadGoneHook | null = null;
  private preferred: ((threadId: string) => PreferredModel) | null = null;
  /** Why the latest run-now of a trigger did not start. */
  private readonly refused = new Map<string, string>();

  constructor(private readonly deps: { db: Database.Database; sdk: Sdk; engine: TriggerEngine; now?: () => number; warn?: (message: string) => void }) {
    for (const owner of OWNERS) deps.engine.handle(owner, (trigger, run) => this.fire(owner, trigger, run));
  }

  private now() { return this.deps.now?.() ?? Date.now(); }

  /** The model a run's thread falls back on when BB has none for it (the Bot's default model). */
  preferModel(pick: (threadId: string) => PreferredModel): void { this.preferred = pick; }

  /** The model a thread falls back on (preferModel's), for features that check a thread before scheduling it. */
  preferredModel(threadId: string): PreferredModel {
    try { return this.preferred?.(threadId) ?? null; } catch { return null; }
  }

  /** How a feature's runs find their thread and prompt. One resolver per owner. */
  resolve(owner: SchedulerOwner, resolver: RunResolver): void { this.resolvers.set(owner, resolver); }

  onRunStart(hook: RunStartHook): void { this.startHook = hook; }

  /**
   * Asked when a due run's thread is deleted or archived, before the trigger
   * turns off: a Bot's Main gets a new Main (Bots.restoreMain) and the run
   * goes there, read again from its resolver.
   */
  onThreadGone(hook: ThreadGoneHook): void { this.goneHook = hook; }

  /** How an owner's runs run a script instead of waking a thread. */
  script(owner: SchedulerOwner, runner: ScriptRunner): void { this.scripts.set(owner, runner); }

  /** Saves the schedule and whether it is on; returns the id to store. An unchanged schedule keeps its next time. */
  ensure(key: SchedulerKey, spec: { schedule: Schedule; timeZone: string }, on: boolean): string {
    if (spec.schedule.type === "cron" && !parseCron(spec.schedule.cron)) throw new Error("That cron isn't one Studio can run: use five fields (minute hour day month weekday) of numbers, names, lists, ranges and steps.");
    this.deps.engine.upsert({ owner: key.owner, ownerId: key.ownerId, spec: { kind: "schedule", schedule: spec.schedule, timeZone: spec.timeZone }, state: on ? "on" : "off" });
    return scheduleId(key);
  }

  setOn(key: SchedulerKey, on: boolean): void { this.deps.engine.setState(key.owner, key.ownerId, on ? "on" : "off"); }

  /** Deletes the trigger and its runs. */
  remove(key: SchedulerKey): void {
    this.deps.engine.remove(key.owner, key.ownerId);
    this.deps.db.prepare("DELETE FROM trigger_runs WHERE trigger_id = ?").run(scheduleId(key));
  }

  has(key: SchedulerKey): boolean { return !!this.deps.engine.get(key.owner, key.ownerId); }

  /**
   * Turns back on a trigger that went off only because its thread was
   * deleted or archived (a Bot's old Main), now that its runs have a thread
   * again. Its next time is worked out from now. True when it came back on.
   */
  revive(key: SchedulerKey): boolean {
    const trigger = this.deps.engine.get(key.owner, key.ownerId);
    if (trigger?.state !== "off") return false;
    const last = this.deps.db.prepare("SELECT status, error FROM trigger_runs WHERE trigger_id = ? ORDER BY id DESC LIMIT 1").get(scheduleId(key)) as { status: string; error: string | null } | undefined;
    if (last?.status !== "skipped" || last.error !== THREAD_GONE) return false;
    this.deps.engine.setState(key.owner, key.ownerId, "on");
    return true;
  }

  /** Runs it now, outside its schedule: its next time stays, and a one-time schedule is not used up. Throws when it can't start. */
  async runNow(key: SchedulerKey): Promise<void> {
    const id = scheduleId(key);
    if (!this.deps.engine.get(key.owner, key.ownerId)) throw new Error("It has no schedule to run; turn it on first.");
    this.refused.delete(id);
    const ran = await this.deps.engine.runNow(key.owner, key.ownerId);
    const refused = this.refused.get(id);
    this.refused.delete(id);
    if (refused) throw new Error(refused);
    if (!ran) throw new Error("It's already running.");
  }

  status(key: SchedulerKey): ScheduleStatus {
    const trigger = this.deps.engine.get(key.owner, key.ownerId);
    const id = scheduleId(key);
    const last = this.deps.db.prepare("SELECT * FROM trigger_runs WHERE trigger_id = ? AND status != 'skipped' ORDER BY id DESC LIMIT 1").get(id) as RunRow | undefined;
    const skipped = last ? undefined : this.deps.db.prepare("SELECT * FROM trigger_runs WHERE trigger_id = ? ORDER BY id DESC LIMIT 1").get(id) as RunRow | undefined;
    return {
      on: trigger?.state === "on", done: trigger?.state === "done",
      nextRunAt: trigger?.state === "on" ? trigger.nextAt : null,
      lastRunAt: last?.started_at ?? null, lastRunStatus: last?.status ?? skipped?.status ?? null,
    };
  }

  /** Recent runs, newest first. */
  runs(key: SchedulerKey, limit = 10): RunView[] {
    const rows = this.deps.db.prepare("SELECT * FROM trigger_runs WHERE trigger_id = ? ORDER BY id DESC LIMIT ?").all(scheduleId(key), limit) as RunRow[];
    return rows.map((row) => ({ id: `${row.trigger_id}#${row.id}`, status: row.status, reason: row.reason, threadId: row.thread_id, scheduledFor: row.scheduled_for, startedAt: row.started_at, finishedAt: row.finished_at, error: row.error, output: row.output }));
  }

  /** A thread went idle or failed: its runs that were going are over. */
  threadSettled(threadId: string, status: "succeeded" | "failed", detail?: string | null): void {
    this.deps.db.prepare("UPDATE trigger_runs SET status = ?, finished_at = ?, error = CASE WHEN ? = 'failed' THEN ? ELSE error END, output = CASE WHEN ? = 'succeeded' THEN ? ELSE output END WHERE thread_id = ? AND status = 'running'")
      .run(status, this.now(), status, detail?.slice(0, 500) ?? null, status, detail?.slice(-OUTPUT_LIMIT) ?? null, threadId);
  }

  private record(id: string, run: TriggerRun, scheduledFor: number | null, fields: { status: RunStatus; threadId?: string | null; error?: string | null }): number {
    const now = this.now();
    const reason = run.reason === "manual" ? "manual" : "time";
    if (fields.status === "skipped") {
      // A run that stays due is skipped again every minute: one line for it, not sixty.
      const last = this.deps.db.prepare("SELECT * FROM trigger_runs WHERE trigger_id = ? ORDER BY id DESC LIMIT 1").get(id) as RunRow | undefined;
      if (last?.status === "skipped" && last.error === (fields.error ?? null) && last.scheduled_for === scheduledFor) return last.id;
    }
    const made = this.deps.db.prepare("INSERT INTO trigger_runs (trigger_id, thread_id, status, reason, scheduled_for, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, fields.threadId ?? null, fields.status, reason, scheduledFor, now, fields.status === "running" ? null : now, fields.error ?? null);
    this.deps.db.prepare("DELETE FROM trigger_runs WHERE trigger_id = ? AND id <= (SELECT id FROM trigger_runs WHERE trigger_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)").run(id, id, KEEP_RUNS);
    return Number(made.lastInsertRowid);
  }

  /** False only when BB says the thread's host is not connected. */
  private async hostUp(thread: { environmentId?: string | null }): Promise<boolean> {
    if (!thread.environmentId) return true;
    const environmentId = thread.environmentId;
    const environment = await Promise.resolve().then(() => this.deps.sdk.environments.get({ environmentId })).catch(() => null) as { hostId?: string | null } | null;
    const hostId = environment?.hostId;
    if (!hostId) return true;
    const host = await Promise.resolve().then(() => this.deps.sdk.hosts.get({ hostId })).catch(() => null) as { status?: string } | null;
    return !host || host.status === "connected";
  }

  /** A script run: one at a time; recorded with its output, or why it failed. */
  private async fireScript(script: ScriptRunner, owner: SchedulerOwner, trigger: Trigger, run: TriggerRun, scheduledFor: number | null): Promise<void> {
    const id = scheduleId({ owner, ownerId: trigger.ownerId });
    const manual = run.reason === "manual";
    const going = this.deps.db.prepare("SELECT * FROM trigger_runs WHERE trigger_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1").get(id) as RunRow | undefined;
    if (going && this.now() - going.started_at < SCRIPT_STALE_MS) {
      if (manual) this.refused.set(id, "It's already running.");
      else this.record(id, run, scheduledFor, { status: "skipped", error: "The run before it was still going." });
      return;
    }
    if (going) this.deps.db.prepare("UPDATE trigger_runs SET status = 'failed', finished_at = ?, error = 'Cut off by a restart.' WHERE trigger_id = ? AND status = 'running'").run(this.now(), id);
    const runId = this.record(id, run, scheduledFor, { status: "running" });
    let result: Awaited<ReturnType<ScriptRunner>>;
    try {
      result = await script(trigger.ownerId);
    } catch (error) {
      result = { status: "failed", output: null, error: errorText(error) };
    }
    if (!result) {
      this.deps.db.prepare("DELETE FROM trigger_runs WHERE id = ?").run(runId);
      this.deps.engine.setState(owner, trigger.ownerId, "off");
      this.record(id, run, scheduledFor, { status: "skipped", error: "Nothing to run: what it was for is gone." });
      if (manual) this.refused.set(id, "Nothing to run: what it was for is gone.");
      return;
    }
    this.deps.db.prepare("UPDATE trigger_runs SET status = ?, finished_at = ?, error = ?, output = ? WHERE id = ?")
      .run(result.status, this.now(), result.error?.slice(0, 500) ?? null, result.output?.slice(-OUTPUT_LIMIT) ?? null, runId);
  }

  private async fire(owner: SchedulerOwner, trigger: Trigger, run: TriggerRun): Promise<void | "later"> {
    const key = { owner, ownerId: trigger.ownerId };
    const id = scheduleId(key);
    const manual = run.reason === "manual";
    const scheduledFor = manual ? null : trigger.nextAt;
    /** Not now. A scheduled run stays due; a run-now tells the caller why. */
    const wait = (why: string, note = true): "later" | void => {
      if (manual) { this.refused.set(id, why); return; }
      if (note) this.record(id, run, scheduledFor, { status: "skipped", error: why });
      return "later";
    };
    /** Nothing left to wake: the trigger turns off. */
    const retire = (why: string): void => {
      this.deps.engine.setState(owner, trigger.ownerId, "off");
      this.record(id, run, scheduledFor, { status: "skipped", error: why });
      if (manual) this.refused.set(id, why);
    };
    const script = this.scripts.get(owner);
    if (script) return this.fireScript(script, owner, trigger, run, scheduledFor);
    const resolver = this.resolvers.get(owner);
    const first = resolver ? await resolver(trigger.ownerId) : null;
    if (!first) return retire("Nothing to run: what it was for is gone.");
    if (first.skip) {
      this.record(id, run, scheduledFor, { status: "skipped", error: first.skip });
      if (manual) this.refused.set(id, first.skip);
      return;
    }
    let target: RunTarget = first;
    let thread: Awaited<ReturnType<Sdk["threads"]["get"]>> | null = null;
    // A gone thread may have a successor (a Bot's new Main): one more read of the target, then off.
    for (let attempt = 0; ; attempt++) {
      try {
        thread = await this.deps.sdk.threads.get({ threadId: target.threadId });
      } catch (error) {
        if (!notFound(error)) return wait(`BB did not answer: ${errorText(error)}`, false);
        thread = null;
      }
      if (thread && thread.deletedAt == null && thread.archivedAt == null) break;
      const next: string | null = attempt === 0 && this.goneHook ? await this.goneHook(target.threadId).catch(() => null) : null;
      const moved: RunTarget | null = next && resolver ? await resolver(trigger.ownerId) : null;
      if (!moved || moved.threadId === target.threadId) return retire(THREAD_GONE);
      target = moved;
    }
    if (!thread) return retire(THREAD_GONE);
    if (NOT_READY.has(thread.status)) {
      // Said once in its runs (not every minute); a thread stuck like this past STUCK_MS skips the run, and the next one comes as usual.
      const why = thread.status === "pending" ? "Its thread hasn't started yet (it may have no model; open it to check)." : "Its thread was starting or stopping.";
      if (!manual && scheduledFor !== null && this.now() - scheduledFor > STUCK_MS) {
        this.record(id, run, scheduledFor, { status: "skipped", threadId: thread.id, error: `${why} This run was skipped.` });
        return;
      }
      return wait(why);
    }
    if (!await this.hostUp(thread)) return wait("No host connected.");
    const going = this.deps.db.prepare("SELECT * FROM trigger_runs WHERE trigger_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1").get(id) as RunRow | undefined;
    if (going) {
      if (thread.status === "active" && going.thread_id === thread.id) {
        // One run at a time: this one is skipped, and its next time comes as usual.
        if (manual) this.refused.set(id, "It's already running.");
        else this.record(id, run, scheduledFor, { status: "skipped", error: "The run before it was still going." });
        return;
      }
      // Its end was missed (Studio was restarting): the thread is not running it any more.
      this.deps.db.prepare("UPDATE trigger_runs SET status = ?, finished_at = ? WHERE trigger_id = ? AND status = 'running'").run(thread.status === "error" && going.thread_id === thread.id ? "failed" : "succeeded", this.now(), id);
    }
    // Its model, never assumed: a thread BB has no model for gets the Bot's default or its provider's (src/thread-model.ts).
    // With neither, the run fails in plain words and the schedule stays on, so it runs once a model is chosen.
    const model = await threadModel(this.deps.sdk, thread.id, this.preferredModel(thread.id)).catch(() => undefined);
    if (model === null) {
      this.record(id, run, scheduledFor, { status: "failed", threadId: thread.id, error: noModelText(thread) });
      if (manual) this.refused.set(id, noModelText(thread));
      return;
    }
    const permissionMode = target.permissionMode ?? model?.permissionMode ?? "accept-edits";
    const runId = this.record(id, run, scheduledFor, { status: "running", threadId: thread.id });
    let started: ReturnType<RunStartHook> = null;
    try { started = this.startHook?.(key, thread.id) ?? null; } catch (error) { this.deps.warn?.(`Run task for ${id} could not be made: ${errorText(error)}`); }
    try {
      await this.deps.sdk.threads.send({ threadId: thread.id, mode: "steer-if-active", input: [{ type: "text", text: dueMessage(id, started?.prompt ? `${target.prompt}\n${started.prompt}` : target.prompt), mentions: [] }], permissionMode } as never);
      try { started?.sent?.(); } catch { }
    } catch (error) {
      const why = missingModel(error) ? noModelText(thread) : errorText(error);
      try { started?.failed(why); } catch { }
      this.deps.db.prepare("UPDATE trigger_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(this.now(), why, runId);
      if (manual) { this.refused.set(id, why); return; }
      // BB's "no stored execution model" said plainly, and the schedule goes on.
      if (missingModel(error)) return;
      throw error;
    }
  }
}
