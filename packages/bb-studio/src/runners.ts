import { resolveRunnerMachine, runnerMachineCheck, runnerEnvironment, RunnerPreflightError } from "./runner-machines";
// Runners: long-lived threads a Bot keeps on a schedule so its own chat
// isn't flooded. Each runner is one thread, woken by its own automation, with
// a name, a job (a short instruction), a state (active, paused) and its last
// report.
//
// Quiet by default. A runner never writes to the Bot's chat itself; it calls
// runner_report (runner threads only):
//   log    → stays in the runner thread and the Bot's Activity;
//   tell   → one "From runner X:" line in the Bot's thread;
//   urgent → tell, plus Needs you and a phone push (Studio Mobile's notify).
// A run with nothing to report ends with exactly [PASS] (docs/silent-output.md)
// and produces nothing.
//
// Why runner threads have no BB parent: BB posts "child completed / failed /
// needs attention" notices into a thread's `parentThreadId` (any child that
// isn't a fork), and "ownership assigned/removed" notices when that parent
// changes. `sourceThreadId` (forks) and `lifecycleOwnerThreadId` (archive and
// delete with the owner; immutable) post nothing, but a lifecycle owner would
// archive the runner when the Bot's thread is handed off. So runners are
// spawned unparented and this table groups them under their Bot.
//
// Why runner threads are hidden: a runner belongs to its Bot, so it lives
// under the Bot in Studio (Runners) and not in BB's thread list. BB's
// `visibility: "hidden"` keeps a thread out of the sidebar, thread search,
// mention suggestions and unread attention; it still opens by id, runs turns
// and gets its automation. A new runner is spawned hidden, an adopted thread
// is hidden when adopted (and made visible again when let go), and runners
// from before are hidden once at startup (hideThreads). A Bot's own chat is
// never a runner's to hide (letting the runner go would show it again):
// src/bot-owned.ts hides it with the rest of the Bot's chain. Anything that
// needs the user still comes through runner_report.
import { readAvailable } from "./kit/server/read-available";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { HeartbeatRun, RunnerAdoptableView, RunnerView } from "./contract";
import { automationName } from "./automation-names";
import { heartbeatRunSchema } from "./contract";
import { heartbeatCron, PERSONAL_PROJECT_ID } from "./project-lead";

type Sdk = BbPluginApi["sdk"];
type TimelineRow = Awaited<ReturnType<Sdk["threads"]["timeline"]>>["rows"][number];
export type RunnerLevel = "log" | "tell" | "urgent";
export type RunnerSchedule = Omit<HeartbeatRun, "enabled">;
type RunnerRow = {
  id: string; bot_id: string; name: string; job: string; thread_id: string | null; project_id: string; state: "active" | "paused";
  cadence: HeartbeatRun["cadence"]; time: string; cron: string | null; timezone: string | null; automation_id: string | null; automation_project_id: string | null; adopted: number;
  last_run_at: number | null; last_level: RunnerLevel | null; last_report: string | null; last_report_at: number | null; urgent: number;
  /** 1 once Studio made the thread hidden. */
  hidden: number; cleanup_pending: number; machine: string | null; machine_name: string | null; machine_offline: number; machine_suspended: number;
  created_at: number; updated_at: number;
};

const automationRow = z.object({
  id: z.string(), name: z.string(), enabled: z.boolean(),
  trigger: z.object({ triggerType: z.string().optional(), cron: z.string().optional(), timezone: z.string().optional() }).passthrough(),
  execution: z.object({ targetThreadId: z.string().nullish(), prompt: z.string().nullish() }).passthrough(),
  nextRunAt: z.number().nullish(), lastRunAt: z.number().nullish(), lastRunStatus: z.string().nullish(), createdByThreadId: z.string().nullish(),
}).passthrough();
type AutomationRow = z.infer<typeof automationRow>;
const missing = (error: unknown) => (error as { status?: number })?.status === 404 || /not found/i.test(String((error as Error)?.message ?? ""));

/** A runner's automation prompt: the job travels with each run, so an edit counts from the next one. */
export function runnerPrompt(runner: { name: string; job: string }): string {
  return `Run of the runner ${JSON.stringify(runner.name)}. Your job: ${runner.job.trim()}\n${RUNNER_RULES}`;
}

/** How a runner reports; short, given every run and every session. */
export const RUNNER_RULES = "Report only through runner_report: level log (kept here and in the Bot's Activity), tell (one short line to the user via the Bot), urgent (also Needs you and a phone push; only when the user must act now). Nothing new, or after reporting: reply exactly [PASS], no ✓ or summary. Never message the Bot's thread yourself.";

/** A runner thread's instructions at each session start. */
export function runnerInstructions(runner: { name: string; job: string; state: string }, botName: string): string {
  const who = `You are ${JSON.stringify(runner.name)}, a runner: an automated sub-agent of the user's Bot ${JSON.stringify(botName)}. Each wake-up is one run. Your job: ${runner.job.trim()}`;
  if (runner.state !== "active") return `${who}\nYou are paused by the user. Don't do the job until resumed; answer questions only.`;
  return `${who}\n${RUNNER_RULES} If a wake-up prompt asks you to message the Bot, follow these rules instead.`;
}

/** Added to an adopted runner's own automation prompt (the rest is kept). */
export const ADOPT_NOTE = `\nReporting (Studio runner, overrides any "tell the Bot" rule above): ${RUNNER_RULES}`;

/** The one line a tell or urgent report adds to the Bot's thread. */
export function tellLine(name: string, level: RunnerLevel, summary: string): string {
  return `${level === "urgent" ? "⚠️ " : ""}From runner ${name}: ${summary.trim().replace(/\s+/g, " ")}`;
}

