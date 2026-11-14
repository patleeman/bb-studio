// Todos' UI vocabulary, shared by the `::loop` card, the
// morning rows and the Todos tab: what each kind is called and drawn with,
// how a trigger, a due date and an owner read, and the Snooze presets.
// Everything here is pure; times read in Todos' time zone when one is
// passed (the todosTimeZone setting), else in the browser's.
import type { Loop } from "../contract";
import { addDays, dayNumber, wall, zoneOption } from "../clock";

export type LoopKind = Loop["kind"];
export type Trigger = Loop["trigger"];
export type SnoozePreset = "later_today" | "tonight" | "tomorrow_morning" | "this_weekend" | "home";

export const KIND: Record<LoopKind, { label: string; icon: string }> = {
  do: { label: "Do", icon: "Circle" },
  decide: { label: "Decide", icon: "Fork" },
  read: { label: "Read", icon: "FileText" },
  waiting: { label: "Waiting on others", icon: "TimeSchedule" },
};

export function areaChips(areas: readonly string[] | undefined, selected: string | null): (string | null)[] {
  const names = [...(areas ?? [])];
  if (selected && !names.includes(selected)) names.push(selected);
  return [null, ...names];
}

/** Inline decide options; past this many, the card shows "Choose…". */
export const INLINE_OPTIONS = 3;

const DAY = 86_400_000;
const time = (at: number, zone?: string) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...zoneOption(zone) });
const weekday = (at: number, zone?: string) => new Date(at).toLocaleDateString("en-US", { weekday: "short", ...zoneOption(zone) });
const daysFrom = (now: number, at: number, zone?: string) => dayNumber(at, zone) - dayNumber(now, zone);
const hasClock = (at: number, zone?: string) => { const clock = wall(at, zone); const minute = clock.hour * 60 + clock.minute; return minute !== 0 && minute !== 24 * 60 - 1; };

/** "3:00 PM" today, "Fri" this week, "Nov 9" later. */
export function shortWhen(at: number, now = Date.now(), zone?: string): string {
  const days = daysFrom(now, at, zone);
  if (days === 0) return time(at, zone);
  if (Math.abs(days) < 7) return weekday(at, zone);
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", ...zoneOption(zone) });
}

