// Bot automations: one list of what wakes a Bot, in four kinds.
//
//   check-in  wakes the Bot's own thread with a short instruction, on a
//             schedule. Several are fine (Morning brief 8:00, Evening
//             wrap-up 18:00). The Bot's original check-in (its project
//             heartbeat, src/project-lead.ts) is listed as the check-in
//             "Check-in" (id `heartbeat`); its schedule is kept as it
//             was, and editing it keeps it a heartbeat.
//   runner    a runner (src/runners.ts), listed here and managed there.
//   reminder  one message to the Bot's thread at a time (--at), once.
//             Running it now does not use it up.
//   watcher   a script BB runs on the server host on a schedule. It wakes
//             the Bot only when it finds something: exit 0 with stdout →
//             Studio posts the stdout to the Bot's thread (or a runner's)
//             and the agent wakes; empty stdout, a last line of
//             {"wakeAgent": false} (BB's own convention) or a non-zero exit
//             → nothing, no tokens.
//
// Who runs them. Check-ins, reminders and the original check-in run on
// Studio's own scheduler (src/triggers/scheduler.ts): one trigger each,
// whatever the schedule, and they keep running with BB's automations plugin
// off. Their `bb_ids` hold the trigger's `trg_…` id. A runner Studio made
// is the same; an adopted runner keeps its BB automation (src/runners.ts).
//
// A watcher is one row here and one or more BB automations (BB runs the
// script and keeps its output): a schedule compiles to as few crons as
// express it (src/schedule.ts), and Studio pauses, resumes, runs and deletes
// them together.
//
// With bb's automations plugin off (a BB Studio copy imports it off;
// src/automations-plugin.ts): a watcher provisioned then is one trigger on
// Studio's scheduler too (owner "watcher"), and Studio runs its script
// itself (src/watcher-script.ts) and posts what it finds. Nothing calls the
// plugin: lists read no bb automations except, read-only, the rows in its
// data file. Rows the copy's import paused ("in bb": made before the import
// and paused) stay as they are: no edit, pause, resume, run or delete.
//
// Why watchers are polled: BB runs the script (no agent) and keeps its
// output on the run; plugins get no event when a run ends. Studio reads each
// active watcher's recent runs every minute (automations_runs) and posts
// the ones with output it hasn't seen. The script needs no bb CLI, token or
// callback, and a missed minute is caught up on the next poll.
import { readAvailable } from "./kit/server/read-available";
import { rpcErrorStatus } from "./kit/server/index";
import { markStudioLine } from "./kit/relayed";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { BotAutomationRunView, BotAutomationView, HeartbeatRun } from "./contract";
import { automationId, automationName } from "./automation-names";
import { lastRunMark, whenText, type BbEntry, type StudioEntry } from "./automation-table";
import { MAINTENANCE_ID } from "./automation-table-contract";
import { automationsPluginOff } from "./automations-plugin";
import { runWatcherScript, type RunWatcherScript } from "./watcher-script";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resumeLog } from "./auto-resume";
import { compileSchedule, describeSchedule, endOfDay, fromHeartbeat, localZone, type Schedule, type Trigger } from "./schedule";
import { isScheduleId, scheduleKey, type EngineScheduler } from "./triggers/scheduler";
import { threadModel } from "./thread-model";

type Sdk = BbPluginApi["sdk"];
export type AutomationKind = "checkin" | "runner" | "reminder" | "watcher";
export type Interpreter = "bash" | "sh" | "node" | "python3";
const PERSONAL = "proj_personal";
/** The [PASS] rule every wake-up prompt carries (docs/silent-output.md). */
export const PASS_RULE = "If nothing needs the user, reply exactly [PASS]: no \"✓\", \"nothing new\" or other filler.";
const OUTPUT_LIMIT = 1500;
const missing = (error: unknown) => (error as { status?: number })?.status === 404 || /not found/i.test(String((error as Error)?.message ?? ""));
/** How long the minute tick waits before setting up (or removing) one that failed again: 1, 2, 4… minutes, at most an hour. */
export function retryDelay(failures: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, failures - 1), 60 * 60_000);
}
/** A failure in a few plain words, for the list: no "HTTP 503:", no trailing period. */
export function plainReason(error: unknown): string {
  const text = String((error as Error)?.message ?? error ?? "").replace(/^HTTP \d+:\s*/i, "").trim();
  if (rpcErrorStatus(error) === 503 || /is not running/i.test(text)) return "bb's automations plugin isn't running";
  if (/ECONNREFUSED|ECONNRESET|fetch failed|timed? ?out/i.test(text)) return "bb didn't answer";
  return (text || "something went wrong").replace(/[.\s]+$/, "").slice(0, 200);
}
/** A watcher whose bb automation was deleted in bb and couldn't be made again. */
/** What the Bot's chat says when a watcher deleted in bb is set up again. */
export const watcherRemadeLine = (name: string) => `⚠️ The watcher "${name}" was deleted in bb's Automations, so Studio set it up again. To remove it for good, delete it in Studio: Bot › Automations › ${name} › Delete.`;

export const WATCHER_GONE = "Its bb automation was deleted in bb; turn it off and on to set it up again.";

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
  const text = markStudioLine(`Watcher ${name}: ${trimmed.length > OUTPUT_LIMIT ? `${trimmed.slice(0, OUTPUT_LIMIT - 1)}…` : trimmed}`);
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
  machineName?: string | null; machineOffline?: boolean;
  id: string; name: string; job: string; threadId: string | null; state: "active" | "paused";
  schedule: { cadence: HeartbeatRun["cadence"]; time: string; cron?: string; timezone?: string }; nextRunAt: number | null; lastRunAt: number | null;
  lastReport: string | null; lastLevel: string | null; lastReportAt: number | null;
}
export interface AutomationDeps {
  db: Database.Database;
  sdk: Sdk;
  /** Studio's scheduler: it wakes the Bot for check-ins and reminders. */
  scheduler: EngineScheduler;
  copiedReminder?(id: string): boolean;
  changed(): void;
  bot(botId?: string): AutomationBot | null;
  /** The Bot's original check-in (its project heartbeat) and its schedule id. */
  heartbeat: {
    get(botId: string): HeartbeatRun | null;
    set(botId: string, run: HeartbeatRun): Promise<void>;
    automation(botId: string): { id: string; projectId: string } | null;
  };
  runners: {
    list(botId: string): Promise<AutomationRunner[]>;
    get(id: string, botId: string): Promise<AutomationRunner>;
    create(input: { name: string; job: string; schedule: { cadence: HeartbeatRun["cadence"]; time: string; cron?: string }; machine?: string | null; confirm?: boolean }, botId: string): Promise<AutomationRunner>;
    update(input: { id: string; name?: string; job?: string; schedule?: { cadence: HeartbeatRun["cadence"]; time: string; cron?: string }; machine?: string | null; confirm?: boolean }, botId: string): Promise<AutomationRunner>;
    setState(id: string, state: "active" | "paused", botId: string): Promise<AutomationRunner>;
    runNow(id: string, botId: string): Promise<AutomationRunner>;
    delete(id: string, botId: string): Promise<unknown>;
    automation(id: string): { id: string; projectId: string } | null;
  };
  /** Whether bb's automations plugin is confirmed off; asks BB's plugin list when not given. */
  automationsOff?: () => Promise<boolean>;
  /** bb's automations from its plugin's data file, read-only, for when the plugin is off. */
  bbFile?: () => BbEntry[];
  /** When the BB Studio copy's import from bb ran; null (or absent) on an install without it. */
  importedAt?: () => number | null;
  /** One line in a Bot's chat the user reads as is (a watcher deleted in bb was set up again). */
  notify?(botId: string, line: string): Promise<void> | void;
  /** Runs a watcher's script when Studio runs watchers itself. */
  runScript?: RunWatcherScript;
  /** Where Studio-run watchers keep their files (one folder each). */
  watcherDir?: string;
  findings?(watcherId: string, finding: string | null, raw: string | null, at: number, failed: string | null): { post: string; note: string; steer?: boolean; thread?: string; done?(posted: boolean): void } | "quiet" | null;
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
  /** A runner's machine (host id/name, or null for server) and preflight confirm. */
  machine?: string | null;
  confirm?: boolean;
};
export type UpdateInput = Partial<Omit<CreateInput, "kind">> & { id: string };