export interface RunnerBot { id: string; name: string; threadId: string | null; state: string }
export interface RunnerDeps {
  db: Database.Database;
  sdk: Sdk;
  changed(): void;
  /** A Bot as stored (src/bot.ts); the primary without an id. */
  bot(botId?: string): RunnerBot | null;
  /** A Bot's thread chain plus the threads it started: where adoptable runners come from. */
  startedThreads(botId?: string): Promise<{ id: string; title: string; projectId: string | null; parentThreadId?: string | null }[]>;
  /** A Bot's thread and the ones it handed off from. */
  chain(botId?: string): string[];
  /** Every Bot's own thread and the ones it handed off from: never a runner's to hide (src/bot-owned.ts hides them). */
  botThreads?(): ReadonlySet<string>;
}

export class Runners {
  private readonly moving = new Set<string>();
  constructor(private readonly deps: RunnerDeps) {}

  private readonly movingThreads = new Set<string>();

  private requireNotMoving(row: RunnerRow): void {
    if (this.moving.has(row.id)) throw new Error("This runner is moving to another machine. Wait for it to finish.");
  }

  isMovingThread(threadId: string): boolean { return this.movingThreads.has(threadId); }

  async preflight(input: { machine?: string | null; job: string; id?: string }, botId?: string) {
    const bot = this.bot(botId);
    const row = input.id ? this.row(input.id, botId) : null;
    const thread = await this.deps.sdk.threads.get({ threadId: row?.thread_id ?? bot.threadId });
    return runnerMachineCheck(this.deps.sdk, { ...input, providerId: thread.providerId ?? "" });
  }

  async machines() {
    return (await this.deps.sdk.hosts.list()).map(host => ({ id: host.id, name: host.name, connected: host.status === "connected" }));
  }

  async installProvider(input: { id?: string; machine: string }, botId?: string) {
    const bot = this.bot(botId);
    const row = input.id ? this.row(input.id, botId) : null;
    const thread = await this.deps.sdk.threads.get({ threadId: row?.thread_id ?? bot.threadId });
    const host = await resolveRunnerMachine(this.deps.sdk, input.machine);
    if (!host || !thread.providerId) throw new Error("Choose a machine and provider first.");
    await this.deps.sdk.hosts.installProviderCli({ hostId: host.id, provider: thread.providerId, actionKind: "install" });
    return { ok: true as const };
  }

  /** No queue or fallback: a due run on an offline machine is skipped. */
  async available(id: string, notify = true): Promise<boolean> {
    let row = this.row(id);
    if (!row.machine) return true;
    const host = await this.deps.sdk.hosts.get({ hostId: row.machine }).catch(() => null);
    row = this.row(id);
    const offline = host?.status !== "connected";
    if (!offline && row.machine_offline) this.changedRow(row.id, { machine_offline: 0 });
    if (offline && !row.machine_offline) this.changedRow(row.id, { machine_offline: 1 });
    // A dispatch hook runs under core's admission lock. It records the outage
    // only; the lifecycle sweep sends the alert outside that lock.
    if (offline && notify && row.machine_offline !== 2) {
      this.changedRow(row.id, { machine_offline: 2 });
      const bot = this.deps.bot(row.bot_id);
      if (bot?.threadId) await this.tell(row, "tell", `Machine offline: ${row.machine_name ?? row.machine}. Runs are skipped until it reconnects.`, bot as RunnerBot & { threadId: string });
    }
    return !offline;
  }

  async checkMachines(): Promise<void> {
    const rows = this.deps.db.prepare("SELECT id FROM bot_runners WHERE machine IS NOT NULL").all() as { id: string }[];
    for (const { id } of rows) {
      const online = await this.available(id, false);
      let row = this.row(id);
      if (this.moving.has(id) || !row.automation_id) continue;
      const projectId = row.automation_project_id ?? row.project_id;
      if (!online) {
        if (!row.machine_suspended && row.state === "active") {
          const automation = (await this.automations([projectId], true)).find(a => a.id === row.automation_id);
          if (automation?.enabled) this.changedRow(id, { machine_suspended: 1 });
        }
        row = this.row(id);
        if (row.machine_suspended) await this.call("automations_pause", { projectId, automationId: row.automation_id }, z.unknown());
        await this.available(id); // Send outside the dispatch hook, after pausing retries.
      } else if (row.machine_suspended) {
        if (row.state === "active" && this.deps.bot(row.bot_id)?.state === "active") {
          await this.call("automations_resume", { projectId, automationId: row.automation_id }, z.unknown());
          this.changedRow(id, { machine_suspended: 0 });
        } else if (row.state === "paused") this.changedRow(id, { machine_suspended: 0 });
      }
    }
  }

  private async handoff(row: RunnerRow): Promise<string> {
    const reports = this.deps.db.prepare("SELECT summary FROM runner_reports WHERE runner_id = ? ORDER BY id DESC LIMIT 3").all(row.id) as { summary: string }[];
    if (reports.length === 3) return reports.reverse().map(r => r.summary).join("\n");
    // Older runners predate the report buffer. Recover bounded history from
    // the old thread's runner_report calls before falling back to its last report.
    const timeline = await this.deps.sdk.threads.timeline({ threadId: row.thread_id!, segmentLimit: "12", includeNestedRows: "true", summaryOnly: "false" }).catch(() => null);
    const recovered: { at: number; summary: string }[] = [];
    const visit = (rows: TimelineRow[]) => {
      for (const entry of rows) {
        if (entry.kind === "turn" && entry.children) visit(entry.children);
        if (entry.kind === "work" && entry.workKind === "tool" && entry.toolName.endsWith("runner_report") && typeof entry.toolArgs?.summary === "string") recovered.push({ at: entry.createdAt, summary: entry.toolArgs.summary });
      }
    };
    if (timeline) visit(timeline.rows);
    if (recovered.length >= reports.length && recovered.length) return recovered.sort((a, b) => a.at - b.at).slice(-3).map(r => r.summary).join("\n");
    return reports.length ? reports.reverse().map(r => r.summary).join("\n") : row.last_report ?? "No reports yet.";
  }

