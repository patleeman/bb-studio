// When a Schedule (src/schedule.ts) next runs, worked out here with no cron
// library: the trigger engine asks for one time after each run. Wall-clock
// times are read in the schedule's time zone, so a daily 9:00 stays 9:00
// across a daylight-saving change.
//
// A time the clocks skip (02:30 on the spring-forward night) runs when the
// gap ends. A time the clocks repeat (01:30 on the fall-back night) runs once
// for fixed times, and both times for schedules that run through every hour
// (an interval, or a cron with `*` hours), as cron does.
import { cronValues, DAY_WORDS, endOfDay, minuteOf, runMinutes, type Schedule } from "../schedule";

const DAY = 86_400_000;
const MONTH_WORDS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const formats = new Map<string, Intl.DateTimeFormat>();

/** The wall clock in `timeZone` at `at`. */
export function wallClock(at: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, Number(part.value)]));
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute!, second: parts.second! };
}

/** How far the zone's wall clock is ahead of UTC at `at`, in ms. */
function offset(at: number, timeZone: string): number {
  const wall = wallClock(at, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(at / 1000) * 1000;
}

/**
 * The instants at which the wall clock in `timeZone` reads this date and
 * time, earliest first: one normally, two when the clocks repeat the hour,
 * and the end of the gap when they skip it.
 */
export function zonedTimes(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number[] {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const before = offset(wall - DAY, timeZone), after = offset(wall + DAY, timeZone);
  const found = [...new Set([before, after])].map((each) => wall - each).filter((at) => offset(at, timeZone) === wall - at).sort((a, b) => a - b);
  return found.length ? found : [wall - before];
}

/** The next time after `now` that the wall clock in `timeZone` reads hour:minute (DST-aware). */
export function nextDailyAt(now: number, hour: number, minute: number, timeZone: string): number {
  const local = wallClock(now, timeZone);
  for (let day = 0; day < 3; day++) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day + day));
    const at = zonedTimes(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, timeZone)[0]!;
    if (at > now) return at;
  }
  return now + DAY;
}

export interface CronPlan { minutes: number[]; hours: number[]; day(date: Date): boolean; everyHour: boolean }

/**
 * A five-field cron (minute hour day-of-month month day-of-week) as the
 * minutes, hours and days it runs; null when it isn't one. `date` is a UTC
 * midnight standing for a calendar day. When both day fields are restricted
 * a day matches either, as in cron.
 */
export function parseCron(cron: string): CronPlan | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, domField, monthField, dowField] = fields as [string, string, string, string, string];
  const minutes = cronValues(minuteField, 0, 59), hours = cronValues(hourField, 0, 23);
  const doms = cronValues(domField, 1, 31), months = cronValues(monthField, 1, 12, MONTH_WORDS), dows = cronValues(dowField, 0, 7, DAY_WORDS);
  if (!minutes || !hours || !doms || !months || !dows) return null;
  const weekdays = new Set(dows.map((each) => each % 7)), monthDays = new Set(doms), inMonths = new Set(months);
  const anyDom = domField.startsWith("*"), anyDow = dowField.startsWith("*");
  return {
    minutes, hours, everyHour: hourField.startsWith("*"),
    day: (date) => {
      if (!inMonths.has(date.getUTCMonth() + 1)) return false;
      const dom = monthDays.has(date.getUTCDate()), dow = weekdays.has(date.getUTCDay());
      return anyDom || anyDow ? dom && dow : dom || dow;
    },
  };
}

/**
 * The next time `schedule` runs after `after`, in epoch ms; null when it never
 * runs again (a one-time schedule that passed, an end date that passed, or a
 * schedule with no run times). `timeZone` is used when the schedule names none.
 */
export function nextRun(schedule: Schedule, after: number, timeZone: string): number | null {
  if (schedule.type === "once") return schedule.at > after ? schedule.at : null;
  const zone = schedule.timezone || timeZone;
  const end = schedule.until ? endOfDay(schedule.until, zone) : Infinity;
  if (after >= end) return null;
  let minutes: number[], onDay: (date: Date) => boolean, repeats: boolean, horizon: number;
  if (schedule.type === "cron") {
    const plan = parseCron(schedule.cron);
    if (!plan) return null;
    minutes = plan.hours.flatMap((hour) => plan.minutes.map((minute) => hour * 60 + minute));
    onDay = plan.day; repeats = plan.everyHour;
    // Far enough for 29 February.
    horizon = 366 * 8;
  } else {
    minutes = runMinutes(schedule);
    const days = new Set<number>(schedule.days);
    onDay = (date) => days.has(date.getUTCDay());
    repeats = schedule.type === "interval" && minuteOf(schedule.to ?? "23:59") - minuteOf(schedule.from ?? "00:00") >= 23 * 60;
    horizon = 8;
  }
  if (!minutes.length) return null;
  const start = wallClock(after, zone);
  const startMinute = start.hour * 60 + start.minute;
  for (let i = 0; i <= horizon; i++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    // No zone is more than 14 hours from UTC.
    if (date.getTime() - 14 * 3_600_000 > end) return null;
    if (!onDay(date)) continue;
    let best = Infinity;
    for (const minute of minutes) {
      // Today, times well before now have passed (the clocks move by at most a few hours).
      if (i === 0 && minute < startMinute - 240) continue;
      const times = zonedTimes(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), Math.floor(minute / 60), minute % 60, zone);
      for (const at of repeats ? times : times.slice(0, 1)) if (at > after && at < best) best = at;
      // Later minutes on a later day only come later.
      if (i > 0 && best < Infinity) break;
    }
    if (best < Infinity) return best <= end ? best : null;
  }
  return null;
}
