// Automations as a week (calendar.ts): today first, 7 days when the pane is
// wide enough and 5 when it isn't, time of day down. Every check-in, reminder,
// watcher, runner and plain BB schedule of the Bot shows when it runs, in the
// viewer's time zone. A past run opens its thread and a failed one is outlined
// red with its error in the tooltip; a run going on now grows to the red
// current-time line. A job that runs more than eight times a day is a thin
// band with a tick per run. Paused jobs aren't drawn: they're listed under
// Paused, beside the grid (under it in a narrow pane), with Resume.
import { GHOST_BUTTON, ICON_BUTTON } from "../../kit/app/index";
import { Icon, Tooltip } from "../../kit/ui/index";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { BotAutomationRunView, BotAutomationView } from "../../contract";
import { useLive } from "../live";
import { useRunners } from "./Runners";
import { sidebarAgenda } from "./sidebarAgenda";
import { BOT_COLORS } from "./BotAvatar";
import { calendarDays, lanes, minuteOfDay, pausedSources, windowDays, type CalendarBand, type CalendarEvent, type CalendarSource } from "./calendar";

const HOUR = 32;
/** A block is this many minutes tall, so a name fits. */
const SPAN = 40;
const BAND = 8;
const KIND_ICON: Record<CalendarSource["kind"], string> = { checkin: "MessageSquare", reminder: "Clock", watcher: "Eye", runner: "Repeat", heartbeat: "MessageSquare", automation: "Zap" };
const KIND_LABEL: Record<CalendarSource["kind"], string> = { checkin: "Check-in", reminder: "Reminder", watcher: "Watcher", runner: "Runner", heartbeat: "Check-in", automation: "Automation" };
// Red stays for failures.
const COLORS = BOT_COLORS.filter((color) => color !== "#e5484d");
function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return COLORS[hash % COLORS.length]!;
}
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayTime = (at: number) => new Date(at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const hourLabel = (hour: number) => new Date(2026, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });

/** The Bot's jobs as calendar sources: Studio automations (runners included) and the plain BB jobs only the Schedule knew. */
export function calendarSources(automations: BotAutomationView[], scheduled: Parameters<typeof sidebarAgenda>[1], runs: Record<string, BotAutomationRunView[]>, runners: { id: string; threadId: string | null; lastRunAt: number | null; lastRunStatus?: string | null; running?: boolean; runningSince?: number | null }[]): CalendarSource[] {
  const agenda = sidebarAgenda(automations, scheduled);
  const byId = new Map(automations.map((each) => [each.id, each]));
  return [...agenda.upcoming, ...agenda.done].map((item): CalendarSource => {
    const studio = byId.get(item.id);
    const runner = item.kind === "runner" ? runners.find((each) => each.id === item.id) : undefined;
    return {
      id: item.id, name: item.name, kind: item.kind, schedule: studio?.schedule ?? null, cron: studio ? null : item.scheduleText || null,
      state: item.state, nextRunAt: item.nextRunAt, threadId: runner?.threadId ?? studio?.threadId ?? null, scheduleText: item.scheduleText,
      runs: studio ? runs[item.id] ?? [] : null,
      lastRun: runner?.lastRunAt ? { at: runner.lastRunAt, status: runner.lastRunStatus ?? "succeeded" } : null,
      runningSince: runner?.running ? runner.runningSince ?? null : null,
    };
  });
}

/** Reads one automation's recent runs into the calendar. */
function RunsFeed({ botId, id, onRuns }: { botId: string; id: string; onRuns(id: string, runs: BotAutomationRunView[]): void }) {
  const runs = useLive("bot_automation_runs", { botId, id, limit: 50 }, { pollMs: 30_000 });
  useEffect(() => { if (runs.data) onRuns(id, runs.data.runs); }, [runs.data, id, onRuns]);
  return null;
}