  async migrate(input: { id: string; machine: string | null; confirm?: boolean }, botId?: string): Promise<RunnerView> {
    const row = this.row(input.id, botId);
    if (this.moving.has(row.id)) throw new Error("This runner is already moving.");
    if (!row.thread_id || !row.automation_id) throw new Error("This runner has no thread or automation to move.");
    this.moving.add(row.id);
    this.movingThreads.add(row.thread_id);
    let newThreadId: string | null = null;
    let retargeted = false;
    let pausedForMove = false;
    let original: AutomationRow | undefined;
    const projectId = row.automation_project_id ?? row.project_id;
    try {
      const old = await this.deps.sdk.threads.get({ threadId: row.thread_id });
      if (old.status !== "idle" && old.status !== "error") throw new Error("Cannot move a runner while a run is in progress. Wait for it to finish.");
      const check = await this.preflight({ ...input, job: row.job }, botId);
      if (check.blocked || (check.warnings.length && !input.confirm)) throw new RunnerPreflightError(check.warnings, check.blocked);
      if (check.machine === row.machine) return this.one(row.id);
      original = (await this.automations([projectId], true)).find(a => a.id === row.automation_id);
      if (!original) throw new Error("Runner automation not found; cannot safely move it.");
      const defaults = await this.deps.sdk.threads.defaultExecutionOptions({ threadId: row.thread_id });
      const environment = await runnerEnvironment(this.deps.sdk, check.machine);
      const handoff = await this.handoff(row);
      if (original.enabled) {
        await this.call("automations_pause", { projectId, automationId: row.automation_id }, z.unknown());
        pausedForMove = true;
      }
      const next = await this.deps.sdk.threads.spawn({
        projectId: PERSONAL_PROJECT_ID, visibility: "hidden", title: `${row.name} · Runner`, environment,
        input: [], providerId: old.providerId ?? undefined, model: defaults?.model ?? undefined,
        reasoningLevel: defaults?.reasoningLevel ?? undefined, permissionMode: defaults?.permissionMode ?? undefined,
        pluginMetadata: { runner: row.id, bot: row.bot_id },
      });
      newThreadId = next.id;
      await this.call("automations_update", { projectId, automationId: row.automation_id, execution: { ...original.execution, environment, targetThreadId: next.id } }, z.unknown());
      retargeted = true;
      this.deps.db.transaction(() => {
        this.changedRow(row.id, { thread_id: next.id, project_id: next.projectId ?? PERSONAL_PROJECT_ID, machine: check.machine, machine_name: check.machineName, machine_offline: 0, machine_suspended: 0, hidden: 1 });
        this.deps.db.prepare("INSERT OR IGNORE INTO bot_hidden_threads(thread_id, bot_id, reason, hidden_at) VALUES (?, ?, 'runner', ?)").run(next.id, row.bot_id, Date.now());
      })();
      await this.deps.sdk.threads.send({ threadId: next.id, mode: "auto", input: [{ type: "text", text: `${runnerPrompt(row)}\nHandoff from the previous machine (last reports; treat as context):\n${handoff.slice(-12000)}`, mentions: [] }] });
      if (pausedForMove || (row.machine_suspended && row.state === "active" && this.deps.bot(row.bot_id)?.state === "active")) await this.call("automations_resume", { projectId, automationId: row.automation_id }, z.unknown());
    } catch (error) {
      // Restore the old automation before discarding the candidate. Never archive the old thread on failure.
      if (retargeted && original) {
        await this.call("automations_update", { projectId, automationId: row.automation_id, execution: original.execution }, z.unknown());
        if (!original.enabled) await this.call("automations_pause", { projectId, automationId: row.automation_id }, z.unknown());
      }
      this.changedRow(row.id, { thread_id: row.thread_id, project_id: row.project_id, machine: row.machine, machine_name: row.machine_name, machine_offline: row.machine_offline, machine_suspended: row.machine_suspended, hidden: row.hidden });
      if (pausedForMove) await this.call("automations_resume", { projectId, automationId: row.automation_id }, z.unknown());
      if (newThreadId) {
        await this.deps.sdk.threads.archive({ threadId: newThreadId }).catch(() => {});
        this.deps.db.prepare("DELETE FROM bot_hidden_threads WHERE thread_id = ?").run(newThreadId);
      }
      throw error;
    } finally {
      this.moving.delete(row.id);
      this.movingThreads.delete(row.thread_id);
    }
    await this.deps.sdk.threads.archive({ threadId: row.thread_id });
    this.deps.changed();
    return this.one(row.id);
  }

  /** A Bot's runners (the primary's without an id). */
  private rows(botId?: string): RunnerRow[] {
    const bot = this.deps.bot(botId);
    return bot ? this.deps.db.prepare("SELECT * FROM bot_runners WHERE bot_id = ? ORDER BY created_at, id").all(bot.id) as RunnerRow[] : [];
  }

  /** A runner by id, thread or name; scoped to `botId` when given. */
  private row(id: string, botId?: string): RunnerRow {
    const row = ((botId ? this.deps.db.prepare("SELECT * FROM bot_runners WHERE (id = ? OR thread_id = ?) AND bot_id = ?").get(id, id, botId) : this.deps.db.prepare("SELECT * FROM bot_runners WHERE id = ? OR thread_id = ?").get(id, id))
      ?? (botId ? this.rows(botId).find((each) => each.name.toLowerCase() === id.toLowerCase()) : this.deps.db.prepare("SELECT * FROM bot_runners WHERE lower(name) = lower(?)").get(id))) as RunnerRow | undefined;
    if (!row) throw new Error(`No runner "${id}". Yours: ${this.rows(botId).map((each) => each.name).join(", ") || "none"}.`);
    return row;
  }

