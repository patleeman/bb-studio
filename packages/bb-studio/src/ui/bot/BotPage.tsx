// The Bot page (bot/<botId>): one scroll, most important first. The header
// says in a sentence what it's doing (botPage.ts), with Open chat, Pause,
// Stop… and Controls (BotControls.tsx, every setting). Working now sits beside
// Needs you: due todos, the chat's pending questions, failed runs (until the
// next run succeeds or the user dismisses one) and maintenance's decisions,
// each with one action. Then the week at full width with Paused below it
// (AutomationsCalendar.tsx), then Recent in plain words, Runners and the
// Todos summary. The top of BB's Info tab on a Bot's thread is BotInfoRows.tsx.
import { OUTLINE_BUTTON, GHOST_BUTTON, ICON_BUTTON, PRIMARY_BUTTON, openAppPath } from "../../kit/app/index";
import { Icon } from "../../kit/ui/index";
import { useEffect, useState, type ReactNode } from "react";
import { experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import type { BotView } from "../../contract";
import type { Loop } from "../../loops/contract";
import { useCall, useLive } from "../live";
import { BotFace } from "../../presence/ui/BotFace";
import { botProvider } from "./BotAvatar";
import { openThreadPage, useBotControls } from "./BotHome";
import { AutomationsSection, useAutomations } from "./Automations";
import { useBotJobs } from "./AutomationsCalendar";
import { calendarWeek, chainGroups, groupName, isGroup, windowDays, type CalendarEvent } from "./calendar";
import { agoWords, clockAt, failedRuns, failedTitle, inSentence, type FailedRun, recentEntries, statusSentence, upNext, type RecentEntry } from "./pageModel";
import { useOpenThread } from "./workspace";
import { botPath } from "./selection";
import { noteBotName } from "../page-bar";
import { usePendingQuestions } from "../../loops/ui/LoopsTab";
import { openLoops, useLoopActions, useLoopsEnabled, useTodosZone } from "../../loops/ui/hooks";
import { dueLabel } from "../../loops/ui/model";
import { Elapsed, ProviderStatusMark, runningLabel } from "./ProviderStatusMark";
import { useAuthNeeds } from "../../auth/ui/needs";

const DAY = 86_400_000;
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const STATE_DOT = { active: "bg-success", paused: "bg-warning", stopped: "bg-muted-foreground/50" } as const;
const RECENT_SHOWN = 8;

/** The Bot's Controls view (bot/<botId>/controls), with `section` scrolled to. */
export const controlsPath = (botId: string, section?: string) => `${botPath(botId)}/controls${section ? `#${section}` : ""}`;
export const isControlsPath = (pathname: string) => /^\/plugins\/studio\/studio\/bot\/[^/]+\/controls\/?$/.test(pathname);

const firstSentence = (text: string | null | undefined) => ((text ?? "").split(/(?<=[.!?])\s/)[0] ?? "").replace(/[.!]$/, "");
const capitalize = (text: string) => text ? text[0]!.toUpperCase() + text.slice(1) : text;
const sentence = (text: string) => /[.!?…]$/.test(text) ? text : `${text}.`;
/** A thread at one message, as BB links it (`/threads/<id>#msg=<seq>`). */
export const messagePath = (threadId: string, seq: number) => `/threads/${encodeURIComponent(threadId)}#msg=${seq}`;

export type WorkItem = { id: string; name: string; detail: string; since: number | null; waiting: string | null; providerId: string | null; threadId: string };
export type NeedItem = {
  key: string; icon: string; tone?: "failed"; title: string; detail: string | null;
  due?: { text: string; urgent: boolean } | null;
  action: { label: string; run(): void };
  dismiss?: () => void;
  open?: () => void;
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
  const authNeeds = useAuthNeeds(bot.primary !== false);
  const actions = useLoopActions(loops.refresh);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const tz = zone();
  const todosZone = useTodosZone();
  const names = page.data?.groupNames ?? {};
  const { sources, runners, activity } = jobs;

  // Working now: what's running, runners by name.
  const working: WorkItem[] = [];
  for (const thread of activity?.inProgress ?? []) {
    // Its own chat waiting on the user is a question in Needs you, not work.
    if (thread.relation === "self" && thread.waitingFor) continue;
    const runner = runners.find((each) => each.threadId === thread.id);
    working.push({
      id: thread.id, threadId: thread.id, since: thread.runningSince ?? null, waiting: thread.waitingFor ?? null, providerId: thread.providerId ?? null,
      name: runner?.name ?? (thread.relation === "self" ? bot.name : thread.title),
      // A runner's thread is titled after it ("Comms · Runner"): its job says what it's doing.
      detail: runner ? firstSentence(runner.job) : thread.relation === "self" ? "Working in its chat" : "A thread it started",
    });
  }
  for (const runner of runners) if (runner.running && runner.threadId && !working.some((each) => each.threadId === runner.threadId)) {
    working.push({ id: runner.id, threadId: runner.threadId, name: runner.name, detail: firstSentence(runner.job), since: runner.runningSince ?? null, waiting: null, providerId: runner.providerId ?? null });
  }

  // Needs you: todos, questions, failures, maintenance.
  const dismissed = new Set(page.data?.dismissed ?? []);
  const needs: NeedItem[] = [...authNeeds];
  const loopAction = (loop: Loop): NeedItem["action"] => loop.kind === "decide" ? { label: "Decide", run: () => openLoops(bot.id) }
    : loop.kind === "read" ? { label: "Got it", run: () => void actions.act({ id: loop.id, action: "got_it" }) }
      : loop.kind === "waiting" ? { label: "Nudge", run: () => void actions.act({ id: loop.id, action: "nudge" }) }
        : { label: "Done", run: () => void actions.act({ id: loop.id, action: "done" }) };
  const loopIcon = { do: "Circle", decide: "Fork", read: "FileText", waiting: "Clock" } as const;
  const loopNeeds = loopsOn ? loops.data?.needsYouNow ?? [] : [];
  const failures = failedRuns(sources, dismissed);
  for (const loop of loopNeeds.filter((each) => dueLabel(each.due, now, todosZone)?.urgent)) needs.push({ key: `loop:${loop.id}`, icon: loopIcon[loop.kind], title: loop.title, detail: loop.why || null, due: dueLabel(loop.due, now, todosZone), action: loopAction(loop) });
  // A failed run opens itself: its thread at the message it sent, or its automation's runs.
  const openRun = (run: FailedRun) => {
    const fallback = () => run.threadId ? openThread(run.threadId) : openAppPath(botPath(bot.id));
    void call("bot_run_link", { botId: bot.id, automationId: run.sourceId, runId: run.runId }).then((link) => {
      if (link.threadId && link.seq !== null) openAppPath(messagePath(link.threadId, link.seq));
      else if (link.threadId) openThread(link.threadId);
      else if (link.path) openAppPath(link.path);
      else fallback();
    }, fallback);
  };
  for (const run of failures) needs.push({
    key: `failed:${run.sourceId}:${run.runId}`, icon: "AlertTriangle", tone: "failed", title: failedTitle(run, now, tz), detail: capitalize(sentence(run.error)),
    action: { label: "Open", run: () => openRun(run) },
    dismiss: () => void call("bot_run_dismiss", { botId: bot.id, automationId: run.sourceId, runId: run.runId }).then(() => page.refresh(), () => {}),
  });
  const tracked = new Set(loopNeeds.filter((loop) => loop.source?.kind === "interaction").map((loop) => loop.source!.ref));
  for (const question of pending.filter((each) => !tracked.has(each.id))) needs.push({
    key: `question:${question.id}`, icon: "CircleQuestion", title: question.text ?? question.reason, detail: `${question.text ? `${question.reason === "Asked you a question" ? "Asked you in chat" : question.reason}` : "In its chat"} ${agoWords(question.createdAt, now)}`,
    action: { label: question.reason.includes("approval") ? "Review" : "Answer", run: () => bot.threadId && openThread(bot.threadId) },
  });
  for (const loop of loopNeeds.filter((each) => !dueLabel(each.due, now, todosZone)?.urgent)) needs.push({ key: `loop:${loop.id}`, icon: loopIcon[loop.kind], title: loop.title, detail: loop.why || null, due: dueLabel(loop.due, now, todosZone), action: loopAction(loop) });
  const lastMaintenance = maintenance.data?.runs.find((run) => !run.dryRun);
  if (lastMaintenance?.needsCall.length) {
    const count = lastMaintenance.needsCall.length;
    needs.push({ key: "maintenance:calls", icon: "Archive", title: `Archive ${count} finished thread${count === 1 ? "" : "s"}?`, detail: "Daily cleanup", action: { label: "Review", run: () => openAppPath(controlsPath(bot.id, "maintenance")) } });
  }
  const adoptable = lastMaintenance?.suggestions.filter((each) => each.threadId && each.automationId) ?? [];
  if (adoptable.length) needs.push({ key: "maintenance:suggest", icon: "Repeat", title: adoptable.length === 1 ? adoptable[0]!.text : `${adoptable.length} threads could be runners`, detail: "Daily cleanup", action: { label: "Review", run: () => openAppPath(controlsPath(bot.id, "maintenance")) } });

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
  // Maintenance's runs are "Daily cleanup" lines of their own.
  const recent = recentEntries({ events: events.filter((event) => event.sourceId !== "maintenance"), sources, frequent, reports, finished, maintenance: maintenance.data?.runs ?? [], names, now, zone: tz });
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
  useEffect(() => { noteBotName(bot.id, bot.name); }, [bot.id, bot.name]);
  return (
    <div className="flex flex-col pb-10" aria-label={`${bot.name} info`} data-testid="bot-page">
      {jobs.feeds}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-6 pb-5">
        <BotFace botId={bot.id} size={44} provider={botProvider(bot)} />
        <div className="flex min-w-40 flex-1 flex-col gap-0.5">
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
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-6 @3xl/page:grid-cols-2">
          <WorkingNow items={working} onOpen={openThread} providers={providers} />
          <NeedsYou model={model} />
        </div>
      )}
      <AutomationsSection botId={bot.id} botName={bot.name} onOpen={openThread} disabled={bot.state !== "active"} external={bot.kind === "external"} page />
      {/* Runners are listed with the other automations above: one view for everything on a schedule. */}
      <div className="pt-10">
        <Recent entries={model.recent} tz={model.tz} now={model.now} />
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
  return (
    <section aria-label="Needs you" data-testid="bot-needs">
      <SectionHead title="Needs you" count={model.needs.length} />
      {shown.length ? (
        <ul className="flex flex-col divide-y divide-border border-b border-border">
          {shown.map((item) => (
            <li key={item.key} data-need={item.key} className={`flex min-w-0 items-center gap-3 ${compact ? "py-1.5" : "py-2"}`}>
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${item.tone === "failed" ? "bg-destructive/10 text-destructive" : "bg-foreground/[0.05] text-muted-foreground"}`}>
                <Icon name={item.icon} className="size-3.5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                {item.open ? <button type="button" className="truncate text-left text-sm hover:underline" onClick={item.open}>{item.title}</button> : <span className="truncate text-sm">{item.title}</span>}
                {!compact && item.detail ? <span className="truncate text-xs text-muted-foreground">{item.detail}</span> : null}
              </span>
              {item.due ? <span className={`shrink-0 text-xs ${item.due.urgent ? "text-warning" : "text-muted-foreground"}`}>{item.due.text}</span> : null}
              {item.dismiss && !compact ? <button type="button" className={ICON_BUTTON} aria-label={`Dismiss ${item.title}`} title="Dismiss" onClick={item.dismiss}><Icon name="X" /></button> : null}
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
    <section aria-label="Todos" data-testid="bot-loops" className="pt-10">
      <SectionHead title="Todos" action={<button type="button" className={OUTLINE_BUTTON} data-testid="bot-loops-tab" onClick={() => openLoops(model.bot.id)}>Open Todos<Icon name="ChevronRight" /></button>} />
      <p className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border py-2.5 text-sm text-muted-foreground">
        {groups ? counts.map(([count, label]) => <span key={label}><span className="font-medium text-foreground tabular-nums">{count}</span> {label}</span>) : "Loading…"}
      </p>
    </section>
  );
}

export { openThreadPage };
