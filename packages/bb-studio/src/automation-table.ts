// The Bot's Automations table (`bot_automation_table`, design 7b): every
// automation that belongs to one Bot, as one list, whatever its state.
//
// Sources:
//   - Studio's own rows: watchers, check-ins and reminders (bot_automations),
//     runners (bot_runners), and the Bot's heartbeat check-in and maintenance
//     (kind "schedule").
//   - bb's core automations, from bb's automations plugin
//     (`automations_overview`). When the plugin doesn't answer (a BB Studio
//     copy imports it turned off), from its data file, read-only.
//
// One row per automation. A bb automation Studio made is part of its Studio
// row, not a row of its own: it is linked by the Studio row's `bb_ids`, by a
// runner's `automation_id`, by the name Studio gives a runner's automation
// ("Studio runner <run_id>"), or by the name Studio gives a check-in's or
// watcher's ("<Bot name> · <automation name>").
//
// Which Bot a bb automation Studio didn't make belongs to: the Bot whose
// thread it targets or was created from (the Bot's chat, its conversations
// and workers in bot_threads, its runners' threads); else the primary Bot.
//
// The mirror. BB Studio's first-run import from bb (the fork's
// apps/server/src/services/fork-import/first-run.ts) pauses every Studio
// automation and runner, stops the Bots, turns bb's automations plugin off
// and sets every bb automation `enabled = 0`, so the copy never runs them a
// second time beside the live bb install; the plugin sync never copies those
// tables again. On such an install a row made before the import that is
// still paused is "in bb": shown as Paused · in bb and read-only here. The
// fork's take-over covers threads only; automations have none.
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AutomationTable, AutomationTableKind, AutomationTableRow } from "./automation-table-contract";
import { cronValues, DAY_WORDS, describeCron, fromHeartbeat, minuteOf, type Schedule } from "./schedule";

