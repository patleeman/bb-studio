// The Automations week calendar's model (AutomationsCalendar.tsx): every
// check-in, reminder, watcher, runner and plain BB schedule of a Bot expanded
// into its runs in a window of days, in the viewer's time zone. Past runs come
// from run history (each links to its thread and carries its error when it
// failed), a run going on now is live, and the rest are the schedule's next
// occurrences. A job that runs many times a day collapses into one band per
// day. Pure, so the expansion is tested without a browser.
import { cronValues, DAY_WORDS, endOfDay, runMinutes, type Schedule } from "../../schedule";

export type CalendarRun = { id: string; at: number; status: string; outcome: string; threadId: string | null; manual?: boolean };
export type CalendarSource = {
  id: string; name: string;
  kind: "checkin" | "reminder" | "watcher" | "runner" | "heartbeat" | "automation";
  /** A Studio schedule, or null for a plain BB job, which has only its cron. */
  schedule: Schedule | null;
  cron?: string | null;
  state: "active" | "paused" | "done" | "ended";
  nextRunAt: number | null;
  /** Where a run without its own thread opens: a runner's thread. */
  threadId: string | null;
  scheduleText: string;
  /** Run history, any order; null when there is none to read (plain BB jobs), so past occurrences show as scheduled. */
  runs: CalendarRun[] | null;
  /** A runner's last run, for when it isn't in the history read. */
  lastRun?: { at: number; status: string | null } | null;
  /** A run going on now: when it started. */
  runningSince?: number | null;
};
export type EventStatus = "scheduled" | "running" | "ok" | "failed" | "skipped";
export type CalendarEvent = {
  key: string; sourceId: string; at: number; status: EventStatus;
  /** The run's outcome ("Ran", "Woke it: …"); null for one that hasn't happened. */
  outcome: string | null;
  error: string | null;
  /** The thread a past or live run opens; null for scheduled ones. */
  threadId: string | null;
  manual: boolean;
};
export type CalendarBand = { sourceId: string; events: CalendarEvent[]; from: number; to: number; every: string };
export type CalendarDay = { start: number; end: number; singles: CalendarEvent[]; bands: CalendarBand[] };

const MINUTE = 60_000;
/** Runs read per automation; the List row, its recent runs and the calendar share the request. */
export const RUNS_LIMIT = 50;
/** More runs than this in a day draw as a band, not blocks. */
export const DENSE_PER_DAY = 8;
/** Occurrences one job may add to a window, so a every-minute cron stays cheap. */
const MAX_OCCURRENCES = 3000;

// ---- Time zones -------------------------------------------------------------

type Parts = { year: number; month: number; day: number; minute: number };
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(at: number, zone: string): Parts {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    formatters.set(zone, format);
  }
  const p = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), minute: Number(p.hour) * 60 + Number(p.minute) };
}
const offset = (at: number, zone: string) => {
  const p = parts(at, zone);
  return Date.UTC(p.year, p.month - 1, p.day, 0, p.minute) - Math.floor(at / MINUTE) * MINUTE;
};

const wallOf = (at: number, zone: string) => { const p = parts(at, zone); return Date.UTC(p.year, p.month - 1, p.day, 0, p.minute); };
/**
 * Epoch ms of a wall-clock time in `zone`. `day` may overflow (Date.UTC
 * normalizes it). A time the clocks skip (spring forward) lands an hour later,
 * as cron runs it; a time that happens twice (fall back) is its first.
 */
export function zonedTime(year: number, month: number, day: number, minute: number, zone: string): number {
  const wall = Date.UTC(year, month - 1, day, 0, minute);
  // The offsets either side of any change near this date.
  const candidates = [...new Set([offset(wall - 86_400_000, zone), offset(wall + 86_400_000, zone)])].map((each) => wall - each);
  const valid = candidates.filter((at) => wallOf(at, zone) === wall);
  return valid.length ? Math.min(...valid) : Math.max(...candidates);
}

