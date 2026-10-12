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
// A run with nothing to report ends without a message and produces nothing.
//
// Why runner threads have no BB parent: BB posts "child completed / failed /
// needs attention" notices into a thread's `parentThreadId` (any child that
// isn't a fork), and "ownership assigned/removed" notices when that parent
// changes. `sourceThreadId` (forks) and `lifecycleOwnerThreadId` (archive and
// delete with the owner; immutable) post nothing, but a lifecycle owner would
// archive the runner when the Bot's thread is handed off. So runners are
// spawned unparented and this table groups them under their Bot.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { HeartbeatRun, RunnerAdoptableView, RunnerView } from "./contract";
import { heartbeatRunSchema } from "./contract";
import { heartbeatCron, PERSONAL_PROJECT_ID } from "./project-lead";

type Sdk = BbPluginApi["sdk"];
export type RunnerLevel = "log" | "tell" | "urgent";
export type RunnerSchedule = Omit<HeartbeatRun, "enabled">;
type RunnerRow = {
  id: string; bot_id: string; name: string; job: string; thread_id: string | null; project_id: string; state: "active" | "paused";
  cadence: HeartbeatRun["cadence"]; time: string; cron: string | null; automation_id: string | null; automation_project_id: string | null; adopted: number;
  last_run_at: number | null; last_level: RunnerLevel | null; last_report: string | null; last_report_at: number | null; urgent: number;
  created_at: number; updated_at: number;
};

const automationRow = z.object({
  id: z.string(), name: z.string(), enabled: z.boolean(),
  trigger: z.object({ cron: z.string().optional() }).passthrough(),
  execution: z.object({ targetThreadId: z.string().nullish(), prompt: z.string().nullish() }).passthrough(),
  nextRunAt: z.number().nullish(), lastRunAt: z.number().nullish(), createdByThreadId: z.string().nullish(),
}).passthrough();
type AutomationRow = z.infer<typeof automationRow>;
const missing = (error: unknown) => (error as { status?: number })?.status === 404 || /not found/i.test(String((error as Error)?.message ?? ""));

/** A runner's automation prompt: the job travels with each run, so an edit counts from the next one. */
export function runnerPrompt(runner: { name: string; job: string }): string {
  return `Run of the runner ${JSON.stringify(runner.name)}. Your job: ${runner.job.trim()}\n${RUNNER_RULES}`;
}

/** How a runner reports; short, given every run and every session. */
export const RUNNER_RULES = "Report only through runner_report: level log (kept here and in the Bot's Activity), tell (one short line to the user via the Bot), urgent (also Needs you and a phone push; only when the user must act now). Nothing new: finish without any final message, no ✓, [PASS] or summary. Never message the Bot's thread yourself.";

/** A runner thread's instructions at each session start. */
export function runnerInstructions(runner: { name: string; job: string; state: string }, botName: string): string {
  const who = `You are ${JSON.stringify(runner.name)}, a runner: an automated sub-agent of the user's Bot ${JSON.stringify(botName)}. Each wake-up is one run. Your job: ${runner.job.trim()}`;
  if (runner.state !== "active") return `${who}\nYou are paused by the user. Don't do the job until resumed; answer questions only.`;
  return `${who}\n${RUNNER_RULES} If a wake-up prompt asks you to reply [PASS] or to message the Bot, follow these rules instead.`;
}

/** Added to an adopted runner's own automation prompt (the rest is kept). */
export const ADOPT_NOTE = `\nReporting (Studio runner, overrides any [PASS] or "tell the Bot" rule above): ${RUNNER_RULES}`;

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
}

export class Runners {
  constructor(private readonly deps: RunnerDeps) {}

  /** A Bot's runners (the primary's without an id). */
  private rows(botId?: string): RunnerRow[] {
    const bot = this.deps.bot(botId);
    return bot ? this.deps.db.prepare("SELECT * FROM bot_runners WHERE bot_id = ? ORDER BY created_at, id").all(bot.id) as RunnerRow[] : [];
  }

