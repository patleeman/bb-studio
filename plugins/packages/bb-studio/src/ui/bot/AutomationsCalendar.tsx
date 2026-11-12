// Automations as a week (calendar.ts): today first, 7 days when the pane is
// wide enough and 5 when it isn't, time of day down, only the hours that have
// runs. Every check-in, reminder, watcher, runner and plain BB schedule of the
// Bot shows when it runs, in the viewer's time zone, coloured by its area (a
// runner, or the Bot itself), the same colours as Runners and Paused.
// Frequent jobs (every 2 hours or more often) are hidden behind Show frequent
// and stay listed in the legend; shown, each is a thin band with a tick per
// run. Runs that start within 15 minutes of each other are one block ("Area
// sweep · 4") whose click lists each run's outcome and a link to its thread;
// a group with a failure turns red and, hovered or clicked, says what failed
// with Open thread and Run again. A past run opens its thread; a run going on
// now grows to the red current-time line. Blocks that overlap sit side by
// side while each keeps 64 px, the rest folding into a "+N" chip. Paused jobs
// aren't drawn: they're listed under the week, with Resume.
import { GHOST_BUTTON, ICON_BUTTON, OUTLINE_BUTTON } from "../../kit/app/index";
import { Icon, Input, Popover, PopoverAnchor, PopoverContent, Tooltip } from "../../kit/ui/index";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { BotAutomationRunView, BotAutomationView, RunnerView } from "../../contract";
import { describeCron } from "../../schedule";
import { useCall, useLive } from "../live";
import { useRunners } from "./Runners";
import { sidebarAgenda } from "./sidebarAgenda";
import { areaColor, areaColors, clockAt, inSentence, lastFailure, outcomeWords } from "./pageModel";
import { calendarWeek, chainGroups, groupName, isGroup, minuteOfDay, pausedSources, placeBlocks, windowDays, windowStart, type CalendarBand, type CalendarEvent, type CalendarGroup, type CalendarItem, type CalendarSource, type FoldChip, RUNS_LIMIT } from "./calendar";

/** An hour's height on the page, where the week shows whole; beside a thread it scrolls. */
const HOUR_WIDE = 27;
const HOUR = 36;
/** A block is this many minutes tall: one line. */
const SPAN = 45;
const BAND = 5;
/** Overlapping blocks narrower than this fold into a "+N" chip. */
const MIN_LANE = 64;
const CHIP = 26;
const KIND_LABEL: Record<CalendarSource["kind"], string> = { checkin: "Check-in", reminder: "Reminder", watcher: "Watcher", runner: "Runner", heartbeat: "Check-in", automation: "Automation" };
const FREQUENT_KEY = "studio.bot.showFrequent";
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayTime = (at: number) => new Date(at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
/** "Sun 1". */
const dayHeader = (at: number) => `${new Date(at).toLocaleDateString(undefined, { weekday: "short" })} ${new Date(at).getDate()}`;
const hourLabel = (hour: number) => new Date(2026, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });

type RunnerLike = Pick<RunnerView, "id" | "name" | "threadId" | "lastRunAt"> & { lastRunStatus?: string | null; running?: boolean; runningSince?: number | null; lastReport?: string | null; lastReportAt?: number | null };

/** A runner reports through the Bot, not its run: the run its last report came from (within 30 minutes before it) says what it found. */
function withReport(runs: BotAutomationRunView[], runner: RunnerLike | undefined): BotAutomationRunView[] {
  const at = runner?.lastReportAt, report = runner?.lastReport;
  if (!at || !report) return runs;
  const run = runs.filter((each) => each.at <= at && at - each.at < 30 * 60_000 && each.status !== "failed").sort((a, b) => b.at - a.at)[0];
  return run ? runs.map((each) => each === run ? { ...each, outcome: `Woke it: ${report}` } : each) : runs;
}

/**
 * The Bot's jobs as calendar sources: Studio automations (runners included)
 * and the plain BB jobs only the Schedule knew. A runner is its own area; a
 * watcher that wakes a runner is that runner's.
 */
