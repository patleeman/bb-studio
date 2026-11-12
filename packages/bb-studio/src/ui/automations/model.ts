// The automations that wake one thread: parsed defensively from the built-in
// automations plugin's `automations_list`, filtered to the thread, and
// described in plain words for the thread panel tab and header badge.
import { z } from "zod";

export const AUTOMATIONS_PLUGIN_ID = "automations";
export const AUTOMATIONS_PANEL_PATH = "automations";
export const AUTOMATIONS_TAB = "thread-automations";

const triggerSchema = z.union([
  z.object({ triggerType: z.literal("schedule"), cron: z.string(), timezone: z.string().optional() }).passthrough(),
  z.object({ triggerType: z.literal("once"), runAt: z.number() }).passthrough(),
  z.object({ triggerType: z.string() }).passthrough(),
]);

const automationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: triggerSchema,
  execution: z.object({ targetThreadId: z.string().nullish() }).passthrough(),
  nextRunAt: z.number().nullish(),
  lastRunAt: z.number().nullish(),
  lastRunStatus: z.string().nullish(),
  lastError: z.string().nullish(),
}).passthrough();

export type ThreadAutomation = z.infer<typeof automationSchema>;

/** Accepts any response; rows that don't parse (read problems, new shapes) are dropped. */
export const automationListSchema: z.ZodType<unknown> = z.unknown();

export function automationsForThread(raw: unknown, threadId: string): ThreadAutomation[] {
  if (!Array.isArray(raw)) return [];
  const rows: ThreadAutomation[] = [];
  for (const entry of raw) {
    const parsed = automationSchema.safeParse(entry);
    if (parsed.success && parsed.data.execution.targetThreadId === threadId) rows.push(parsed.data);
  }
  return rows.sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name));
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isInt = (s: string) => /^\d+$/.test(s);
const clock = (h: string, m: string) => `${Number(h)}:${m.padStart(2, "0")}`;

function dayLabel(dow: string): string | null {
  if (dow === "*") return "Daily";
  if (dow === "1-5" || dow === "MON-FRI" || dow === "mon-fri") return "Weekdays";
  if (dow === "0,6" || dow === "6,0" || dow === "6-7" || dow === "6,7") return "Weekends";
  const parts = dow.split(",");
  if (parts.every(p => isInt(p) && Number(p) <= 7)) return parts.map(p => DAYS[Number(p) % 7]).join(", ");
  return null;
}

/** "Every 30 min", "Weekdays 9:00", ...; the cron string itself when unrecognised. */
export function scheduleSummary(trigger: ThreadAutomation["trigger"], now = Date.now()): string {
  if (trigger.triggerType === "once" && typeof trigger.runAt === "number") {
    return `Once, ${formatWhen(trigger.runAt, now)}`;
  }
  if (trigger.triggerType !== "schedule" || typeof trigger.cron !== "string") return "Custom trigger";
  const cron = trigger.cron.trim();
  const fields = cron.split(/\s+/);
  if (fields.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = fields as [string, string, string, string, string];
  if (dom !== "*" || mon !== "*") return cron;
  if (dow === "*") {
    if (min === "*" && hour === "*") return "Every minute";
    const everyMin = /^\*\/(\d+)$/.exec(min);
    if (everyMin && hour === "*") return `Every ${Number(everyMin[1])} min`;
    if (isInt(min) && hour === "*") return min === "0" ? "Hourly" : `Hourly at :${min.padStart(2, "0")}`;
    const everyHour = /^\*\/(\d+)$/.exec(hour);
    if (everyHour && isInt(min)) return Number(everyHour[1]) === 1 ? "Hourly" : `Every ${Number(everyHour[1])} hours`;
  }
  if (isInt(min) && isInt(hour)) {
    const days = dayLabel(dow);
    if (days) return `${days} ${clock(hour, min)}`;
  }
  if (isInt(min) && /^\d+(,\d+)+$/.test(hour) && dow === "*") {
    return `Daily ${hour.split(",").map(h => clock(h, min)).join(", ")}`;
  }
  return cron;
}

/** "in 5 min", "3 h ago", "now". */
export function relativeTime(at: number, now = Date.now()): string {
  const diff = at - now;
  const abs = Math.abs(diff);
  const minute = 60_000, hour = 3_600_000, day = 86_400_000;
  if (abs < minute) return "now";
  const value = abs < hour ? `${Math.round(abs / minute)} min` : abs < day ? `${Math.round(abs / hour)} h` : `${Math.round(abs / day)} d`;
  return diff > 0 ? `in ${value}` : `${value} ago`;
}

function formatWhen(at: number, now: number): string {
  const date = new Date(at);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  return sameDay ? time : `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export function nextRunLabel(row: ThreadAutomation, now = Date.now()): string {
  if (!row.enabled) return "Paused";
  if (row.nextRunAt == null) return "Not scheduled";
  return `Next ${relativeTime(row.nextRunAt, now)}`;
}

export function lastRunLabel(row: ThreadAutomation, now = Date.now()): string | null {
  if (row.lastRunAt == null) return row.lastRunStatus ? `Last run ${row.lastRunStatus}` : null;
  const status = row.lastRunStatus === "succeeded" ? "ok" : row.lastRunStatus ?? "ran";
  return `Last ${status} ${relativeTime(row.lastRunAt, now)}`;
}

export function editPath(row: Pick<ThreadAutomation, "projectId" | "id">): string {
  return `/plugins/${AUTOMATIONS_PLUGIN_ID}/${AUTOMATIONS_PANEL_PATH}/${encodeURIComponent(row.projectId)}/${encodeURIComponent(row.id)}/edit`;
}

export type AutomationsState =
  | { kind: "loading" }
  /** The Automations plugin is not installed, is off, or failed to start. */
  | { kind: "absent" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; rows: ThreadAutomation[] };

/** Whether the Automations plugin is installed and running, from `sdk.plugins.list()`. */
export function automationsPresent(plugins: readonly { id: string; enabled: boolean; status?: string }[]): boolean {
  const entry = plugins.find((plugin) => plugin.id === AUTOMATIONS_PLUGIN_ID);
  return Boolean(entry?.enabled && entry.status !== "error" && entry.status !== "incompatible");
}
