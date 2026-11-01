// The Attention Router's UI vocabulary, shared by the `::loop` card, the
// morning rows and the Loops tab: what each kind is called and drawn with,
// how a trigger, a due date and an owner read, and the Snooze presets.
// Everything here is pure; times read in the browser's zone.
import type { Loop } from "../contract";

export type LoopKind = Loop["kind"];
export type Trigger = Loop["trigger"];
export type SnoozePreset = "later_today" | "tonight" | "tomorrow_morning" | "this_weekend" | "home";

export const KIND: Record<LoopKind, { label: string; icon: string }> = {
  do: { label: "Do", icon: "CircleCheck" },
  decide: { label: "Decide", icon: "Fork" },
  read: { label: "Read", icon: "FileText" },
  waiting: { label: "Waiting on others", icon: "TimeSchedule" },
};

/** The fixed areas of phase 1 (Patrick's decision 9). */
export const AREAS = ["Job", "Home", "Kensico", "Systems"] as const;

/** Inline decide options; past this many, the card shows "Choose…". */
export const INLINE_OPTIONS = 3;

const DAY = 86_400_000;
const time = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const weekday = (at: number) => new Date(at).toLocaleDateString("en-US", { weekday: "short" });
const startOfDay = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** "3:00 PM" today, "Fri" this week, "Nov 9" later. */
export function shortWhen(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY);
  if (days === 0) return time(at);
  if (Math.abs(days) < 7) return weekday(at);
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Fri 3:00 PM", "Mon Nov 9, 9:00 AM" past a week. */
export function fullWhen(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY);
  if (days === 0) return `Today ${time(at)}`;
  if (days === 1) return `Tomorrow ${time(at)}`;
  if (days > 0 && days < 7) return `${weekday(at)} ${time(at)}`;
  return `${new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${time(at)}`;
}

/** The due label and whether it's pressing (today or past). */
export function dueLabel(due: number | null, now = Date.now()): { text: string; urgent: boolean } | null {
  if (due === null) return null;
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days < 0) return { text: "Overdue", urgent: true };
  if (days === 0) return { text: "Due today", urgent: true };
  if (days === 1) return { text: "Due tomorrow", urgent: false };
  return { text: `Due ${shortWhen(due, now)}`, urgent: false };
}

const titleCase = (name: string) => name.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** A place trigger in words: "When you get home", "When you leave the office". */
export function placeLabel(place: string, direction: "arrive" | "leave" = "arrive"): string {
  const key = place.trim().toLowerCase();
  const where = key === "home" ? "home" : key === "office" || key === "work" ? `the ${key}` : titleCase(place.trim());
  return direction === "arrive" ? (key === "home" ? "When you get home" : `When you get to ${where}`) : `When you leave ${where}`;
}

/** What releases a loop, in words, with its chip icon. */
export function triggerLabel(trigger: Trigger, now = Date.now()): { text: string; icon: string } {
  if (trigger.type === "time" && trigger.at !== undefined) return { text: fullWhen(trigger.at, now), icon: "Clock" };
  if (trigger.type === "event" && trigger.event) return { text: eventLabel(trigger.event), icon: "Zap" };
  if (trigger.type === "place" && trigger.place) return { text: placeLabel(trigger.place, trigger.direction), icon: "Pin" };
  return { text: "Anytime", icon: "Circle" };
}