/** Midnight starting the day `at` falls on, in `zone`. */
export function startOfDay(at: number, zone: string): number {
  const p = parts(at, zone);
  return zonedTime(p.year, p.month, p.day, 0, zone);
}
/** The minute of the day `at` shows on a clock in `zone`. */
export const minuteOfDay = (at: number, zone: string) => parts(at, zone).minute;

/** `count` days from the one holding `at`, each [start, end) in `zone`. */
export function windowDays(at: number, count: number, zone: string): { start: number; end: number }[] {
  const p = parts(at, zone);
  return Array.from({ length: count }, (_, i) => ({ start: zonedTime(p.year, p.month, p.day + i, 0, zone), end: zonedTime(p.year, p.month, p.day + i + 1, 0, zone) }));
}

// ---- Occurrences ------------------------------------------------------------

/** Each calendar date (in `zone`) that touches [from, to): year, month, day and weekday. */
function datesIn(from: number, to: number, zone: string): { year: number; month: number; day: number; weekday: number }[] {
  const first = parts(from - 86_400_000, zone);
  const out = [];
  for (let i = 0; ; i++) {
    const date = new Date(Date.UTC(first.year, first.month - 1, first.day + i));
    const start = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0, zone);
    if (start >= to + 86_400_000) break;
    out.push({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() });
  }
  return out;
}

type Matcher = { minutes: number[]; day(date: { month: number; day: number; weekday: number }): boolean };
/** A five-field cron as minutes of the day and a date test; null if it isn't one. */
export function cronMatcher(expr: string): Matcher | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minField, hourField, domField, monthField, dowField] = fields as [string, string, string, string, string];
  const mins = cronValues(minField, 0, 59), hours = cronValues(hourField, 0, 23);
  const dom = cronValues(domField, 1, 31), months = cronValues(monthField, 1, 12);
  const dow = cronValues(dowField, 0, 7, DAY_WORDS)?.map((day) => day % 7);
  if (!mins || !hours || !dom || !months || !dow) return null;
  const domAny = domField === "*", dowAny = dowField === "*";
  return {
    minutes: hours.flatMap((hour) => mins.map((minute) => hour * 60 + minute)),
    // Cron's rule: with both day fields restricted, either may match.
    day: ({ month, day, weekday }) => months.includes(month) && (domAny || dowAny
      ? (domAny || dom.includes(day)) && (dowAny || dow.includes(weekday))
      : dom.includes(day) || dow.includes(weekday)),
  };
}

function scheduleMatcher(schedule: Exclude<Schedule, { type: "once" }>): Matcher | null {
  if (schedule.type === "cron") return cronMatcher(schedule.cron);
  let minutes: number[];
  try { minutes = runMinutes(schedule); } catch { return null; }
  const days = new Set<number>(schedule.days);
  return { minutes, day: ({ weekday }) => days.has(weekday) };
}

/**
 * When a job is due in [from, to): its schedule expanded in its own time zone
 * (`zone` when it names none), its end date respected. A one-off is its one
 * time. A schedule this can't read falls back to its next run.
 */