export function calendarSources(automations: BotAutomationView[], scheduled: Parameters<typeof sidebarAgenda>[1], runs: Record<string, BotAutomationRunView[]>, runners: RunnerLike[]): CalendarSource[] {
  const agenda = sidebarAgenda(automations, scheduled);
  const byId = new Map(automations.map((each) => [each.id, each]));
  return [...agenda.upcoming, ...agenda.done].map((item): CalendarSource => {
    const studio = byId.get(item.id);
    const runner = item.kind === "runner" ? runners.find((each) => each.id === item.id) : undefined;
    const woken = studio?.kind === "watcher" && studio.target !== "main" && studio.target !== "own" ? { id: studio.target, name: studio.targetName } : null;
    return {
      id: item.id, name: item.name, kind: item.kind, schedule: studio?.schedule ?? null, cron: studio ? null : item.scheduleText || null,
      state: item.state, nextRunAt: item.nextRunAt, threadId: runner?.threadId ?? studio?.threadId ?? null,
      // A plain BB job has only its cron: say it in words. A cron words can't say stays out of sight.
      scheduleText: plainSchedule(studio ? item.scheduleText : item.scheduleText ? describeCron(item.scheduleText) : ""),
      runs: studio ? withReport(runs[item.id] ?? [], runner) : null,
      lastRun: runner?.lastRunAt ? { at: runner.lastRunAt, status: runner.lastRunStatus ?? "succeeded" } : null,
      runningSince: runner?.running ? runner.runningSince ?? null : null,
      area: item.kind === "runner" ? { id: item.id, name: item.name } : woken,
    };
  });
}

/** Schedule words with no cron in them: "Custom: 0 9 1-7 * 6" reads "Custom schedule". */
export const plainSchedule = (text: string) => /^Custom:/.test(text) ? "Custom schedule" : text;

/** Reads one automation's recent runs. */
function RunsFeed({ botId, id, onRuns }: { botId: string; id: string; onRuns(id: string, runs: BotAutomationRunView[]): void }) {
  const runs = useLive("bot_automation_runs", { botId, id, limit: RUNS_LIMIT }, { pollMs: 30_000 });
  useEffect(() => { if (runs.data) onRuns(id, runs.data.runs); }, [runs.data, id, onRuns]);
  return null;
}

/**
 * The Bot's jobs with their runs, its runners and area colours, for the week,
 * Needs you, Recent and Up next. Render `feeds` once: it reads each job's
 * runs (one shared request per job, however many views read it).
 */
export function useBotJobs(botId: string, automations: BotAutomationView[]) {
  const runners = useRunners(botId);
  const activity = useLive("bot_activity", { botId }, { pollMs: 15_000 });
  const [runs, setRuns] = useState<Record<string, BotAutomationRunView[]>>({});
  const onRuns = useMemo(() => (id: string, list: BotAutomationRunView[]) => setRuns((all) => all[id] === list ? all : { ...all, [id]: list }), []);
  const runnerList = runners.data?.runners ?? [];
  const sources = calendarSources(automations, activity.data?.scheduled ?? [], runs, runnerList);
  const colors = areaColors(runnerList);
  const feeds = automations.map((each) => <RunsFeed key={each.id} botId={botId} id={each.id} onRuns={onRuns} />);
  return { sources, runs, runners: runnerList, activity: activity.data, colors, feeds, loaded: automations.every((each) => runs[each.id]) };
}

/** Show frequent: remembered on this device. */
function useShowFrequent(): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => { try { return localStorage.getItem(FREQUENT_KEY) === "1"; } catch { return false; } });
  return [value, (next) => { setValue(next); try { localStorage.setItem(FREQUENT_KEY, next ? "1" : "0"); } catch { /* private mode */ } }];
}

