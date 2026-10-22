// A Bot automation's schedule (src/automations.ts) and its compilation to BB
// automation triggers. The editor speaks in days, times, intervals within an
// active window, quiet hours and an end date; BB takes one five-field cron
// and a timezone (or a one-shot time) per automation. One cron can't say
// "8:00 and 18:30" or "every 45 minutes", so a schedule compiles to as few
// crons as express it exactly, and Studio keeps them as one automation.
// The end date isn't a cron field: Studio pauses the group once it passes.
// Pure: the desktop UI uses the same functions for its preview.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type Common = {
  /** IANA timezone; the server's when missing. */
  timezone?: string;
  /** Skip runs from `from` up to (not including) `to`; may wrap midnight. */
  quiet?: { from: string; to: string } | null;
  /** Last day (YYYY-MM-DD, in the timezone) it runs; it pauses after. */
  until?: string | null;
};
export type Schedule =
  | (Common & { type: "times"; days: Weekday[]; times: string[] })
  | (Common & { type: "interval"; every: number; unit: "minutes" | "hours"; days: Weekday[]; from?: string; to?: string })
  | (Common & { type: "cron"; cron: string })
  | { type: "once"; at: number };

export type Trigger = { triggerType: "schedule"; cron: string; timezone: string } | { triggerType: "once"; runAt: number };

export const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** BB rejects longer crons; more crons than this is a schedule to simplify. */
const MAX_CRON = 100;
export const MAX_TRIGGERS = 8;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function minuteOf(time: string): number {
  const match = TIME.exec(time);
  if (!match) throw new Error(`"${time}" isn't a time like 08:00.`);
  return Number(match[1]) * 60 + Number(match[2]);
}
export const timeOf = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** Whether minute-of-day `m` is inside quiet hours. */
export function inQuiet(m: number, quiet: Common["quiet"]): boolean {
  if (!quiet) return false;
  const from = minuteOf(quiet.from), to = minuteOf(quiet.to);
  if (from === to) return false;
  return from < to ? m >= from && m < to : m >= from || m < to;
}

/** The minutes of the day a times or interval schedule runs at, quiet hours removed. */
export function runMinutes(schedule: Extract<Schedule, { type: "times" | "interval" }>): number[] {
  let minutes: number[];
  if (schedule.type === "times") {
    minutes = schedule.times.map(minuteOf);
  } else {
    const step = schedule.every * (schedule.unit === "hours" ? 60 : 1);
    if (!Number.isInteger(schedule.every) || schedule.every < 1 || step > 24 * 60) throw new Error("Choose an interval between 1 minute and 24 hours.");
    const from = minuteOf(schedule.from ?? "00:00"), to = minuteOf(schedule.to ?? "23:59");
    if (to < from) throw new Error("The active window must end after it starts, on the same day.");
    minutes = [];
    for (let m = from; m <= to; m += step) minutes.push(m);
  }
  return [...new Set(minutes)].filter((m) => !inQuiet(m, schedule.quiet)).sort((a, b) => a - b);
}

/** A cron field for a set of values in [min, max]: *, a step, or ranges. */
export function cronField(values: number[], min: number, max: number): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const span = max - min + 1;
  if (sorted.length === span) return "*";
  if (sorted.length > 1 && sorted[0] === min) {
    const step = sorted[1]! - sorted[0]!;
    if (step > 1 && span % step === 0 && sorted.length === span / step && sorted.every((value, i) => value === min + i * step)) return `*/${step}`;
  }
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j - i >= 2 ? `${sorted[i]}-${sorted[j]}` : sorted.slice(i, j + 1).join(","));
    i = j + 1;
  }
  return parts.join(",");
}

/** The weekday field: * for every day. */
export function dayField(days: readonly number[]): string {
  if (!days.length) throw new Error("Pick at least one day.");
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Days are 0 (Sunday) to 6 (Saturday).");
  return cronField([...days], 0, 6);
}

/** The crons for run minutes on days: one per set of minutes that share the same hours. */
export function cronsFor(minutes: number[], days: readonly number[]): string[] {
  const week = dayField(days);
  const hoursByMinute = new Map<number, number[]>();
  for (const m of minutes) hoursByMinute.set(m % 60, [...(hoursByMinute.get(m % 60) ?? []), Math.floor(m / 60)]);
  const minutesByHours = new Map<string, number[]>();
  for (const [minute, hours] of hoursByMinute) {
    const key = cronField(hours, 0, 23);
    minutesByHours.set(key, [...(minutesByHours.get(key) ?? []), minute]);
  }
  return [...minutesByHours].map(([hours, mins]) => `${cronField(mins, 0, 59)} ${hours} * * ${week}`);
}