  /** The runner whose thread this is (or whose spawn metadata names it, before its thread id is saved). */
  forThread(threadId: string | undefined | null, metadata?: { readonly [key: string]: unknown }): RunnerRow | null {
    if (!threadId) return null;
    const byThread = this.deps.db.prepare("SELECT * FROM bot_runners WHERE thread_id = ?").get(threadId) as RunnerRow | undefined;
    if (byThread) return byThread;
    return typeof metadata?.runner === "string" ? (this.deps.db.prepare("SELECT * FROM bot_runners WHERE id = ? AND thread_id IS NULL").get(metadata.runner) as RunnerRow | undefined) ?? null : null;
  }

  threadIds(): Set<string> {
    return new Set((this.deps.db.prepare("SELECT thread_id FROM bot_runners WHERE thread_id IS NOT NULL").all() as { thread_id: string }[]).map((row) => row.thread_id));
  }

  /** Runner threads, with whether an urgent report waits on the user. */
  threads(botId?: string): Map<string, { urgent: boolean }> {
    return new Map(this.rows(botId).flatMap((row) => row.thread_id ? [[row.thread_id, { urgent: !!row.urgent }] as const] : []));
  }

  /** A Bot's own chat (any Bot's, handed-off ones included): src/bot-owned.ts hides it, not a runner. */
  private isBotChat(threadId: string, botId: string): boolean {
    return this.deps.bot(botId)?.threadId === threadId || this.deps.chain(botId).includes(threadId) || !!this.deps.botThreads?.().has(threadId);
  }

  /**
   * Hides the runner's thread from BB's thread list (one threads.update,
   * plus `extra` fields such as a cleared parent). False when it couldn't;
   * hideThreads retries at the next startup.
   */
  private async hide(row: Pick<RunnerRow, "id" | "bot_id" | "thread_id">, extra: Record<string, unknown> = {}): Promise<boolean> {
    if (!row.thread_id) return false;
    const rest = () => Object.keys(extra).length ? this.deps.sdk.threads.update({ threadId: row.thread_id, ...extra } as never).catch(() => {}) : undefined;
    if (this.isBotChat(row.thread_id, row.bot_id)) { await rest(); return false; }
    try {
      await this.deps.sdk.threads.update({ threadId: row.thread_id, visibility: "hidden", ...extra } as never);
    } catch (error) {
      if (!missing(error)) { await rest(); return false; }
    }
    this.deps.db.prepare("UPDATE bot_runners SET hidden = 1 WHERE id = ?").run(row.id);
    // Recorded with the Bot's other hidden threads, so the sweep (src/bot-owned.ts) never hides it again once let go.
    this.deps.db.prepare("INSERT OR IGNORE INTO bot_hidden_threads (thread_id, bot_id, reason, hidden_at) VALUES (?, ?, 'runner', ?)").run(row.thread_id, row.bot_id, Date.now());
    return true;
  }

  /**
   * Startup step: hides every runner thread not hidden yet (runners from
   * before runner threads were hidden, or a hide that failed). Idempotent:
   * a hidden row is skipped. Returns how many it hid.
   */
  async hideThreads(): Promise<number> {
    const rows = this.deps.db.prepare("SELECT * FROM bot_runners WHERE thread_id IS NOT NULL AND hidden = 0").all() as RunnerRow[];
    let hid = 0;
    for (const row of rows) if (await this.hide(row)) hid++;
    return hid;
  }

  instructions(row: RunnerRow): string {
    return runnerInstructions(row, this.deps.bot(row.bot_id)?.name ?? "Bot");
  }

  private call<T>(method: string, input: unknown, schema: z.ZodType<T>) {
    return this.deps.sdk.plugins.callRpc({ pluginId: "automations", method, input: input as never, outputSchema: schema });
  }

  private async automations(projectIds: Iterable<string>, strict = false): Promise<(AutomationRow & { projectId: string })[]> {
    const lists = await Promise.all([...new Set(projectIds)].map(async (projectId) => {
      const result = await readAvailable(async () => z.array(automationRow).parse(await this.call("automations_list", { projectId }, z.unknown())));
      if (result.status === "unavailable") {
        console.warn(`[studio] Automation list unavailable for ${projectId}`, result.error);
        throw result.error;
      }
      if (strict && result.status === "absent") throw new Error("Automation list unavailable during runner cleanup.");
      return result.status === "ok" ? result.value.map((entry) => ({ ...entry, projectId })) : [];
    }));
    return lists.flat();
  }

