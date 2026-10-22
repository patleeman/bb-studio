// Bot automations: one list of what wakes a Bot, in four kinds.
//
//   check-in  wakes the Bot's own thread with a short instruction, on a
//             schedule. Several are fine (Morning brief 8:00, Evening
//             wrap-up 18:00). The Bot's original check-in (its project
//             heartbeat, src/project-lead.ts) is listed as the check-in
//             "Check-in" (id `heartbeat`); its schedule and automation are
//             kept as they were, and editing it keeps it a heartbeat.
//   runner    a runner (src/runners.ts), listed here and managed there.
//   reminder  one message to the Bot's thread at a time (--at), once.
//   watcher   a script BB runs on the server host on a schedule. It wakes
//             the Bot only when it finds something: exit 0 with stdout →
//             Studio posts the stdout to the Bot's thread (or a runner's)
//             and the agent wakes; empty stdout, a last line of
//             {"wakeAgent": false} (BB's own convention) or a non-zero exit
//             → nothing, no tokens.
//
// Each Studio automation is one row here and one or more BB automations: a
// schedule compiles to as few crons as express it (src/schedule.ts), and
// Studio pauses, resumes, runs and deletes them together.
//
// Why watchers are polled: BB runs the script (no agent) and keeps its
// output on the run; plugins get no event when a run ends. Studio reads each
// active watcher's recent runs every minute (automations_runs) and posts
// the ones with output it hasn't seen. The script needs no bb CLI, token or
// callback, and a missed minute is caught up on the next poll.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { BotAutomationRunView, BotAutomationView, HeartbeatRun } from "./contract";
import { resumeLog } from "./auto-resume";
import { compileSchedule, describeSchedule, endOfDay, fromHeartbeat, localZone, type Schedule, type Trigger } from "./schedule";

type Sdk = BbPluginApi["sdk"];
export type AutomationKind = "checkin" | "runner" | "reminder" | "watcher";
export type Interpreter = "bash" | "sh" | "node" | "python3";
const PERSONAL = "proj_personal";
/** The [PASS] rule every wake-up prompt carries (docs/silent-output.md). */
export const PASS_RULE = "If nothing needs the user, reply exactly [PASS]: no \"✓\", \"nothing new\" or other filler.";
const OUTPUT_LIMIT = 1500;
const missing = (error: unknown) => (error as { status?: number })?.status === 404 || /not found/i.test(String((error as Error)?.message ?? ""));

type Row = {
  id: string; bot_id: string; kind: "checkin" | "reminder" | "watcher"; name: string; instruction: string;
  script: string | null; interpreter: string | null; timeout_ms: number | null; env_json: string | null; working_dir: string | null;
  target: string; schedule_json: string; provider_id: string | null; model: string | null; reasoning: string | null;
  state: "active" | "paused" | "done" | "ended"; project_id: string; bb_ids: string; target_thread_id: string | null;
  resources: string | null; provision_pending: number; cleanup_pending: number; seen_ids: string; seen_until: number; last_fired_at: number | null; last_fire: string | null; created_at: number; updated_at: number;
};

const bbAutomation = z.object({
  id: z.string(), enabled: z.boolean(), nextRunAt: z.number().nullish(), lastRunAt: z.number().nullish(),
  lastRunStatus: z.string().nullish(), trigger: z.object({ triggerType: z.string().optional(), cron: z.string().optional() }).passthrough(),
}).passthrough();
type BbAutomation = z.infer<typeof bbAutomation>;
const bbRun = z.object({
  id: z.string(), status: z.string(), trigger: z.string().nullish(), threadId: z.string().nullish(), skipReason: z.string().nullish(),
  error: z.string().nullish(), output: z.string().nullish(), exitCode: z.number().nullish(), scheduledFor: z.number().nullish(),
  startedAt: z.number().nullish(), finishedAt: z.number().nullish(),
}).passthrough();
type BbRun = z.infer<typeof bbRun>;

/** The prompt a check-in sends the Bot's thread. */
export function checkinPrompt(name: string, instruction: string): string {
  return `Check-in "${name}": ${instruction.trim()}\nDo the checks yourself; tell the user only what changed or needs them. ${PASS_RULE}`;
}

/** The prompt a reminder sends the Bot's thread. */
export function reminderPrompt(name: string, instruction: string, setAt: number): string {
  return `Reminder "${name}" (set ${new Date(setAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}): ${instruction.trim()}\nDo it now, or tell the user in a line if it's theirs to do.`;
}

/** What a watcher's run with output posts: a visible line, and a note for the agent. */
export function watcherMessage(name: string, output: string, instruction: string, toRunner: boolean): { text: string; note: string } {
  const trimmed = output.trim();
  const text = `Watcher ${name}: ${trimmed.length > OUTPUT_LIMIT ? `${trimmed.slice(0, OUTPUT_LIMIT - 1)}…` : trimmed}`;
  const what = instruction.trim() ? ` What to do with it: ${instruction.trim()}` : "";
  const note = toRunner
    ? `Your watcher's script found the output above.${what} Handle it as a run of your job and report through runner_report as usual.`
    : `Your watcher's script found the output above; the user sees it as is.${what} Act on it or tell the user what matters in a line. ${PASS_RULE}`;
  return { text, note };
}