// ---- When, in a few words ---------------------------------------------------

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
/** A minute of the day on a 24-hour clock: "07:45". */
export const clock24 = (minute: number) => `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;

/** "Daily", "Weekdays", "Weekends", "Sun", "Mon, Wed". */
export function daysText(days: readonly number[]): string {
  const set = [...new Set(days.map((day) => day % 7))].sort((a, b) => a - b);
  if (set.length === 7) return "Daily";
  if (set.join() === "1,2,3,4,5") return "Weekdays";
  if (set.join() === "0,6") return "Weekends";
  return set.map((day) => DAY_SHORT[day]).join(", ");
}

const onDays = (days: string) => (days === "Daily" ? "" : ` · ${days}`);
const evenStep = (values: readonly number[]) => {
  if (values.length < 3) return null;
  const step = values[1]! - values[0]!;
  return values.every((value, i) => i === 0 || value - values[i - 1]! === step) ? step : null;
};
const contiguous = (values: readonly number[]) => values.every((value, i) => i === 0 || value === values[i - 1]! + 1);

/**
 * A five-field cron on a 24-hour clock: "Daily 04:30", "Sun 10:15",
 * "Daily 07:15, 12:15, 17:15, 22:15", "Every 2 h, 08:00–22:00",
 * "Every 20 min", "Hourly at :15 · Weekdays". Anything else as
 * describeCron says it ("Custom: <cron>" when nothing fits).
 */
export function cronText(expr: string): string {
  const cron = expr.trim().replace(/\s+/g, " ");
  const fields = cron.split(" ");
  if (fields.length !== 5) return describeCron(cron);
  const [minField, hourField, dom, month, dowField] = fields as [string, string, string, string, string];
  const minutes = cronValues(minField, 0, 59);
  const hours = cronValues(hourField, 0, 23);
  const days = cronValues(dowField, 0, 7, DAY_WORDS);
  if (dom !== "*" || month !== "*" || !minutes || !hours || !days) return describeCron(cron);
  const day = daysText(days);
  const allHours = hours.length === 24;
  const minuteStep = /^\*\/(\d+)$/.exec(minField);
  const hourStep = /^\*\/(\d+)$/.exec(hourField);
  if (minutes.length === 60 && allHours) return `Every minute${onDays(day)}`;
  if (minuteStep && allHours) return `Every ${Number(minuteStep[1])} min${onDays(day)}`;
  if (minuteStep && contiguous(hours)) return `Every ${Number(minuteStep[1])} min, ${clock24(hours[0]! * 60)}–${clock24(hours.at(-1)! * 60 + minutes.at(-1)!)}${onDays(day)}`;
  if (minutes.length === 1) {
    const minute = minutes[0]!;
    const past = minute ? ` at :${pad(minute)}` : "";
    if (allHours) return `Hourly${past}${onDays(day)}`;
    if (hourStep) return `Every ${Number(hourStep[1])} h${past}${onDays(day)}`;
    const times = hours.map((hour) => clock24(hour * 60 + minute));
    if (times.length <= 4) return `${day} ${times.join(", ")}`;
    const step = evenStep(hours);
    if (step) return `Every ${step} h, ${times[0]}–${times.at(-1)}${onDays(day)}`;
    return `${times.length}× ${day === "Daily" ? "daily" : day}`;
  }
  if (hours.length === 1 && minutes.length <= 4) return `${day} ${minutes.map((minute) => clock24(hours[0]! * 60 + minute)).join(", ")}`;
  return describeCron(cron);
}

/** A Studio schedule in a few words, 24-hour: "Daily 07:45", "Every 2 h, 08:00–23:00", "Hourly · quiet 03:00–05:00". */
export function whenText(schedule: Schedule, now = Date.now()): string {
  if (schedule.type === "once") {
    const at = new Date(schedule.at);
    const year = at.getFullYear() === new Date(now).getFullYear() ? "" : ` ${at.getFullYear()}`;
    return `Once, ${MONTH_SHORT[at.getMonth()]} ${at.getDate()}${year} ${clock24(at.getHours() * 60 + at.getMinutes())}`;
  }
  let text: string;
  if (schedule.type === "cron") text = cronText(schedule.cron);
  else if (schedule.type === "times") text = `${daysText(schedule.days)} ${[...schedule.times].sort().map((time) => clock24(minuteOf(time))).join(", ")}`;
  else {
    const every = schedule.every === 1 ? (schedule.unit === "hours" ? "Hourly" : "Every minute") : `Every ${schedule.every} ${schedule.unit === "hours" ? "h" : "min"}`;
    const from = schedule.from ?? "00:00", to = schedule.to ?? "23:59";
    const window = from !== "00:00" || to !== "23:59" ? `, ${from}–${to}` : "";
    text = `${every}${window}${onDays(daysText(schedule.days))}`;
  }
  if (schedule.quiet) text += ` · quiet ${schedule.quiet.from}–${schedule.quiet.to}`;
  if (schedule.until) text += ` · until ${schedule.until}`;
  return text;
}

// ---- The rows, as read ------------------------------------------------------

type LastRun = AutomationTableRow["lastRun"];
type Status = AutomationTableRow["status"];

/** One of Studio's own rows, as read. */
export interface StudioEntry {
  id: string;
  botId: string;
  kind: Exclude<AutomationTableKind, "bb">;
  name: string;
  when: string;
  status: Status;
  /** Null for the heartbeat and maintenance, which the import doesn't pause. */
  createdAt: number | null;
  /** The bb automations (or Studio schedules, `trg_…`) behind it. */
  bbIds: { id: string; projectId: string }[];
  threadId: string | null;
  lastRunAt: number | null;
  lastRun: LastRun;
  instruction: string | null;
  script: string | null;
}

/** One of bb's core automations, as read. */
export interface BbEntry {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  cron: string | null;
  /** A one-shot's time. */
  runAt: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastRunStatus: string | null;
  /** Its target thread, then the thread that created it. */
  threadIds: string[];
  createdAt: number | null;
  instruction: string | null;
}

/** A run status from bb or Studio's scheduler, as the table's mark. */
export function lastRunMark(status: string | null | undefined): LastRun {
  if (!status) return null;
  if (status === "failed") return "failed";
  return status === "succeeded" || status === "skipped" || status === "fired" || status === "ok" ? "ok" : null;
}

/** A Studio schedule's state (bb's `trg_…` ids, Studio's scheduler), when it has one. */
export type ScheduleStatus = (id: string) => { lastRunAt: number | null; lastRunStatus: string | null } | null;

type AutomationRow = {
  id: string; bot_id: string; kind: "watcher" | "checkin" | "reminder"; name: string; instruction: string; script: string | null;
  schedule_json: string; state: string; project_id: string; bb_ids: string; resources: string | null; target: string;
  target_thread_id: string | null; last_fired_at: number | null; created_at: number;
};
type RunnerRow = {
  id: string; bot_id: string; name: string; job: string; thread_id: string | null; project_id: string; state: string;
  cadence: string; time: string; cron: string | null; timezone: string | null; automation_id: string | null;
  automation_project_id: string | null; last_run_at: number | null; created_at: number;
};

function parse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

function latest(runs: { at: number | null; status: LastRun }[]): { at: number | null; status: LastRun } {
  return runs.reduce<{ at: number | null; status: LastRun }>((best, run) => (run.at !== null && (best.at === null || run.at > best.at) ? run : best), { at: null, status: null });
}

/** Studio's watchers, check-ins, reminders and runners, every Bot's. */
export function readStudioEntries(db: Database.Database, scheduleStatus: ScheduleStatus): StudioEntry[] {
  const bbRefs = (row: AutomationRow) => {
    const resources = parse<{ id: string; projectId: string }[] | null>(row.resources, null);
    if (Array.isArray(resources)) return resources.filter((each) => typeof each?.id === "string");
    return parse<unknown[]>(row.bb_ids, []).filter((id): id is string => typeof id === "string").map((id) => ({ id, projectId: row.project_id }));
  };
  const runnerThread = new Map((db.prepare("SELECT id, thread_id FROM bot_runners").all() as { id: string; thread_id: string | null }[]).map((row) => [row.id, row.thread_id]));
  const botThread = new Map((db.prepare("SELECT id, thread_id FROM bots").all() as { id: string; thread_id: string | null }[]).map((row) => [row.id, row.thread_id]));
  const automations = (db.prepare("SELECT * FROM bot_automations").all() as AutomationRow[]).map((row): StudioEntry => {
    const refs = bbRefs(row);
    const own = latest([{ at: row.last_fired_at ?? null, status: null }, ...refs.map((ref) => { const status = scheduleStatus(ref.id); return { at: status?.lastRunAt ?? null, status: lastRunMark(status?.lastRunStatus) }; })]);
    const schedule = parse<Schedule | null>(row.schedule_json, null);
    return {
      id: row.id, botId: row.bot_id, kind: row.kind, name: row.name,
      when: schedule ? whenText(schedule) : "",
      status: row.state === "active" ? "active" : row.state === "paused" ? "paused" : "off",
      createdAt: row.created_at, bbIds: refs,
      threadId: row.target !== "main" ? runnerThread.get(row.target) ?? null : row.target_thread_id ?? botThread.get(row.bot_id) ?? null,
      lastRunAt: own.at, lastRun: own.status,
      instruction: row.instruction.trim() || null, script: row.kind === "watcher" ? row.script : null,
    };
  });
  const runners = (db.prepare("SELECT * FROM bot_runners").all() as RunnerRow[]).map((row): StudioEntry => {
    const status = row.automation_id ? scheduleStatus(row.automation_id) : null;
    const own = latest([{ at: row.last_run_at ?? null, status: null }, { at: status?.lastRunAt ?? null, status: lastRunMark(status?.lastRunStatus) }]);
    return {
      id: row.id, botId: row.bot_id, kind: "runner", name: row.name,
      when: whenText(fromHeartbeat({ cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}) }, row.timezone ?? undefined)),
      status: row.state === "active" ? "active" : "paused",
      createdAt: row.created_at,
      bbIds: row.automation_id ? [{ id: row.automation_id, projectId: row.automation_project_id ?? row.project_id }] : [],
      threadId: row.thread_id, lastRunAt: own.at, lastRun: own.status, instruction: row.job.trim() || null, script: null,
    };
  });
  return [...automations, ...runners];
}

/** Which Bot each thread belongs to: the Bots' chats, their conversations and workers (bot_threads), their runners' threads. */
export function readThreadOwners(db: Database.Database, botThreads: readonly { botId: string; threadId: string | null }[] = []): Map<string, string> {
  const owners = new Map<string, string>();
  const add = (threadId: string | null | undefined, botId: string) => { if (threadId && !owners.has(threadId)) owners.set(threadId, botId); };
  for (const bot of botThreads) add(bot.threadId, bot.botId);
  for (const row of db.prepare("SELECT id, thread_id FROM bots").all() as { id: string; thread_id: string | null }[]) add(row.thread_id, row.id);
  for (const row of db.prepare("SELECT thread_id, bot_id FROM bot_threads").all() as { thread_id: string; bot_id: string }[]) add(row.thread_id, row.bot_id);
  for (const row of db.prepare("SELECT thread_id, bot_id FROM bot_runners WHERE thread_id IS NOT NULL").all() as { thread_id: string; bot_id: string }[]) add(row.thread_id, row.bot_id);
  return owners;
}

const overviewEntry = z.object({
  automation: z.object({
    id: z.string(), projectId: z.string().optional(), name: z.string(), enabled: z.boolean().optional(),
    trigger: z.object({ cron: z.string().optional(), runAt: z.number().optional() }).passthrough().optional(),
    execution: z.object({ prompt: z.string().optional(), targetThreadId: z.string().optional() }).passthrough().optional(),
    createdByThreadId: z.string().nullish(), nextRunAt: z.number().nullish(), lastRunAt: z.number().nullish(),
    lastRunStatus: z.string().nullish(), createdAt: z.number().nullish(),
  }).passthrough(),
  project: z.object({ id: z.string() }).passthrough(),
}).passthrough();

/** bb's automations from its plugin's `automations_overview`. An entry it can't read as an automation is skipped. */
export function bbFromOverview(overview: unknown): BbEntry[] {
  const list = (overview as { automations?: unknown } | null)?.automations;
  return (Array.isArray(list) ? list : []).flatMap((raw): BbEntry[] => {
    const parsed = overviewEntry.safeParse(raw);
    if (!parsed.success) return [];
    const { automation, project } = parsed.data;
    return [{
      id: automation.id, projectId: automation.projectId ?? project.id, name: automation.name, enabled: automation.enabled ?? false,
      cron: automation.trigger?.cron ?? null, runAt: automation.trigger?.runAt ?? null,
      nextRunAt: automation.nextRunAt ?? null, lastRunAt: automation.lastRunAt ?? null, lastRunStatus: automation.lastRunStatus ?? null,
      threadIds: [...new Set([automation.execution?.targetThreadId, automation.createdByThreadId].filter((id): id is string => !!id))],
      createdAt: automation.createdAt ?? null, instruction: automation.execution?.prompt?.trim() || null,
    }];
  });
}

/** bb's automations from its plugin's data file, read-only; none when it isn't there or can't be read. */
export function bbFromFile(path: string): BbEntry[] {
  if (!existsSync(path)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 1000");
    const rows = db.prepare("SELECT id, project_id, target_thread_id, name, enabled, trigger_config, execution, created_by_thread_id, next_run_at, last_run_at, last_run_status, created_at FROM automations").all() as {
      id: string; project_id: string; target_thread_id: string | null; name: string; enabled: number; trigger_config: string; execution: string;
      created_by_thread_id: string | null; next_run_at: number | null; last_run_at: number | null; last_run_status: string | null; created_at: number | null;
    }[];
    return rows.map((row) => {
      const trigger = parse<{ cron?: unknown; runAt?: unknown }>(row.trigger_config, {});
      const execution = parse<{ prompt?: unknown; targetThreadId?: unknown }>(row.execution, {});
      return {
        id: row.id, projectId: row.project_id, name: row.name, enabled: row.enabled === 1,
        cron: typeof trigger.cron === "string" ? trigger.cron : null, runAt: typeof trigger.runAt === "number" ? trigger.runAt : null,
        nextRunAt: row.next_run_at, lastRunAt: row.last_run_at, lastRunStatus: row.last_run_status,
        threadIds: [...new Set([row.target_thread_id, typeof execution.targetThreadId === "string" ? execution.targetThreadId : null, row.created_by_thread_id].filter((id): id is string => !!id))],
        createdAt: row.created_at, instruction: typeof execution.prompt === "string" ? execution.prompt.trim() || null : null,
      };
    });
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/** When BB Studio's one-way import from bb ran (`fork-import.json` in the server's data folder), or null on an install without it or once it is cut over from bb. */
export function readImportedAt(dataDir: string): number | null {
  try {
    const state = JSON.parse(readFileSync(join(dataDir, "fork-import.json"), "utf8")) as { version?: unknown; sourceDataDir?: unknown; importedAt?: unknown; cutoverAt?: unknown };
    if (state.version !== 1 || typeof state.sourceDataDir !== "string") return null;
    if (typeof state.cutoverAt === "number" || mirrorPaused(dataDir)) return null;
    return typeof state.importedAt === "number" ? state.importedAt : Number.MAX_SAFE_INTEGER;
  } catch {
    return null;
  }
}

function mirrorPaused(dataDir: string): boolean {
  const path = join(dataDir, "fork-import.db");
  if (!existsSync(path)) return false;
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 1000");
    const row = db.prepare("SELECT value FROM cursors WHERE key = 'paused'").get() as { value: string } | undefined;
    return row?.value === "true";
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

// ---- The merge --------------------------------------------------------------

export interface TableInput {
  botId: string;
  primaryBotId: string | null;
  bots: readonly { id: string; name: string }[];
  studio: readonly StudioEntry[];
  bb: readonly BbEntry[];
  threadOwners: ReadonlyMap<string, string>;
  /** When the mirror's import ran; null on an install without it. */
  importedAt: number | null;
  bbPlugin: AutomationTable["bbPlugin"];
}

const RUNNER_NAME = /^Studio runner (run_[A-Za-z0-9_-]+)$/;

/** Which Bot a bb automation Studio didn't make belongs to, and why. */
function owner(entry: BbEntry, input: TableInput): { botId: string | null; via: "thread" | "primary" } {
  for (const threadId of entry.threadIds) {
    const botId = input.threadOwners.get(threadId);
    if (botId) return { botId, via: "thread" };
  }
  return { botId: input.primaryBotId ?? input.bots[0]?.id ?? null, via: "primary" };
}

const bbStatus = (entry: BbEntry): Status => {
  if (entry.enabled) return "active";
  return entry.runAt !== null && entry.lastRunAt !== null && entry.lastRunAt >= entry.runAt && entry.nextRunAt === null ? "off" : "paused";
};

const bbWhen = (entry: BbEntry): string => {
  if (entry.cron) return cronText(entry.cron);
  if (entry.runAt !== null) return whenText({ type: "once", at: entry.runAt });
  return "";
};

/** The rows for one Bot: its Studio rows with the bb automations behind them, and the bb automations attributed to it. Active first, then by name. */
export function automationTable(input: TableInput): AutomationTable {
  const botName = new Map(input.bots.map((bot) => [bot.id, bot.name]));
  const byBbId = new Map<string, StudioEntry>();
  const byName = new Map<string, StudioEntry>();
  for (const entry of input.studio) {
    for (const ref of entry.bbIds) if (!byBbId.has(ref.id)) byBbId.set(ref.id, entry);
    if (entry.kind === "runner") byName.set(`Studio runner ${entry.id}`, entry);
    else if (botName.has(entry.botId)) byName.set(`${botName.get(entry.botId)} · ${entry.name}`, entry);
  }
  const linked = new Map<string, BbEntry[]>();
  const loose: { entry: BbEntry; via: "thread" | "primary" }[] = [];
  for (const entry of input.bb) {
    const runnerId = RUNNER_NAME.exec(entry.name)?.[1];
    const studio = byBbId.get(entry.id) ?? byName.get(entry.name) ?? (runnerId ? input.studio.find((each) => each.kind === "runner" && each.id === runnerId) : undefined);
    if (studio) { linked.set(studio.id, [...(linked.get(studio.id) ?? []), entry]); continue; }
    const found = owner(entry, input);
    if (found.botId === input.botId) loose.push({ entry, via: found.via });
  }
  const inBb = (status: Status, createdAt: number | null) => input.importedAt !== null && status === "paused" && createdAt !== null && createdAt <= input.importedAt;
  const rows: AutomationTableRow[] = [];
  for (const entry of input.studio) {
    if (entry.botId !== input.botId) continue;
    const behind = linked.get(entry.id) ?? [];
    const last = latest([{ at: entry.lastRunAt, status: entry.lastRun }, ...behind.map((each) => ({ at: each.lastRunAt, status: lastRunMark(each.lastRunStatus) }))]);
    const bb = entry.bbIds.find((ref) => behind.some((each) => each.id === ref.id)) ?? (behind[0] ? { id: behind[0].id, projectId: behind[0].projectId } : null);
    const mirrored = inBb(entry.status, entry.createdAt);
    rows.push({
      id: entry.id, kind: entry.kind, name: entry.name, when: entry.when || (behind[0] ? bbWhen(behind[0]) : ""),
      lastRunAt: last.at, lastRun: last.status, status: entry.status, inBb: mirrored, readOnly: mirrored,
      bb, threadId: entry.threadId, instruction: entry.instruction, script: entry.script, via: "studio",
    });
  }
  for (const { entry, via } of loose) {
    const status = bbStatus(entry);
    const mirrored = inBb(status, entry.createdAt);
    rows.push({
      id: entry.id, kind: "bb", name: entry.name, when: bbWhen(entry), lastRunAt: entry.lastRunAt, lastRun: entry.lastRunAt === null ? null : lastRunMark(entry.lastRunStatus),
      status, inBb: mirrored, readOnly: mirrored, bb: { id: entry.id, projectId: entry.projectId },
      threadId: entry.threadIds[0] ?? null, instruction: entry.instruction, script: null, via,
    });
  }
  rows.sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
  return { botId: input.botId, mirrored: input.importedAt !== null, bbPlugin: input.bbPlugin, rows };
}