/** "Fri 3:00 PM", "Mon Nov 9, 9:00 AM" past a week. */
export function fullWhen(at: number, now = Date.now(), zone?: string): string {
  const days = daysFrom(now, at, zone);
  if (days === 0) return `Today ${time(at, zone)}`;
  if (days === 1) return `Tomorrow ${time(at, zone)}`;
  if (days > 0 && days < 7) return `${weekday(at, zone)} ${time(at, zone)}`;
  return `${new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...zoneOption(zone) })}, ${time(at, zone)}`;
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

/** Why a due todo still waits (loops.list `held`): the day's budget is spent, or it's low priority. */
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

/** A decide option, "Bayside Decks · $4,200 · starts Nov 9": its name and the rest. */
export function optionParts(option: string): { label: string; detail: string } {
  const at = option.indexOf(" · ");
  return at < 0 ? { label: option, detail: "" } : { label: option.slice(0, at), detail: option.slice(at + 3) };
}

/** Snooze presets in menu order (decision 3). Times match the server's (src/loops/scheduler.ts). */
export const SNOOZE: { id: SnoozePreset; label: string; icon: string }[] = [
  { id: "later_today", label: "Later today", icon: "Clock" },
  { id: "tonight", label: "Tonight", icon: "Clock" },
  { id: "tomorrow_morning", label: "Tomorrow", icon: "Calendar" },
  { id: "this_weekend", label: "This weekend", icon: "Calendar" },
  { id: "home", label: "When I’m home", icon: "Pin" },
];

/** When a preset fires, for the menu's right column. */
export function snoozeHint(preset: SnoozePreset, now = Date.now(), zone?: string): string {
  if (preset === "home") return "Home";
  if (preset === "later_today") { const later = now + 3 * 3_600_000; return daysFrom(now, later, zone) === 0 ? time(later, zone) : `${weekday(later, zone)} ${time(later, zone)}`; }
  const clock = wall(now, zone);
  if (preset === "tonight") { const at = addDays(now, clock.hour >= 19 ? 1 : 0, 19, 0, zone); return at - now < DAY ? time(at, zone) : `${weekday(at, zone)} ${time(at, zone)}`; }
  if (preset === "tomorrow_morning") { const at = addDays(now, 1, 8, 0, zone); return `${weekday(at, zone)} ${time(at, zone)}`; }
  let days = (6 - clock.weekday + 7) % 7;
  if (!days && clock.hour >= 10) days = 7;
  return `Sat ${time(addDays(now, days, 10, 0, zone), zone)}`;
}

export const isClosed = (loop: Pick<Loop, "closedAt">) => loop.closedAt !== null;

/** A thread owner as the server resolved it (loops.list `owners`, loops.get `owner`). */
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

type History = { type: string; at: number; data: string }[];
const parse = (data: string): Record<string, unknown> => { try { return JSON.parse(data) as Record<string, unknown>; } catch { return {}; } };

/** How a closed todo ended: "Done", "Got it", "Dismissed", or the option chosen. */
export function closedVerb(loop: Loop, history: History): string {
  const closed = [...history].reverse().find((each) => each.type === "closed");
  const data = closed ? parse(closed.data) : {};
  if (data.action === "choose" && typeof data.option === "string") return optionParts(data.option).label;
  if (data.action === "got_it") return "Got it";
  if (loop.status === "dropped" || data.action === "drop") return "Dismissed";
  return "Done";
}

/** When the todo was last released into the chat or handed off. */
export function lastEvent(history: History, type: string): number | null {
  return [...history].reverse().find((each) => each.type === type)?.at ?? null;
}

/** "12 min", "2 h", "3 d". */
export function elapsed(since: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - since) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

/** The label above a released card: what released it, and when. */
export function releaseLabel(loop: Loop, history: History, zone?: string): { text: string; icon: string } {
  const handedOff = loop.owner !== "patrick" ? lastEvent(history, "handed_off") : null;
  if (handedOff !== null) return { text: `Handed off · ${time(handedOff, zone)}`, icon: "ArrowTurnForward" };
  const at = lastEvent(history, "surfaced") ?? loop.updatedAt;
  const when = time(at, zone);
  if (loop.trigger.type === "place" && loop.trigger.place) return { text: `${loop.trigger.direction === "leave" ? "Left" : "Arrived at"} ${loop.trigger.place} · ${when}`, icon: "Pin" };
  if (loop.trigger.type === "event" && loop.trigger.event) return { text: `${eventLabel(loop.trigger.event, loop.trigger.label)} · ${when}`, icon: "Zap" };
  if (loop.trigger.type === "time" && loop.trigger.at !== undefined && Math.abs(loop.trigger.at - at) < 5 * 60_000) return { text: `${weekday(loop.trigger.at, zone)} ${time(loop.trigger.at, zone)} trigger · ${when}`, icon: "Clock" };
  if (loop.source && loop.source.kind !== "interaction") return { text: `from ${loop.source.kind} · ${when}`, icon: "Mail" };
  return { text: when, icon: "Clock" };
}

/** The source link's text, or null when there's nothing to show. */
export function sourceText(source: Loop["source"]): string | null {
  if (!source || source.kind === "interaction") return null;
  if (source.kind === "thread") return "Thread";
  return source.ref.length > 60 ? `${source.ref.slice(0, 57)}…` : source.ref;
}

/** The ranking used for the Todos tab's first section and the morning rows. */
export const PRIORITY_RANK: Record<Loop["priority"], number> = { urgent: 0, normal: 1, low: 2 };

/** Whether a URL is safe to open from a card (http, https or mailto). */
export const safeUrl = (url: string | undefined): string | null => url && /^(https?:|mailto:)/i.test(url) ? url : null;