const HEARTBEAT_ID = "heartbeat";
/** A run's message is the first one its thread got from a little before the run started… */
const RUN_MESSAGE_SLACK_MS = 60_000;
/** …to a while after (a queued send waits for the thread to be free). */
const RUN_MESSAGE_WINDOW_MS = 30 * 60_000;
const MAINTENANCE_SCHEDULE: Schedule = { type: "cron", cron: "0 4 * * *" };
const HEARTBEAT_NAME = "Check-in";

/** One repeating cron, retaining an adopted runner's timezone when supplied. */
function runnerSchedule(schedule: Schedule, timezone = localZone()): { cadence: "custom"; time: string; cron: string } {
  const triggers = compileSchedule(schedule);
  const only = triggers[0];
  if (triggers.length !== 1 || only?.triggerType !== "schedule") throw new Error("A runner (and the original check-in) takes one repeating cron; simplify the times, or make a check-in instead.");
  if (only.timezone !== timezone) throw new Error(`This one runs in timezone ${timezone}.`);
  if (schedule.type !== "once" && schedule.until) throw new Error("This one has no end date; pause or delete it instead.");
  return { cadence: "custom", time: "09:00", cron: only.cron };
}

export class Automations {
  private ticking: Promise<void> | null = null;
  private readonly watching = new Set<string>();
  /**
   * Rows that couldn't be set up or removed: why, and when the minute tick
   * tries again (retryDelay). `logged` is the last reason written to the
   * log, so one reason is logged once, not every minute.
   */
  private readonly retry = new Map<string, { failures: number; nextAt: number; error: string; logged: string | null }>();
  /** Watchers whose bb automation was deleted in bb and couldn't be made again: not retried until turned off and on. */
  private readonly gone = new Set<string>();
  /** bb automations made again after theirs was deleted in bb: one of these gone too isn't made a third time. */
  private readonly remade = new Set<string>();
  /** The last tick failure logged per row, so one reason is logged once. */
  private readonly tickWarned = new Map<string, string>();
  /** Row+column keys already warned for malformed JSON, so each logs once. */
  private readonly jsonWarned = new Set<string>();
  private readonly automationsOff: () => Promise<boolean>;
  constructor(private readonly deps: AutomationDeps) {
    this.automationsOff = deps.automationsOff ?? automationsPluginOff(deps.sdk);
    // A watcher on Studio's scheduler runs its script here.
    deps.scheduler.script("watcher", (id) => this.runWatcher(id));
    // A due check-in or reminder reads its row and its Bot's thread as they are now, so it follows a handed-off thread by itself.
    deps.scheduler.resolve("automation", (id) => {
      const row = this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ?").get(id) as Row | undefined;
      const threadId = row && row.kind !== "watcher" && !row.cleanup_pending ? this.deps.bot(row.bot_id)?.threadId : null;
      if (!row || !threadId) return null;
      if (row.kind === "reminder" && this.deps.copiedReminder?.(row.id)) return null;
      return { threadId, prompt: row.kind === "checkin" ? checkinPrompt(row.name, row.instruction) : reminderPrompt(row.name, row.instruction, row.created_at) };
    });
  }