/** Whether a watcher's run should wake the agent, and with what. */
export function watcherFinding(run: Pick<BbRun, "status" | "output" | "exitCode">): string | null {
  if (run.status !== "succeeded" || (run.exitCode ?? 0) !== 0) return null;
  const output = (run.output ?? "").trim();
  if (!output) return null;
  const last = output.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  try { if (JSON.parse(last)?.wakeAgent === false) return null; } catch { /* Not JSON: output. */ }
  return output;
}

/** One run in words, for the list and the bot. */
export function runOutcome(kind: AutomationKind, run: BbRun): string {
  if (run.status === "failed") return run.error ? `Failed: ${run.error}` : "Failed";
  if (run.status === "skipped") return kind === "watcher" ? "Nothing new" : `Skipped${run.skipReason ? ` (${run.skipReason})` : ""}`;
  if (run.status === "running" || run.status === "pending" || run.status === "queued") return "Running";
  if (kind === "watcher") { const found = watcherFinding(run); return found ? `Woke it: ${found.split("\n")[0]!.slice(0, 200)}` : "Nothing new"; }
  return run.status === "succeeded" ? "Ran" : run.status;
}

export interface AutomationBot { id: string; name: string; threadId: string | null; state: string; primary: boolean; kind: string }
export interface AutomationRunner {
  id: string; name: string; job: string; threadId: string | null; state: "active" | "paused";
  schedule: { cadence: HeartbeatRun["cadence"]; time: string; cron?: string; timezone?: string }; nextRunAt: number | null; lastRunAt: number | null;
  lastReport: string | null; lastLevel: string | null; lastReportAt: number | null;
}
export interface AutomationDeps {
  db: Database.Database;
  sdk: Sdk;
  changed(): void;
  bot(botId?: string): AutomationBot | null;
  /** The Bot's original check-in (its project heartbeat) and its automation. */
  heartbeat: {
    get(botId: string): HeartbeatRun | null;
    set(botId: string, run: HeartbeatRun): Promise<void>;
    automation(botId: string): { id: string; projectId: string } | null;
  };
  runners: {
    list(botId: string): Promise<AutomationRunner[]>;
    create(input: { name: string; job: string; schedule: { cadence: HeartbeatRun["cadence"]; time: string; cron?: string } }, botId: string): Promise<AutomationRunner>;
    update(input: { id: string; name?: string; job?: string; schedule?: { cadence: HeartbeatRun["cadence"]; time: string; cron?: string } }, botId: string): Promise<AutomationRunner>;
    setState(id: string, state: "active" | "paused", botId: string): Promise<AutomationRunner>;
    runNow(id: string, botId: string): Promise<AutomationRunner>;
    delete(id: string, botId: string): Promise<unknown>;
    automation(id: string): { id: string; projectId: string } | null;
  };
  /** Built-in daily Bot maintenance (src/bot-maintenance.ts); null for an external bot. */
  maintenance?: {
    get(botId: string): { paused: boolean; lastRunAt: number | null; lastOutcome: string | null; nextRunAt: number | null } | null;
    setPaused(botId: string, paused: boolean): Promise<void>;
    run(botId: string): Promise<void>;
  };
}

export type ScriptInput = { body: string; interpreter: Interpreter; timeoutMs?: number; env?: Record<string, string>; workingDirectory?: string | null };
export type CreateInput = {
  kind: AutomationKind; name: string; instruction?: string; schedule: Schedule;
  model?: { model?: string | null; reasoning?: string | null } | null;
  script?: ScriptInput | null;
  /** A watcher's target: the Bot's thread ("main", the default) or a runner id. */
  target?: string | null;
};
export type UpdateInput = Partial<Omit<CreateInput, "kind">> & { id: string };

const HEARTBEAT_ID = "heartbeat";
const MAINTENANCE_ID = "maintenance";
const MAINTENANCE_SCHEDULE: Schedule = { type: "cron", cron: "0 4 * * *" };
const HEARTBEAT_NAME = "Check-in";

/** A Bot's runner schedule from a compiled schedule: one cron in the server's timezone. */
function runnerSchedule(schedule: Schedule): { cadence: "custom"; time: string; cron: string } {
  const triggers = compileSchedule(schedule);
  const only = triggers[0];
  if (triggers.length !== 1 || only?.triggerType !== "schedule") throw new Error("A runner (and the original check-in) takes one repeating cron; simplify the times, or make a check-in instead.");
  if (only.timezone !== localZone()) throw new Error(`This one runs in the server's timezone (${localZone()}).`);
  if (schedule.type !== "once" && schedule.until) throw new Error("This one has no end date; pause or delete it instead.");
  return { cadence: "custom", time: "09:00", cron: only.cron };
}

export class Automations {
  private ticking: Promise<void> | null = null;
  private readonly watching = new Set<string>();
  constructor(private readonly deps: AutomationDeps) {}

  private call<T>(method: string, input: unknown, schema: z.ZodType<T>) {
    return this.deps.sdk.plugins.callRpc({ pluginId: "automations", method, input: input as never, outputSchema: schema });
  }

  private bot(botId?: string): AutomationBot {
    const bot = this.deps.bot(botId);
    if (!bot) throw new Error("Make your Bot first.");
    return bot;
  }

  private rows(botId: string): Row[] {
    return this.deps.db.prepare("SELECT * FROM bot_automations WHERE bot_id = ? ORDER BY created_at, id").all(botId) as Row[];
  }

  private row(id: string, botId: string): Row {
    const row = (this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ? AND bot_id = ?").get(id, botId)
      ?? this.rows(botId).find((each) => each.name.toLowerCase() === id.toLowerCase())) as Row | undefined;
    if (!row) throw new Error(`No automation "${id}".`);
    return row;
  }

