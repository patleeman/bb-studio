// Todos' UI vocabulary, shared by the `::loop` card, the
// morning rows and the Todos tab: what each kind is called and drawn with,
// how a trigger, a due date and an owner read, and the Snooze presets.
// Everything here is pure; times read in Todos' time zone when one is
// passed (the todosTimeZone setting), else in the browser's.
import type { Loop } from "../contract";
import { dayNumber, wall, zoneOption } from "../clock";

export type LoopKind = Loop["kind"];
export type Trigger = Loop["trigger"];

export const KIND: Record<LoopKind, { label: string; icon: string }> = {
  do: { label: "Do", icon: "Circle" },
  decide: { label: "Decide", icon: "Fork" },
  read: { label: "Read", icon: "FileText" },
  waiting: { label: "Waiting on others", icon: "TimeSchedule" },
};

// toLocale*String builds a new Intl.DateTimeFormat on every call, which is slow
// in a list of cards that re-renders; one formatter per shape and zone instead.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(shape: "time" | "weekday" | "day" | "date", zone?: string): Intl.DateTimeFormat {
  const key = `${shape}|${zone ?? ""}`;
  let found = formatters.get(key);
  if (!found) {
    const options: Intl.DateTimeFormatOptions = shape === "time" ? { hour: "numeric", minute: "2-digit" }
      : shape === "weekday" ? { weekday: "short" }
      : shape === "day" ? { month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric" };
    found = new Intl.DateTimeFormat("en-US", { ...options, ...zoneOption(zone) });
    formatters.set(key, found);
  }
  return found;
}
const time = (at: number, zone?: string) => formatter("time", zone).format(at);
const weekday = (at: number, zone?: string) => formatter("weekday", zone).format(at);
const daysFrom = (now: number, at: number, zone?: string) => dayNumber(at, zone) - dayNumber(now, zone);
const hasClock = (at: number, zone?: string) => { const clock = wall(at, zone); const minute = clock.hour * 60 + clock.minute; return minute !== 0 && minute !== 24 * 60 - 1; };

/** "3:00 PM" today, "Fri" this week, "Nov 9" later. */
export function shortWhen(at: number, now = Date.now(), zone?: string): string {
  const days = daysFrom(now, at, zone);
  if (days === 0) return time(at, zone);
  if (Math.abs(days) < 7) return weekday(at, zone);
  return formatter("day", zone).format(at);
}

/** "Fri 3:00 PM", "Mon Nov 9, 9:00 AM" past a week. */
export function fullWhen(at: number, now = Date.now(), zone?: string): string {
  const days = daysFrom(now, at, zone);
  if (days === 0) return `Today ${time(at, zone)}`;
  if (days === 1) return `Tomorrow ${time(at, zone)}`;
  if (days > 0 && days < 7) return `${weekday(at, zone)} ${time(at, zone)}`;
  return `${formatter("date", zone).format(at)}, ${time(at, zone)}`;
}

/** The due label and whether it's pressing (today or past). */
export function dueLabel(due: number | null, now = Date.now(), zone?: string): { text: string; urgent: boolean } | null {
  if (due === null) return null;
  const days = daysFrom(now, due, zone);
  if (days < 0) return { text: "Overdue", urgent: true };
  const clock = hasClock(due, zone) ? `, ${time(due, zone)}` : "";
  if (days === 0) return { text: `Due today${clock}`, urgent: true };
  if (days === 1) return { text: `Due tomorrow${clock}`, urgent: false };
  return { text: `Due ${shortWhen(due, now, zone)}${clock}`, urgent: false };
}

const titleCase = (name: string) => name.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** A place trigger in words: "When you get home", "When you leave the office". */
export function placeLabel(place: string, direction: "arrive" | "leave" = "arrive"): string {
  const key = place.trim().toLowerCase();
  const where = key === "home" ? "home" : key === "office" || key === "work" ? `the ${key}` : titleCase(place.trim());
  return direction === "arrive" ? (key === "home" ? "When you get home" : `When you get to ${where}`) : `When you leave ${where}`;
}

/** Why a due todo still waits (tasks.list `held`): the day's budget is spent, or it's low priority. */
export type Hold = "budget" | "morning";

/** What releases a todo, in words, with its chip icon. A held todo says what it waits for instead. */
export function triggerLabel(trigger: Trigger, now = Date.now(), held?: Hold | null, zone?: string): { text: string; icon: string } {
  if (held === "budget") return { text: "Next free slot", icon: "TimeSchedule" };
  if (held === "morning") return { text: "Tomorrow morning card", icon: "Calendar" };
  if (trigger.type === "time" && trigger.at !== undefined) return { text: fullWhen(trigger.at, now, zone), icon: "Clock" };
  if (trigger.type === "event" && trigger.event) return { text: eventLabel(trigger.event, trigger.label), icon: "Zap" };
  if (trigger.type === "place" && trigger.place) return { text: placeLabel(trigger.place, trigger.direction), icon: "Pin" };
  return { text: "Anytime", icon: "Circle" };
}

/**
 * An event trigger in words: its label ("When Unraid fixes the PHP CVE"),
 * `reply:sam` as "When Sam replies", else the key prettified:
 * `unraid:php-cve-fixed` reads "Unraid: php cve fixed".
 */
export function eventLabel(event: string, label?: string): string {
  if (label?.trim()) return label.trim().replace(/^\S/, (c) => c.toUpperCase());
  const reply = /^reply:(.+)$/.exec(event);
  if (reply) return `When ${titleCase(reply[1]!.replace(/[-_]/g, " "))} replies`;
  const [source, ...rest] = event.split(":").map((part) => part.replace(/[-_]+/g, " ").trim()).filter(Boolean);
  if (!source) return event;
  const head = source.replace(/^\S/, (c) => c.toUpperCase());
  return rest.length ? `${head}: ${rest.join(" ")}` : head;
}

/** A thread owner as the server resolved it (loops.get `owner`). */
export type OwnerInfo = { owner: string; name: string; threadId: string | null };

/** The owner's name: "You", the Bot, a lead by its project, the thread's title, or "An agent". */
export function ownerName(owner: string, names: { bot: string; leads: ReadonlyMap<string, string> }, resolved?: OwnerInfo | null): string {
  if (owner === "patrick") return "You";
  if (owner === "cos") return names.bot;
  return names.leads.get(owner.slice("thread:".length)) ?? resolved?.name ?? "An agent";
}

/** The thread an owner works in: the Bot's chat, or the owner's thread while it exists. */
export function ownerThread(owner: string, botThreadId: string | null, resolved?: OwnerInfo | null): string | null {
  if (owner === "cos") return botThreadId;
  if (!owner.startsWith("thread:")) return null;
  // The server drops the link once the thread is gone; before it answers, link the id.
  return resolved ? resolved.threadId : owner.slice("thread:".length);
}


/** The source link's text, or null when there's nothing to show. */
export function sourceText(source: Loop["source"]): string | null {
  if (!source || source.kind === "interaction") return null;
  if (source.kind === "thread") return "Thread";
  return source.ref.length > 60 ? `${source.ref.slice(0, 57)}…` : source.ref;
}

/** Whether a URL is safe to open from a card (http, https or mailto). */
export const safeUrl = (url: string | undefined): string | null => url && /^(https?:|mailto:)/i.test(url) ? url : null;