  private view(row: RunnerRow, automation?: AutomationRow): RunnerView {
    // BB can turn the automation off by itself (a failed run disables it, or
    // someone paused it in BB): then it has no next run, so the runner shows
    // paused, and Resume turns the automation back on.
    const state = row.state === "active" && !row.machine_offline && !row.machine_suspended && automation?.enabled === false ? "paused" : row.state;
    return {
      machine: row.machine ?? null, machineName: row.machine_name ?? null, machineOffline: !!row.machine_offline,
      id: row.id, name: row.name, job: row.job, threadId: row.thread_id, state, adopted: !!row.adopted,
      schedule: { cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}), ...((row.timezone ?? automation?.trigger.timezone) ? { timezone: row.timezone ?? automation!.trigger.timezone } : {}) },
      nextRunAt: state === "active" ? automation?.nextRunAt ?? null : null,
      lastRunAt: Math.max(automation?.lastRunAt ?? 0, row.last_run_at ?? 0) || null,
      lastRunStatus: automation?.lastRunStatus ?? null,
      lastLevel: row.last_level, lastReport: row.last_report, lastReportAt: row.last_report_at, urgent: !!row.urgent,
    };
  }

  async list(botId?: string): Promise<RunnerView[]> {
    const rows = this.rows(botId);
    const automations = await this.automations(rows.flatMap((row) => row.automation_project_id ? [row.automation_project_id] : []));
    return Promise.all(rows.map(async (row) => {
      const runner = this.view(row, automations.find((each) => each.id === row.automation_id));
      if (!runner.threadId) return runner;
      const thread = await this.deps.sdk.threads.get({ threadId: runner.threadId }).catch(() => null);
      return { ...runner, providerId: thread?.providerId ?? null };
    }));
  }

  private bot(botId?: string): RunnerBot & { threadId: string } {
    const bot = this.deps.bot(botId);
    if (!bot?.threadId) throw new Error("Make your Bot first.");
    if (bot.state !== "active") throw new Error(`Your Bot is ${bot.state}. Resume it first.`);
    return bot as RunnerBot & { threadId: string };
  }

  private changedRow(id: string, fields: Partial<RunnerRow>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.deps.db.prepare(`UPDATE bot_runners SET ${keys.map((key) => `${key} = @${key}`).join(", ")}, updated_at = @updated_at WHERE id = @id`).run({ ...fields, updated_at: Date.now(), id });
    this.deps.changed();
  }

  /** Makes the runner's thread (its first message is its first run) and its automation. */
  async create(input: { name: string; job: string; schedule: RunnerSchedule; machine?: string | null; confirm?: boolean }, botId?: string): Promise<RunnerView> {
    const bot = this.bot(botId);
    const check = await this.preflight(input, botId);
    if (check.blocked || (check.warnings.length && !input.confirm)) throw new RunnerPreflightError(check.warnings, check.blocked);
    const environment = await runnerEnvironment(this.deps.sdk, check.machine);
    const schedule = parseSchedule(input.schedule);
    const name = input.name.trim();
    automationName(this.deps.db, bot.id, name);
    const id = `run_${Math.random().toString(36).slice(2, 12)}`;
    const now = Date.now();
    // The row comes first, so the thread's first turn gets runner instructions (forThread by metadata).
    this.deps.db.prepare(`INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, cron, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?, ?, ?)`).run(id, bot.id, name, input.job.trim(), PERSONAL_PROJECT_ID, schedule.cadence, schedule.time, schedule.cron ?? null, now, now);
    this.changedRow(id, { machine: check.machine, machine_name: check.machineName });
    try {
      const [botThread, defaults] = await Promise.all([
        this.deps.sdk.threads.get({ threadId: bot.threadId }),
        this.deps.sdk.threads.defaultExecutionOptions({ threadId: bot.threadId }).catch(() => null),
      ]);
      // No parentThreadId and no lifecycle owner: BB posts nothing to the Bot.
      // Hidden: it lives under the Bot, not in BB's thread list (see the top of this file).
      const thread = await this.deps.sdk.threads.spawn({
        projectId: PERSONAL_PROJECT_ID,
        visibility: "hidden",
        title: `${name} · Runner`,
        environment,
        ...(botThread.providerId ? { providerId: botThread.providerId } : {}),
        ...(defaults?.model ? { model: defaults.model } : {}),
        pluginMetadata: { runner: id, bot: bot.id },
        input: [{ type: "text", text: `${runnerPrompt({ name, job: input.job })}\nThis is your first run.`, mentions: [] }],
      } as never);
      this.deps.db.prepare("UPDATE bot_runners SET thread_id = ?, project_id = ?, last_run_at = ?, hidden = 1 WHERE id = ?").run(thread.id, thread.projectId ?? PERSONAL_PROJECT_ID, now, id);
      this.deps.db.prepare("INSERT OR IGNORE INTO bot_hidden_threads (thread_id, bot_id, reason, hidden_at) VALUES (?, ?, 'runner', ?)").run(thread.id, bot.id, now);
      await this.provision(this.row(id));
    } catch (error) {
      this.changedRow(id, { cleanup_pending: 1, state: "paused" });
      await this.delete(id).catch((cleanupError) => console.warn(`[studio] runner ${id} cleanup pending`, cleanupError));
      throw error;
    }
    this.deps.changed();
    return this.one(id);
  }

  async get(id: string, botId?: string): Promise<RunnerView> {
    return this.one(this.row(id, botId).id);
  }

  private async one(id: string): Promise<RunnerView> {
    const row = this.row(id);
    const automation = (await this.automations([row.automation_project_id ?? row.project_id])).find((a) => a.id === row.automation_id);
    const thread = row.thread_id ? await this.deps.sdk.threads.get({ threadId: row.thread_id }).catch(() => null) : null;
    return { ...this.view(row, automation), providerId: thread?.providerId ?? null };
  }

  /** Makes or updates the runner's automation to match its row (adopted runners keep their prompt). */
  private async provision(row: RunnerRow): Promise<void> {
    if (!row.thread_id) throw new Error("This runner has no thread.");
    const [thread, defaults] = await Promise.all([this.deps.sdk.threads.get({ threadId: row.thread_id }), this.deps.sdk.threads.defaultExecutionOptions({ threadId: row.thread_id }).catch(() => null)]);
    let timezone = row.timezone;
    if (!timezone && row.adopted && row.automation_id) {
      const existing = (await this.automations([row.automation_project_id ?? row.project_id], true)).find((a) => a.id === row.automation_id);
      timezone = existing?.trigger.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      this.changedRow(row.id, { timezone });
    }
    const trigger = { triggerType: "schedule", cron: heartbeatCron({ enabled: true, cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}) }), timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone };
    const projectId = row.automation_project_id ?? thread.projectId;
    if (row.adopted && row.automation_id) {
      await this.call("automations_update", { projectId, automationId: row.automation_id, trigger }, z.unknown());
    } else {
      if (!thread.providerId || !defaults?.model) throw new Error("Choose a provider and model for the runner's thread first.");
      const execution = {
        mode: "agent", providerId: thread.providerId, model: defaults.model, reasoningLevel: defaults.reasoningLevel ?? "medium",
        permissionMode: defaults.permissionMode ?? "accept-edits", environment: await runnerEnvironment(this.deps.sdk, row.machine ?? null), targetThreadId: row.thread_id, prompt: runnerPrompt(row),
      };
      let automationId = row.automation_id;
      if (automationId) {
        await this.call("automations_update", { projectId, automationId, trigger, execution }, z.unknown()).catch((error) => { if (!missing(error)) throw error; automationId = null; });
      }
      if (!automationId) {
        const made = await this.call("automations_create", { projectId: thread.projectId, name: `Studio runner ${row.id}`, enabled: false, origin: "app", trigger, execution }, z.object({ id: z.string() }));
        automationId = made.id;
        this.deps.db.prepare("UPDATE bot_runners SET automation_id = ?, automation_project_id = ? WHERE id = ?").run(automationId, thread.projectId, row.id);
      }
      row = { ...row, automation_id: automationId, automation_project_id: thread.projectId };
    }
    await this.call(row.state === "active" && !row.machine_offline && !row.machine_suspended ? "automations_resume" : "automations_pause", { projectId: row.automation_project_id ?? projectId, automationId: row.automation_id }, z.unknown());
  }

  async update(input: { id: string; name?: string; job?: string; schedule?: RunnerSchedule; machine?: string | null; confirm?: boolean }, botId?: string): Promise<RunnerView> {
    let row = this.row(input.id, botId);
    this.requireNotMoving(row);
    const schedule = input.schedule ? parseSchedule(input.schedule) : null;
    if (input.name !== undefined) automationName(this.deps.db, row.bot_id, input.name.trim(), row.id);
    if (input.machine !== undefined) {
      const target = await resolveRunnerMachine(this.deps.sdk, input.machine);
      if ((target?.id ?? null) !== row.machine) {
        // Check the edited job before moving as well as the stored job.
        const check = await this.preflight({ ...input, job: input.job ?? row.job }, botId);
        if (check.blocked || (check.warnings.length && !input.confirm)) throw new RunnerPreflightError(check.warnings, check.blocked);
        await this.migrate({ id: row.id, machine: input.machine, confirm: input.confirm }, botId);
        row = this.row(row.id);
      }
    }
    const name = input.name?.trim();
    if (input.name !== undefined) automationName(this.deps.db, row.bot_id, name ?? "", row.id);
    const next: RunnerRow = { ...row, ...(name ? { name } : {}), ...(input.job?.trim() ? { job: input.job.trim() } : {}), ...(schedule ? { cadence: schedule.cadence, time: schedule.time, cron: schedule.cron ?? null } : {}) };
    // The automation first: if it refuses the schedule, nothing changes.
    if (schedule || (!row.adopted && (next.name !== row.name || next.job !== row.job))) await this.provision(next);
    if (next.name !== row.name && row.thread_id && !row.adopted) await this.deps.sdk.threads.update({ threadId: row.thread_id, title: `${next.name} · Runner` } as never).catch(() => {});
    this.changedRow(row.id, { name: next.name, job: next.job, cadence: next.cadence, time: next.time, cron: next.cron });
    return this.one(row.id);
  }

  async setState(id: string, state: "active" | "paused", botId?: string): Promise<RunnerView> {
    const row = this.row(id, botId);
    this.requireNotMoving(row);
    if (state === "active") this.bot(row.bot_id);
    if (state === "active" && !await this.available(row.id)) { this.changedRow(row.id, { state }); await this.checkMachines(); return this.one(row.id); }
    if (row.automation_id) await this.call(state === "active" ? "automations_resume" : "automations_pause", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown());
    this.changedRow(row.id, { state });
    return this.one(row.id);
  }

  /** Pauses every active runner (the Bot was stopped); `onPaused` hears each as it goes, so a failure midway loses none. */
  async pauseAll(botId?: string, onPaused?: (id: string) => void): Promise<string[]> {
    const paused: string[] = [];
    for (const row of this.rows(botId)) {
      if (row.state !== "active") continue;
      await this.setState(row.id, "paused");
      paused.push(row.id);
      onPaused?.(row.id);
    }
    return paused;
  }

  /**
   * Turns a runner the Bot's Stop paused back on, while the Bot resumes (so
   * before it is active again). False when the runner was deleted since.
   */
  async restore(id: string): Promise<boolean> {
    const row = this.deps.db.prepare("SELECT * FROM bot_runners WHERE id = ?").get(id) as RunnerRow | undefined;
    if (!row) return false;
    if (row.state === "active") return true;
    if (!await this.available(row.id)) { this.changedRow(row.id, { state: "active" }); await this.checkMachines(); return true; }
    if (row.automation_id) await this.call("automations_resume", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown());
    this.changedRow(row.id, { state: "active" });
    return true;
  }

  /** A runner's BB automation, for its runs. */
  automation(id: string): { id: string; projectId: string } | null {
    const row = this.deps.db.prepare("SELECT automation_id, automation_project_id, project_id FROM bot_runners WHERE id = ?").get(id) as Pick<RunnerRow, "automation_id" | "automation_project_id" | "project_id"> | undefined;
    return row?.automation_id ? { id: row.automation_id, projectId: row.automation_project_id ?? row.project_id } : null;
  }

  /** Runs it now, through its automation (so the run counts like a scheduled one). */
  async runNow(id: string, botId?: string): Promise<RunnerView> {
    const row = this.row(id, botId);
    this.requireNotMoving(row);
    this.bot(row.bot_id);
    if (!row.automation_id) throw new Error("This runner has no schedule to run.");
    if (!await this.available(row.id)) { await this.checkMachines(); return this.one(row.id); }
    await this.call("automations_run", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown());
    this.changedRow(row.id, { last_run_at: Date.now() });
    return this.one(row.id);
  }

  /**
   * A runner Studio made: deletes its automation and archives its thread
   * (history kept). An adopted runner is only let go: its thread and
   * automation stay as they were before adopting, minus the reporting note.
   * Either way its thread is visible again, so it isn't lost: an adopted one
   * back in BB's thread list, an archived one in BB's archive.
   */
  async delete(id: string, botId?: string): Promise<{ deleted: true; kept: boolean }> {
    const row = this.row(id, botId);
    this.requireNotMoving(row);
    this.changedRow(row.id, { cleanup_pending: 1 });
    if (row.thread_id && row.hidden) await this.deps.sdk.threads.update({ threadId: row.thread_id, visibility: "visible" } as never).catch((error) => { if (!missing(error)) throw error; });
    if (row.adopted) {
      if (row.automation_id) {
        const automation = (await this.automations([row.automation_project_id ?? row.project_id], true)).find((each) => each.id === row.automation_id);
        const prompt = automation?.execution.prompt;
        if (prompt?.includes(ADOPT_NOTE)) await this.call("automations_update", { projectId: row.automation_project_id, automationId: row.automation_id, execution: { ...automation!.execution, prompt: prompt.replace(ADOPT_NOTE, "") } }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
      }
    } else {
      if (row.automation_id) await this.call("automations_delete", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
      if (row.thread_id) await this.deps.sdk.threads.archive({ threadId: row.thread_id }).catch((error) => { if (!missing(error)) throw error; });
    }
    this.deps.db.prepare("DELETE FROM bot_runners WHERE id = ?").run(row.id);
    this.deps.changed();
    return { deleted: true, kept: !!row.adopted };
  }

  /** Retry unfinished rollback/release work on startup and each lifecycle tick. */
  async retryCleanup(): Promise<void> {
    const rows = this.deps.db.prepare("SELECT id FROM bot_runners WHERE cleanup_pending = 1").all() as { id: string }[];
    for (const row of rows) {
      await this.delete(row.id).catch((error) => console.warn(`[studio] runner ${row.id} cleanup pending`, error));
    }
  }

  /** The user saw an urgent report: it leaves Needs you. */
  seen(id: string, botId?: string): void {
    const row = this.row(id, botId);
    if (row.urgent) this.changedRow(row.id, { urgent: 0 });
  }

  /**
   * runner_report from a runner's thread. log stays here; tell posts one line
   * into the Bot's thread; urgent also goes to Needs you and the phone.
   * An urgent flag stays until the user acknowledges it (acknowledge, when
   * they open the runner); a later log or tell doesn't clear it.
   */
  async report(threadId: string, input: { level: RunnerLevel; summary: string }): Promise<string> {
    const row = this.forThread(threadId);
    if (!row) throw new Error("Only a runner's thread can report.");
    const summary = input.summary.trim();
    const now = Date.now();
    this.deps.db.prepare("INSERT INTO runner_reports(runner_id, summary) VALUES (?, ?)").run(row.id, summary);
    this.deps.db.prepare("DELETE FROM runner_reports WHERE runner_id = ? AND id NOT IN (SELECT id FROM runner_reports WHERE runner_id = ? ORDER BY id DESC LIMIT 3)").run(row.id, row.id);
    this.changedRow(row.id, { last_level: input.level, last_report: summary, last_report_at: now, last_run_at: now, ...(input.level === "urgent" ? { urgent: 1 } : {}) });
    if (input.level === "log") return "Logged. Then reply exactly [PASS].";
    const bot = this.deps.bot(row.bot_id);
    if (!bot?.threadId) return "Logged; the Bot has no thread to tell. Then reply exactly [PASS].";
    await this.tell(row, input.level, summary, bot as RunnerBot & { threadId: string });
    return input.level === "urgent" ? "Told the user and pushed to their phone. Then reply exactly [PASS]." : "Told the user. Then reply exactly [PASS].";
  }

  /** A tell or urgent report's line in the Bot's thread; urgent also pushes to the phone. */
  private async tell(row: RunnerRow, level: "tell" | "urgent", summary: string, bot: RunnerBot & { threadId: string }): Promise<void> {
    await alertBot(this.deps.sdk, {
      botThreadId: bot.threadId, senderThreadId: row.thread_id, line: tellLine(row.name, level, summary),
      push: level === "urgent" ? { title: `${bot.name} · ${row.name}`, body: summary, coalesceKey: `runner:${row.id}` } : null,
    });
  }

  /** Every runner's automation, for auto-resume (src/auto-resume.ts): on while the runner and its Bot are active. */
  resumeTargets(): { automationId: string; projectId: string; botId: string; ownerId: string; name: string; on: boolean }[] {
    const rows = this.deps.db.prepare("SELECT * FROM bot_runners WHERE automation_id IS NOT NULL").all() as RunnerRow[];
    return rows.map((row) => ({
      automationId: row.automation_id!, projectId: row.automation_project_id ?? row.project_id, botId: row.bot_id, ownerId: row.id, name: row.name,
      on: !row.machine_offline && !row.machine_suspended && !this.moving.has(row.id) && !row.cleanup_pending && row.state === "active" && this.deps.bot(row.bot_id)?.state === "active",
    }));
  }

  /** A log entry Studio adds to a runner (an auto-resume): its last report, like runner_report's log. */
  note(id: string, summary: string): void {
    this.changedRow(id, { last_level: "log", last_report: summary, last_report_at: Date.now() });
  }

  /** Studio's own urgent report for a runner (auto-resume past its cap): Needs you, the phone and one line in the Bot's chat. */
  async alert(id: string, summary: string): Promise<void> {
    const row = this.deps.db.prepare("SELECT * FROM bot_runners WHERE id = ?").get(id) as RunnerRow | undefined;
    if (!row) return;
    this.changedRow(row.id, { last_level: "urgent", last_report: summary, last_report_at: Date.now(), urgent: 1 });
    const bot = this.deps.bot(row.bot_id);
    if (bot?.threadId) await this.tell(row, "urgent", summary, bot as RunnerBot & { threadId: string });
  }

  /** Threads the Bot started (or whose automation it made) that an automation wakes, not yet runners. */
  async adoptable(botId?: string): Promise<RunnerAdoptableView[]> {
    const bot = this.deps.bot(botId);
    if (!bot?.threadId) return [];
    const started = await this.deps.startedThreads(bot.id);
    const chain = new Set(this.deps.chain(bot.id));
    const mine = new Map(started.filter((thread) => !chain.has(thread.id)).map((thread) => [thread.id, thread]));
    const runners = this.threadIds();
    const automations = await this.automations([PERSONAL_PROJECT_ID, ...started.flatMap((thread) => thread.projectId ? [thread.projectId] : [])]);
    const seen = new Set<string>();
    return automations.flatMap((automation) => {
      if (automation.trigger.triggerType !== "schedule" || !automation.trigger.cron?.trim() || automation.execution.mode !== "agent") return [];
      const target = automation.execution.targetThreadId;
      if (!target || chain.has(target) || runners.has(target) || seen.has(target)) return [];
      if (!mine.has(target) && !(automation.createdByThreadId && chain.has(automation.createdByThreadId))) return [];
      seen.add(target);
      return [{ threadId: target, title: mine.get(target)?.title ?? automation.name, automationId: automation.id, automationName: automation.name, projectId: automation.projectId, cron: automation.trigger.cron ?? null, enabled: automation.enabled }];
    });
  }

  /**
   * Adopt as runner (the user's choice): registers the thread, keeps its
   * automation and schedule, adds the reporting note to the automation's
   * prompt, detaches the thread from the Bot (one BB "removed" notice,
   * then no more child notices) and hides it from BB's thread list: it lives
   * under the Bot now, until it's let go (delete).
   */
  async adopt(input: { threadId: string; automationId: string; name?: string; job?: string }, botId?: string): Promise<RunnerView> {
    const bot = this.bot(botId);
    if (this.threadIds().has(input.threadId)) throw new Error("That thread is already a runner.");
    const candidate = (await this.adoptable(bot.id)).find((each) => each.threadId === input.threadId && each.automationId === input.automationId);
    if (!candidate) throw new Error("Only a recurring cron agent automation on a thread your Bot started can be adopted.");
    const automation = (await this.automations([candidate.projectId])).find((each) => each.id === candidate.automationId)!;
    const name = (input.name?.trim() || candidate.title.replace(/\s*·\s*Runner$/i, "")).slice(0, 60);
    automationName(this.deps.db, bot.id, name);
    const prompt = automation.execution.prompt ?? "";
    const job = (input.job?.trim() || prompt.split("\n")[0]?.trim() || "Follow your automation's prompt.").slice(0, 2000);
    const cron = automation.trigger.cron!;
    const now = Date.now();
    const id = `run_${Math.random().toString(36).slice(2, 12)}`;
    if (!prompt.includes(ADOPT_NOTE)) await this.call("automations_update", { projectId: candidate.projectId, automationId: automation.id, execution: { ...automation.execution, prompt: `${prompt}${ADOPT_NOTE}` } }, z.unknown());
    this.deps.db.prepare(`INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, cron, automation_id, automation_project_id, adopted, last_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'custom', '09:00', ?, ?, ?, 1, ?, ?, ?)`)
      .run(id, bot.id, name, job, input.threadId, candidate.projectId, automation.enabled ? "active" : "paused", cron, automation.id, candidate.projectId, automation.lastRunAt ?? null, now, now);
    this.changedRow(id, { timezone: automation.trigger.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone });
    const thread = await this.deps.sdk.threads.get({ threadId: input.threadId }).catch(() => null);
    await this.hide({ id, bot_id: bot.id, thread_id: input.threadId }, thread?.parentThreadId ? { parentThreadId: null } : {});
    this.deps.changed();
    return this.one(id);
  }
}

/**
 * One line in a Bot's thread the user reads as is (runner reports, Studio's
 * own alerts), with an agent-only note so the Bot doesn't answer it; with
 * `push`, also a phone push (Studio Mobile's notify) whose Reply goes to the Bot.
 */
export async function alertBot(sdk: Sdk, input: { botThreadId: string; senderThreadId?: string | null; line: string; note?: string; push?: { title: string; body: string; coalesceKey: string } | null }): Promise<void> {
  await sdk.threads.send({
    threadId: input.botThreadId, mode: "auto", ...(input.senderThreadId ? { senderThreadId: input.senderThreadId } : {}),
    input: [
      { type: "text", text: input.line, mentions: [] },
      { type: "text", text: input.note ?? "Runner report, already shown to the user as is. Don't reply or acknowledge it; reply exactly [PASS] unless it asks you to act on something.", mentions: [], visibility: "agent-only" },
    ],
  } as never);
  if (input.push) {
    await sdk.plugins.callRpc({
      pluginId: "mobile", method: "notify", outputSchema: z.unknown(),
      // turn-finished on the Bot's thread: the phone shows its Reply action, and a reply goes to the Bot.
      input: { title: input.push.title, body: input.push.body.slice(0, 4000), kind: "turn-finished", threadId: input.botThreadId, projectId: PERSONAL_PROJECT_ID, coalesceKey: input.push.coalesceKey } as never,
    }).catch((error) => { console.warn("[studio] Bot push delivery failed", error); throw error; });
  }
}

/** A schedule as the bot or the UI gives it: cadence, time (default 09:00), cron for custom. */
export function parseSchedule(schedule: RunnerSchedule | { cadence: HeartbeatRun["cadence"]; time?: string; cron?: string }): RunnerSchedule {
  const run = heartbeatRunSchema.parse({ enabled: true, time: "09:00", ...schedule });
  if (run.cadence === "custom" && !run.cron) throw new Error("A custom schedule needs a five-field cron expression.");
  return { cadence: run.cadence, time: run.time, ...(run.cadence === "custom" ? { cron: run.cron } : {}) };
}