const CRON = /^\S+(\s+\S+){4}$/;

/** The server's timezone. */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Compiles a schedule to BB triggers. Throws in words the user can act on. */
export function compileSchedule(schedule: Schedule, options: { now?: number; defaultTimezone?: string } = {}): Trigger[] {
  if (schedule.type === "once") {
    if (!Number.isFinite(schedule.at) || schedule.at <= (options.now ?? Date.now())) throw new Error("Pick a time in the future.");
    return [{ triggerType: "once", runAt: Math.round(schedule.at) }];
  }
  const timezone = schedule.timezone || options.defaultTimezone || localZone();
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { throw new Error(`"${timezone}" isn't a timezone.`); }
  if (schedule.until) endOfDay(schedule.until, timezone);
  let crons: string[];
  if (schedule.type === "cron") {
    const cron = schedule.cron.trim().replace(/\s+/g, " ");
    if (!CRON.test(cron)) throw new Error("A cron has five fields: minute hour day month weekday.");
    if (schedule.quiet) throw new Error("Quiet hours don't apply to a raw cron; leave them out of the cron instead.");
    crons = [cron];
  } else {
    const minutes = runMinutes(schedule);
    if (!minutes.length) throw new Error(schedule.quiet ? "Quiet hours cover every run time." : "Add at least one time.");
    crons = cronsFor(minutes, schedule.days);
  }
  if (crons.length > MAX_TRIGGERS) throw new Error(`That needs ${crons.length} separate schedules; use fewer distinct minutes (at most ${MAX_TRIGGERS}).`);
  const long = crons.find((cron) => cron.length > MAX_CRON);
  if (long) throw new Error("That schedule is too long for one cron; use fewer times.");
  return crons.map((cron) => ({ triggerType: "schedule", cron, timezone }));
}

/** Epoch ms at the end of `date` (YYYY-MM-DD) in `timezone`. */
export function endOfDay(date: string, timezone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`"${date}" isn't a date like 2026-12-31.`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) throw new Error(`"${date}" isn't a valid calendar date.`);
  // Midnight starting the next day, in the zone: guess UTC, then correct by the zone's offset there.
  const guess = Date.UTC(y, m - 1, d + 1);
  const offset = (at: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - at;
  };
  const first = guess - offset(guess);
  return guess - offset(first) - 1;
}

// 12-hour, like describeCron, so the Automations list reads one way.
const clock = (time: string) => {
  const { time: text, half } = clock12(minuteOf(time));
  return `${text} ${half}`;
};

export function daysLabel(days: readonly number[]): string {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return "Every day";
  if (set.join() === "1,2,3,4,5") return "Weekdays";
  if (set.join() === "0,6") return "Weekends";
  return set.map((day) => DAY_NAMES[day]).join(", ");
}

// --- A cron in plain English ------------------------------------------------