  /** A runner by id, thread or name; a name is looked up among `botId`'s runners when given. */
  private row(id: string, botId?: string): RunnerRow {
    const row = (this.deps.db.prepare("SELECT * FROM bot_runners WHERE id = ? OR thread_id = ?").get(id, id)
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

  instructions(row: RunnerRow): string {
    return runnerInstructions(row, this.deps.bot(row.bot_id)?.name ?? "Bot");
  }

  private call<T>(method: string, input: unknown, schema: z.ZodType<T>) {
    return this.deps.sdk.plugins.callRpc({ pluginId: "automations", method, input: input as never, outputSchema: schema });
  }

  private async automations(projectIds: Iterable<string>): Promise<(AutomationRow & { projectId: string })[]> {
    const lists = await Promise.all([...new Set(projectIds)].map(async (projectId) => {
      const raw = await this.call("automations_list", { projectId }, z.unknown()).catch(() => []);
      return (Array.isArray(raw) ? raw : []).flatMap((entry) => { const parsed = automationRow.safeParse(entry); return parsed.success ? [{ ...parsed.data, projectId }] : []; });
    }));
    return lists.flat();
  }

  private view(row: RunnerRow, automation?: AutomationRow): RunnerView {
    return {
      id: row.id, name: row.name, job: row.job, threadId: row.thread_id, state: row.state, adopted: !!row.adopted,
      schedule: { cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}) },
      nextRunAt: row.state === "active" ? automation?.nextRunAt ?? null : null,
      lastRunAt: Math.max(automation?.lastRunAt ?? 0, row.last_run_at ?? 0) || null,
      lastLevel: row.last_level, lastReport: row.last_report, lastReportAt: row.last_report_at, urgent: !!row.urgent,
    };
  }