/** The hours a window's runs need, at least 10, so the week shows whole without scrolling. */
function hourRange(items: { at: number }[], tz: string): [number, number] {
  if (!items.length) return [7, 19];
  const minutes = items.map((item) => minuteOfDay(item.at, tz));
  let from = Math.floor(Math.min(...minutes) / 60), to = Math.min(24, Math.ceil((Math.max(...minutes) + SPAN) / 60) + 1);
  while (to - from < 10) { if (from > 0) from--; if (to - from < 10 && to < 24) to++; }
  return [from, to];
}

export function AutomationsCalendar({ botId, botName = "The Bot", automations, onOpen, onPick, onResume, onRunNow, busy, wide = false, toolbar }: {
  botId: string; botName?: string; automations: BotAutomationView[];
  /** On the Bot page: show every hour that has runs, whole. Beside a thread it scrolls. */
  wide?: boolean;
  onOpen(threadId: string): void;
  /** A job's block without a thread to open: show the job. */
  onPick(id: string): void;
  onResume(id: string): void;
  /** Run again, from a failure. */
  onRunNow?(id: string): void;
  busy: boolean;
  /** Week / List and New, at the toolbar's end. */
  toolbar?: ReactNode;
}) {
  const jobs = useBotJobs(botId, automations);
  const page = useLive("bot_page_state", { botId }, { pollMs: 60_000 });
  const call = useCall();
  const names = page.data?.groupNames ?? {};
  const rename = (key: string, name: string) => void call("bot_calendar_group_rename", { botId, key, name }).then(() => page.refresh(), () => {});
  const [showFrequent, setShowFrequent] = useShowFrequent();
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
  const { sources, colors } = jobs;
  // Maintenance's switch is in Controls, not Resume here.
  const paused = pausedSources(sources).filter((source) => source.id !== "maintenance");
  const count = width >= 600 ? 7 : 5;
  const { days, frequent } = calendarWeek(sources, windowDays(windowStart(now, week, count), count, tz), now, tz, showFrequent);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const bandIds = [...new Set(days.flatMap((day) => day.bands.map((band) => band.sourceId)))];
  const inset = bandIds.length * BAND + (bandIds.length ? 4 : 2);
  const maxLanes = Math.max(1, Math.floor(((width - 52) / count - inset - 2) / MIN_LANE));
  const hour = wide ? HOUR_WIDE : HOUR;
  const [fromHour, toHour] = wide ? hourRange(days.flatMap((day) => [...day.singles, ...day.bands.flatMap((band) => band.events)]), tz) : [0, 24];
  const scroller = useRef<HTMLDivElement>(null);
  // Beside a thread it opens on the hours around now.
  useLayoutEffect(() => { if (!wide && scroller.current) scroller.current.scrollTop = Math.max(0, (minuteOfDay(Date.now(), tz) / 60 - 2) * HOUR); }, [tz, wide]);
  const y = (at: number) => (Math.min(minuteOfDay(at, tz), 24 * 60 - SPAN) / 60 - fromHour) * hour;
  const range = `${new Date(days[0]!.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(days.at(-1)!.start).toLocaleDateString(undefined, { day: "numeric" })}`;
  const open = (event: CalendarEvent) => { if (event.threadId) onOpen(event.threadId); else if (byId.get(event.sourceId)?.runs !== null) onPick(event.sourceId); };
  const colorOf = (sourceId: string) => areaColor(colors, byId.get(sourceId)?.area);
  // The legend: each area with a job this week, the Bot's last.
  const shownAreas = new Map<string, string>();
  for (const runner of jobs.runners) if (sources.some((source) => source.area?.id === runner.id)) shownAreas.set(runner.id, runner.name);
  const botJobs = sources.some((source) => !source.area && source.state !== "paused");
  const grouped = days.some((day) => chainGroups(day.singles, tz).some(isGroup));

  return (
    <div ref={box} data-testid="automations-calendar" data-wide={wide || undefined} className="flex flex-col gap-2">
      {jobs.feeds}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-medium">{week === 0 ? "This week" : "Week"}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{range}</span>
        <button type="button" className={ICON_BUTTON} aria-label="Earlier" onClick={() => setWeek(week - 1)}><Icon name="ChevronLeft" /></button>
        <button type="button" className={ICON_BUTTON} aria-label="Later" onClick={() => setWeek(week + 1)}><Icon name="ChevronRight" /></button>
        {week ? <button type="button" className={GHOST_BUTTON} onClick={() => setWeek(0)}>Today</button> : null}
        <span className="flex-1" />
        {frequent.length ? (
          <button type="button" role="switch" aria-checked={showFrequent} data-testid="calendar-show-frequent" onClick={() => setShowFrequent(!showFrequent)}
            className="flex h-7 items-center gap-2 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground">
            <span aria-hidden className={`relative h-3.5 w-6 rounded-full transition-colors ${showFrequent ? "bg-foreground" : "bg-foreground/15"}`}>
              <span className={`absolute top-0.5 size-2.5 rounded-full bg-background transition-[left] ${showFrequent ? "left-3" : "left-0.5"}`} />
            </span>
            Show frequent
          </button>
        ) : null}
        {toolbar}
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid border-b border-border bg-background text-xs" style={{ gridTemplateColumns: `44px repeat(${count}, minmax(0, 1fr))` }}>
          <span />
          {days.map((day) => {
            const today = week === 0 && day.start <= now && now < day.end;
            return (
              <span key={day.start} className={`truncate border-l border-border px-2 py-1.5 ${today ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                {today ? `Today · ${dayHeader(day.start)}` : dayHeader(day.start)}
              </span>
            );
          })}
        </div>
        <div ref={scroller} className={wide ? "relative" : "relative max-h-[440px] overflow-y-auto"}>
          <div className="relative grid" style={{ gridTemplateColumns: `44px repeat(${count}, minmax(0, 1fr))`, height: (toHour - fromHour) * hour + 6 }}>
            <div className="relative">
              {Array.from({ length: toHour - fromHour - 1 }, (_, i) => (
                <span key={i} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums" style={{ top: (i + 1) * hour }}>{hourLabel(fromHour + i + 1)}</span>
              ))}
            </div>
            {days.map((day) => {
              const today = day.start <= now && now < day.end;
              const items = chainGroups(day.singles, tz);
              const { blocks, chips } = placeBlocks<CalendarItem>(items, tz, SPAN, maxLanes);
              const room = `(100% - ${inset + 3}px)`;
              return (
                <div key={day.start} data-day={new Date(day.start).toDateString()} className={`@container/day relative border-l border-border ${today && week === 0 ? "bg-foreground/[0.025]" : ""}`}
                  style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${hour - 1}px, color-mix(in oklab, var(--border) 60%, transparent) ${hour - 1}px, color-mix(in oklab, var(--border) 60%, transparent) ${hour}px)` }}>
                  {day.bands.map((band) => <Band key={band.sourceId} band={band} lane={bandIds.indexOf(band.sourceId)} source={byId.get(band.sourceId)!} color={colorOf(band.sourceId)} now={now} y={y} onOpen={open} />)}
                  {blocks.map(({ event: item, lane, of }) => {
                    const style: CSSProperties = { top: y(item.at) + 3, height: SPAN * hour / 60 - 6, left: `calc(${inset}px + ${room} * ${lane / of})`, width: `calc(${room} / ${of} - 2px)` };
                    return isGroup(item)
                      ? <GroupBlock key={`${item.key}@${item.at}`} group={item} name={groupName(item, tz, names)} byId={byId} colorOf={colorOf} now={now} style={style} onOpen={onOpen} onRunNow={onRunNow} onRename={(name) => rename(item.key, name)} busy={busy} />
                      : <Block key={item.key} event={item} source={byId.get(item.sourceId)!} color={colorOf(item.sourceId)} now={now} tz={tz} hour={hour} style={style} onOpen={open} onRunNow={onRunNow} busy={busy} />;
                  })}
                  {chips.map((chip) => <FoldChipButton key={chip.at} chip={chip} byId={byId} names={names} tz={tz} now={now} onOpen={open} style={{ top: y(chip.at) + 3 + SPAN * hour / 60 - 4, left: inset, minWidth: CHIP, height: 14 }} />)}
                  {today ? (
                    <div data-testid="calendar-now" aria-hidden className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive" style={{ top: (minuteOfDay(now, tz) / 60 - fromHour) * hour }}>
                      <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-destructive" />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 px-0.5 text-xs text-muted-foreground" data-testid="calendar-legend">
        <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {[...shownAreas].map(([id, name]) => <span key={id} className="flex items-center gap-1.5"><Dot color={areaColor(colors, { id })} />{name}</span>)}
          {botJobs ? <span className="flex items-center gap-1.5"><Dot color={areaColor(colors, null)} />{botName}</span> : null}
          {grouped ? <span className="flex items-center gap-1.5"><Dots colors={[areaColor(colors, null), "var(--muted-foreground)"]} />Several areas at once</span> : null}
        </p>
        {frequent.length ? (
          <p className="flex flex-wrap items-center gap-1.5" data-testid="calendar-frequent">
            <span className="flex items-center gap-1.5 pr-0.5">{showFrequent ? null : <Icon name="EyeOff" className="size-3.5" aria-hidden />}{showFrequent ? "Frequent:" : "Frequent, hidden:"}</span>
            {frequent.map(({ sourceId, every }) => (
              <span key={sourceId} data-frequent={sourceId} className={`flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5 ${showFrequent ? "text-foreground/80" : ""}`}>
                <Dot color={colorOf(sourceId)} />{byId.get(sourceId)?.name} · {every.replace(/ h$/, " hours").replace(/^hourly$/, "every hour")}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {paused.length ? (
        <section aria-label="Paused" data-testid="calendar-paused" className="pt-4">
          <h3 className="pb-1.5 text-sm font-medium">Paused</h3>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {paused.map((source) => (
              <li key={source.id} data-paused={source.id} className="flex min-w-0 items-center gap-2.5 py-2">
                <Dot color={areaColor(colors, source.area)} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{source.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[source.area?.name, source.scheduleText].filter(Boolean).join(" · ")}
                    {lastFailure(source) ? <span className="text-destructive" data-paused-failed>{source.area?.name || source.scheduleText ? " · " : ""}Last run failed</span> : null}
                  </span>
                </span>
                {source.runs !== null ? <button type="button" className={OUTLINE_BUTTON} disabled={busy} onClick={() => onResume(source.id)}><Icon name="Play" />Resume</button> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function Dot({ color, className = "" }: { color: string; className?: string }) {
  return <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-full ${className}`} style={{ background: color }} />;
}

/** A group's areas: up to four overlapping dots. */
export function Dots({ colors }: { colors: string[] }) {
  const shown = [...new Set(colors)].slice(0, 4);
  return (
    <span aria-hidden className="flex shrink-0 items-center">
      {shown.map((color, i) => <span key={color} className="inline-block size-2 rounded-full ring-1 ring-background" style={{ background: color, marginLeft: i ? -3 : 0 }} />)}
    </span>
  );
}

function tip(source: CalendarSource, event: CalendarEvent, now: number): ReactNode {
  const status = event.status === "failed" ? <span className="font-medium">Failed: {event.error}</span>
    : event.status === "running" ? `Running for ${Math.max(1, Math.round((now - event.at) / 60_000))} min`
      : event.status === "scheduled" ? (event.at > now ? "Due" : "Was due")
        : outcomeWords(event);
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium">{source.name}</span>
      <span>{[source.area?.name, KIND_LABEL[source.kind], dayTime(event.at)].filter(Boolean).join(" · ")}{event.manual ? " · run by hand" : ""}</span>
      <span>{status}</span>
      <span className="opacity-80">{source.scheduleText}</span>
    </span>
  );
}

const blockLook = (color: string, past: boolean, failed: boolean): CSSProperties => failed
  ? { background: "color-mix(in oklab, var(--destructive) 12%, var(--background))", borderColor: "var(--destructive)" }
  : { background: `color-mix(in oklab, ${color} ${past ? 9 : 16}%, var(--background))`, borderColor: `color-mix(in oklab, ${color} ${past ? 22 : 40}%, var(--border))` };

function Block({ event, source, color, now, tz, hour, style, onOpen }: { event: CalendarEvent; source: CalendarSource; color: string; now: number; tz: string; hour: number; style: CSSProperties; onOpen(event: CalendarEvent): void; onRunNow?(id: string): void; busy: boolean }) {
  const past = event.status !== "scheduled" && event.status !== "running" || event.at <= now && event.status === "scheduled";
  const running = event.status === "running";
  const failed = event.status === "failed";
  // A live run reaches the current-time line.
  const height = Math.max(Number(style.height), running ? (minuteOfDay(now, tz) - minuteOfDay(event.at, tz)) * hour / 60 - 2 : 0);
  return (
    <Tooltip label={tip(source, event, now)} side="right">
      <button type="button" data-event={event.key} data-source={source.id} data-status={event.status} onClick={() => onOpen(event)}
        aria-label={`${source.name}, ${dayTime(event.at)}, ${event.status === "scheduled" ? "due" : event.status}`}
        className={`absolute z-10 flex min-w-0 items-center gap-1.5 overflow-hidden rounded border px-1.5 text-left text-[11px] leading-none hover:z-30 hover:brightness-105 focus-visible:z-30 ${running ? "ring-1 ring-foreground/30" : ""} ${past && !failed ? "text-muted-foreground" : "text-foreground"}`}
        style={{ ...style, height, ...blockLook(color, past, failed) }}>
        {failed ? <Icon name="AlertTriangle" className="size-3 shrink-0 text-destructive" aria-hidden />
          : running ? <Icon name="Spinner" className="size-3 shrink-0 animate-spin text-success motion-reduce:animate-none" aria-hidden />
            : <Dot color={color} />}
        <span className="min-w-0 truncate font-medium">{source.name}</span>
      </button>
    </Tooltip>
  );
}

/**
 * Runs that started within 15 minutes of each other: one block, its areas'
 * dots, name and count. A click lists each run's outcome with a link to its
 * thread. With a failure it's red, a warning in place of the dots, and
 * hovering opens the list too, with Open thread and Run again.
 */
function GroupBlock({ group, name, byId, colorOf, now, style, onOpen, onRunNow, onRename, busy }: {
  group: CalendarGroup; name: string; byId: Map<string, CalendarSource>; colorOf(id: string): string; now: number; style: CSSProperties;
  onOpen(threadId: string): void; onRunNow?(id: string): void; onRename(name: string): void; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = group.status === "failed";
  const past = group.events.every((event) => event.status !== "scheduled" || event.at <= now) && group.status !== "running";
  const hover = failed ? {
    onPointerEnter: () => { if (closing.current) clearTimeout(closing.current); setOpen(true); },
    onPointerLeave: () => { closing.current = setTimeout(() => setOpen(false), 250); },
  } : {};
  const colors = group.events.map((event) => colorOf(event.sourceId));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button type="button" data-group={group.key} data-status={group.status} aria-expanded={open} onClick={() => setOpen(!open)} {...hover}
          aria-label={`${name}, ${group.events.length} runs, ${dayTime(group.at)}${failed ? ", one failed" : ""}`}
          className={`absolute z-10 flex min-w-0 items-center gap-1.5 overflow-hidden rounded border px-1.5 text-left text-[11px] leading-none hover:z-30 focus-visible:z-30 ${open ? "z-30 ring-2 ring-foreground/70" : ""} ${past && !failed ? "text-muted-foreground" : "text-foreground"}`}
          style={{ ...style, ...(failed ? blockLook("", false, true) : { background: `color-mix(in oklab, var(--foreground) ${past ? 6 : 9}%, var(--background))`, borderColor: "color-mix(in oklab, var(--foreground) 22%, var(--border))" }) }}>
          {failed ? <Icon name="AlertTriangle" className="size-3 shrink-0 text-destructive" aria-hidden /> : <Dots colors={colors} />}
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{group.events.length}</span>
        </button>
      </PopoverAnchor>
      <PopoverContent side="bottom" className="w-72 p-0" data-testid="calendar-group" onOpenAutoFocus={(event) => event.preventDefault()} {...hover}>
        <GroupList group={group} name={name} byId={byId} colorOf={colorOf} now={now} onOpen={(threadId) => { setOpen(false); onOpen(threadId); }} onRunNow={onRunNow} onRename={onRename} busy={busy} />
      </PopoverContent>
    </Popover>
  );
}

function GroupList({ group, name, byId, colorOf, now, onOpen, onRunNow, onRename, busy }: {
  group: CalendarGroup; name: string; byId: Map<string, CalendarSource>; colorOf(id: string): string; now: number;
  onOpen(threadId: string): void; onRunNow?(id: string): void; onRename(name: string): void; busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const tz = zone();
  const failure = group.events.find((event) => event.status === "failed");
  const failedSource = failure ? byId.get(failure.sourceId) : undefined;
  const time = `${clockAt(group.at, tz)}${group.to !== group.at ? ` – ${clockAt(group.to, tz)}` : ""}`;
  if (failure && failedSource) {
    return (
      <div className="flex flex-col gap-2 p-3 text-xs">
        <p className="flex items-center gap-1.5 text-sm font-medium"><Icon name="AlertTriangle" className="size-3.5 text-destructive" aria-hidden />{name} · {new Date(group.at).toDateString() === new Date(now).toDateString() ? "today" : dayTime(group.at)} {clockAt(group.at, tz)}</p>
        <ul className="flex flex-col gap-1">
          {group.events.map((event) => (
            <li key={event.key} className="flex items-center gap-2"><Dot color={colorOf(event.sourceId)} /><span className="min-w-0 flex-1 truncate">{byId.get(event.sourceId)?.name}</span>
              <span className={event.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{event.status === "failed" ? "Failed" : outcomeWords(event, now)}</span></li>
          ))}
        </ul>
        <p className="text-muted-foreground">{failedSource.name} {inSentence(failure.error ?? "failed").replace(/\.$/, "")}.</p>
        <div className="flex flex-wrap gap-1.5">
          {failure.threadId ? <button type="button" className={OUTLINE_BUTTON} onClick={() => onOpen(failure.threadId!)}>Open {failedSource.name}'s thread</button> : null}
          {onRunNow ? <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => onRunNow(failedSource.id)}><Icon name="Repeat" />Run again</button> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col text-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Dots colors={group.events.map((event) => colorOf(event.sourceId))} />
        {editing ? (
          <form className="flex min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); setEditing(false); if (draft.trim() !== name) onRename(draft.trim()); }}>
            <Input autoFocus aria-label="Group name" className="h-7 text-sm" value={draft} maxLength={60} onChange={(event) => setDraft(event.target.value)} onBlur={() => setEditing(false)} placeholder="5 AM checks" />
          </form>
        ) : (
          <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" title="Rename" onClick={() => { setDraft(name); setEditing(true); }}>{name}</button>
        )}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{time}</span>
      </div>
      <ul className="flex flex-col p-1">
        {group.events.map((event) => {
          const source = byId.get(event.sourceId);
          return (
            <li key={event.key}>
              <button type="button" disabled={!event.threadId} onClick={() => event.threadId && onOpen(event.threadId)} data-group-run={event.sourceId}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-state-hover disabled:hover:bg-transparent">
                <Dot color={colorOf(event.sourceId)} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{source?.name}</span>
                  <span className={`truncate text-xs ${event.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{outcomeWords(event, now)}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{clockAt(event.at, tz)}</span>
                {event.threadId ? <Icon name="ChevronRight" className="size-3.5 shrink-0 text-muted-foreground" aria-label="Open its thread" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The blocks a crowded cluster folded away: "+N", each listed in the tooltip; it opens the first. */
function FoldChipButton({ chip, byId, names, tz, now, style, onOpen }: { chip: FoldChip<CalendarItem>; byId: Map<string, CalendarSource>; names: Record<string, string>; tz: string; now: number; style: CSSProperties; onOpen(event: CalendarEvent): void }) {
  const events = chip.events.flatMap((item) => isGroup(item) ? item.events : [item]);
  const failed = events.some((event) => event.status === "failed");
  const live = events.some((event) => event.status === "running");
  const label = (item: CalendarItem) => isGroup(item) ? groupName(item, tz, names) : byId.get(item.sourceId)?.name ?? "";
  return (
    <Tooltip side="right" label={(
      <span className="flex flex-col gap-1">
        {chip.events.map((item) => (
          <span key={isGroup(item) ? item.key : item.key} className="flex flex-col">
            <span className="font-medium">{label(item)} · {clockAt(item.at, tz)}</span>
            {!isGroup(item) ? <span>{item.status === "failed" ? `Failed: ${item.error}` : item.status === "running" ? "Running" : item.status === "scheduled" ? (item.at > now ? "Due" : "Was due") : outcomeWords(item)}</span> : <span>{item.events.length} runs</span>}
          </span>
        ))}
      </span>
    )}>
      <button type="button" data-fold={chip.events.length} aria-label={`${chip.events.length} more: ${chip.events.map(label).join(", ")}`} onClick={() => onOpen(events[0]!)}
        className={`absolute z-10 flex items-center justify-center rounded px-1 bg-muted text-[10px] font-medium tabular-nums text-foreground hover:z-30 hover:brightness-110 ${failed ? "ring-1 ring-destructive" : "ring-1 ring-border"}`} style={style}>
        {live ? <span data-fold-live className="mr-0.5 size-1.5 shrink-0 animate-pulse rounded-full bg-foreground" /> : null}+{chip.events.length}
      </button>
    </Tooltip>
  );
}

/** A frequent job's day: a thin bar from its first run to its last, a tick per run (solid past, faint due), failures and a live run marked. */
function Band({ band, lane, source, color, now, y, onOpen }: { band: CalendarBand; lane: number; source: CalendarSource; color: string; now: number; y(at: number): number; onOpen(event: CalendarEvent): void }) {
  const top = y(band.from);
  const bottom = y(band.to);
  const failed = band.events.filter((event) => event.status === "failed");
  const latest = [...band.events].reverse().find((event) => event.threadId) ?? band.events.find((event) => event.at > now) ?? band.events[0]!;
  const done = band.events.filter((event) => event.status !== "scheduled").length;
  return (
    <Tooltip side="right" label={(
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{source.name}</span>
        <span>{[source.area?.name, band.every].filter(Boolean).join(" · ")} · {band.events.length} runs this day{done ? `, ${done} done` : ""}</span>
        {failed.map((event) => <span key={event.key} className="font-medium">Failed {clockAt(event.at, zone())}: {event.error}</span>)}
        <span className="opacity-80">{source.scheduleText}</span>
      </span>
    )}>
      <button type="button" data-band={source.id} aria-label={`${source.name}, ${band.every}, ${band.events.length} runs`} onClick={() => onOpen(failed.at(-1) ?? latest)}
        className="absolute z-10 rounded-full hover:brightness-125" style={{ top: top - 2, height: Math.max(8, bottom - top + 4), left: 3 + lane * BAND, width: BAND - 2, background: `color-mix(in oklab, ${color} 22%, transparent)` }}>
        {band.events.map((event) => (
          <span key={event.key} data-tick={event.status}
            className={`absolute left-1/2 -translate-x-1/2 rounded-full ${event.status === "failed" ? "size-2 bg-destructive ring-1 ring-background" : event.status === "running" ? "size-2 animate-pulse" : "h-0.5 w-full"}`}
            style={{ top: y(event.at) - top + 1, ...(event.status === "failed" ? {} : { background: color, opacity: event.status === "scheduled" ? 0.4 : 1 }) }} />
        ))}
      </button>
    </Tooltip>
  );
}