const DAY_WORDS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const PLURAL_DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** A cron field's values in [min, max] (*, n, a-b, lists, /steps, day names), or null if it isn't one. */
function cronValues(field: string, min: number, max: number, names?: Record<string, number>): number[] | null {
  const values = new Set<number>();
  const value = (text: string) => {
    const named = names?.[text.toLowerCase()];
    if (named !== undefined) return named;
    if (!/^\d+$/.test(text)) return NaN;
    return Number(text);
  };
  for (const part of field.split(",")) {
    const match = /^(\*|[^-/]+(?:-[^-/]+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) return null;
    const step = match[2] ? Number(match[2]) : 1;
    let from: number, to: number;
    if (match[1] === "*") { from = min; to = max; } else {
      const [a, b] = match[1]!.split("-");
      from = value(a!); to = b === undefined ? (match[2] ? max : from) : value(b);
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || step < 1 || from < min || to > max || from > to) return null;
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return [...values].sort((a, b) => a - b);
}

/** A minute of the day on a 12-hour clock: "7:05" and its half. */
function clock12(minute: number): { time: string; half: "AM" | "PM" } {
  const h = Math.floor(minute / 60), m = minute % 60;
  return { time: `${h % 12 || 12}:${String(m).padStart(2, "0")}`, half: h < 12 ? "AM" : "PM" };
}
const at12 = (minute: number) => { const { time, half } = clock12(minute); return `${time} ${half}`; };

/** "7, 12, 5, 10 PM" style: whole hours lose ":00", and AM/PM follows the last time of each run of AM or PM times. */
function shortTimes(minutes: number[]): string {
  return minutes.map((minute, i) => {
    const { time, half } = clock12(minute);
    const text = minute % 60 ? time : time.replace(/:00$/, "");
    const next = minutes[i + 1];
    return next === undefined || clock12(next).half !== half ? `${text} ${half}` : text;
  }).join(", ");
}

/** The days a weekday field names: "Daily", "Weekdays", "Weekends", "Mondays", "Mon, Wed". */
function cronDays(days: number[]): string {
  const set = [...new Set(days.map((day) => day % 7))].sort();
  if (set.length === 7) return "Daily";
  if (set.length === 1) return PLURAL_DAYS[set[0]!]!;
  return daysLabel(set);
}

/** A label for `timezone` when it isn't this machine's: "(London time)". */
function zoneNote(timezone?: string): string {
  if (!timezone || timezone === localZone()) return "";
  return ` (${timezone.split("/").pop()!.replace(/_/g, " ")} time)`;
}

/**
 * A five-field cron in plain English: "Daily 7:05 AM and 5:05 PM", "Every 2
 * hours", "4× daily: 7 AM, 12, 5, 10 PM", "Weekdays 9:00 AM", "Mondays
 * 8:30 AM", "Every 15 minutes". The timezone shows only when it isn't the
 * local one. Anything else is "Custom: <cron>". Pure.
 */
export function describeCron(expr: string, timezone?: string): string {
  const cron = expr.trim().replace(/\s+/g, " ");
  const custom = `Custom: ${cron}`;
  const fields = cron.split(" ");
  if (fields.length !== 5) return custom;
  const [minField, hourField, dom, month, dowField] = fields as [string, string, string, string, string];
  if (dom !== "*" || month !== "*") return custom;
  const minutes = cronValues(minField, 0, 59);
  const hours = cronValues(hourField, 0, 23);
  const days = cronValues(dowField, 0, 7, DAY_WORDS);
  if (!minutes || !hours || !days) return custom;
  const dayText = cronDays(days);
  // "daily", "weekdays", "weekends" lower-cased mid-sentence; day names stay capitalized.
  const dayWord = /^(Daily|Weekdays|Weekends)$/.test(dayText) ? dayText.toLowerCase() : dayText;
  const onDays = dayText === "Daily" ? "" : ` on ${dayWord}`;
  const zone = zoneNote(timezone);
  const allHours = hours.length === 24;
  const hourStep = /^\*\/(\d+)$/.exec(hourField);
  const minuteStep = /^\*\/(\d+)$/.exec(minField);
  let text: string | null = null;
  if (minutes.length === 60 && allHours) text = `Every minute${onDays}`;
  else if (minuteStep && allHours) text = `Every ${Number(minuteStep[1])} minutes${onDays}`;
  else if (minuteStep && hours.length > 1 && hours.every((h, i) => i === 0 || h === hours[i - 1]! + 1)) {
    text = `Every ${Number(minuteStep[1])} minutes, ${at12(hours[0]! * 60).replace(":00", "")}–${at12(((hours.at(-1)! + 1) % 24) * 60).replace(":00", "")}${onDays}`;
  } else if (minutes.length === 1) {
    const minute = minutes[0]!;
    const past = minute ? ` at :${String(minute).padStart(2, "0")}` : "";
    if (allHours) text = `Hourly${past}${onDays}`;
    else if (hourStep) text = `Every ${Number(hourStep[1])} hours${past}${onDays}`;
    else {
      const times = hours.map((hour) => hour * 60 + minute);
      if (times.length === 1) text = `${dayText} ${at12(times[0]!)}`;
      else if (times.length === 2) text = `${dayText} ${at12(times[0]!)} and ${at12(times[1]!)}`;
      else text = `${times.length}× ${dayWord}: ${shortTimes(times)}`;
    }
  } else if (hours.length === 1 && minutes.length <= 4) {
    const times = minutes.map((minute) => hours[0]! * 60 + minute);
    text = times.length === 2 ? `${dayText} ${at12(times[0]!)} and ${at12(times[1]!)}` : `${times.length}× ${dayWord}: ${shortTimes(times)}`;
  }
  return text ? text + zone : custom;
}

/** The schedule in a few words, for lists and tools. */
export function describeSchedule(schedule: Schedule, now = Date.now()): string {
  if (schedule.type === "once") {
    const at = new Date(schedule.at);
    const sameDay = new Date(now).toDateString() === at.toDateString();
    return `Once, ${sameDay ? "today" : at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  let text: string;
  if (schedule.type === "cron") text = describeCron(schedule.cron, schedule.timezone);
  else if (schedule.type === "times") text = `${daysLabel(schedule.days)} ${[...schedule.times].sort().map(clock).join(", ")}`;
  else {
    const every = schedule.every === 1 ? (schedule.unit === "hours" ? "Hourly" : "Every minute") : `Every ${schedule.every} ${schedule.unit === "hours" ? "h" : "min"}`;
    const window = (schedule.from ?? "00:00") !== "00:00" || (schedule.to ?? "23:59") !== "23:59" ? ` ${clock(schedule.from ?? "00:00")}–${clock(schedule.to ?? "23:59")}` : "";
    text = `${every}${window}, ${daysLabel(schedule.days).toLowerCase()}`;
  }
  if (schedule.quiet) text += ` · quiet ${clock(schedule.quiet.from)}–${clock(schedule.quiet.to)}`;
  if (schedule.until) text += ` · until ${schedule.until}`;
  return text;
}

/** A project heartbeat's schedule (cadence and time) as a schedule, for the migrated check-in. */
export function fromHeartbeat(run: { cadence: string; time: string; cron?: string }, timezone?: string): Schedule {
  const tz = timezone ? { timezone } : {};
  const minute = minuteOf(run.time) % 60;
  const every = (n: number, unit: "minutes" | "hours"): Schedule => ({ type: "interval", every: n, unit, days: ALL_DAYS, from: unit === "hours" ? timeOf(minute) : "00:00", to: "23:59", ...tz });
  switch (run.cadence) {
    case "every5minutes": return every(5, "minutes");
    case "every15minutes": return every(15, "minutes");
    case "every30minutes": return every(30, "minutes");
    case "hourly": return every(1, "hours");
    case "every2hours": return every(2, "hours");
    case "every6hours": return every(6, "hours");
    case "daily": return { type: "times", days: ALL_DAYS, times: [run.time], ...tz };
    case "weekdays": return { type: "times", days: WEEKDAYS, times: [run.time], ...tz };
    case "weekly": return { type: "times", days: [1], times: [run.time], ...tz };
    default: return { type: "cron", cron: run.cron ?? "0 9 * * *", ...tz };
  }
}

/** Presets for the editor and the bot's tool. */
export const SCHEDULE_PRESETS: { id: string; label: string; schedule: Schedule }[] = [
  { id: "weekday-mornings", label: "Weekday mornings", schedule: { type: "times", days: WEEKDAYS, times: ["08:00"] } },
  { id: "weekday-evenings", label: "Weekday evenings", schedule: { type: "times", days: WEEKDAYS, times: ["18:00"] } },
  { id: "twice-daily", label: "Morning and evening", schedule: { type: "times", days: ALL_DAYS, times: ["08:00", "18:00"] } },
  { id: "working-hours", label: "Every 2 h while working", schedule: { type: "interval", every: 2, unit: "hours", days: WEEKDAYS, from: "09:00", to: "17:00" } },
  { id: "every-15", label: "Every 15 min", schedule: { type: "interval", every: 15, unit: "minutes", days: ALL_DAYS, from: "00:00", to: "23:59", quiet: { from: "22:00", to: "07:00" } } },
  { id: "weekly", label: "Mondays", schedule: { type: "times", days: [1], times: ["09:00"] } },
];

/** A delay like 30s, 5m, 2h or 1d, in ms. */
export function parseDuration(text: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(text.trim());
  if (!match) throw new Error(`"${text}" isn't a delay like 30m, 2h or 1d.`);
  return Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]!.toLowerCase() as "s" | "m" | "h" | "d"];
}