  async list(botId?: string): Promise<RunnerView[]> {
    const rows = this.rows(botId);
    const automations = await this.automations(rows.flatMap((row) => row.automation_project_id ? [row.automation_project_id] : []));
    return rows.map((row) => this.view(row, automations.find((each) => each.id === row.automation_id)));
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
  async create(input: { name: string; job: string; schedule: RunnerSchedule }, botId?: string): Promise<RunnerView> {
    const bot = this.bot(botId);
    const schedule = parseSchedule(input.schedule);
    const name = input.name.trim();
    if (this.rows(bot.id).some((row) => row.name.toLowerCase() === name.toLowerCase())) throw new Error(`You already have a runner named "${name}".`);
    const id = `run_${Math.random().toString(36).slice(2, 12)}`;
    const now = Date.now();
    // The row comes first, so the thread's first turn gets runner instructions (forThread by metadata).
    this.deps.db.prepare(`INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, cron, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?, ?, ?)`).run(id, bot.id, name, input.job.trim(), PERSONAL_PROJECT_ID, schedule.cadence, schedule.time, schedule.cron ?? null, now, now);
    try {
      const [botThread, defaults] = await Promise.all([
        this.deps.sdk.threads.get({ threadId: bot.threadId }),
        this.deps.sdk.threads.defaultExecutionOptions({ threadId: bot.threadId }).catch(() => null),
      ]);
      // No parentThreadId and no lifecycle owner: BB posts nothing to the Bot (see the top of this file).
      const thread = await this.deps.sdk.threads.spawn({
        projectId: PERSONAL_PROJECT_ID,
        title: `${name} · Runner`,
        environment: { type: "project-default" },
        ...(botThread.providerId ? { providerId: botThread.providerId } : {}),
        ...(defaults?.model ? { model: defaults.model } : {}),
        pluginMetadata: { runner: id, bot: bot.id },
        input: [{ type: "text", text: `${runnerPrompt({ name, job: input.job })}\nThis is your first run.`, mentions: [] }],
      } as never);
      this.deps.db.prepare("UPDATE bot_runners SET thread_id = ?, project_id = ?, last_run_at = ? WHERE id = ?").run(thread.id, thread.projectId ?? PERSONAL_PROJECT_ID, now, id);
      await this.provision(this.row(id));
    } catch (error) {
      const row = this.deps.db.prepare("SELECT * FROM bot_runners WHERE id = ?").get(id) as RunnerRow | undefined;
      if (row?.automation_id) await this.call("automations_delete", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown()).catch(() => {});
      if (row?.thread_id) await this.deps.sdk.threads.archive({ threadId: row.thread_id }).catch(() => {});
      this.deps.db.prepare("DELETE FROM bot_runners WHERE id = ?").run(id);
      throw error;
    }
    this.deps.changed();
    return this.one(id);
  }

  private async one(id: string): Promise<RunnerView> {
    const row = this.row(id);
    return (await this.list(row.bot_id)).find((each) => each.id === row.id) ?? this.view(row);
  }

  /** Makes or updates the runner's automation to match its row (adopted runners keep their prompt). */
  private async provision(row: RunnerRow): Promise<void> {
    if (!row.thread_id) throw new Error("This runner has no thread.");
    const [thread, defaults] = await Promise.all([this.deps.sdk.threads.get({ threadId: row.thread_id }), this.deps.sdk.threads.defaultExecutionOptions({ threadId: row.thread_id }).catch(() => null)]);
    const trigger = { triggerType: "schedule", cron: heartbeatCron({ enabled: true, cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}) }), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const projectId = row.automation_project_id ?? thread.projectId;
    if (row.adopted && row.automation_id) {
      await this.call("automations_update", { projectId, automationId: row.automation_id, trigger }, z.unknown());
    } else {
      if (!thread.providerId || !defaults?.model) throw new Error("Choose a provider and model for the runner's thread first.");
      const execution = {
        mode: "agent", providerId: thread.providerId, model: defaults.model, reasoningLevel: defaults.reasoningLevel ?? "medium",
        permissionMode: defaults.permissionMode ?? "accept-edits", environment: { type: "project-default" }, targetThreadId: row.thread_id, prompt: runnerPrompt(row),
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
    await this.call(row.state === "active" ? "automations_resume" : "automations_pause", { projectId: row.automation_project_id ?? projectId, automationId: row.automation_id }, z.unknown());
  }

  async update(input: { id: string; name?: string; job?: string; schedule?: RunnerSchedule }, botId?: string): Promise<RunnerView> {
    const row = this.row(input.id, botId);
    const schedule = input.schedule ? parseSchedule(input.schedule) : null;
    const name = input.name?.trim();
    if (name && name.toLowerCase() !== row.name.toLowerCase() && this.rows(row.bot_id).some((each) => each.name.toLowerCase() === name.toLowerCase())) throw new Error(`You already have a runner named "${name}".`);
    const next: RunnerRow = { ...row, ...(name ? { name } : {}), ...(input.job?.trim() ? { job: input.job.trim() } : {}), ...(schedule ? { cadence: schedule.cadence, time: schedule.time, cron: schedule.cron ?? null } : {}) };
    // The automation first: if it refuses the schedule, nothing changes.
    if (schedule || (!row.adopted && (next.name !== row.name || next.job !== row.job))) await this.provision(next);
    if (next.name !== row.name && row.thread_id && !row.adopted) await this.deps.sdk.threads.update({ threadId: row.thread_id, title: `${next.name} · Runner` } as never).catch(() => {});
    this.changedRow(row.id, { name: next.name, job: next.job, cadence: next.cadence, time: next.time, cron: next.cron });
    return this.one(row.id);
  }

  async setState(id: string, state: "active" | "paused", botId?: string): Promise<RunnerView> {
    const row = this.row(id, botId);
    if (state === "active") this.bot(row.bot_id);
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
    if (row.automation_id) await this.call("automations_resume", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown());
    this.changedRow(row.id, { state: "active" });
    return true;
  }

  /** Runs it now, through its automation (so the run counts like a scheduled one). */
  async runNow(id: string, botId?: string): Promise<RunnerView> {
    const row = this.row(id, botId);
    this.bot(row.bot_id);
    if (!row.automation_id) throw new Error("This runner has no schedule to run.");
    await this.call("automations_run", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown());
    this.changedRow(row.id, { last_run_at: Date.now() });
    return this.one(row.id);
  }

  /**
   * A runner Studio made: deletes its automation and archives its thread
   * (history kept). An adopted runner is only let go: its thread and
   * automation stay as they were before adopting, minus the reporting note.
   */
  async delete(id: string, botId?: string): Promise<{ deleted: true; kept: boolean }> {
    const row = this.row(id, botId);
    if (row.adopted) {
      if (row.automation_id) {
        const automation = (await this.automations([row.automation_project_id ?? row.project_id])).find((each) => each.id === row.automation_id);
        const prompt = automation?.execution.prompt;
        if (prompt?.includes(ADOPT_NOTE)) await this.call("automations_update", { projectId: row.automation_project_id, automationId: row.automation_id, execution: { ...automation!.execution, prompt: prompt.replace(ADOPT_NOTE, "") } }, z.unknown()).catch(() => {});
      }
    } else {
      if (row.automation_id) await this.call("automations_delete", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
      if (row.thread_id) await this.deps.sdk.threads.archive({ threadId: row.thread_id }).catch(() => {});
    }
    this.deps.db.prepare("DELETE FROM bot_runners WHERE id = ?").run(row.id);
    this.deps.changed();
    return { deleted: true, kept: !!row.adopted };
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
    this.changedRow(row.id, { last_level: input.level, last_report: summary, last_report_at: now, last_run_at: now, ...(input.level === "urgent" ? { urgent: 1 } : {}) });
    if (input.level === "log") return "Logged. Finish without a final message.";
    const bot = this.deps.bot(row.bot_id);
    if (!bot?.threadId) return "Logged; the Bot has no thread to tell. Finish without a final message.";
    // A plain message from this thread (senderThreadId), with an agent-only
    // note so the Bot doesn't answer it: the user reads the line as it is.
    await this.deps.sdk.threads.send({
      threadId: bot.threadId, mode: "auto", senderThreadId: threadId,
      input: [
        { type: "text", text: tellLine(row.name, input.level, summary), mentions: [] },
        { type: "text", text: "Runner report, already shown to the user as is. Don't reply or acknowledge it; finish without a final message unless it asks you to act on something.", mentions: [], visibility: "agent-only" },
      ],
    } as never);
    if (input.level === "urgent") {
      await this.deps.sdk.plugins.callRpc({
        pluginId: "mobile", method: "notify", outputSchema: z.unknown(),
        // turn-finished on the Bot's thread: the phone shows its Reply action, and a reply goes to the Bot.
        input: { title: `${bot.name} · ${row.name}`, body: summary.slice(0, 4000), kind: "turn-finished", threadId: bot.threadId, projectId: PERSONAL_PROJECT_ID, coalesceKey: `runner:${row.id}` } as never,
      }).catch(() => {});
    }
    return input.level === "urgent" ? "Told the user and pushed to their phone. Finish without a final message." : "Told the user. Finish without a final message.";
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
   * prompt, and detaches the thread from the Bot (one BB "removed" notice,
   * then no more child notices).
   */
  async adopt(input: { threadId: string; automationId: string; name?: string; job?: string }, botId?: string): Promise<RunnerView> {
    const bot = this.bot(botId);
    if (this.threadIds().has(input.threadId)) throw new Error("That thread is already a runner.");
    const candidate = (await this.adoptable(bot.id)).find((each) => each.threadId === input.threadId && each.automationId === input.automationId);
    if (!candidate) throw new Error("That thread isn't one your Bot started with an automation waking it.");
    const automation = (await this.automations([candidate.projectId])).find((each) => each.id === candidate.automationId)!;
    const name = (input.name?.trim() || candidate.title.replace(/\s*·\s*Runner$/i, "")).slice(0, 60);
    const prompt = automation.execution.prompt ?? "";
    const job = (input.job?.trim() || prompt.split("\n")[0]?.trim() || "Follow your automation's prompt.").slice(0, 2000);
    const cron = automation.trigger.cron ?? "0 9 * * *";
    const now = Date.now();
    const id = `run_${Math.random().toString(36).slice(2, 12)}`;
    if (!prompt.includes(ADOPT_NOTE)) await this.call("automations_update", { projectId: candidate.projectId, automationId: automation.id, execution: { ...automation.execution, prompt: `${prompt}${ADOPT_NOTE}` } }, z.unknown());
    this.deps.db.prepare(`INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, cron, automation_id, automation_project_id, adopted, last_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'custom', '09:00', ?, ?, ?, 1, ?, ?, ?)`)
      .run(id, bot.id, name, job, input.threadId, candidate.projectId, automation.enabled ? "active" : "paused", cron, automation.id, candidate.projectId, automation.lastRunAt ?? null, now, now);
    const thread = await this.deps.sdk.threads.get({ threadId: input.threadId }).catch(() => null);
    if (thread?.parentThreadId) await this.deps.sdk.threads.update({ threadId: input.threadId, parentThreadId: null } as never).catch(() => {});
    this.deps.changed();
    return this.one(id);
  }
}

/** A schedule as the bot or the UI gives it: cadence, time (default 09:00), cron for custom. */
export function parseSchedule(schedule: RunnerSchedule | { cadence: HeartbeatRun["cadence"]; time?: string; cron?: string }): RunnerSchedule {
  const run = heartbeatRunSchema.parse({ enabled: true, time: "09:00", ...schedule });
  if (run.cadence === "custom" && !run.cron) throw new Error("A custom schedule needs a five-field cron expression.");
  return { cadence: run.cadence, time: run.time, ...(run.cadence === "custom" ? { cron: run.cron } : {}) };
}