  /** One of Studio's own schedules (a `trg_` id) in the shape BB's automations list gives; undefined when it has none. */
  private own(id: string): BbAutomation | undefined {
    const key = scheduleKey(id);
    if (!key || !this.deps.scheduler.has(key)) return undefined;
    const status = this.deps.scheduler.status(key);
    return { id, enabled: status.on, done: status.done, nextRunAt: status.nextRunAt, lastRunAt: status.lastRunAt, lastRunStatus: status.lastRunStatus, trigger: {} };
  }

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
    const row = this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ? AND bot_id = ?").get(id, botId) as Row | undefined;
    if (!row) throw new Error(`No automation "${id}".`);
    return row;
  }

  private warnJsonOnce(rowId: string, column: string, message: string): void {
    const key = `${rowId}:${column}`;
    if (this.jsonWarned.has(key)) return;
    this.jsonWarned.add(key);
    console.warn(message);
  }

  private parseJson<T>(
    rowId: string,
    column: string,
    raw: string | null | undefined,
    valid: (value: unknown) => value is T,
    detail?: string,
  ): T | null {
    if (!raw) return null;
    const suffix = detail ? ` (${detail})` : "";
    try {
      const value: unknown = JSON.parse(raw);
      if (valid(value)) return value;
      this.warnJsonOnce(rowId, column, `[studio] Malformed automation ${rowId} ${column}: unexpected JSON shape${suffix}`);
      return null;
    } catch (error) {
      this.warnJsonOnce(rowId, column, `[studio] Malformed automation ${rowId} ${column}: ${plainReason(error)}${suffix}`);
      return null;
    }
  }

  private parseSchedule(row: Row): Schedule | null {
    return this.parseJson(
      row.id,
      "schedule_json",
      row.schedule_json,
      (value): value is Schedule => !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { type?: unknown }).type === "string",
    );
  }

  private parseEnv(row: Row): Record<string, string> {
    return this.parseJson(
      row.id,
      "env_json",
      row.env_json,
      (value): value is Record<string, string> => !!value && typeof value === "object" && !Array.isArray(value),
    ) ?? {};
  }

  private resources(row: Row): { id: string; projectId: string }[] {
    if (row.resources) {
      return this.parseJson(
        row.id,
        "resources",
        row.resources,
        (value): value is { id: string; projectId: string }[] =>
          Array.isArray(value) && value.every((each) => !!each && typeof each === "object" && typeof (each as { id?: unknown }).id === "string" && typeof (each as { projectId?: unknown }).projectId === "string"),
      ) ?? [];
    }
    const ids = this.parseJson(
      row.id,
      "bb_ids",
      row.bb_ids,
      (value): value is string[] => Array.isArray(value) && value.every((each) => typeof each === "string"),
    ) ?? [];
    return ids.map((id) => ({ id, projectId: row.project_id }));
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

  /** The schedules behind these ids: Studio's own from its scheduler, the rest from BB's automations (asked only when there are some). */
  private async bbList(refs: Iterable<{ id: string; projectId: string }>): Promise<Map<string, BbAutomation>> {
    const all = [...refs];
    const lists = await Promise.all([...new Set(all.filter((ref) => !isScheduleId(ref.id)).map((ref) => ref.projectId))].map(async (projectId) => {
      const result = await readAvailable(async () => z.array(bbAutomation).parse(await this.call("automations_list", { projectId }, z.unknown())));
      if (result.status === "unavailable") {
        if (await this.automationsOff()) return this.fileList(projectId);
        console.warn(`[studio] Automation list unavailable for ${projectId}`, result.error);
        throw result.error;
      }
      return result.status === "ok" ? result.value : [];
    }));
    const found = new Map(lists.flat().map((each) => [each.id, each]));
    for (const ref of all) { const own = this.own(ref.id); if (own) found.set(ref.id, own); }
    return found;
  }

  /** With bb's automations plugin off: its automations in one project as its data file has them, read-only (all off). */
  private fileList(projectId: string): BbAutomation[] {
    return (this.deps.bbFile?.() ?? []).filter((each) => each.projectId === projectId).map((each) => ({
      id: each.id, enabled: false, nextRunAt: null, lastRunAt: each.lastRunAt, lastRunStatus: each.lastRunStatus,
      trigger: each.cron ? { triggerType: "schedule", cron: each.cron } : { triggerType: "once" },
    }));
  }

  /** A row the BB Studio copy's import paused so it doesn't run twice beside bb: made before the import and still paused. */
  private inBb(createdAt: number, state: string): boolean {
    const importedAt = this.deps.importedAt?.() ?? null;
    return importedAt !== null && state === "paused" && createdAt <= importedAt;
  }

  /** Whether a Studio automation or runner runs in bb (see inBb). */
  private rowInBb(id: string, botId: string): boolean {
    const row = (this.deps.db.prepare("SELECT created_at, state FROM bot_automations WHERE id = ? AND bot_id = ?").get(id, botId)
      ?? this.deps.db.prepare("SELECT created_at, state FROM bot_runners WHERE id = ? AND bot_id = ?").get(id, botId)) as { created_at: number; state: string } | undefined;
    return !!row && this.inBb(row.created_at, row.state);
  }

  /** Refuses a change to a row that runs in bb. */
  private guardInBb(id: string, botId: string): void {
    if (this.rowInBb(id, botId)) throw new Error("It runs in bb; this copy shows it read-only.");
  }

  guardRunner(id: string, botId?: string): void {
    this.guardInBb(id, this.bot(botId).id);
  }

  /** Runs a Studio-run watcher's script and wakes its target with what it finds. Null when the watcher is gone. */
  private async runWatcher(id: string): Promise<{ status: "succeeded" | "failed"; output: string | null; error: string | null } | null> {
    const row = this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ? AND kind = 'watcher'").get(id) as Row | undefined;
    if (!row || row.cleanup_pending) return null;
    const dir = row.working_dir?.trim();
    const storage = join(this.deps.watcherDir ?? join(tmpdir(), "studio-watchers"), row.id);
    const result = await (this.deps.runScript ?? runWatcherScript)({
      body: row.script ?? "", interpreter: row.interpreter ?? "bash", timeoutMs: row.timeout_ms ?? 120_000,
      env: this.parseEnv(row),
      cwd: dir && dir !== "automation-storage" && dir !== "project" ? dir : storage,
    });
    const status = result.exitCode === 0 ? "succeeded" as const : "failed" as const;
    const finding = watcherFinding({ status, output: result.output, exitCode: result.exitCode });
    const plan = this.plan(row, finding, result.output || null, Date.now(), status === "failed" ? result.error || result.output || "The script failed" : null);
    if (plan && await this.post(row, plan)) this.save(row.id, { last_fired_at: Date.now(), last_fire: plan.post.slice(0, 2000) });
    return { status, output: result.output || null, error: result.error };
  }

  /** What an agent kind runs on: the Bot thread's provider, and its model unless the automation picks a cheaper one. */
  private async agentExecution(row: Row, threadId: string, prompt: string) {
    const [thread, defaults] = await Promise.all([this.deps.sdk.threads.get({ threadId }), threadModel(this.deps.sdk, threadId, this.deps.scheduler.preferredModel?.(threadId)).catch(() => null)]);
    const model = row.model ?? defaults?.model;
    if (!thread.providerId || !model) throw new Error("The Bot's Main conversation has no model yet. Choose one in it (or set the Bot's default model in Bot settings), then try again.");
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
    const env = row.env_json ? this.parseEnv(row) : undefined;
    return {
      mode: "script", script: row.script ?? "", interpreter: row.interpreter ?? "bash", timeoutMs: row.timeout_ms ?? 120_000,
      ...(env && Object.keys(env).length ? { env } : {}),
      workingDirectory: !dir || dir === "automation-storage" ? { type: "automation-storage" } : dir === "project" ? { type: "project" } : { type: "path", path: dir },
    };
  }

  /** A check-in or reminder: one trigger on Studio's scheduler, on while the row and its Bot are active. */
  private async provisionOwn(row: Row, bot: AutomationBot, schedule: Schedule): Promise<Row> {
    const on = row.state === "active" && bot.state === "active";
    // Its run reads the Main and its model when due (the resolver, and the scheduler's model fallback), so
    // pausing, or following a new Main, never reads the thread: a gone Main or one with no model can't block it.
    if (on && !bot.threadId) throw new Error(`${bot.name} has no Main conversation. Pick one in Bot settings (or start a new one), then turn this on.`);
    const projectId = PERSONAL;
    this.save(row.id, { provision_pending: 1 });
    // Left from before the move to Studio's scheduler: their BB automations go (best effort).
    for (const old of this.resources(row)) if (!isScheduleId(old.id)) await this.call("automations_delete", { projectId: old.projectId, automationId: old.id }, z.unknown()).catch(() => {});
    const id = this.deps.scheduler.ensure({ owner: "automation", ownerId: row.id }, { schedule, timeZone: (schedule.type !== "once" && schedule.timezone) || localZone() }, on);
    this.save(row.id, { bb_ids: JSON.stringify([id]), resources: JSON.stringify([{ id, projectId }]), project_id: projectId, target_thread_id: bot.threadId, provision_pending: 0 });
    return this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ?").get(row.id) as Row;
  }

  /**
   * A watcher while bb's automations plugin is off: one trigger on Studio's
   * scheduler (owner "watcher") that runs its script here. Its bb automations,
   * if it had any, can't be reached; they stay off in bb's data and drop off
   * the row.
   */
  private provisionOwnWatcher(row: Row, bot: AutomationBot, schedule: Schedule): Row {
    if (!row.script?.trim()) throw new Error("A watcher needs a script.");
    this.save(row.id, { provision_pending: 1 });
    const id = this.deps.scheduler.ensure({ owner: "watcher", ownerId: row.id }, { schedule, timeZone: (schedule.type !== "once" && schedule.timezone) || localZone() }, row.state === "active" && bot.state === "active");
    this.save(row.id, { bb_ids: JSON.stringify([id]), resources: JSON.stringify([{ id, projectId: PERSONAL }]), project_id: PERSONAL, provision_pending: 0 });
    return this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ?").get(row.id) as Row;
  }

  /**
   * Makes the row's schedule match it. A check-in or reminder is a trigger on
   * Studio's scheduler. A watcher is BB automations: made, updated or deleted
   * to match, then paused or resumed. Throws before saving on a bad schedule.
   * A failure is kept as the row's reason (the list shows it); success clears
   * it, and a watcher's "its bb automation was deleted".
   */
  private async provision(row: Row): Promise<Row> {
    try {
      const done = await this.apply(row);
      this.retry.delete(row.id);
      this.tickWarned.delete(row.id);
      if (this.gone.delete(row.id)) this.deps.changed();
      return done;
    } catch (error) {
      this.noteFailure(row.id, error);
      throw error;
    }
  }

  /** Keeps why a row couldn't be set up or removed, leaving its back-off as it was. */
  private noteFailure(id: string, error: unknown): void {
    const prev = this.retry.get(id);
    this.retry.set(id, { failures: prev?.failures ?? 0, nextAt: prev?.nextAt ?? 0, error: plainReason(error), logged: prev?.logged ?? null });
  }

  /** The minute tick's failure to set up or remove a row: wait longer each time, and log a reason once. */
  private backOff(row: Row, error: unknown, now: number): void {
    const prev = this.retry.get(row.id);
    const failures = (prev?.failures ?? 0) + 1;
    const delay = retryDelay(failures);
    const reason = plainReason(error);
    if (reason !== prev?.logged) console.warn(`[studio] automation ${row.id} (${row.name}): couldn't ${row.cleanup_pending ? "remove it" : "set it up"}: ${reason}. Trying again in ${Math.round(delay / 60_000)} min.`);
    this.retry.set(row.id, { failures, nextAt: now + delay, error: reason, logged: reason });
    this.deps.changed();
  }

  /** What the list says of a row being set up or removed, or of a watcher whose bb automation is gone; null otherwise. */
  private pendingOutcome(row: Row, now = Date.now()): string | null {
    if (this.gone.has(row.id)) return WATCHER_GONE;
    if (!row.cleanup_pending && !row.provision_pending) return null;
    const retry = this.retry.get(row.id);
    const minutes = Math.max(1, Math.ceil(((retry?.nextAt ?? 0) - now) / 60_000));
    const when = `Trying again in ${minutes} min.`;
    if (row.cleanup_pending) return retry ? `Couldn't remove it: ${retry.error}. ${when}` : `Removing it. ${when}`;
    return retry ? `Couldn't set it up: ${retry.error}. ${when}` : `Not set up yet. ${when}`;
  }

  private async apply(row: Row): Promise<Row> {
    const bot = this.bot(row.bot_id);
    const schedule = this.parseSchedule(row);
    if (!schedule) throw new Error(`Automation "${row.id}" has a corrupted schedule.`);
    if (row.kind !== "watcher") return this.provisionOwn(row, bot, schedule);
    if (await this.automationsOff()) return this.provisionOwnWatcher(row, bot, schedule);
    // Back on bb's automations: a schedule Studio ran while the plugin was off goes.
    const own = this.resources(row).filter((resource) => isScheduleId(resource.id));
    if (own.length) {
      for (const resource of own) { const key = scheduleKey(resource.id); if (key) this.deps.scheduler.remove(key); }
      this.saveResources(row, this.resources(row).filter((resource) => !isScheduleId(resource.id)));
      row = this.deps.db.prepare("SELECT * FROM bot_automations WHERE id = ?").get(row.id) as Row;
    }
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
      const key = scheduleKey(resource.id);
      if (key) this.deps.scheduler.setOn(key, on);
      else await this.call(on ? "automations_resume" : "automations_pause", { projectId: resource.projectId, automationId: resource.id }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
    }
  }

  // ---- The list ----

  async list(botId?: string, onlyId?: string): Promise<BotAutomationView[]> {
    const bot = this.bot(botId);
    const rows = this.rows(bot.id).filter((row) => !onlyId || row.id === onlyId);
    const heartbeat = bot.kind === "external" && !this.deps.heartbeat.get(bot.id) ? null : this.deps.heartbeat.get(bot.id);
    const hbAutomation = !onlyId || onlyId === HEARTBEAT_ID ? this.deps.heartbeat.automation(bot.id) : null;
    let runners: AutomationRunner[] = [];
    if (bot.kind !== "external") {
      if (!onlyId) runners = await this.deps.runners.list(bot.id);
      else {
        const target = rows[0]?.target;
        const runnerId = target ? target === "main" ? null : target : [HEARTBEAT_ID, MAINTENANCE_ID].includes(onlyId) ? null : onlyId;
        if (runnerId) runners = [await this.deps.runners.get(runnerId, bot.id)];
      }
    }
    const bb = await this.bbList([...rows.flatMap((row) => this.resources(row)), ...(hbAutomation ? [hbAutomation] : [])]);
    const views: BotAutomationView[] = [];
    if (heartbeat) {
      const automation = hbAutomation ? bb.get(hbAutomation.id) : undefined;
      views.push({
        id: HEARTBEAT_ID, kind: "checkin", name: HEARTBEAT_NAME, original: true, bbIds: hbAutomation ? [hbAutomation.id] : [],
        instruction: "What the Check-in section of your always-on skill says.",
        schedule: fromHeartbeat(heartbeat), scheduleText: describeSchedule(fromHeartbeat(heartbeat)),
        state: heartbeat.enabled ? "active" : "paused", nextRunAt: heartbeat.enabled ? automation?.nextRunAt ?? null : null, lastRunAt: automation?.lastRunAt ?? null,
        lastOutcome: this.resumedSince(hbAutomation ? [hbAutomation.id] : [], automation?.lastRunAt) ?? automation?.lastRunStatus ?? null, model: null, script: null, target: "main", targetName: bot.name, threadId: bot.threadId,
      });
    }
    const maintenance = bot.kind === "external" ? null : this.deps.maintenance?.get(bot.id) ?? null;
    if (maintenance) {
      views.push({
        id: MAINTENANCE_ID, kind: "checkin", name: "Maintenance", original: false,
        instruction: "Thread, automation, Memory and skill housekeeping.",
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
      // A reminder is done once it has run and has nothing left to run.
      if (!row.provision_pending && !row.cleanup_pending && row.kind === "reminder" && state === "active" && automations.length > 0 && automations.every((each) => isScheduleId(each.id) ? each.done === true : !!last && !each.nextRunAt)) { state = "done"; }
      const schedule = this.parseSchedule(row);
      if (!schedule) continue;
      const runner = row.target !== "main" ? runners.find((each) => each.id === row.target) : null;
      views.push({
        id: row.id, kind: row.kind, name: row.name, original: false, inBb: this.inBb(row.created_at, row.state), bbIds: this.ids(row), instruction: row.instruction,
        schedule, scheduleText: describeSchedule(schedule),
        state, nextRunAt: state === "active" && Number.isFinite(next) ? next : null, lastRunAt: Math.max(last, row.last_fired_at ?? 0) || null,
        lastOutcome: this.pendingOutcome(row) ?? this.resumedSince(this.ids(row), Math.max(last, row.last_fired_at ?? 0)) ?? (row.kind === "watcher" && row.last_fire ? `Woke it: ${row.last_fire.split("\n")[0]!.slice(0, 200)}` : automations.find((each) => each.lastRunAt === last)?.lastRunStatus ?? null),
        model: row.kind === "watcher" ? null : { model: row.model, reasoning: row.reasoning },
        script: row.kind === "watcher" ? { body: row.script ?? "", interpreter: (row.interpreter ?? "bash") as Interpreter, timeoutMs: row.timeout_ms ?? 120_000, workingDirectory: row.working_dir ?? null, envKeys: Object.keys(this.parseEnv(row)) } : null,
        target: row.target, targetName: runner?.name ?? bot.name, threadId: runner ? runner.threadId : bot.threadId,
      });
    }
    for (const runner of runners) {
      const schedule = fromHeartbeat(runner.schedule, runner.schedule.timezone);
      views.push({
        machineName: runner.machineName ?? null, machineOffline: runner.machineOffline ?? false,
        id: runner.id, kind: "runner", name: runner.name, original: false, inBb: this.rowInBb(runner.id, bot.id), instruction: runner.job, schedule, scheduleText: describeSchedule(schedule),
        state: runner.state, nextRunAt: runner.nextRunAt, lastRunAt: runner.lastRunAt,
        lastOutcome: runner.lastReport ? `${runner.lastLevel === "urgent" ? "Urgent" : runner.lastLevel === "tell" ? "Told you" : "Logged"}: ${runner.lastReport}` : null,
        model: null, script: null, target: "own", targetName: runner.name, threadId: runner.threadId,
      });
    }
    return views;
  }

  /**
   * The Bot's heartbeat check-in and maintenance as rows of the Automations
   * table (src/automation-table.ts), kind "schedule". Reads no bb automation:
   * the table merges the heartbeat's own from bb's list.
   */
  builtinEntries(botId: string): StudioEntry[] {
    const bot = this.deps.bot(botId);
    if (!bot) return [];
    const entries: StudioEntry[] = [];
    const heartbeat = this.deps.heartbeat.get(bot.id);
    if (heartbeat) {
      const ref = this.deps.heartbeat.automation(bot.id);
      const own = ref ? this.own(ref.id) : undefined;
      entries.push({
        id: HEARTBEAT_ID, botId: bot.id, kind: "schedule", name: HEARTBEAT_NAME, when: whenText(fromHeartbeat(heartbeat)),
        status: heartbeat.enabled ? "active" : "paused", createdAt: null, bbIds: ref ? [ref] : [], threadId: bot.threadId,
        lastRunAt: own?.lastRunAt ?? null, lastRun: lastRunMark(own?.lastRunStatus), instruction: "What the Check-in section of your always-on skill says.", script: null,
      });
    }
    const maintenance = bot.kind === "external" ? null : this.deps.maintenance?.get(bot.id) ?? null;
    if (maintenance) {
      entries.push({
        id: MAINTENANCE_ID, botId: bot.id, kind: "schedule", name: "Maintenance", when: whenText(MAINTENANCE_SCHEDULE),
        status: maintenance.paused ? "paused" : "active", createdAt: null, bbIds: [], threadId: null,
        lastRunAt: maintenance.lastRunAt, lastRun: maintenance.lastRunAt ? "ok" : null, instruction: "Thread, automation, Memory and skill housekeeping.", script: null,
      });
    }
    return entries;
  }

  /**
   * A Bot's check-ins and reminders for its Activity (src/bot.ts): they run
   * on Studio's scheduler, so BB's automations list no longer has them.
   */
  scheduled(botId: string): { id: string; name: string; cron: string | null; enabled: boolean; nextRunAt: number | null }[] {
    const bot = this.deps.bot(botId);
    if (!bot) return [];
    return this.rows(bot.id).flatMap((row) => {
      const own = row.kind === "watcher" || row.state === "done" || row.state === "ended" ? undefined : this.ids(row).map((id) => this.own(id)).find((each) => !!each);
      if (!own) return [];
      const schedule = this.parseSchedule(row);
      if (!schedule) return [];
      return [{ id: own.id, name: `${bot.name} · ${row.name}`, cron: schedule.type === "cron" ? schedule.cron : null, enabled: own.enabled, nextRunAt: own.nextRunAt ?? null }];
    });
  }

  /** Studio's latest auto-resume (src/auto-resume.ts) of these BB automations, when it came after their last run. */
  private resumedSince(bbIds: string[], lastRunAt: number | null | undefined): string | null {
    const latest = resumeLog(this.deps.db, bbIds, 1)[0];
    return latest && latest.at > (lastRunAt ?? 0) ? latest.message : null;
  }

  /** The schedules of check-ins and watchers, for auto-resume (src/auto-resume.ts), which acts only on BB automations (watchers'): on while the row and its Bot are active. Reminders run once and aren't resumed. */
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
    automationName(this.deps.db, bot.id, name);
    if (input.kind === "runner") {
      const runner = await this.deps.runners.create({
        name, job: (input.instruction ?? "").trim(), schedule: runnerSchedule(input.schedule),
        ...(input.machine !== undefined ? { machine: input.machine } : {}),
        ...(input.confirm !== undefined ? { confirm: input.confirm } : {}),
      }, bot.id);
      return this.one(runner.id, bot.id);
    }
    if (input.kind === "reminder" && input.schedule.type !== "once") throw new Error("A reminder is one time (at or in); make a check-in for a repeating one.");
    if (input.kind !== "reminder" && input.schedule.type === "once") throw new Error("Use a reminder for one time.");
    if (input.kind !== "watcher" && !input.instruction?.trim()) throw new Error("Say what it should do.");
    if (input.kind === "watcher" && !input.script?.body.trim()) throw new Error("A watcher needs a script.");
    const target = input.kind === "watcher" ? this.target(input.target, bot.id) : "main";
    compileSchedule(input.schedule);
    // A new check-in or reminder says now when the Main can't run it (no Main, no model), not at its first run.
    if (input.kind !== "watcher") {
      if (!bot.threadId) throw new Error(`${bot.name} has no Main conversation. Pick one in Bot settings (or start a new one), then try again.`);
      await this.agentExecution({ model: input.model?.model || null, reasoning: input.model?.reasoning || null } as Row, bot.threadId, "");
    }
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
    const id = automationId(this.deps.db, botId, target);
    const runner = this.deps.db.prepare("SELECT id FROM bot_runners WHERE bot_id = ? AND id = ?").get(botId, id) as { id: string } | undefined;
    if (!runner) throw new Error(`No runner "${target}" to wake.`);
    return runner.id;
  }

  private async one(id: string, botId: string): Promise<BotAutomationView> {
    const found = (await this.list(botId, id)).find((each) => each.id === id);
    if (!found) throw new Error(`No automation "${id}".`);
    return found;
  }

  private isRunner(id: string, botId: string): string | null {
    const row = this.deps.db.prepare("SELECT id FROM bot_runners WHERE bot_id = ? AND id = ?").get(botId, id) as { id: string } | undefined;
    return row?.id ?? null;
  }

  async update(input: UpdateInput, botId?: string): Promise<BotAutomationView> {
    const bot = this.bot(botId);
    input = { ...input, id: automationId(this.deps.db, bot.id, input.id) };
    this.guardInBb(input.id, bot.id);
    if (input.name !== undefined) automationName(this.deps.db, bot.id, input.name.trim(), input.id);
    if (input.id === MAINTENANCE_ID) throw new Error("Maintenance settings are in Bot info → Maintenance.");
    if (input.id === HEARTBEAT_ID) {
      const run = this.deps.heartbeat.get(bot.id);
      if (!run) throw new Error("This Bot has no original check-in.");
      if (input.name && input.name !== HEARTBEAT_NAME) throw new Error("The original check-in keeps its name; its instruction is the Check-in section of your always-on skill.");
      if (input.schedule) await this.deps.heartbeat.set(bot.id, { ...run, ...runnerSchedule(input.schedule), enabled: run.enabled });
      return this.one(HEARTBEAT_ID, bot.id);
    }
    const runnerId = this.isRunner(input.id, bot.id);
    if (runnerId) {
      const stored = this.deps.db.prepare("SELECT timezone FROM bot_runners WHERE id = ?").get(runnerId) as { timezone: string | null };
      const timezone = stored.timezone ?? (await this.deps.runners.get(runnerId, bot.id)).schedule.timezone ?? localZone();
      await this.deps.runners.update({
        id: runnerId,
        ...(input.name ? { name: input.name } : {}),
        ...(input.instruction ? { job: input.instruction } : {}),
        ...(input.schedule ? { schedule: runnerSchedule(input.schedule.type === "once" ? input.schedule : { ...input.schedule, timezone: input.schedule.timezone || timezone }, timezone) } : {}),
        ...(input.machine !== undefined ? { machine: input.machine } : {}),
        ...(input.confirm !== undefined ? { confirm: input.confirm } : {}),
      }, bot.id);
      return this.one(runnerId, bot.id);
    }
    const row = this.row(input.id, bot.id);
    const name = input.name?.trim();
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
    const nextSchedule = this.parseSchedule(next);
    if (!nextSchedule) throw new Error(`Automation "${next.id}" has a corrupted schedule.`);
    compileSchedule(nextSchedule);
    if (next.kind === "watcher" && !next.script?.trim()) throw new Error("A watcher needs a script.");
    if (next.kind !== "watcher") {
      if (!bot.threadId) throw new Error(`${bot.name} has no Main conversation. Pick one in Bot settings (or start a new one), then try again.`);
      await this.agentExecution(next, bot.threadId, "");
    }
    this.save(row.id, { name: next.name, instruction: next.instruction, schedule_json: next.schedule_json, model: next.model, reasoning: next.reasoning, script: next.script, interpreter: next.interpreter, timeout_ms: next.timeout_ms, env_json: next.env_json, working_dir: next.working_dir, target: next.target, state: next.state, provision_pending: 1 });
    await this.provision(this.row(row.id, bot.id));
    return this.one(row.id, bot.id);
  }

  async setState(id: string, state: "active" | "paused", botId?: string): Promise<BotAutomationView> {
    const bot = this.bot(botId);
    id = automationId(this.deps.db, bot.id, id);
    this.guardInBb(id, bot.id);
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
    this.save(row.id, { state, provision_pending: 1 });
    await this.provision(this.row(row.id, bot.id));
    return this.one(row.id, bot.id);
  }

  async runNow(id: string, botId?: string): Promise<BotAutomationView> {
    const bot = this.bot(botId);
    id = automationId(this.deps.db, bot.id, id);
    this.guardInBb(id, bot.id);
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
    const key = scheduleKey(target.id);
    if (key) await this.deps.scheduler.runNow(key);
    else await this.call("automations_run", { projectId: target.projectId, automationId: target.id, idempotencyKey: `studio-${id}-${Date.now()}` }, z.unknown());
    return this.one(id === HEARTBEAT_ID ? HEARTBEAT_ID : this.isRunner(id, bot.id) ?? this.row(id, bot.id).id, bot.id);
  }

  async delete(id: string, botId?: string): Promise<{ deleted: true }> {
    const bot = this.bot(botId);
    id = automationId(this.deps.db, bot.id, id);
    this.guardInBb(id, bot.id);
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
    try {
      for (const resource of [...resources]) {
        const key = scheduleKey(resource.id);
        if (key) this.deps.scheduler.remove(key);
        else await this.call("automations_delete", { projectId: resource.projectId, automationId: resource.id }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
        resources.splice(resources.indexOf(resource), 1);
        this.saveResources(row, resources);
      }
    } catch (error) {
      this.noteFailure(row.id, error);
      throw error;
    }
    this.deps.db.prepare("DELETE FROM bot_automations WHERE id = ?").run(row.id);
    this.retry.delete(row.id);
    this.gone.delete(row.id);
    this.tickWarned.delete(row.id);
    this.deps.changed();
    return { deleted: true };
  }

  /** Recent runs of every schedule behind one Studio automation, newest first. */
  async runs(id: string, botId?: string, limit = 10): Promise<BotAutomationRunView[]> {
    const bot = this.bot(botId);
    id = automationId(this.deps.db, bot.id, id);
    if (id === MAINTENANCE_ID) {
      const maintenance = this.deps.maintenance?.get(bot.id);
      return maintenance?.lastRunAt ? [{ id: `${MAINTENANCE_ID}-${maintenance.lastRunAt}`, at: maintenance.lastRunAt, status: "succeeded", manual: false, outcome: maintenance.lastOutcome ?? "Ran", threadId: null }] : [];
    }
    const { kind, targets } = this.targets(id, bot.id);
    const runs = (await Promise.all(targets.map((target) => this.bbRuns(target, limit)))).flat();
    const views: BotAutomationRunView[] = runs.map((run) => ({
      id: run.id, at: run.startedAt ?? run.scheduledFor ?? 0, status: run.status, manual: run.trigger === "manual", outcome: runOutcome(kind, run), threadId: run.threadId ?? null,
    }));
    // Studio's auto-resumes show among the runs (src/auto-resume.ts).
    for (const resume of resumeLog(this.deps.db, targets.map((target) => target.id), limit)) views.push({ id: resume.id, at: resume.at, status: "resumed", manual: false, outcome: resume.message, threadId: null });
    return views.sort((a, b) => b.at - a.at).slice(0, limit);
  }

  /** The schedules behind one of a Bot's jobs (Studio's own or BB automations), and its kind. */
  private targets(id: string, botId: string): { kind: AutomationKind; targets: { id: string; projectId: string }[] } {
    if (id === HEARTBEAT_ID) { const one = this.deps.heartbeat.automation(botId); return { kind: "checkin", targets: one ? [one] : [] }; }
    const runnerId = this.isRunner(id, botId);
    if (runnerId) { const one = this.deps.runners.automation(runnerId); return { kind: "runner", targets: one ? [one] : [] }; }
    const row = this.row(id, botId);
    return { kind: row.kind, targets: this.resources(row) };
  }

  /**
   * Where one run opens (the Bot page's Needs you): a run that sent a message
   * opens its thread at that message (a runner's run, a check-in in the
   * Bot's chat); one that ran in a thread without sending one opens that
   * thread; a script's run opens its automation in the automations plugin,
   * which shows its runs' output.
   */
  async runLink(id: string, runId: string, botId?: string): Promise<{ threadId: string | null; seq: number | null; path: string | null }> {
    const bot = this.bot(botId);
    id = automationId(this.deps.db, bot.id, id);
    const { kind, targets } = this.targets(id, bot.id);
    // Only a BB automation has a page in the automations plugin; Studio's own schedules show their runs here.
    const page = (target: { id: string; projectId: string }) => isScheduleId(target.id) ? null : `/plugins/automations/automations/${encodeURIComponent(target.projectId)}/${encodeURIComponent(target.id)}`;
    for (const target of targets) {
      const run = (await this.bbRuns(target, 50)).find((each) => each.id === runId);
      if (!run) continue;
      // A check-in writes in the Bot's chat and a runner's run in its thread, even when the run doesn't say so.
      const runnerId = kind === "runner" ? this.isRunner(id, bot.id) : null;
      const threadId = run.threadId ?? (kind === "checkin" ? bot.threadId : runnerId ? (await this.deps.runners.get(runnerId, bot.id).catch(() => null))?.threadId ?? null : null);
      if (!threadId) return { threadId: null, seq: null, path: page(target) };
      const seq = await this.messageAt(threadId, run.startedAt ?? run.scheduledFor ?? null).catch(() => null);
      // It sent nothing there (it failed first): its run's log says what happened.
      if (seq === null && !run.threadId) return { threadId: null, seq: null, path: page(target) };
      return { threadId, seq, path: page(target) };
    }
    return { threadId: null, seq: null, path: targets[0] ? page(targets[0]) : null };
  }

  /** The message a run sent a thread: its first request at or after the run started (a little slack for clocks); null when it sent none. */
  private async messageAt(threadId: string, at: number | null): Promise<number | null> {
    if (at === null) return null;
    const from = at - RUN_MESSAGE_SLACK_MS;
    let before: number | null = null, found: number | null = null;
    // Newest first, 100 a page, back to the run (10 pages at most).
    for (let page = 0; page < 10; page++) {
      const events = await this.deps.sdk.threads.events.list({ threadId, order: "desc", limit: "100", types: ["client/turn/requested"], ...(before === null ? {} : { beforeSeq: String(before) }) }) as { seq: number; createdAt: number }[];
      for (const event of events) {
        if (event.createdAt < from) return found;
        // Not one sent long after the run started: a later run's.
        if (event.createdAt <= at + RUN_MESSAGE_WINDOW_MS) found = event.seq;
      }
      if (events.length < 100) return found;
      before = events.at(-1)!.seq;
    }
    return found;
  }

  private async bbRuns(target: { id: string; projectId: string }, limit: number): Promise<BbRun[]> {
    const key = scheduleKey(target.id);
    if (key) return this.deps.scheduler.runs(key, limit).map((run) => ({ id: run.id, status: run.status, trigger: run.reason === "manual" ? "manual" : "schedule", threadId: run.threadId, skipReason: run.status === "skipped" ? run.error : null, error: run.status === "failed" ? run.error : null, output: run.output, scheduledFor: run.scheduledFor, startedAt: run.startedAt, finishedAt: run.finishedAt }));
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
      // A watcher whose bb automation is gone waits for its owner to turn it off and on; one that failed waits out its back-off.
      if (!row.cleanup_pending && this.gone.has(row.id)) continue;
      if (now < (this.retry.get(row.id)?.nextAt ?? 0)) continue;
      try {
        if (row.cleanup_pending) await this.delete(row.id, row.bot_id);
        else await this.provision(row);
      } catch (error) { this.backOff(row, error, now); }
    }
    const reminders = this.deps.db.prepare("SELECT * FROM bot_automations WHERE kind = 'reminder' AND state = 'active' AND provision_pending = 0 AND cleanup_pending = 0").all() as Row[];
    if (reminders.length) {
      const bb = await this.bbList(reminders.flatMap((r) => this.resources(r)));
      for (const row of reminders) {
        const runs = this.ids(row).map((id) => bb.get(id));
        if (runs.length && runs.every((r) => r && (isScheduleId(r.id) ? r.done === true : r.lastRunAt && !r.nextRunAt))) this.save(row.id, { state: "done" });
      }
    }
    // Handoff is reconciled by the Bot hook immediately, and retried here after failures.
    for (const botId of new Set((this.deps.db.prepare("SELECT DISTINCT bot_id FROM bot_automations").all() as { bot_id: string }[]).map((r) => r.bot_id))) {
      const bot = this.deps.bot(botId);
      if (bot) await this.follow(bot);
    }
    const rows = this.deps.db.prepare("SELECT * FROM bot_automations WHERE state = 'active' AND cleanup_pending = 0 AND provision_pending = 0").all() as Row[];
    for (const row of rows) {
      try {
        const schedule = this.parseSchedule(row);
        if (!schedule) continue;
        if (schedule.type !== "once" && schedule.until && now > endOfDay(schedule.until, schedule.timezone || localZone())) {
          await this.setBb(row, false);
          this.save(row.id, { state: "ended" });
          continue;
        }
        if (row.kind === "watcher" && !this.gone.has(row.id)) await this.watch(row);
        this.tickWarned.delete(row.id);
      } catch (error) {
        // One reason is logged once, not every minute.
        const reason = plainReason(error);
        if (this.tickWarned.get(row.id) !== reason) console.warn(`[studio] automation ${row.id} (${row.name}) tick failed: ${reason}`, error);
        this.tickWarned.set(row.id, reason);
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
      const seenIds = this.parseJson(
        row.id,
        "seen_ids",
        row.seen_ids,
        (value): value is string[] => Array.isArray(value) && value.every((each) => typeof each === "string"),
        "skipping watcher for this tick",
      );
      if (!seenIds) {
        if (!row.seen_ids) this.warnJsonOnce(row.id, "seen_ids", `[studio] Malformed automation ${row.id} seen_ids: empty value (skipping watcher for this tick)`);
        return 0;
      }
      const seen = new Set<string>(seenIds);
      const runs: BbRun[] = [];
      for (const { id, projectId } of this.resources(row).filter((resource) => !isScheduleId(resource.id))) {
        let cursor: string | undefined;
        const cursors = new Set<string>();
        do {
          let page: { runs: BbRun[]; nextCursor?: string | null };
          try {
            page = await this.call("automations_runs", { projectId, automationId: id, limit: 20, ...(cursor ? { cursor } : {}) },
              z.object({ runs: z.array(bbRun), nextCursor: z.string().nullish() }));
          } catch (error) {
            if (!missing(error)) throw error;
            // Its bb automation was deleted in bb: make it again; what it ran before is read on the next tick.
            await this.remake(row, id);
            return 0;
          }
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
        const failed = run.status === "failed" || (run.status === "succeeded" && (run.exitCode ?? 0) !== 0) ? run.error || run.output || "The script failed" : null;
        const plan = this.plan(row, watcherFinding(run), run.output ?? null, run.finishedAt!, failed);
        if (plan && await this.post(row, plan)) {
          fired++;
          this.save(row.id, { last_fired_at: run.finishedAt!, last_fire: plan.post.slice(0, 2000) });
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

  /**
   * A watcher whose bb automation (`goneId`) was deleted in bb: set it up
   * again, once. When that fails, or the one made again is gone too, the row
   * is marked: the list says so, and the minute tick leaves it alone until
   * it's turned off and on (which sets it up and clears the mark).
   */
  private async remake(row: Row, goneId: string): Promise<void> {
    const markGone = (reason: string) => {
      if (!this.gone.has(row.id)) console.warn(`[studio] watcher ${row.id} (${row.name}): its bb automation was deleted in bb and couldn't be set up again (${reason}). Turn it off and on to set it up again.`);
      this.gone.add(row.id);
      this.deps.changed();
    };
    if (this.remade.has(goneId)) { markGone("the one made again is gone too"); return; }
    const before = new Set(this.ids(row));
    try {
      const done = await this.provision(row);
      for (const id of this.ids(done)) if (!before.has(id)) this.remade.add(id);
      console.warn(`[studio] watcher ${row.id} (${row.name}): its bb automation was deleted in bb; set it up again.`);
      // Said once: if the delete in bb was on purpose, the user deletes the watcher in Studio, which removes it for good.
      try { await this.deps.notify?.(row.bot_id, watcherRemadeLine(row.name)); } catch (error) { console.warn(`[studio] watcher ${row.id}: couldn't tell the Bot it was set up again`, error); }
    } catch (error) {
      markGone(plainReason(error));
    }
  }

  private plan(row: Row, finding: string | null, raw: string | null, at: number, failed: string | null = null): { post: string; note: string | null; steer?: boolean; thread?: string; done?(posted: boolean): void } | null {
    if (this.deps.findings) {
      try {
        const plan = this.deps.findings(row.id, finding, raw, at, failed);
        if (plan === "quiet") return null;
        if (plan) return plan;
      } catch (error) {
        console.warn(`[studio] watcher ${row.id}: its finding could not be kept as a task`, error);
      }
    }
    return finding ? { post: finding, note: null } : null;
  }

  private async post(row: Row, plan: { post: string; note: string | null; steer?: boolean; thread?: string; done?(posted: boolean): void }): Promise<boolean> {
    let posted = false;
    try { posted = await this.fire(row, plan.post, plan.note, plan.steer ? "steer-if-active" : "auto", plan.thread ?? null); }
    finally { try { plan.done?.(posted); } catch (error) { console.warn(`[studio] watcher ${row.id}: its finding could not be marked`, error); } }
    return posted;
  }

  private async fire(row: Row, output: string, extra: string | null = null, mode: "auto" | "steer-if-active" = "auto", to: string | null = null): Promise<boolean> {
    const bot = this.bot(row.bot_id);
    const runner = row.target !== "main" ? this.deps.db.prepare("SELECT thread_id FROM bot_runners WHERE id = ?").get(row.target) as { thread_id: string | null } | undefined : undefined;
    const threadId = to ?? runner?.thread_id ?? bot.threadId;
    if (!threadId) return false;
    const { text, note } = watcherMessage(row.name, output, row.instruction, !to && !!runner?.thread_id);
    await this.deps.sdk.threads.send({
      threadId, mode,
      input: [{ type: "text", text, mentions: [] }, { type: "text", text: extra ? `${note} ${extra}` : note, mentions: [], visibility: "agent-only" }],
    } as never);
    return true;
  }
}
