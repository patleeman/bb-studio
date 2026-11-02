// The Bot page (bot/<botId>): one scroll, most important first. The header
// says in a sentence what it's doing (botPage.ts), with Open chat, Pause,
// Stop… and Controls (BotControls.tsx, every setting). Working now sits beside
// Needs you: due loops, the chat's pending questions, failed runs (until the
// next run succeeds or Patrick dismisses one) and maintenance's decisions,
// each with one action. Then the week at full width with Paused below it
// (AutomationsCalendar.tsx), then Recent in plain words, Runners and the
// Loops summary. BotPane is the compact version beside the Bot's chat.
import { OUTLINE_BUTTON, GHOST_BUTTON, ICON_BUTTON, PRIMARY_BUTTON, openAppPath } from "../../kit/app/index";
import { Icon } from "../../kit/ui/index";
import { useEffect, useState, type ReactNode } from "react";
import { experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import type { BotView } from "../../contract";
import type { Loop } from "../../loops/contract";
import { useCall, useLive } from "../live";
import { BotAvatar, botProvider, colorForName, isBotShape } from "./BotAvatar";
import { openThreadPage, useBotControls } from "./BotHome";
import { AutomationsSection, useAutomations } from "./Automations";
import { Dot, Dots, useBotJobs } from "./AutomationsCalendar";
import { RunnersSection } from "./Runners";
import { calendarWeek, chainGroups, groupName, isGroup, windowDays, type CalendarEvent } from "./calendar";
import { agoWords, areaColor, clockAt, failedRuns, failedTitle, inSentence, recentEntries, statusSentence, upNext, whenWords, type RecentEntry } from "./pageModel";
import { useOpenThread } from "./workspace";
import { botPath } from "./selection";
import { usePendingQuestions } from "../../loops/ui/LoopsTab";
import { openLoops, useLoopActions, useLoopsEnabled, useOpenLoopsPane } from "../../loops/ui/hooks";
import { dueLabel } from "../../loops/ui/model";
import { Elapsed, ProviderStatusMark, runningLabel } from "./ProviderStatusMark";

const DAY = 86_400_000;
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const STATE_DOT = { active: "bg-success", paused: "bg-warning", stopped: "bg-muted-foreground/50" } as const;
const RECENT_SHOWN = 8;

/** The Bot's Controls view (bot/<botId>/controls), with `section` scrolled to. */
export const controlsPath = (botId: string, section?: string) => `${botPath(botId)}/controls${section ? `#${section}` : ""}`;
export const isControlsPath = (pathname: string) => /^\/plugins\/studio\/studio\/bot\/[^/]+\/controls\/?$/.test(pathname);

const firstSentence = (text: string | null | undefined) => ((text ?? "").split(/(?<=[.!?])\s/)[0] ?? "").replace(/[.!]$/, "");
const capitalize = (text: string) => text ? text[0]!.toUpperCase() + text.slice(1) : text;

export type WorkItem = { id: string; name: string; detail: string; since: number | null; waiting: string | null; providerId: string | null; threadId: string };
export type NeedItem = {
  key: string; icon: string; tone?: "failed"; title: string; detail: string | null;
  due?: { text: string; urgent: boolean } | null;
  action: { label: string; run(): void };
  dismiss?: () => void;
};

/**
 * What the page and the pane show: working now, needs you, the jobs (with
 * runs and areas), Up next, Recent and the status sentence.
 */
export function useBotPageModel(view: BotView) {
  const bot = view.bot!;
  const automations = useAutomations(bot.id);
  const jobs = useBotJobs(bot.id, automations.data?.automations ?? []);
  const page = useLive("bot_page_state", { botId: bot.id }, { pollMs: 60_000 });
  const maintenance = useLive("bot_maintenance_get", { botId: bot.id }, { enabled: bot.kind !== "external", pollMs: 120_000 });
  const loopsOn = useLoopsEnabled() && bot.primary !== false;
  const loops = useLive("loops.list", {}, { enabled: loopsOn, pollMs: 60_000 });
  const pending = usePendingQuestions(bot.threadId);
  const call = useCall();
  const openThread = useOpenThread();
  const actions = useLoopActions(loops.refresh);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const tz = zone();
  const names = page.data?.groupNames ?? {};
  const { sources, runners, activity } = jobs;

  // Working now: what's running, runners by name.
  const working: WorkItem[] = [];
  for (const thread of activity?.inProgress ?? []) {
    const runner = runners.find((each) => each.threadId === thread.id);
    working.push({
      id: thread.id, threadId: thread.id, since: thread.runningSince ?? null, waiting: thread.waitingFor ?? null, providerId: thread.providerId ?? null,
      name: runner?.name ?? (thread.relation === "self" ? bot.name : thread.title),
      detail: runner ? (thread.title && thread.title !== runner.name ? thread.title : firstSentence(runner.job)) : thread.relation === "self" ? "Working in its chat" : "A thread it started",
    });
  }
  for (const runner of runners) if (runner.running && runner.threadId && !working.some((each) => each.threadId === runner.threadId)) {
    working.push({ id: runner.id, threadId: runner.threadId, name: runner.name, detail: firstSentence(runner.job), since: runner.runningSince ?? null, waiting: null, providerId: runner.providerId ?? null });
  }

  // Needs you: loops, questions, failures, maintenance.
  const dismissed = new Set(page.data?.dismissed ?? []);
  const needs: NeedItem[] = [];
  const loopAction = (loop: Loop): NeedItem["action"] => loop.kind === "decide" ? { label: "Decide", run: () => openLoops(bot.id) }
    : loop.kind === "read" ? { label: "Got it", run: () => void actions.act({ id: loop.id, action: "got_it" }) }
      : loop.kind === "waiting" ? { label: "Nudge", run: () => void actions.act({ id: loop.id, action: "nudge" }) }
        : { label: "Done", run: () => void actions.act({ id: loop.id, action: "done" }) };
  const loopIcon = { do: "Circle", decide: "Fork", read: "FileText", waiting: "Clock" } as const;
  const loopNeeds = loopsOn ? loops.data?.needsYouNow ?? [] : [];
  const failures = failedRuns(sources, dismissed);
  for (const loop of loopNeeds.filter((each) => dueLabel(each.due, now)?.urgent)) needs.push({ key: `loop:${loop.id}`, icon: loopIcon[loop.kind], title: loop.title, detail: loop.why || null, due: dueLabel(loop.due, now), action: loopAction(loop) });
  for (const run of failures) needs.push({
    key: `failed:${run.sourceId}:${run.runId}`, icon: "AlertTriangle", tone: "failed", title: failedTitle(run, now, tz), detail: capitalize(/^(it|she|he|they)\b/i.test(run.error) ? run.error : `It ${run.error}`.replace(/^It (C|c)ouldn't/, "It couldn't")),
    action: run.threadId ? { label: "Open", run: () => openThread(run.threadId!) } : { label: "Open", run: () => openAppPath(botPath(bot.id)) },
    dismiss: () => void call("bot_run_dismiss", { botId: bot.id, automationId: run.sourceId, runId: run.runId }).then(() => page.refresh(), () => {}),
  });
  const tracked = new Set(loopNeeds.filter((loop) => loop.source?.kind === "interaction").map((loop) => loop.source!.ref));
  for (const question of pending.filter((each) => !tracked.has(each.id))) needs.push({
    key: `question:${question.id}`, icon: "CircleQuestion", title: question.text ?? question.reason, detail: `${question.text ? `${question.reason === "Asked you a question" ? "Asked you in chat" : question.reason}` : "In its chat"} ${agoWords(question.createdAt, now)}`,
    action: { label: question.reason.includes("approval") ? "Review" : "Answer", run: () => bot.threadId && openThread(bot.threadId) },
  });
  for (const loop of loopNeeds.filter((each) => !dueLabel(each.due, now)?.urgent)) needs.push({ key: `loop:${loop.id}`, icon: loopIcon[loop.kind], title: loop.title, detail: loop.why || null, due: dueLabel(loop.due, now), action: loopAction(loop) });
  const lastMaintenance = maintenance.data?.runs.find((run) => !run.dryRun);
  if (lastMaintenance?.needsCall.length) {
    const count = lastMaintenance.needsCall.length;
    needs.push({ key: "maintenance:calls", icon: "Archive", title: `Archive ${count} finished thread${count === 1 ? "" : "s"}?`, detail: "Daily cleanup wants your call", action: { label: "Review", run: () => openAppPath(controlsPath(bot.id, "maintenance")) } });
  }
  const adoptable = lastMaintenance?.suggestions.filter((each) => each.threadId && each.automationId) ?? [];
  if (adoptable.length) needs.push({ key: "maintenance:suggest", icon: "Repeat", title: adoptable.length === 1 ? adoptable[0]!.text : `${adoptable.length} threads could be runners`, detail: "Daily cleanup suggests it", action: { label: "Review", run: () => openAppPath(controlsPath(bot.id, "maintenance")) } });

  // The jobs over two days back and the week ahead, for Recent, Up next and the status.
  const window = windowDays(now - 2 * DAY, 6, tz);
  const week = calendarWeek(sources, window, now, tz, true);
  const events: CalendarEvent[] = week.days.flatMap((day) => [...day.singles, ...day.bands.flatMap((band) => band.events)]);
  const frequent = new Set(week.frequent.map((each) => each.sourceId));
  const next = upNext(events, sources, frequent, now, tz, names, 3);
  const pastSingles = week.days.flatMap((day) => day.singles).filter((event) => event.at <= now && event.status !== "scheduled" && event.status !== "running");
  const lastItem = (() => {
    const today = pastSingles.filter((event) => now - event.at < DAY);
    if (!today.length) return null;
    const items = chainGroups(today, tz);
    const last = items.at(-1)!;
    return isGroup(last) ? { name: groupName(last, tz, names), at: last.to } : { name: sources.find((each) => each.id === last.sourceId)?.name ?? "A job", at: last.at };
  })();
  const reports = runners.filter((runner) => runner.lastReport && runner.lastReportAt).map((runner) => ({ sourceId: runner.id, at: runner.lastReportAt!, text: runner.lastReport! }));
  const runnerThreads = new Set(runners.map((runner) => runner.threadId));
  const finished = (activity?.completed ?? []).filter((thread) => thread.relation === "started" && !runnerThreads.has(thread.id) && now - thread.updatedAt < 2 * DAY).map((thread) => ({ id: thread.id, title: thread.title, at: thread.updatedAt }));
  const recent = recentEntries({ events, sources, frequent, reports, finished, maintenance: maintenance.data?.runs ?? [], names, now, zone: tz });
  const status = statusSentence({ state: bot.state, working: working.length, needs: needs.length, next: next[0] ? { name: next[0].name, at: next[0].at } : null, lastRunAt: lastItem?.at ?? null, now, zone: tz });
  return { bot, jobs, working, needs, next, recent, status, lastItem, loopsOn, loops: loops.data, now, tz, automations, loopError: actions.error };
}
export type BotPageModel = ReturnType<typeof useBotPageModel>;

/** The Bot page itself. */
export function BotPage({ view, refresh }: { view: BotView; refresh(): void }) {
  const model = useBotPageModel(view);
  const { bot, working, needs, status, lastItem, loopsOn, jobs } = model;
  const { run, busy, error, setSheet, sheets } = useBotControls(view, refresh, working.length);
  const openThread = useOpenThread();
  const { providers } = useProviders();
  const quiet = !working.length && !needs.length;
  const color = bot.color ?? colorForName(bot.name);
  return (
    <div className="flex flex-col pb-10" aria-label={`${bot.name} info`} data-testid="bot-page">
      {jobs.feeds}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-6 pb-5">
        <BotAvatar shape={isBotShape(bot.shape) ? bot.shape : null} color={color} emoji={bot.avatar || "🤖"} image={bot.avatarImageUrl} size={44} working={working.length > 0} provider={botProvider(bot)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-lg leading-tight font-semibold">{bot.name}</h1>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground" data-testid="bot-info-status">
            <span className={`size-2 shrink-0 rounded-full ${STATE_DOT[bot.state]}`} aria-hidden /><span className="min-w-0">{status}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {bot.threadId ? <button type="button" className={PRIMARY_BUTTON} data-testid="bot-open-chat" onClick={() => openThread(bot.threadId!)}><Icon name="MessageSquare" />Open chat</button> : null}
          {bot.state === "active"
            ? <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_pause")}><Icon name="Pause" />Pause</button>
            : <button type="button" className={OUTLINE_BUTTON} disabled={!!busy} onClick={() => void run("bot_resume")}><Icon name="Play" />Resume</button>}
          {bot.state !== "stopped" ? <button type="button" className={GHOST_BUTTON} disabled={!!busy} onClick={() => setSheet("stop")}><Icon name="Square" />Stop…</button> : null}
          <button type="button" className={OUTLINE_BUTTON} data-testid="bot-controls" onClick={() => openAppPath(controlsPath(bot.id))}><Icon name="SlidersHorizontal" />Controls</button>
        </div>
      </header>
      {error ? <p role="alert" className="pb-2 text-xs text-destructive">{error}</p> : null}
      {!bot.threadId ? <p className="pb-2 text-xs text-muted-foreground">{bot.name} has no chat.{bot.primary === false ? "" : " Make a thread your Bot from its ⋯ menu."}</p> : null}
      {quiet ? (
        <p className="flex items-center gap-2 border-y border-border py-3 text-sm text-muted-foreground" data-testid="bot-quiet">
          <Icon name="Check" className="size-4 text-success" aria-hidden /><span className="flex-1">Nothing running, and nothing needs you.</span>
          {lastItem ? <span className="text-xs">Last run: {inSentence(lastItem.name)} at {clockAt(lastItem.at, model.tz)}</span> : null}
        </p>
      ) : (
        <div className="grid gap-x-8 gap-y-6 @3xl/page:grid-cols-2">
          <WorkingNow items={working} onOpen={openThread} providers={providers} />
          <NeedsYou model={model} />
        </div>
      )}
      <AutomationsSection botId={bot.id} botName={bot.name} onOpen={openThread} disabled={bot.state !== "active"} external={bot.kind === "external"} page />
      <div className="grid gap-x-8 gap-y-8 pt-10 @3xl/page:grid-cols-2">
        <Recent entries={model.recent} tz={model.tz} now={model.now} />
        {bot.kind === "external" ? null : <RunnersSection botId={bot.id} botName={bot.name} onOpen={openThread} disabled={bot.state !== "active"} providers={providers} fallbackProviderId={bot.providerId} compact colors={jobs.colors} schedules={Object.fromEntries((model.automations.data?.automations ?? []).map((each) => [each.id, each.scheduleText]))} />}
      </div>
      {loopsOn ? <LoopsSummary model={model} /> : null}
      {sheets}
    </div>
  );
}

function SectionHead({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2 border-b border-border">
      <h2 className="text-sm font-medium">{title}</h2>
      {count ? <span className="rounded-full bg-warning px-1.5 text-[11px] leading-4 font-medium text-background tabular-nums">{count}</span> : null}
      <span className="flex-1" />{action}
    </div>
  );
}

export function WorkingNow({ items, onOpen, providers, compact = false }: { items: WorkItem[]; onOpen(threadId: string): void; providers: Parameters<typeof ProviderStatusMark>[0]["providers"]; compact?: boolean }) {
  return (
    <section aria-label="Working now" data-testid="bot-working">
      <SectionHead title="Working now" />
      {items.length ? (
        <ul className="flex flex-col divide-y divide-border border-b border-border">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className={`flex w-full min-w-0 items-center gap-3 text-left hover:bg-state-hover ${compact ? "py-1.5" : "py-2"}`} onClick={() => onOpen(item.threadId)}>
                <ProviderStatusMark providerId={item.providerId} tone={item.waiting ? "needs" : "running"} providers={providers} label={item.waiting ?? runningLabel(item.since)} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{item.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.waiting ?? item.detail}</span>
                </span>
                {item.since != null ? <Elapsed since={item.since} className="text-xs text-muted-foreground" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="py-2 text-sm text-muted-foreground">Nothing running.</p>}
    </section>
  );
}

export function NeedsYou({ model, limit, compact = false }: { model: BotPageModel; limit?: number; compact?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? model.needs.slice(0, limit) : model.needs;
  const allLoops = model.loopsOn ? <button type="button" className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => openLoops(model.bot.id)}>All loops<Icon name="ChevronRight" className="size-3.5" /></button> : null;
  return (
    <section aria-label="Needs you" data-testid="bot-needs">
      <SectionHead title="Needs you" count={model.needs.length} action={compact ? null : allLoops} />
      {shown.length ? (
        <ul className="flex flex-col divide-y divide-border border-b border-border">
          {shown.map((item) => (
            <li key={item.key} data-need={item.key} className={`flex min-w-0 items-center gap-3 ${compact ? "py-1.5" : "py-2"}`}>
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${item.tone === "failed" ? "bg-destructive/10 text-destructive" : "bg-foreground/[0.05] text-muted-foreground"}`}>
                <Icon name={item.icon} className="size-3.5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{item.title}</span>
                {!compact && item.detail ? <span className="truncate text-xs text-muted-foreground">{item.detail}</span> : null}
              </span>
              {item.due ? <span className={`shrink-0 text-xs ${item.due.urgent ? "text-warning" : "text-muted-foreground"}`}>{item.due.text}</span> : null}
              {item.dismiss && !compact ? <button type="button" className={ICON_BUTTON} aria-label={`Dismiss ${item.title}`} title="Dismiss: it shows again if the next run fails" onClick={item.dismiss}><Icon name="X" /></button> : null}
              <button type="button" className={`${OUTLINE_BUTTON} shrink-0`} onClick={item.action.run}>{item.action.label}</button>
            </li>
          ))}
        </ul>
      ) : <p className="py-2 text-sm text-muted-foreground">Nothing needs you.</p>}
      {limit && model.needs.length > limit ? (
        <button type="button" className="flex items-center gap-0.5 pt-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAll(!all)}>
          {all ? "Fewer" : `${model.needs.length - limit} more`}<Icon name={all ? "ChevronUp" : "ChevronRight"} className="size-3.5" />
        </button>
      ) : null}
      {model.loopError ? <p role="alert" className="pt-1 text-xs text-destructive">{model.loopError}</p> : null}
    </section>
  );
}

const dayLabel = (at: number, now: number) => {
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / DAY);
  return days === 0 ? null : days === 1 ? "Yesterday" : new Date(at).toLocaleDateString(undefined, { weekday: "short" });
};

export function Recent({ entries, tz, now, limit = RECENT_SHOWN, compact = false }: { entries: RecentEntry[]; tz: string; now: number; limit?: number; compact?: boolean }) {
  const [older, setOlder] = useState(false);
  const shown = older ? entries : entries.slice(0, limit);
  return (
    <section aria-label="Recent" data-testid="bot-recent">
      <SectionHead title="Recent" action={!compact && entries.length > limit ? <button type="button" className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOlder(!older)}>{older ? "Newer" : "Older"}<Icon name="ChevronRight" className="size-3.5" /></button> : null} />
      {shown.length ? (
        <ul className="flex flex-col">
          {shown.map((entry, i) => {
            const previous = shown[i - 1];
            const label = dayLabel(entry.at, now);
            const time = entry.muted ? "" : label && previous && dayLabel(previous.at, now) === label ? "" : label ?? clockAt(entry.at, tz);
            return (
              <li key={entry.key} data-recent={entry.key} className="grid grid-cols-[4.5rem_1fr] gap-3">
                <span className="border-b border-transparent py-2 text-xs text-muted-foreground/80 tabular-nums">{time}</span>
                <span className={`border-b border-border py-2 text-sm ${entry.muted ? "text-muted-foreground" : ""}`}>
                  {entry.parts.map((part, j) => <span key={j} className={part.tone === "failed" ? "text-destructive" : part.tone === "strong" ? "font-semibold" : ""}>{part.text}</span>)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="py-2 text-sm text-muted-foreground">Nothing yet.</p>}
    </section>
  );
}

function LoopsSummary({ model }: { model: BotPageModel }) {
  const groups = model.loops;
  const weekAgo = model.now - 7 * DAY;
  const counts: [number, string][] = groups ? [
    [groups.needsYouNow.length, "need you"], [groups.comingUp.length, "coming up"], [groups.agentsOnIt.length, "with agents"],
    [groups.waitingOnOthers.length, "waiting on others"], [groups.done.filter((loop) => (loop.closedAt ?? 0) >= weekAgo).length, "done this week"],
  ] : [];
  return (
    <section aria-label="Loops" data-testid="bot-loops" className="pt-10">
      <SectionHead title="Loops" action={<button type="button" className={OUTLINE_BUTTON} data-testid="bot-loops-tab" onClick={() => openLoops(model.bot.id)}>Open Loops<Icon name="ChevronRight" /></button>} />
      <p className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border py-2.5 text-sm text-muted-foreground">
        {groups ? counts.map(([count, label]) => <span key={label}><span className="font-medium text-foreground tabular-nums">{count}</span> {label}</span>) : "Loading…"}
      </p>
    </section>
  );
}

/**
 * Bot info beside the Bot's chat: the page's compact version. Name and status
 * with Pause and Controls, Working now, Needs you (four, then "N more"), Up
 * next (three runs, frequent jobs skipped), Recent (three) and links out.
 */
export function BotPane({ view, refresh, threadId }: { view: BotView; refresh(): void; threadId?: string }) {
  const model = useBotPageModel(view);
  const { bot, working, jobs } = model;
  const { run, busy, sheets } = useBotControls(view, refresh, working.length);
  const openThread = useOpenThread();
  const openLoopsPane = useOpenLoopsPane();
  const { providers } = useProviders();
  const color = bot.color ?? colorForName(bot.name);
  const short = bot.state !== "active" ? (bot.state === "paused" ? "Paused" : "Stopped") : working.length ? `Working on ${working.length} thing${working.length === 1 ? "" : "s"}` : model.needs.length ? `${model.needs.length} thing${model.needs.length === 1 ? "" : "s"} need${model.needs.length === 1 ? "s" : ""} you` : "Idle";
  return (
    <div className="studio-root flex h-full min-h-0 flex-col gap-5 overflow-y-auto bg-background px-4 pt-4 pb-6 text-foreground" aria-label={`${bot.name} info`} data-testid="bot-pane">
      {jobs.feeds}
      <header className="flex items-center gap-3">
        <BotAvatar shape={isBotShape(bot.shape) ? bot.shape : null} color={color} emoji={bot.avatar || "🤖"} image={bot.avatarImageUrl} size={32} working={working.length > 0} provider={botProvider(bot)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{bot.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="bot-info-status"><span className={`size-1.5 rounded-full ${STATE_DOT[bot.state]}`} aria-hidden />{short}</span>
        </div>
        {bot.threadId && bot.threadId !== threadId ? <button type="button" className={ICON_BUTTON} aria-label="Open chat" title="Open chat" data-testid="bot-open-chat" onClick={() => openThread(bot.threadId!)}><Icon name="MessageSquare" /></button> : null}
        {bot.state === "active"
          ? <button type="button" className={ICON_BUTTON} aria-label="Pause" title="Pause" disabled={!!busy} onClick={() => void run("bot_pause")}><Icon name="Pause" /></button>
          : <button type="button" className={ICON_BUTTON} aria-label="Resume" title="Resume" disabled={!!busy} onClick={() => void run("bot_resume")}><Icon name="Play" /></button>}
        <button type="button" className={ICON_BUTTON} aria-label="Controls" title="Controls" onClick={() => openAppPath(controlsPath(bot.id))}><Icon name="SlidersHorizontal" /></button>
      </header>
      {working.length ? <WorkingNow items={working} onOpen={openThread} providers={providers} compact /> : null}
      <NeedsYou model={model} limit={4} compact />
      <section aria-label="Up next" data-testid="bot-up-next">
        <SectionHead title="Up next" />
        {model.next.length ? (
          <ul className="flex flex-col divide-y divide-border border-b border-border">
            {model.next.map((row) => (
              <li key={row.key} className="flex min-w-0 items-center gap-2.5 py-2 text-sm">
                {row.count > 1 ? <Dots colors={row.areas.map((id) => areaColor(jobs.colors, { id }))} /> : <Dot color={areaColor(jobs.colors, { id: row.areas[0] ?? "" })} />}
                <span className="min-w-0 flex-1 truncate">{row.name}{row.count > 1 ? ` · ${row.count}` : ""}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{capitalize(whenWords(row.at, model.now, model.tz).replace(/^at /, ""))}</span>
              </li>
            ))}
          </ul>
        ) : <p className="py-2 text-sm text-muted-foreground">Nothing scheduled.</p>}
      </section>
      <Recent entries={model.recent} tz={model.tz} now={model.now} limit={3} compact />
      <nav className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="More">
        <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => openAppPath(botPath(bot.id))}>Schedule<Icon name="ArrowUpRight" className="size-3.5" /></button>
        {model.loopsOn ? <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => openLoopsPane(bot.id)}>Loops<Icon name="ArrowUpRight" className="size-3.5" /></button> : null}
        <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => openAppPath(controlsPath(bot.id))}>Controls<Icon name="ArrowUpRight" className="size-3.5" /></button>
      </nav>
      {sheets}
    </div>
  );
}

export { openThreadPage };
