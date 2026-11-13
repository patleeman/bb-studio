// The Bot page's model (BotPage.tsx: the page and BotPane): the status sentence under
// its name, the failed runs that sit in Needs you, Recent in plain words, Up
// next, and the area colours the calendar, Runners and Paused share. Pure, so
// it's tested without a browser. Plain language only: no cron strings, ids or
// token counts.
import type { RunnerView } from "../../contract";
import { chainGroups, clockWords, groupName, isGroup, minuteOfDay, plainError, runStatus, startOfDay, type CalendarEvent, type CalendarSource } from "./calendar";

const MINUTE = 60_000;
const DAY = 86_400_000;

// ---- Areas ------------------------------------------------------------------

/** Area colours, one each, in the order the runners were made; red stays for failures. */
export const AREA_COLORS = ["#5b8def", "#f2804a", "#3eb0d5", "#7c66dc", "#f5b83d", "#2ba59a", "#c862c6", "#46a758", "#d9775c", "#1f9d75"] as const;
/** The Bot's own jobs: a neutral grey. */
export const BOT_AREA_COLOR = "#8d8d86";

/** Each runner's colour by its place in the list (so eight runners get eight colours); the Bot's under "". */
export function areaColors(runners: readonly { id: string }[]): Map<string, string> {
  const colors = new Map<string, string>([["", BOT_AREA_COLOR]]);
  runners.forEach((runner, i) => colors.set(runner.id, AREA_COLORS[i % AREA_COLORS.length]!));
  return colors;
}
export const areaColor = (colors: ReadonlyMap<string, string>, area: { id: string } | null | undefined) => colors.get(area?.id ?? "") ?? BOT_AREA_COLOR;

// ---- Words ------------------------------------------------------------------