  private resources(row: Row): { id: string; projectId: string }[] {
    return row.resources ? JSON.parse(row.resources) : (JSON.parse(row.bb_ids) as string[]).map((id) => ({ id, projectId: row.project_id }));
  }

  private ids(row: Row): string[] { return this.resources(row).map((r) => r.id); }

  private saveResources(row: Row, resources: { id: string; projectId: string }[]): void {
    this.save(row.id, { resources: JSON.stringify(resources), bb_ids: JSON.stringify(resources.map((r) => r.id)) });
  }

  private save(id: string, fields: Partial<Row>): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.deps.db.prepare(`UPDATE bot_automations SET ${keys.map((key) => `${key} = @${key}`).join(", ")}, updated_at = @updated_at WHERE id = @id`).run({ ...fields, updated_at: Date.now(), id });
    this.deps.changed();
  }

  private async bbList(projectIds: Iterable<string>): Promise<Map<string, BbAutomation>> {
    const lists = await Promise.all([...new Set(projectIds)].map(async (projectId) => {
      const raw = await this.call("automations_list", { projectId }, z.unknown()).catch(() => []);
      return (Array.isArray(raw) ? raw : []).flatMap((entry) => { const parsed = bbAutomation.safeParse(entry); return parsed.success ? [parsed.data] : []; });
    }));
    return new Map(lists.flat().map((each) => [each.id, each]));
  }

  /** What an agent kind runs on: the Bot thread's provider, and its model unless the automation picks a cheaper one. */
  private async agentExecution(row: Row, threadId: string, prompt: string) {
    const [thread, defaults] = await Promise.all([this.deps.sdk.threads.get({ threadId }), this.deps.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null)]);
    const model = row.model ?? defaults?.model;
    if (!thread.providerId || !model) throw new Error("Choose a provider and model for the Bot's thread first.");
    return {
      projectId: thread.projectId ?? PERSONAL,
      execution: {
        mode: "agent", providerId: thread.providerId, model, reasoningLevel: row.reasoning ?? defaults?.reasoningLevel ?? "medium",
        permissionMode: defaults?.permissionMode ?? "accept-edits", environment: { type: "project-default" }, targetThreadId: threadId, prompt,
      },
    };
  }

  private scriptExecution(row: Row) {
    const dir = row.working_dir?.trim();
    return {
      mode: "script", script: row.script ?? "", interpreter: row.interpreter ?? "bash", timeoutMs: row.timeout_ms ?? 120_000,
      ...(row.env_json ? { env: JSON.parse(row.env_json) as Record<string, string> } : {}),
      workingDirectory: !dir || dir === "automation-storage" ? { type: "automation-storage" } : dir === "project" ? { type: "project" } : { type: "path", path: dir },
    };
  }

  /** Makes, updates or deletes the row's BB automations to match it, then pauses or resumes them. Throws before saving on a bad schedule. */
  private async provision(row: Row): Promise<Row> {
    const bot = this.bot(row.bot_id);
    const schedule = JSON.parse(row.schedule_json) as Schedule;
    const triggers: Trigger[] = compileSchedule(schedule);
    let projectId = PERSONAL;
    let execution: Record<string, unknown>;
    let target: string | null = null;
    if (row.kind === "watcher") {
      if (!row.script?.trim()) throw new Error("A watcher needs a script.");
      execution = this.scriptExecution(row);
    } else {
      if (!bot.threadId) throw new Error(`${bot.name} has no thread yet.`);
      target = bot.threadId;
      const prompt = row.kind === "checkin" ? checkinPrompt(row.name, row.instruction) : reminderPrompt(row.name, row.instruction, row.created_at);
      ({ projectId, execution } = await this.agentExecution(row, bot.threadId, prompt));
    }
    // The row describes the desired configuration until the complete group is applied.
    this.save(row.id, { provision_pending: 1 });
    const current = this.resources(row);
    const resources = [...current];
    const next: { id: string; projectId: string }[] = [];
    const name = (i: number) => `${bot.name} · ${row.name}${triggers.length > 1 ? ` (${i + 1}/${triggers.length})` : ""}`;
    for (const [i, trigger] of triggers.entries()) {
      let id: string | null = resources[i]?.id ?? null;
      if (id && resources[i]!.projectId !== projectId) {
        await this.call("automations_delete", { projectId: resources[i]!.projectId, automationId: id }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
        // Remove the old identity before creating its replacement in another project.
        resources.splice(i, 1, { id: "", projectId });
        this.saveResources(row, resources.filter((r) => r.id));
        id = null;
      }
      if (id) await this.call("automations_update", { projectId, automationId: id, name: name(i), trigger, execution }, z.unknown()).catch((error) => { if (!missing(error)) throw error; id = null; });
      if (!id) id = (await this.call("automations_create", { projectId, name: name(i), enabled: false, origin: "app", trigger, execution }, z.object({ id: z.string() }))).id;
      next.push({ id, projectId });
      resources[i] = { id, projectId };
      this.saveResources(row, resources.filter((r) => r.id));
    }
    for (const resource of current.slice(triggers.length)) {
      await this.call("automations_delete", { projectId: resource.projectId, automationId: resource.id }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
      resources.splice(resources.findIndex((r) => r.id === resource.id), 1);
      this.saveResources(row, resources.filter((r) => r.id));
    }
    const on = row.state === "active" && bot.state === "active";
    for (const resource of next) await this.call(on ? "automations_resume" : "automations_pause", { projectId: resource.projectId, automationId: resource.id }, z.unknown());
    this.save(row.id, { bb_ids: JSON.stringify(next.map((r) => r.id)), resources: JSON.stringify(next), project_id: projectId, target_thread_id: target, provision_pending: 0 });
    return this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ?").get(row.id) as Row;
  }

  private async setBb(row: Row, on: boolean): Promise<void> {
    for (const resource of this.resources(row)) {
      await this.call(on ? "automations_resume" : "automations_pause", { projectId: resource.projectId, automationId: resource.id }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
    }
  }

  // ---- The list ----

  async list(botId?: string, onlyId?: string): Promise<BotAutomationView[]> {
    const bot = this.bot(botId);
    const rows = this.rows(bot.id).filter((row) => !onlyId || row.id === onlyId);
    const heartbeat = bot.kind === "external" && !this.deps.heartbeat.get(bot.id) ? null : this.deps.heartbeat.get(bot.id);
    const hbAutomation = !onlyId || onlyId === HEARTBEAT_ID ? this.deps.heartbeat.automation(bot.id) : null;
    const runners = bot.kind === "external" || (onlyId && (rows.length || [HEARTBEAT_ID, MAINTENANCE_ID].includes(onlyId))) ? [] : await this.deps.runners.list(bot.id);
    const bb = await this.bbList([PERSONAL, ...rows.flatMap((row) => this.resources(row).map((r) => r.projectId)), ...(hbAutomation ? [hbAutomation.projectId] : [])]);
    const views: BotAutomationView[] = [];
    if (heartbeat) {
      const automation = hbAutomation ? bb.get(hbAutomation.id) : undefined;
      views.push({
        id: HEARTBEAT_ID, kind: "checkin", name: HEARTBEAT_NAME, original: true,
        instruction: "What your Memory page's Check-in section says.",
        schedule: fromHeartbeat(heartbeat), scheduleText: describeSchedule(fromHeartbeat(heartbeat)),
        state: heartbeat.enabled ? "active" : "paused", nextRunAt: heartbeat.enabled ? automation?.nextRunAt ?? null : null, lastRunAt: automation?.lastRunAt ?? null,
        lastOutcome: this.resumedSince(hbAutomation ? [hbAutomation.id] : [], automation?.lastRunAt) ?? automation?.lastRunStatus ?? null, model: null, script: null, target: "main", targetName: bot.name, threadId: bot.threadId,
      });
    }
    const maintenance = bot.kind === "external" ? null : this.deps.maintenance?.get(bot.id) ?? null;
    if (maintenance) {
      views.push({
        id: MAINTENANCE_ID, kind: "checkin", name: "Maintenance", original: false,
        instruction: "Daily at 4 AM local and after check-ins. Thread, automation, Memory and skill housekeeping. Starts with a one-day dry run.",
        schedule: MAINTENANCE_SCHEDULE, scheduleText: "Daily at 4 AM local", state: maintenance.paused ? "paused" : "active",
        nextRunAt: maintenance.paused ? null : maintenance.nextRunAt, lastRunAt: maintenance.lastRunAt, lastOutcome: maintenance.lastOutcome,
        model: null, script: null, target: "main", targetName: bot.name, threadId: null,
      });
    }
    for (const row of rows) {
      const automations = this.ids(row).map((id) => bb.get(id)).filter((each): each is BbAutomation => !!each);
      const next = automations.map((each) => each.nextRunAt ?? Infinity).reduce((a, b) => Math.min(a, b), Infinity);
      const last = automations.map((each) => each.lastRunAt ?? 0).reduce((a, b) => Math.max(a, b), 0);
      let state = row.state;
      // A reminder is done once BB has run it and has nothing left to run.
      if (row.kind === "reminder" && state === "active" && last && !automations.some((each) => each.nextRunAt)) { state = "done"; }
      const schedule = JSON.parse(row.schedule_json) as Schedule;
      const runner = row.target !== "main" ? runners.find((each) => each.id === row.target) : null;
      views.push({
        id: row.id, kind: row.kind, name: row.name, original: false, instruction: row.instruction,
        schedule, scheduleText: describeSchedule(schedule),
        state, nextRunAt: state === "active" && Number.isFinite(next) ? next : null, lastRunAt: Math.max(last, row.last_fired_at ?? 0) || null,
        lastOutcome: row.cleanup_pending ? "Cleanup incomplete; will retry" : row.provision_pending ? "Provisioning incomplete; will retry" : this.resumedSince(this.ids(row), Math.max(last, row.last_fired_at ?? 0)) ?? (row.kind === "watcher" && row.last_fire ? `Woke it: ${row.last_fire.split("\n")[0]!.slice(0, 200)}` : automations.find((each) => each.lastRunAt === last)?.lastRunStatus ?? null),
        model: row.kind === "watcher" ? null : { model: row.model, reasoning: row.reasoning },
        script: row.kind === "watcher" ? { body: row.script ?? "", interpreter: (row.interpreter ?? "bash") as Interpreter, timeoutMs: row.timeout_ms ?? 120_000, workingDirectory: row.working_dir ?? null, envKeys: row.env_json ? Object.keys(JSON.parse(row.env_json) as object) : [] } : null,
        target: row.target, targetName: runner?.name ?? bot.name, threadId: runner ? runner.threadId : bot.threadId,
      });
    }
    for (const runner of runners) {
      const schedule = fromHeartbeat(runner.schedule, runner.schedule.timezone);
      views.push({
        id: runner.id, kind: "runner", name: runner.name, original: false, instruction: runner.job, schedule, scheduleText: describeSchedule(schedule),
        state: runner.state, nextRunAt: runner.nextRunAt, lastRunAt: runner.lastRunAt,
        lastOutcome: runner.lastReport ? `${runner.lastLevel === "urgent" ? "Urgent" : runner.lastLevel === "tell" ? "Told you" : "Logged"}: ${runner.lastReport}` : null,
        model: null, script: null, target: "own", targetName: runner.name, threadId: runner.threadId,
      });
    }
    return views;
  }

  /** Studio's latest auto-resume (src/auto-resume.ts) of these BB automations, when it came after their last run. */
  private resumedSince(bbIds: string[], lastRunAt: number | null | undefined): string | null {
    const latest = resumeLog(this.deps.db, bbIds, 1)[0];
    return latest && latest.at > (lastRunAt ?? 0) ? latest.message : null;
  }

  /** The BB automations of check-ins and watchers, for auto-resume (src/auto-resume.ts): on while the row and its Bot are active. Reminders run once and aren't resumed. */
  resumeTargets(): { automationId: string; projectId: string; botId: string; ownerId: string; name: string; on: boolean }[] {
    const rows = this.deps.db.prepare("SELECT * FROM bot_automations WHERE kind != 'reminder'").all() as Row[];
    return rows.flatMap((row) => {
      const on = !row.cleanup_pending && !row.provision_pending && row.state === "active" && this.deps.bot(row.bot_id)?.state === "active";
      return this.resources(row).map(({ id: automationId, projectId }) => ({ automationId, projectId, botId: row.bot_id, ownerId: row.id, name: row.name, on }));
    });
  }

  /** Check-ins and reminders follow the Bot's thread when it's handed off. */
  async follow(bot: AutomationBot): Promise<void> {
    if (!bot.threadId) return;
    for (const row of this.rows(bot.id)) {
      if (row.cleanup_pending || row.provision_pending || row.kind === "watcher" || row.state !== "active" || !row.target_thread_id || row.target_thread_id === bot.threadId) continue;
      await this.provision(row).catch((error) => console.warn(`[studio] automation ${row.id} didn't follow the Bot's thread`, error));
    }
  }

  // ---- Changes ----

  async create(input: CreateInput, botId?: string): Promise<BotAutomationView> {
    const bot = this.bot(botId);
    if (bot.state !== "active") throw new Error(`${bot.name} is ${bot.state}. Resume it first.`);
    const name = input.name.trim();
    if (!name) throw new Error("Give it a name.");
    if (input.kind === "runner") {
      const runner = await this.deps.runners.create({ name, job: (input.instruction ?? "").trim(), schedule: runnerSchedule(input.schedule) }, bot.id);
      return this.one(runner.id, bot.id);
    }
    if (input.kind === "reminder" && input.schedule.type !== "once") throw new Error("A reminder is one time (at or in); make a check-in for a repeating one.");
    if (input.kind !== "reminder" && input.schedule.type === "once") throw new Error("Use a reminder for one time.");
    if (input.kind !== "watcher" && !input.instruction?.trim()) throw new Error("Say what it should do.");
    if (input.kind === "watcher" && !input.script?.body.trim()) throw new Error("A watcher needs a script.");
    if (this.rows(bot.id).some((row) => row.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === HEARTBEAT_NAME.toLowerCase()) throw new Error(`There's already an automation named "${name}".`);
    const target = input.kind === "watcher" ? this.target(input.target, bot.id) : "main";
    compileSchedule(input.schedule);
    const id = `aut_${Math.random().toString(36).slice(2, 12)}`;
    const now = Date.now();
    this.deps.db.prepare(`INSERT INTO bot_automations (id, bot_id, kind, name, instruction, script, interpreter, timeout_ms, env_json, working_dir, target, schedule_json, provider_id, model, reasoning, state, project_id, bb_ids, seen_until, created_at, updated_at)
      VALUES (@id, @bot_id, @kind, @name, @instruction, @script, @interpreter, @timeout_ms, @env_json, @working_dir, @target, @schedule_json, NULL, @model, @reasoning, 'active', @project_id, '[]', @now, @now, @now)`).run({
      id, bot_id: bot.id, kind: input.kind, name, instruction: (input.instruction ?? "").trim(),
      ...this.scriptFields(input.script), target, schedule_json: JSON.stringify(input.schedule),
      model: input.kind === "watcher" ? null : input.model?.model || null, reasoning: input.kind === "watcher" ? null : input.model?.reasoning || null, project_id: PERSONAL, now,
    });
    try {
      await this.provision(this.row(id, bot.id));
    } catch (error) {
      this.save(id, { cleanup_pending: 1, provision_pending: 0, state: "paused" });
      await this.delete(id, bot.id).catch((cleanupError) => console.warn(`[studio] automation ${id} cleanup pending`, cleanupError));
      throw error;
    }
    this.deps.changed();
    return this.one(id, bot.id);
  }

  private scriptFields(script: ScriptInput | null | undefined) {
    if (!script) return { script: null, interpreter: null, timeout_ms: null, env_json: null, working_dir: null };
    if (!["bash", "sh", "node", "python3"].includes(script.interpreter)) throw new Error("The interpreter is bash, sh, node or python3.");
    const timeout = script.timeoutMs ?? 120_000;
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 900_000) throw new Error("The timeout is between 1 second and 15 minutes.");
    return {
      script: script.body, interpreter: script.interpreter, timeout_ms: timeout,
      env_json: script.env && Object.keys(script.env).length ? JSON.stringify(script.env) : null, working_dir: script.workingDirectory?.trim() || null,
    };
  }

  private target(target: string | null | undefined, botId: string): string {
    if (!target || target === "main") return "main";
    const runner = this.deps.db.prepare("SELECT id FROM bot_runners WHERE bot_id = ? AND (id = ? OR lower(name) = lower(?))").get(botId, target, target) as { id: string } | undefined;
    if (!runner) throw new Error(`No runner "${target}" to wake.`);
    return runner.id;
  }

  private async one(id: string, botId: string): Promise<BotAutomationView> {
    const found = (await this.list(botId, id)).find((each) => each.id === id);
    if (!found) throw new Error(`No automation "${id}".`);
    return found;
  }

  private isRunner(id: string, botId: string): string | null {
    const row = this.deps.db.prepare("SELECT id FROM bot_runners WHERE bot_id = ? AND (id = ? OR lower(name) = lower(?))").get(botId, id, id) as { id: string } | undefined;
    return row?.id ?? null;
  }

  async update(input: UpdateInput, botId?: string): Promise<BotAutomationView> {
    const bot = this.bot(botId);
    if (input.id === MAINTENANCE_ID) throw new Error("Maintenance settings are in Bot info → Maintenance.");
    if (input.id === HEARTBEAT_ID) {
      const run = this.deps.heartbeat.get(bot.id);
      if (!run) throw new Error("This Bot has no original check-in.");
      if (input.name && input.name !== HEARTBEAT_NAME) throw new Error("The original check-in keeps its name; its instruction is your Memory page's Check-in section.");
      if (input.schedule) await this.deps.heartbeat.set(bot.id, { ...run, ...runnerSchedule(input.schedule), enabled: run.enabled });
      return this.one(HEARTBEAT_ID, bot.id);
    }
    const runnerId = this.isRunner(input.id, bot.id);
    if (runnerId) {
      await this.deps.runners.update({ id: runnerId, ...(input.name ? { name: input.name } : {}), ...(input.instruction ? { job: input.instruction } : {}), ...(input.schedule ? { schedule: runnerSchedule(input.schedule) } : {}) }, bot.id);
      return this.one(runnerId, bot.id);
    }
    const row = this.row(input.id, bot.id);
    const name = input.name?.trim();
    if (name && name.toLowerCase() !== row.name.toLowerCase() && this.rows(bot.id).some((each) => each.name.toLowerCase() === name.toLowerCase())) throw new Error(`There's already an automation named "${name}".`);
    if (input.schedule) {
      if (row.kind === "reminder" && input.schedule.type !== "once") throw new Error("A reminder is one time.");
      if (row.kind !== "reminder" && input.schedule.type === "once") throw new Error("Use a reminder for one time.");
    }
    const next: Row = {
      ...row,
      ...(name ? { name } : {}),
      ...(input.instruction !== undefined ? { instruction: input.instruction.trim() } : {}),
      ...(input.schedule ? { schedule_json: JSON.stringify(input.schedule) } : {}),
      ...(input.model !== undefined && row.kind !== "watcher" ? { model: input.model?.model || null, reasoning: input.model?.reasoning || null } : {}),
      ...(input.script && row.kind === "watcher" ? this.scriptFields(input.script) : {}),
      ...(input.target !== undefined && row.kind === "watcher" ? { target: this.target(input.target, bot.id) } : {}),
      // A new time brings a done reminder or an ended schedule back.
      ...(input.schedule && (row.state === "done" || row.state === "ended") ? { state: "active" as const } : {}),
    };
    if (next.kind !== "watcher" && !next.instruction) throw new Error("Say what it should do.");
    compileSchedule(JSON.parse(next.schedule_json) as Schedule);
    if (next.kind === "watcher" && !next.script?.trim()) throw new Error("A watcher needs a script.");
    if (next.kind !== "watcher") {
      if (!bot.threadId) throw new Error(`${bot.name} has no thread yet.`);
      await this.agentExecution(next, bot.threadId, "");
    }
    this.save(row.id, { name: next.name, instruction: next.instruction, schedule_json: next.schedule_json, model: next.model, reasoning: next.reasoning, script: next.script, interpreter: next.interpreter, timeout_ms: next.timeout_ms, env_json: next.env_json, working_dir: next.working_dir, target: next.target, state: next.state, provision_pending: 1 });
    await this.provision(this.row(row.id, bot.id));
    return this.one(row.id, bot.id);
  }

  async setState(id: string, state: "active" | "paused", botId?: string): Promise<BotAutomationView> {
    const bot = this.bot(botId);
    if (state === "active" && bot.state !== "active") throw new Error(`${bot.name} is ${bot.state}. Resume it first.`);
    if (id === MAINTENANCE_ID && this.deps.maintenance) { await this.deps.maintenance.setPaused(bot.id, state === "paused"); return this.one(MAINTENANCE_ID, bot.id); }
    if (id === HEARTBEAT_ID) {
      const run = this.deps.heartbeat.get(bot.id);
      if (!run) throw new Error("This Bot has no original check-in.");
      await this.deps.heartbeat.set(bot.id, { ...run, enabled: state === "active" });
      return this.one(HEARTBEAT_ID, bot.id);
    }
    const runnerId = this.isRunner(id, bot.id);
    if (runnerId) { await this.deps.runners.setState(runnerId, state, bot.id); return this.one(runnerId, bot.id); }
    const row = this.row(id, bot.id);
    if (row.state === "done" || row.state === "ended") throw new Error(state === "active" ? "It's over; give it a new time or end date to bring it back." : "It's already over.");
    if (state === "active") {
      // Its BB automations come back to match (a schedule may have changed while paused).
      await this.provision({ ...row, state });
    } else {
      await this.setBb(row, false);
    }
    this.save(row.id, { state });
    return this.one(row.id, bot.id);
  }

  async runNow(id: string, botId?: string): Promise<BotAutomationView> {
    const bot = this.bot(botId);
    if (bot.state !== "active") throw new Error(`${bot.name} is ${bot.state}. Resume it first.`);
    if (id === MAINTENANCE_ID && this.deps.maintenance) { await this.deps.maintenance.run(bot.id); return this.one(MAINTENANCE_ID, bot.id); }
    let target: { id: string; projectId: string } | null = null;
    if (id === HEARTBEAT_ID) target = this.deps.heartbeat.automation(bot.id);
    else {
      const runnerId = this.isRunner(id, bot.id);
      if (runnerId) { await this.deps.runners.runNow(runnerId, bot.id); return this.one(runnerId, bot.id); }
      const row = this.row(id, bot.id);
      target = this.resources(row)[0] ?? null;
    }
    if (!target) throw new Error("It has no schedule to run; turn it on first.");
    await this.call("automations_run", { projectId: target.projectId, automationId: target.id, idempotencyKey: `studio-${id}-${Date.now()}` }, z.unknown());
    return this.one(id === HEARTBEAT_ID ? HEARTBEAT_ID : this.isRunner(id, bot.id) ?? this.row(id, bot.id).id, bot.id);
  }

  async delete(id: string, botId?: string): Promise<{ deleted: true }> {
    const bot = this.bot(botId);
    if (id === MAINTENANCE_ID) throw new Error("Maintenance cannot be deleted; turn it off in Bot info.");
    if (id === HEARTBEAT_ID) {
      const run = this.deps.heartbeat.get(bot.id);
      if (run?.enabled) await this.deps.heartbeat.set(bot.id, { ...run, enabled: false });
      return { deleted: true };
    }
    const runnerId = this.isRunner(id, bot.id);
    if (runnerId) { await this.deps.runners.delete(runnerId, bot.id); return { deleted: true }; }
    const row = this.row(id, bot.id);
    this.save(row.id, { cleanup_pending: 1, provision_pending: 0 });
    const resources = this.resources(row);
    for (const resource of [...resources]) {
      await this.call("automations_delete", { projectId: resource.projectId, automationId: resource.id }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
      resources.splice(resources.indexOf(resource), 1);
      this.saveResources(row, resources);
    }
    this.deps.db.prepare("DELETE FROM bot_automations WHERE id = ?").run(row.id);
    this.deps.changed();
    return { deleted: true };
  }

  /** Recent runs of every BB automation behind one Studio automation, newest first. */
  async runs(id: string, botId?: string, limit = 10): Promise<BotAutomationRunView[]> {
    const bot = this.bot(botId);
    let kind: AutomationKind = "checkin";
    let targets: { id: string; projectId: string }[] = [];
    if (id === MAINTENANCE_ID) {
      const maintenance = this.deps.maintenance?.get(bot.id);
      return maintenance?.lastRunAt ? [{ id: `${MAINTENANCE_ID}-${maintenance.lastRunAt}`, at: maintenance.lastRunAt, status: "succeeded", manual: false, outcome: maintenance.lastOutcome ?? "Ran", threadId: null }] : [];
    }
    if (id === HEARTBEAT_ID) { const one = this.deps.heartbeat.automation(bot.id); targets = one ? [one] : []; }
    else {
      const runnerId = this.isRunner(id, bot.id);
      if (runnerId) { kind = "runner"; const one = this.deps.runners.automation(runnerId); targets = one ? [one] : []; }
      else { const row = this.row(id, bot.id); kind = row.kind; targets = this.resources(row); }
    }
    const runs = (await Promise.all(targets.map((target) => this.bbRuns(target, limit)))).flat();
    const views: BotAutomationRunView[] = runs.map((run) => ({
      id: run.id, at: run.startedAt ?? run.scheduledFor ?? 0, status: run.status, manual: run.trigger === "manual", outcome: runOutcome(kind, run), threadId: run.threadId ?? null,
    }));
    // Studio's auto-resumes show among the runs (src/auto-resume.ts).
    for (const resume of resumeLog(this.deps.db, targets.map((target) => target.id), limit)) views.push({ id: resume.id, at: resume.at, status: "resumed", manual: false, outcome: resume.message, threadId: null });
    return views.sort((a, b) => b.at - a.at).slice(0, limit);
  }

  private async bbRuns(target: { id: string; projectId: string }, limit: number): Promise<BbRun[]> {
    const page = await this.call("automations_runs", { projectId: target.projectId, automationId: target.id, limit }, z.object({ runs: z.array(bbRun) }).passthrough()).catch((error) => { if (missing(error)) return { runs: [] }; throw error; });
    return page.runs;
  }

  // ---- Stop, Pause and Resume (src/bot.ts) ----

  /** Pauses every active automation of a Bot (not runners or the original check-in, which the Bot handles); `onPaused` hears each. */
  async pauseAll(botId: string, onPaused?: (id: string) => void): Promise<string[]> {
    const paused: string[] = [];
    for (const row of this.rows(botId)) {
      if (row.state !== "active") continue;
      await this.setBb(row, false);
      this.save(row.id, { state: "paused" });
      paused.push(row.id);
      onPaused?.(row.id);
    }
    return paused;
  }

  /** Turns back on one the Bot's Stop or Pause turned off. False when it's gone or over. */
  async restore(id: string): Promise<boolean> {
    const row = this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ?").get(id) as Row | undefined;
    if (!row || row.state === "done" || row.state === "ended") return false;
    if (row.state === "active") return true;
    // The Bot isn't active yet while it resumes: turn its BB automations on directly.
    await this.setBb(row, true);
    this.save(row.id, { state: "active" });
    return true;
  }

  // ---- The minute tick: watchers and end dates ----

  /** Posts new watcher findings and ends schedules past their end date. Errors are per automation. */
  tick(now = Date.now()): Promise<void> {
    return this.ticking ??= this.reconcile(now).finally(() => { this.ticking = null; });
  }

  private async reconcile(now: number): Promise<void> {
    const pending = this.deps.db.prepare("SELECT * FROM bot_automations WHERE cleanup_pending = 1 OR provision_pending = 1").all() as Row[];
    for (const row of pending) {
      try {
        if (row.cleanup_pending) await this.delete(row.id, row.bot_id);
        else await this.provision(row);
      } catch (error) { console.warn(`[studio] automation ${row.id} reconciliation pending`, error); }
    }
    // Handoff is reconciled by the Bot hook immediately, and retried here after failures.
    for (const botId of new Set((this.deps.db.prepare("SELECT DISTINCT bot_id FROM bot_automations").all() as { bot_id: string }[]).map((r) => r.bot_id))) {
      const bot = this.deps.bot(botId);
      if (bot) await this.follow(bot);
    }
    const rows = this.deps.db.prepare("SELECT * FROM bot_automations WHERE state = 'active' AND cleanup_pending = 0 AND provision_pending = 0").all() as Row[];
    for (const row of rows) {
      try {
        const schedule = JSON.parse(row.schedule_json) as Schedule;
        if (schedule.type !== "once" && schedule.until && now > endOfDay(schedule.until, schedule.timezone || localZone())) {
          await this.setBb(row, false);
          this.save(row.id, { state: "ended" });
          continue;
        }
        if (row.kind === "watcher") await this.watch(row);
      } catch (error) {
        console.warn(`[studio] automation ${row.id} tick failed`, error);
      }
    }
  }

  /** Reads a watcher's new runs, oldest first, and wakes its target for each with output. */
  async watch(row: Row): Promise<number> {
    if (this.watching.has(row.id)) return 0;
    this.watching.add(row.id);
    try {
      // tick may have read this row before another watcher pass finished.
      const current = this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ?").get(row.id) as Row | undefined;
      if (!current || current.state !== "active") return 0;
      row = current;
      const seen = new Set<string>(JSON.parse(row.seen_ids));
      const runs: BbRun[] = [];
      for (const { id, projectId } of this.resources(row)) {
        let cursor: string | undefined;
        const cursors = new Set<string>();
        do {
          const page = await this.call("automations_runs", { projectId, automationId: id, limit: 20, ...(cursor ? { cursor } : {}) },
            z.object({ runs: z.array(bbRun), nextCursor: z.string().nullish() }));
          runs.push(...page.runs.filter((run) => run.finishedAt && (run.finishedAt > row.seen_until || (run.finishedAt === row.seen_until && !seen.has(run.id)))));
          // Finish the entire boundary timestamp, including a boundary split across pages.
          if (page.runs.some((run) => run.finishedAt && run.finishedAt < row.seen_until)) break;
          cursor = page.nextCursor ?? undefined;
          if (cursor && cursors.has(cursor)) throw new Error("Watcher history returned a repeated cursor.");
          if (cursor) cursors.add(cursor);
        } while (cursor);
      }
      runs.sort((a, b) => a.finishedAt! - b.finishedAt! || a.id.localeCompare(b.id));
      let boundary = row.seen_until;
      let fired = 0;
      for (const run of runs) {
        const finding = watcherFinding(run);
        if (finding) {
          await this.fire(row, finding);
          fired++;
          this.save(row.id, { last_fired_at: run.finishedAt!, last_fire: finding.slice(0, 2000) });
        }
        if (run.finishedAt! > boundary) { seen.clear(); boundary = run.finishedAt!; }
        seen.add(run.id);
        this.deps.db.prepare("UPDATE bot_automations SET seen_until = ?, seen_ids = ? WHERE id = ?").run(boundary, JSON.stringify([...seen]), row.id);
      }
      return fired;
    } finally {
      this.watching.delete(row.id);
    }
  }

  private async fire(row: Row, output: string): Promise<void> {
    const bot = this.bot(row.bot_id);
    const runner = row.target !== "main" ? this.deps.db.prepare("SELECT thread_id FROM bot_runners WHERE id = ?").get(row.target) as { thread_id: string | null } | undefined : undefined;
    const threadId = runner?.thread_id ?? bot.threadId;
    if (!threadId) return;
    const { text, note } = watcherMessage(row.name, output, row.instruction, !!runner?.thread_id);
    await this.deps.sdk.threads.send({
      threadId, mode: "auto",
      input: [{ type: "text", text, mentions: [] }, { type: "text", text: note, mentions: [], visibility: "agent-only" }],
    } as never);
  }
}