export function occurrences(source: Pick<CalendarSource, "schedule" | "cron" | "nextRunAt">, from: number, to: number, zone: string): number[] {
  const { schedule } = source;
  if (schedule?.type === "once") return schedule.at >= from && schedule.at < to ? [schedule.at] : [];
  const tz = schedule?.timezone || zone;
  const matcher = schedule ? scheduleMatcher(schedule) : source.cron ? cronMatcher(source.cron) : null;
  if (!matcher) return source.nextRunAt !== null && source.nextRunAt >= from && source.nextRunAt < to ? [source.nextRunAt] : [];
  let until = Infinity;
  if (schedule?.until) try { until = endOfDay(schedule.until, tz); } catch { /* an unreadable end date doesn't end it */ }
  const out = new Set<number>();
  for (const date of datesIn(from, to, tz)) {
    if (!matcher.day(date)) continue;
    for (const minute of matcher.minutes) {
      const at = zonedTime(date.year, date.month, date.day, minute, tz);
      if (at >= from && at < to && at <= until) out.add(at);
      if (out.size >= MAX_OCCURRENCES) return [...out].sort((a, b) => a - b);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ---- Events -----------------------------------------------------------------

export function runStatus(status: string | null | undefined): Exclude<EventStatus, "scheduled"> {
  const text = (status ?? "").toLowerCase();
  if (/running|pending|queued|started/.test(text)) return "running";
  if (/fail|error|timed?.?out/.test(text)) return "failed";
  if (/skip|cancel/.test(text)) return "skipped";
  return "ok";
}
const errorOf = (outcome: string) => outcome.replace(/^Failed:?\s*/i, "") || "Failed";

/**
 * A job's events in [from, to) at `now`: its runs that happened (or are going
 * on), then, if it's active, what's still due. A paused job shows only the runs
 * it made. Without run history, past occurrences show as scheduled.
 */
export function sourceEvents(source: CalendarSource, from: number, to: number, now: number, zone: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const add = (event: Omit<CalendarEvent, "sourceId" | "key">) => events.push({ ...event, sourceId: source.id, key: `${source.id}:${event.at}:${event.status}` });
  for (const run of source.runs ?? []) {
    if (run.at < from || run.at >= to || run.status === "resumed") continue;
    const status = runStatus(run.status);
    if (run.at > now && status !== "running") continue;
    add({ at: run.at, status, outcome: run.outcome, error: status === "failed" ? errorOf(run.outcome) : null, threadId: run.threadId ?? source.threadId, manual: !!run.manual });
  }
  const near = (at: number, status?: EventStatus) => events.some((event) => Math.abs(event.at - at) < MINUTE && (!status || event.status === status));
  const last = source.lastRun;
  if (last && last.at >= from && last.at < to && last.at <= now && !near(last.at)) {
    const status = runStatus(last.status);
    add({ at: last.at, status, outcome: last.status, error: status === "failed" ? errorOf(last.status ?? "") : null, threadId: source.threadId, manual: false });
  }
  const since = source.runningSince;
  if (since && now >= from && now < to && !events.some((event) => event.status === "running")) {
    add({ at: Math.max(since, from), status: "running", outcome: "Running", error: null, threadId: source.threadId, manual: false });
  }
  const live = source.state === "active";
  const due = occurrences(source, from, to, zone);
  for (const at of due) {
    if (at > now ? !live : source.runs !== null || !live) continue;
    // A one-off that ran shows as its run; a due time a live run covers isn't due again.
    if (near(at)) continue;
    add({ at, status: "scheduled", outcome: null, error: null, threadId: null, manual: false });
  }
  if (live && !due.length && source.nextRunAt !== null && source.nextRunAt > now && source.nextRunAt >= from && source.nextRunAt < to && !near(source.nextRunAt)) {
    add({ at: source.nextRunAt, status: "scheduled", outcome: null, error: null, threadId: null, manual: false });
  }
  return events.sort((a, b) => a.at - b.at);
}

/** "every 2 h", "every 15 min": the usual gap between a band's runs. */
export function cadenceLabel(times: number[]): string {
  const gaps = times.slice(1).map((at, i) => Math.round((at - times[i]!) / MINUTE)).filter((gap) => gap > 0).sort((a, b) => a - b);
  if (!gaps.length) return `${times.length}×`;
  const gap = gaps[Math.floor(gaps.length / 2)]!;
  if (gap < 60) return `every ${gap} min`;
  const hours = Math.round(gap / 30) / 2;
  return hours === 1 ? "hourly" : `every ${hours} h`;
}

/**
 * The days of a window: each day's blocks, and a band for each dense job: one
 * whose schedule runs more than DENSE_PER_DAY times on some day of the window,
 * or that ran that often. A dense job is a band on every day, however few of
 * its runs that day shows, so it reads the same all week.
 */
export function calendarDays(sources: CalendarSource[], days: { start: number; end: number }[], now: number, zone: string): CalendarDay[] {
  if (!days.length) return [];
  const from = days[0]!.start, to = days.at(-1)!.end;
  const perDay = (times: number[]) => Math.max(0, ...days.map(({ start, end }) => times.filter((at) => at >= start && at < end).length));
  const all = sources.map((source) => {
    const events = sourceEvents(source, from, to, now, zone);
    const due = occurrences(source, from, to, zone);
    const dense = perDay(due) > DENSE_PER_DAY || perDay(events.map((event) => event.at)) > DENSE_PER_DAY;
    return { source, events, dense, every: cadenceLabel(due.length > 1 ? due : events.filter((event) => !event.manual).map((event) => event.at)) };
  });
  return days.map(({ start, end }) => {
    const day: CalendarDay = { start, end, singles: [], bands: [] };
    for (const { source, events, dense, every } of all) {
      const today = events.filter((event) => event.at >= start && event.at < end);
      if (!today.length) continue;
      if (dense) day.bands.push({ sourceId: source.id, events: today, from: today[0]!.at, to: today.at(-1)!.at, every });
      else day.singles.push(...today);
    }
    day.singles.sort((a, b) => a.at - b.at || a.sourceId.localeCompare(b.sourceId));
    return day;
  });
}

export type PlacedBlock = { event: CalendarEvent; lane: number; of: number; folded: boolean };
export type FoldChip = { at: number; events: CalendarEvent[] };
const PRIORITY: Record<EventStatus, number> = { running: 0, failed: 1, scheduled: 2, ok: 3, skipped: 4 };

/**
 * Blocks `span` minutes tall that would overlap go side by side, at most
 * `maxLanes` across. A cluster that needs more shows its most telling blocks
 * (a live run, then a failure, then the earliest) and folds the rest into a
 * "+N" chip at the cluster's top; its blocks leave room for the chip.
 */
export function placeBlocks(events: CalendarEvent[], zone: string, span: number, maxLanes = Infinity): { blocks: PlacedBlock[]; chips: FoldChip[] } {
  const blocks: PlacedBlock[] = [];
  const chips: FoldChip[] = [];
  let group: { event: CalendarEvent; lane: number }[] = [];
  let ends: number[] = [];
  let groupEnd = -Infinity;
  const finish = () => {
    if (!group.length) return;
    const of = ends.length;
    if (of <= maxLanes) blocks.push(...group.map((each) => ({ ...each, of, folded: false })));
    else {
      const ranked = [...group].sort((a, b) => PRIORITY[a.event.status] - PRIORITY[b.event.status] || a.event.at - b.event.at);
      const shown = ranked.slice(0, Math.max(1, maxLanes)).sort((a, b) => a.event.at - b.event.at);
      blocks.push(...shown.map((each, lane) => ({ event: each.event, lane, of: shown.length, folded: true })));
      chips.push({ at: group[0]!.event.at, events: ranked.slice(shown.length).map((each) => each.event).sort((a, b) => a.at - b.at) });
    }
    group = []; ends = [];
  };
  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    const top = minuteOfDay(event.at, zone);
    if (top >= groupEnd) { finish(); groupEnd = -Infinity; }
    let lane = ends.findIndex((end) => end <= top);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = top + span;
    groupEnd = Math.max(groupEnd, top + span);
    group.push({ event, lane });
  }
  finish();
  return { blocks, chips };
}

/** Where the window `week` pages from today starts: a page is as many days as show. */
export const windowStart = (now: number, week: number, count: number) => now + week * count * 86_400_000;

/** The jobs that are paused, for the calendar's Paused list. */
export const pausedSources = (sources: CalendarSource[]) => sources.filter((source) => source.state === "paused").sort((a, b) => a.name.localeCompare(b.name));