export function AutomationsCalendar({ botId, automations, onOpen, onPick, onResume, busy }: {
  botId: string; automations: BotAutomationView[];
  onOpen(threadId: string): void;
  /** A job's block without a thread to open: show the job. */
  onPick(id: string): void;
  onResume(id: string): void;
  busy: boolean;
}) {
  const runners = useRunners(botId);
  const activity = useLive("bot_activity", { botId }, { pollMs: 15_000 });
  const [runs, setRuns] = useState<Record<string, BotAutomationRunView[]>>({});
  const onRuns = useMemo(() => (id: string, list: BotAutomationRunView[]) => setRuns((all) => all[id] === list ? all : { ...all, [id]: list }), []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width || 720);
    return () => observer.disconnect();
  }, []);
  const [week, setWeek] = useState(0);
  const tz = zone();
  const sources = calendarSources(automations, activity.data?.scheduled ?? [], runs, runners.data?.runners ?? []);
  const paused = pausedSources(sources);
  const side = paused.length > 0 && width >= 760;
  const count = (side ? width - 200 : width) >= 600 ? 7 : 5;
  const days = calendarDays(sources, windowDays(now + week * count * 86_400_000, count, tz), now, tz);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const bandIds = [...new Set(days.flatMap((day) => day.bands.map((band) => band.sourceId)))];
  const scroller = useRef<HTMLDivElement>(null);
  // Opens on the hours around now.
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = Math.max(0, (minuteOfDay(Date.now(), tz) / 60 - 2) * HOUR); }, [tz]);
  const range = `${new Date(days[0]!.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(days.at(-1)!.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const open = (event: CalendarEvent) => { if (event.threadId) onOpen(event.threadId); else if (byId.get(event.sourceId)?.runs !== null) onPick(event.sourceId); };

  return (
    <div ref={box} data-testid="automations-calendar" className="mt-2 flex flex-col gap-2">
      {automations.map((each) => <RunsFeed key={each.id} botId={botId} id={each.id} onRuns={onRuns} />)}
      <div className="flex items-center gap-1">
        <button type="button" className={ICON_BUTTON} aria-label="Earlier" onClick={() => setWeek(week - 1)}><Icon name="ChevronLeft" /></button>
        <button type="button" className={ICON_BUTTON} aria-label="Later" onClick={() => setWeek(week + 1)}><Icon name="ChevronRight" /></button>
        <span className="flex-1 text-xs text-muted-foreground tabular-nums">{range}</span>
        {week ? <button type="button" className={GHOST_BUTTON} onClick={() => setWeek(0)}>Today</button> : null}
      </div>
      <div className={side ? "flex items-start gap-3" : "flex flex-col gap-3"}>
        <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border">
          <div className="grid border-b border-border bg-background text-[11px]" style={{ gridTemplateColumns: `36px repeat(${count}, minmax(0, 1fr))` }}>
            <span />
            {days.map((day) => {
              const today = week === 0 && day.start <= now && now < day.end;
              return (
                <span key={day.start} className={`truncate border-l border-border px-1.5 py-1 ${today ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  {today ? "Today" : new Date(day.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                </span>
              );
            })}
          </div>
          <div ref={scroller} className="relative max-h-[440px] overflow-y-auto">
            <div className="relative grid" style={{ gridTemplateColumns: `36px repeat(${count}, minmax(0, 1fr))`, height: 24 * HOUR }}>
              <div className="relative">
                {Array.from({ length: 23 }, (_, i) => (
                  <span key={i} className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums" style={{ top: (i + 1) * HOUR }}>{hourLabel(i + 1)}</span>
                ))}
              </div>
              {days.map((day) => (
                <div key={day.start} data-day={new Date(day.start).toDateString()} className="relative border-l border-border"
                  style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR - 1}px, color-mix(in oklab, var(--border) 60%, transparent) ${HOUR - 1}px, color-mix(in oklab, var(--border) 60%, transparent) ${HOUR}px)` }}>
                  {day.bands.map((band) => <Band key={band.sourceId} band={band} lane={bandIds.indexOf(band.sourceId)} source={byId.get(band.sourceId)!} now={now} tz={tz} onOpen={open} />)}
                  {lanes(day.singles, tz, SPAN).map(({ event, lane, of }) => (
                    <Block key={event.key} event={event} source={byId.get(event.sourceId)!} now={now} tz={tz} onOpen={open}
                      style={{ top: Math.min(minuteOfDay(event.at, tz), 24 * 60 - SPAN) * HOUR / 60, left: `calc(${bandIds.length * BAND + 2}px + (100% - ${bandIds.length * BAND + 4}px) * ${lane / of})`, width: `calc((100% - ${bandIds.length * BAND + 4}px) / ${of} - 2px)` }} />
                  ))}
                  {day.start <= now && now < day.end ? (
                    <div data-testid="calendar-now" aria-hidden className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive" style={{ top: minuteOfDay(now, tz) * HOUR / 60 }}>
                      <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-destructive" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        {paused.length ? (
          <section aria-label="Paused" data-testid="calendar-paused" className={side ? "w-48 shrink-0" : ""}>
            <h4 className="pb-1 text-[11px] font-medium text-muted-foreground">Paused</h4>
            <ul className="flex flex-col divide-y divide-border border-y border-border">
              {paused.map((source) => (
                <li key={source.id} data-paused={source.id} className="flex min-w-0 items-center gap-2 py-1.5">
                  <Icon name={KIND_ICON[source.kind]} className="size-3.5 shrink-0 text-muted-foreground/70" aria-label={KIND_LABEL[source.kind]} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs text-muted-foreground">{source.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground/70">{source.scheduleText}</span>
                  </span>
                  {source.runs !== null ? <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => onResume(source.id)}><Icon name="Play" />Resume</button> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {bandIds.length ? (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {bandIds.map((id) => {
            const band = days.flatMap((day) => day.bands).find((each) => each.sourceId === id)!;
            return <span key={id} className="flex items-center gap-1"><span className="inline-block h-3 w-1.5 rounded-full" style={{ background: colorFor(byId.get(id)!.name) }} />{byId.get(id)!.name} · {band.every}</span>;
          })}
        </p>
      ) : null}
    </div>
  );
}

function tip(source: CalendarSource, event: CalendarEvent, now: number): ReactNode {
  const status = event.status === "failed" ? <span className="font-medium">Failed: {event.error}</span>
    : event.status === "running" ? `Running for ${Math.max(1, Math.round((now - event.at) / 60_000))} min`
      : event.status === "scheduled" ? (event.at > now ? "Due" : "Was due")
        : event.outcome ?? "Ran";
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium">{source.name}</span>
      <span>{KIND_LABEL[source.kind]} · {dayTime(event.at)}{event.manual ? " · run by hand" : ""}</span>
      <span>{status}</span>
      <span className="opacity-80">{source.scheduleText}</span>
      {event.threadId ? <span className="opacity-80">Click to open its thread</span> : null}
    </span>
  );
}

function Block({ event, source, now, tz, style, onOpen }: { event: CalendarEvent; source: CalendarSource; now: number; tz: string; style: CSSProperties; onOpen(event: CalendarEvent): void }) {
  const color = colorFor(source.name);
  const past = event.status !== "scheduled" && event.status !== "running" || event.at <= now && event.status === "scheduled";
  const running = event.status === "running";
  const failed = event.status === "failed";
  // A live run reaches the current-time line.
  const height = Math.max(SPAN, running ? (minuteOfDay(now, tz) - minuteOfDay(event.at, tz)) : 0) * HOUR / 60 - 2;
  return (
    <Tooltip label={tip(source, event, now)} side="right">
      <button type="button" data-event={event.key} data-source={source.id} data-status={event.status} onClick={() => onOpen(event)}
        aria-label={`${source.name}, ${dayTime(event.at)}, ${event.status === "scheduled" ? "due" : event.status}`}
        className={`absolute z-10 flex min-w-0 items-start gap-1 overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight hover:z-30 hover:brightness-110 focus-visible:z-30 ${failed ? "ring-1 ring-destructive" : running ? "ring-1 ring-foreground/40" : ""} ${past && !failed ? "text-muted-foreground" : "text-foreground"}`}
        style={{ ...style, height, background: `color-mix(in oklab, ${color} ${past ? 12 : 24}%, var(--background))`, borderLeft: `2px solid ${failed ? "var(--destructive)" : color}` } as CSSProperties}>
        {failed ? <Icon name="AlertCircle" className="mt-px size-3 shrink-0 text-destructive" aria-hidden />
          : running ? <span className="mt-1 size-1.5 shrink-0 animate-pulse rounded-full" style={{ background: color }} />
            : <Icon name={KIND_ICON[source.kind]} className="mt-px size-3 shrink-0 opacity-70" aria-hidden />}
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{source.name}</span>
          <span className="truncate text-[10px] opacity-80 tabular-nums">{clock(event.at)}{running ? " · now" : ""}</span>
        </span>
      </button>
    </Tooltip>
  );
}

/** A dense job's day: a thin bar from its first run to its last, a tick per run, failures and a live run marked. */
function Band({ band, lane, source, now, tz, onOpen }: { band: CalendarBand; lane: number; source: CalendarSource; now: number; tz: string; onOpen(event: CalendarEvent): void }) {
  const color = colorFor(source.name);
  const top = minuteOfDay(band.from, tz) * HOUR / 60;
  const bottom = minuteOfDay(band.to, tz) * HOUR / 60;
  const failed = band.events.filter((event) => event.status === "failed");
  const latest = [...band.events].reverse().find((event) => event.threadId) ?? band.events.find((event) => event.at > now) ?? band.events[0]!;
  const done = band.events.filter((event) => event.status !== "scheduled").length;
  return (
    <Tooltip side="right" label={(
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{source.name}</span>
        <span>{KIND_LABEL[source.kind]} · {band.every} · {band.events.length} runs this day{done ? `, ${done} done` : ""}</span>
        {failed.map((event) => <span key={event.key} className="font-medium">Failed {clock(event.at)}: {event.error}</span>)}
        <span className="opacity-80">{source.scheduleText}</span>
      </span>
    )}>
      <button type="button" data-band={source.id} aria-label={`${source.name}, ${band.every}, ${band.events.length} runs`} onClick={() => onOpen(failed.at(-1) ?? latest)}
        className="absolute z-10 rounded-full hover:brightness-125" style={{ top: top - 2, height: Math.max(8, bottom - top + 4), left: 2 + lane * BAND, width: BAND - 3, background: `color-mix(in oklab, ${color} 30%, transparent)` }}>
        {band.events.map((event) => (
          <span key={event.key} data-tick={event.status}
            className={`absolute left-1/2 -translate-x-1/2 rounded-full ${event.status === "failed" ? "size-2 bg-destructive ring-1 ring-background" : event.status === "running" ? "size-2 animate-pulse" : "h-0.5 w-full"}`}
            style={{ top: minuteOfDay(event.at, tz) * HOUR / 60 - top + 1, ...(event.status === "failed" ? {} : { background: color, opacity: event.status === "scheduled" ? 0.55 : 1 }) }} />
        ))}
      </button>
    </Tooltip>
  );
}
