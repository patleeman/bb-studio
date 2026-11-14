import { zonedTimes } from "../triggers/next-run";

const DAY = 86_400_000;
const formats = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type Wall = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

function format(zone: string): Intl.DateTimeFormat {
  let found = formats.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" });
    formats.set(zone, found);
  }
  return found;
}

export function isTimeZone(zone: string): boolean {
  if (!zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

export function wall(at: number, zone?: string): Wall {
  if (!zone) {
    const date = new Date(at);
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), weekday: date.getDay() };
  }
  const parts = Object.fromEntries(format(zone).formatToParts(at).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: WEEKDAYS.indexOf(parts.weekday ?? "") };
}

export function dayNumber(at: number, zone?: string): number {
  const { year, month, day } = wall(at, zone);
  return Math.round(Date.UTC(year, month - 1, day) / DAY);
}

export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, zone?: string): number {
  if (!zone) return new Date(year, month - 1, day, hour, minute).getTime();
  return zonedTimes(year, month, day, hour, minute, zone)[0]!;
}

export function addDays(at: number, days: number, hour: number, minute: number, zone?: string): number {
  const { year, month, day } = wall(at, zone);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, zone);
}

export function inputValue(at: number, zone?: string): string {
  const { year, month, day, hour, minute } = wall(at, zone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

export function fromInputValue(value: string, zone?: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  const at = zonedTime(year, month, day, hour, minute, zone);
  return Number.isFinite(at) ? at : null;
}

export function zoneOption(zone?: string): { timeZone: string } | Record<string, never> {
  return zone ? { timeZone: zone } : {};
}