/** `reply:yassine` reads "When Yassine replies"; other keys show as they are. */
export function eventLabel(event: string): string {
  const reply = /^reply:(.+)$/.exec(event);
  if (reply) return `When ${titleCase(reply[1]!.replace(/[-_]/g, " "))} replies`;
  return `On ${event}`;
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
export function snoozeHint(preset: SnoozePreset, now = Date.now()): string {
  if (preset === "home") return "Home";
  if (preset === "later_today") return time(now + 3 * 3_600_000);
  const at = new Date(now);
  if (preset === "tonight") { if (at.getHours() >= 19) at.setDate(at.getDate() + 1); at.setHours(19, 0, 0, 0); return at.getTime() - now < DAY ? time(at.getTime()) : `${weekday(at.getTime())} ${time(at.getTime())}`; }
  if (preset === "tomorrow_morning") { at.setDate(at.getDate() + 1); at.setHours(8, 0, 0, 0); return `${weekday(at.getTime())} ${time(at.getTime())}`; }
  let days = (6 - at.getDay() + 7) % 7;
  if (!days && at.getHours() >= 10) days = 7;
  at.setDate(at.getDate() + days); at.setHours(10, 0, 0, 0);
  return `Sat ${time(at.getTime())}`;
}

export const isClosed = (loop: Pick<Loop, "closedAt">) => loop.closedAt !== null;

/** The owner's name: "You", the Bot, a lead by its project, or "An agent". */
export function ownerName(owner: string, names: { bot: string; leads: ReadonlyMap<string, string> }): string {
  if (owner === "patrick") return "You";
  if (owner === "cos") return names.bot;
  return names.leads.get(owner.slice("thread:".length)) ?? "An agent";
}

/** The thread an owner works in: a lead's thread, or the Bot's chat. */
export function ownerThread(owner: string, botThreadId: string | null): string | null {
  if (owner.startsWith("thread:")) return owner.slice("thread:".length);
  return owner === "cos" ? botThreadId : null;
}

type History = { type: string; at: number; data: string }[];
const parse = (data: string): Record<string, unknown> => { try { return JSON.parse(data) as Record<string, unknown>; } catch { return {}; } };

/** How a closed loop ended: "Done", "Got it", "Dropped", or the option chosen. */
export function closedVerb(loop: Loop, history: History): string {
  const closed = [...history].reverse().find((each) => each.type === "closed");
  const data = closed ? parse(closed.data) : {};
  if (data.action === "choose" && typeof data.option === "string") return optionParts(data.option).label;
  if (data.action === "got_it") return "Got it";
  if (loop.status === "dropped" || data.action === "drop") return "Dropped";
  return "Done";
}

/** When the loop was last released into the chat or handed off. */
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
export function releaseLabel(loop: Loop, history: History, now = Date.now()): { text: string; icon: string } {
  const at = lastEvent(history, "surfaced") ?? loop.updatedAt;
  const when = time(at);
  if (loop.trigger.type === "place" && loop.trigger.place) return { text: `${loop.trigger.direction === "leave" ? "Left" : "Arrived at"} ${loop.trigger.place} · ${when}`, icon: "Pin" };
  if (loop.trigger.type === "event" && loop.trigger.event) return { text: `${eventLabel(loop.trigger.event)} · ${when}`, icon: "Zap" };
  if (loop.trigger.type === "time" && loop.trigger.at !== undefined && Math.abs(loop.trigger.at - at) < 5 * 60_000) return { text: `${shortWhen(loop.trigger.at, now)} trigger · ${when}`, icon: "Clock" };
  if (loop.source && loop.source.kind !== "interaction") return { text: `from ${loop.source.kind} · ${when}`, icon: "Mail" };
  return { text: when, icon: "Clock" };
}

/** The source link's text, or null when there's nothing to show. */
export function sourceText(source: Loop["source"]): string | null {
  if (!source || source.kind === "interaction") return null;
  if (source.kind === "thread") return "Thread";
  return source.ref.length > 60 ? `${source.ref.slice(0, 57)}…` : source.ref;
}

/** The ranking used for the Loops tab's first section and the morning rows. */
export const PRIORITY_RANK: Record<Loop["priority"], number> = { urgent: 0, normal: 1, low: 2 };

/** Whether a URL is safe to open from a card (http, https or mailto). */
export const safeUrl = (url: string | undefined): string | null => url && /^(https?:|mailto:)/i.test(url) ? url : null;