/** "1:00 PM" in `zone`. */
export const clockAt = (at: number, zone: string) => clockWords(minuteOfDay(at, zone)).replace(/^(\d+) /, "$1:00 ");
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "at 6:00 PM" today, "tomorrow at 5:00 AM", "Fri at 9:00 AM". */
export function whenWords(at: number, now: number, zone: string): string {
  const days = Math.round((startOfDay(at, zone) - startOfDay(now, zone)) / DAY);
  const time = clockAt(at, zone);
  if (days === 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  const weekday = new Date(at).toLocaleDateString("en-US", { weekday: "short", timeZone: zone });
  return `${WEEKDAY.includes(weekday) ? weekday : weekday.slice(0, 3)} at ${time}`;
}
/** A name inside a sentence: "Evening wrap-up" → "evening wrap-up"; "GB Studio build" stays. */
export const inSentence = (name: string) => /^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** A run's outcome in plain words: "Quiet", "2 new emails", or the failure. */
export function outcomeWords(event: Pick<CalendarEvent, "status" | "outcome" | "error" | "at">, now = Infinity): string {
  if (event.status === "failed") return event.error ?? "Failed";
  if (event.status === "running") return "Running now";
  if (event.status === "scheduled") return event.at > now ? "Due" : "Didn't run";
  // A watcher's quiet tick is recorded as a skip: it had nothing to say.
  if (event.status === "skipped") return /nothing new|empty output|no output/i.test(event.outcome ?? "") ? "Quiet" : "Skipped";
  const text = (event.outcome ?? "").trim();
  if (/^woke it:\s*/i.test(text)) return text.replace(/^woke it:\s*/i, "");
  if (!text || /^(ran|succeeded|nothing new|quiet|completed?)$/i.test(text)) return "Quiet";
  return text;
}

// ---- The status sentence ------------------------------------------------------

export interface StatusInput {
  state: "active" | "paused" | "stopped";
  /** Runs and threads going on now. */
  working: number;
  /** Items in Needs you. */
  needs: number;
  /** The next run that isn't frequent. */
  next: { name: string; at: number } | null;
  /** When its last run finished, for "All quiet since". */
  lastRunAt: number | null;
  now: number;
  zone: string;
}

/**
 * The line under the Bot's name: "Working on 3 things. 5 things need you.
 * Next: evening wrap-up at 6:00 PM." or "Idle. All quiet since 1:00 PM. Next: …".
 */
export function statusSentence({ state, working, needs, next, lastRunAt, now, zone }: StatusInput): string {
  if (state === "stopped") return "Stopped.";
  const parts: string[] = [];
  if (state === "paused") parts.push("Paused.");
  else if (working) parts.push(`Working on ${plural(working, "thing", "things")}.`);
  else parts.push("Idle.");
  if (needs) parts.push(`${needs === 1 ? "1 thing needs" : `${needs} things need`} you.`);
  else if (state === "active" && !working && lastRunAt && now - lastRunAt < DAY) parts.push(`All quiet since ${clockAt(lastRunAt, zone)}.`);
  if (state === "active" && next) parts.push(`Next: ${inSentence(next.name)} ${whenWords(next.at, now, zone)}.`);
  return parts.join(" ");
}

// ---- Failed runs in Needs you ----------------------------------------------------

export type FailedRun = { sourceId: string; name: string; runId: string; at: number; error: string; threadId: string | null; kind: CalendarSource["kind"] };
/** A dismissal's key: the job and the run. */
export const dismissKey = (sourceId: string, runId: string) => `${sourceId}:${runId}`;

/**
 * Whether a finished run counts as a success: it ran fine, or it's a watcher
 * (or script) that had nothing to say ("skipped", "empty output", "Nothing
 * new"). A skip for another reason (the Bot was busy) says nothing either way.
 */
function succeeded(source: Pick<CalendarSource, "kind">, run: { status: string | null; outcome?: string | null }): boolean | null {
  const status = runStatus(run.status);
  if (status === "ok") return true;
  if (status === "failed") return false;
  if (status === "skipped") return source.kind === "watcher" || /empty output|no output|nothing new/i.test(`${run.status ?? ""} ${run.outcome ?? ""}`) ? true : null;
  return null;
}

/** A job's latest finished run when that run failed (its run id and error), else null: any newer success, a watcher's quiet skip included, clears it. */
export function lastFailure(source: CalendarSource): { id: string; at: number; outcome: string; threadId: string | null } | null {
  const finished = (source.runs ?? []).filter((run) => run.status !== "resumed" && succeeded(source, run) !== null).sort((a, b) => b.at - a.at);
  const last = finished[0];
  if (!last || succeeded(source, last)) return null;
  // A runner's last run, when the history read doesn't reach it.
  if (source.lastRun && source.lastRun.at > last.at && succeeded(source, source.lastRun)) return null;
  return last;
}

/**
 * Each job whose latest finished run failed: it stays in Needs you until a
 * newer run succeeds (a watcher's quiet skip counts) or the user dismisses
 * that run. A run going on now doesn't clear it. A paused job's failure isn't
 * here: it's paused on purpose, and Paused marks it failed.
 */
export function failedRuns(sources: readonly CalendarSource[], dismissed: ReadonlySet<string>): FailedRun[] {
  const out: FailedRun[] = [];
  for (const source of sources) {
    if (source.state === "paused") continue;
    const last = lastFailure(source);
    if (!last || dismissed.has(dismissKey(source.id, last.id))) continue;
    out.push({ sourceId: source.id, name: source.name, runId: last.id, at: last.at, error: plainError(last.outcome.replace(/^Failed:?\s*/i, "")) || "It failed", threadId: last.threadId ?? source.threadId, kind: source.kind });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** "Security check failed at 1:00 PM": a runner's run is its check. */
export function failedTitle(run: FailedRun, now: number, zone: string): string {
  return `${run.name}${run.kind === "runner" ? " check" : ""} failed ${whenWords(run.at, now, zone).replace(/^at /, "at ")}`;
}

// ---- Up next ------------------------------------------------------------------

export type UpNext = { key: string; name: string; at: number; areas: string[]; count: number };

/**
 * The next `limit` runs after `now` that aren't frequent, a 15-minute chain
 * as one row ("Area sweep · 4").
 */
export function upNext(events: readonly CalendarEvent[], sources: readonly CalendarSource[], frequent: ReadonlySet<string>, now: number, zone: string, names: Readonly<Record<string, string>> = {}, limit = 3): UpNext[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const due = events.filter((event) => event.status === "scheduled" && event.at > now && !frequent.has(event.sourceId));
  const byDay = new Map<number, CalendarEvent[]>();
  for (const event of due) { const day = startOfDay(event.at, zone); byDay.set(day, [...(byDay.get(day) ?? []), event]); }
  const rows: UpNext[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    for (const item of chainGroups(byDay.get(day)!, zone)) {
      if (isGroup(item)) rows.push({ key: `${item.key}@${item.at}`, name: groupName(item, zone, names), at: item.at, areas: [...new Set(item.events.map((event) => byId.get(event.sourceId)?.area?.id ?? ""))], count: item.events.length });
      else rows.push({ key: item.key, name: byId.get(item.sourceId)?.name ?? "Job", at: item.at, areas: [byId.get(item.sourceId)?.area?.id ?? ""], count: 1 });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

// ---- Recent -------------------------------------------------------------------

export type RecentPart = { text: string; tone?: "failed" | "strong" };
export type RecentEntry = { key: string; at: number; parts: RecentPart[]; muted?: boolean };

export interface RecentInput {
  /** Every job's events over the last days (calendar events: past runs only are used). */
  events: readonly CalendarEvent[];
  sources: readonly CalendarSource[];
  frequent: ReadonlySet<string>;
  /** Runner reports: what a runner told the Bot, by runner (source) id. */
  reports: readonly { sourceId: string; at: number; text: string }[];
  /** Threads the Bot started that finished, not runner threads. */
  finished: readonly { id: string; title: string; at: number }[];
  /** Maintenance runs. */
  maintenance: readonly { at: number; summary: string; dryRun: boolean }[];
  names?: Readonly<Record<string, string>>;
  now: number;
  zone: string;
}

/** A report a runner made within 30 minutes after a run is that run's outcome. */
function reportFor(event: CalendarEvent, reports: RecentInput["reports"]): string | null {
  return reports.find((report) => report.sourceId === event.sourceId && report.at >= event.at && report.at - event.at < 30 * MINUTE)?.text ?? null;
}
const sentence = (text: string) => /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
const joinNames = (names: string[]) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Recent, newest first, in plain words: a group's runs in one line ("Area
 * sweep: Comms found 2 new emails; Systems, Home & Family and Staff quiet."),
 * a run's outcome, a failure in red, finished threads and maintenance, and
 * one muted line a day for the frequent checks that had nothing to say.
 */
export function recentEntries({ events, sources, frequent, reports, finished, maintenance, names = {}, now, zone }: RecentInput): RecentEntry[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const label = (event: CalendarEvent) => byId.get(event.sourceId)?.name ?? "A job";
  const words = (event: CalendarEvent) => event.status === "failed" ? outcomeWords(event) : reportFor(event, reports) ?? outcomeWords(event);
  const past = events.filter((event) => event.at <= now && event.status !== "scheduled" && event.status !== "running");
  const entries: RecentEntry[] = [];
  const quietFrequent = new Map<number, { at: number; count: number }>();
  const byDay = new Map<number, CalendarEvent[]>();
  for (const event of past) {
    const day = startOfDay(event.at, zone);
    if (frequent.has(event.sourceId) && event.status !== "failed" && words(event) === "Quiet") {
      const tally = quietFrequent.get(day) ?? { at: 0, count: 0 };
      quietFrequent.set(day, { at: Math.max(tally.at, event.at), count: tally.count + 1 });
      continue;
    }
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }
  for (const list of byDay.values()) {
    for (const item of chainGroups(list, zone)) {
      if (isGroup(item)) {
        const parts: RecentPart[] = [{ text: `${groupName(item, zone, names)}: ` }];
        const loud = item.events.filter((event) => event.status !== "failed" && words(event) !== "Quiet");
        const failed = item.events.filter((event) => event.status === "failed");
        const silent = item.events.filter((event) => event.status !== "failed" && words(event) === "Quiet");
        const said = loud.map((event) => /^\d/.test(words(event)) ? `${label(event)} found ${words(event)}` : `${label(event)}: ${inSentence(words(event))}`);
        const pieces = [...said, ...(silent.length ? [`${joinNames(silent.map(label))} quiet`] : [])];
        parts.push({ text: pieces.length ? `${pieces.join("; ")}.` : "" });
        for (const event of failed) parts.push({ text: `${pieces.length ? " " : ""}${label(event)} ${failedClause(words(event))}`, tone: "failed" });
        entries.push({ key: `group:${item.key}@${item.at}`, at: item.to, parts: parts.filter((part) => part.text) });
      } else if (item.status === "failed") {
        entries.push({ key: item.key, at: item.at, parts: [{ text: `${label(item)}: ` }, { text: sentence(words(item)), tone: "failed" }] });
      } else {
        const text = words(item);
        entries.push({ key: item.key, at: item.at, parts: [{ text: `${label(item)}: ${text === "Quiet" ? "nothing to report." : sentence(inSentence(text))}` }] });
      }
    }
  }
  for (const [day, tally] of quietFrequent) entries.push({ key: `frequent:${day}`, at: tally.at, muted: true, parts: [{ text: `Frequent checks ran ${plural(tally.count, "time", "times")} ${startOfDay(now, zone) === day ? "today" : "that day"} with nothing to report.` }] });
  for (const thread of finished) entries.push({ key: `thread:${thread.id}`, at: thread.at, parts: [{ text: "Archived " }, { text: thread.title, tone: "strong" }, { text: "." }] });
  for (const run of maintenance) if (!run.dryRun && !entries.some((entry) => entry.key === `maintenance:${run.at}`)) entries.push({ key: `maintenance:${run.at}`, at: run.at, parts: [{ text: `Daily cleanup: ${sentence(run.summary)}` }] });
  // Newest day first; in a day, newest first and the frequent tally last.
  const day = (entry: RecentEntry) => startOfDay(entry.at, zone);
  return entries.sort((a, b) => day(b) - day(a) || (a.muted ? 1 : 0) - (b.muted ? 1 : 0) || b.at - a.at);
}

/** "couldn't sign in to Wyze." from "Couldn't sign in to Wyze". */
function failedClause(error: string): string {
  const text = inSentence(error.trim());
  return sentence(/^(couldn't|could not|can't|failed|didn't|timed out|lost)/i.test(text) ? text : `failed: ${text}`);
}

// ---- Runners ------------------------------------------------------------------

/** "9 h ago", "yesterday". */
export function agoWords(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 60 * 48) return "yesterday";
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
/** Runner rows' right side on the page: working now, failed, paused, or "Quiet · 9 h ago". */
export function runnerState(runner: RunnerView, now = Date.now()): { text: string; tone?: "failed" | "working" } {
  if (runner.running) return { text: "Working now", tone: "working" };
  if (runner.state === "paused") return { text: "Paused" };
  const failed = /fail|error/i.test(runner.lastRunStatus ?? "");
  if (!runner.lastRunAt) return { text: runner.nextRunAt ? `Next ${whenWords(runner.nextRunAt, now, Intl.DateTimeFormat().resolvedOptions().timeZone).replace(/^at /, "")}` : "Not run yet" };
  const reported = runner.lastReportAt && runner.lastReportAt >= runner.lastRunAt;
  return { text: `${failed ? "Failed" : reported ? "Reported" : "Quiet"} · ${agoWords(runner.lastRunAt, now)}`, tone: failed ? "failed" : undefined };
}
