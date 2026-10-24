// The Bot's runners (src/runners.ts) in its sidebar and Info tab: each
// runner's name, schedule, next run, state and last report; pause or resume,
// Run now, edit (name, job, schedule), delete; New runner; and Adopt as
// runner for threads the Bot started that an automation wakes. Opening a
// runner opens its thread as a BB thread.
import { errorMessage } from "../../kit/format";
import { DANGER_BUTTON, GHOST_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from "../../kit/app/index";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, Input } from "../../kit/ui/index";
import { useState } from "react";
import type { RunnerAdoptableView, RunnerView } from "../../contract";
import { describeCron } from "../../schedule";
import { useCall, useLive, type Method, type RpcInput, type Cadence } from "../live";
import { HeartbeatFields, useHeartbeatForm } from "../ProjectLeads";
import { Elapsed, ProviderStatusMark, runnerStatusTone, runningLabel, type ProviderCatalogEntry } from "./ProviderStatusMark";

import { botItemName, runnerLastRun, sidebarTime, type RunnerOutcome } from "./sidebarAgenda";
import { compactAge } from "./ThreadsSection";

export type RunnersData = { runners: RunnerView[]; adoptable: RunnerAdoptableView[] };
export const useRunners = (botId: string) => useLive("bot_runners", { botId }, { pollMs: 15_000 });

const CADENCE: Record<Cadence, string> = {
  every5minutes: "Every 5 min", every15minutes: "Every 15 min", every30minutes: "Every 30 min", hourly: "Hourly", every2hours: "Every 2 h",
  every6hours: "Every 6 h", daily: "Daily", weekdays: "Weekdays", weekly: "Mondays", custom: "Custom",
};
export function scheduleLabel(schedule: RunnerView["schedule"]): string {
  if (schedule.cadence === "custom") return schedule.cron ? describeCron(schedule.cron) : "Custom";
  return ["daily", "weekdays", "weekly"].includes(schedule.cadence) ? `${CADENCE[schedule.cadence]} ${schedule.time}` : CADENCE[schedule.cadence];
}
const at = (time: number) => new Date(time).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const LEVEL: Record<NonNullable<RunnerView["lastLevel"]>, string> = { log: "Logged", tell: "Told you", urgent: "Urgent" };
/** Hover text: schedule, next run, last report. */
export function runnerTitle(runner: RunnerView): string {
  return [
    `${runner.name}: ${scheduleLabel(runner.schedule)}${runner.state === "paused" ? " (paused)" : ""}`,
    runner.nextRunAt ? `Next run ${at(runner.nextRunAt)}` : null,
    runner.lastReport ? `${LEVEL[runner.lastLevel ?? "log"]}${runner.lastReportAt ? ` ${at(runner.lastReportAt)}` : ""}: ${runner.lastReport}` : runner.lastRunAt ? `Last run ${at(runner.lastRunAt)}, nothing to report` : null,
  ].filter(Boolean).join("\n");
}

const OUTCOME_TEXT: Record<NonNullable<RunnerOutcome>, string> = { paused: "text-muted-foreground", quiet: "text-muted-foreground", reported: "text-muted-foreground", failed: "text-destructive" };

/** The runner's state, the same in the sidebar and Bot info: running only mid-run; failed when its last run did. */
export function runnerTone(runner: RunnerView) {
  if (runner.machineOffline) return "waiting" as const;
  const tone = runnerStatusTone(runner.state, runner.urgent, runner.running);
  return tone === "idle" && runner.state === "active" && runnerLastRun(runner).failed ? "failed" as const : tone;
}

/** What a runner's row says on its right, and to a screen reader. */
export function runnerSummary(runner: RunnerView): { label: string; next: string | null; outcome: RunnerOutcome } {
  const last = runnerLastRun(runner);
  if (runner.machineOffline) return { label: `${runner.machineName ?? "Its machine"} is offline`, next: null, outcome: null };
  if (runner.urgent) return { label: "Waiting for you", next: null, outcome: null };
  if (runner.state === "paused") return { label: "Paused", next: null, outcome: "paused" };
  const outcome = last.outcome === "paused" ? null : last.outcome;
  const next = runner.nextRunAt ? sidebarTime(runner.nextRunAt) : null;
  const label = [next ? `Next run ${next}` : null, outcome ? `last run ${outcome}` : null].filter(Boolean).join(", ") || "Idle";
  return { label: label[0]!.toUpperCase() + label.slice(1), next, outcome };
}

/** The right side of a runner's row: running (a ticking clock), offline, paused, or "next 5:15 PM · quiet". */
function RunnerState({ runner, running }: { runner: RunnerView; running: boolean }) {
  if (running) return runner.runningSince ? <Elapsed since={runner.runningSince} className="text-success" /> : <span className="shrink-0 text-success">running</span>;
  if (runner.machineOffline) return <span className="shrink-0 text-warning">offline</span>;
  // Waiting for you: the urgent report's age, as on a thread that needs you.
  if (runner.urgent && runner.lastReportAt) return <span className="shrink-0 tabular-nums text-muted-foreground">{compactAge(runner.lastReportAt)}</span>;
  const summary = runnerSummary(runner);
  if (summary.outcome === "paused") return <span className="shrink-0 text-muted-foreground">paused</span>;
  return (
    <span className="flex min-w-0 shrink-0 items-baseline gap-1 tabular-nums text-muted-foreground">
      {/* The name keeps the room: on a narrow row "next 10:00 PM · quiet" is "10:00 PM", and only a failure stays; the rest is in the tooltip. */}
      {summary.next ? <span className="text-foreground/70"><span className="@max-[19rem]/runner:hidden">next </span>{summary.next}</span> : null}
      {summary.outcome ? <span className={`${OUTCOME_TEXT[summary.outcome]} ${summary.outcome === "failed" || !summary.next ? "" : "@max-[19rem]/runner:hidden"}`}>{summary.next ? "· " : ""}{summary.outcome}</span> : null}
    </span>
  );
}

/**
 * A runner in the Bots sidebar, under Runners or in the Schedule agenda.
 * Between runs: a dimmed logo and "next 5:15 PM · quiet". Mid-run it looks
 * like a running thread: the turning ring and a ticking clock.
 */
export function RunnerSidebarRow({ runner, active, onOpen, providers, fallbackProviderId, botName, agenda = false }: { botName: string; agenda?: boolean; runner: RunnerView; active: boolean; onOpen(runner: RunnerView): void; providers: readonly ProviderCatalogEntry[]; fallbackProviderId?: string | null }) {
  const tone = runnerTone(runner);
  const running = tone === "running";
  return (
    <button type="button" data-runner={runner.id} data-agenda={agenda ? runner.id : undefined} aria-current={active ? "true" : undefined} title={runnerTitle(runner)} disabled={!runner.threadId} onClick={() => onOpen(runner)}
      className="@container/runner flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover disabled:hover:bg-transparent aria-[current]:bg-state-active">
      <ProviderStatusMark providerId={runner.providerId ?? fallbackProviderId} tone={tone} providers={providers} label={running ? runningLabel(runner.runningSince) : runnerSummary(runner).label} />
      <span className={`min-w-0 flex-1 truncate ${tone === "idle" || tone === "waiting" ? "text-muted-foreground" : ""}`}>{botItemName(runner.name, botName)}{runner.machineName ? <span className="text-muted-foreground"> · {runner.machineName}</span> : null}</span>
      <span className="flex shrink-0 text-[11px]"><RunnerState runner={runner} running={running} /></span>
    </button>
  );
}

/** Bot info's line under a runner's name: the same state as its sidebar row, and its schedule. */
function RunnerStatusLine({ runner }: { runner: RunnerView }) {
  const running = runnerTone(runner) === "running";
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 pl-6 text-xs text-muted-foreground" data-testid="runner-status">
      {running ? <span className="text-success">Running</span> : null}
      <RunnerState runner={runner} running={running} />
    </p>
  );
}

/** Opens a runner's thread; an urgent report counts as seen. */
export function useOpenRunner(botId: string, open: (threadId: string) => void, refresh: () => void) {
  const call = useCall();
  return (runner: RunnerView) => {
    if (!runner.threadId) return;
    open(runner.threadId);
    if (runner.urgent) void call("bot_runner_seen", { botId, id: runner.id }).then(refresh, () => {});
  };
}

type Sheet = { kind: "new" } | { kind: "edit"; runner: RunnerView } | { kind: "delete"; runner: RunnerView } | { kind: "move"; runner: RunnerView } | null;

/** The Info tab's Runners section. */
export function RunnersSection({ botId, botName, onOpen, disabled, adoptOnly = false, providers = [], fallbackProviderId = null }: { botId: string; botName: string; onOpen(threadId: string): void; disabled: boolean; adoptOnly?: boolean; providers?: readonly ProviderCatalogEntry[]; fallbackProviderId?: string | null }) {
  const data = useRunners(botId);
  const call = useCall();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useOpenRunner(botId, onOpen, data.refresh);
  const run = async <M extends Method,>(method: M, input: RpcInput<M>) => {
    setBusy(true); setError(null);
    try { await call(method, { ...input, botId }); setSheet(null); data.refresh(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  const runners = data.data?.runners ?? [];
  // Adoption suggestions now live in the maintenance summary.
  if (adoptOnly) return null;
  return (
    <section aria-label="Runners" data-testid="bot-runners" className="px-4 pt-4">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-xs font-medium text-muted-foreground">Runners</h3>
        <button type="button" className={GHOST_BUTTON} disabled={disabled} onClick={() => { setError(null); setSheet({ kind: "new" }); }}><Icon name="Plus" />New runner</button>
      </div>
      {error && !sheet ? <p role="alert" className="pt-1 text-xs text-destructive">{error}</p> : null}
      {runners.length ? (
        <ul className="mt-1 flex flex-col divide-y divide-border border-y border-border">
          {runners.map((runner) => (
            <li key={runner.id} data-runner={runner.id} className="flex flex-col gap-1 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <ProviderStatusMark providerId={runner.providerId ?? fallbackProviderId} tone={runnerTone(runner)} providers={providers} label={runnerTone(runner) === "running" ? runningLabel(runner.runningSince) : runnerSummary(runner).label} />
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" title={runnerTitle(runner)} onClick={() => open(runner)}>{runner.name}</button>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {runner.machineName ? <span className={`flex items-center gap-1 ${runner.machineOffline ? "text-warning" : ""}`} title={runner.machineOffline ? `${runner.machineName} is offline` : `Runs on ${runner.machineName}`}>
                    <Icon name="Laptop" className="size-3.5" aria-hidden />{runner.machineName}{runner.machineOffline ? " · offline" : ""}
                  </span> : null}
                  {runner.machineName ? <span aria-hidden>·</span> : null}
                  <span>{scheduleLabel(runner.schedule)}</span>
                </span>
              </div>
              <RunnerStatusLine runner={runner} />
              <p className="line-clamp-2 pl-6 text-xs text-muted-foreground">
                {runner.lastReport ? <><span className="text-foreground/80">{LEVEL[runner.lastLevel ?? "log"]}:</span> {runner.lastReport}</> : runner.job}
              </p>
              <div className="flex flex-wrap gap-0.5 pl-3">
                {runner.state === "active"
                  ? <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => void run("bot_runner_pause", { id: runner.id })}><Icon name="Pause" />Pause</button>
                  : <button type="button" className={GHOST_BUTTON} disabled={busy || disabled} onClick={() => void run("bot_runner_resume", { id: runner.id })}><Icon name="Play" />Resume</button>}
                <button type="button" className={GHOST_BUTTON} disabled={busy || disabled} onClick={() => void run("bot_runner_run_now", { id: runner.id })}><Icon name="Zap" />Run now</button>
                <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => { setError(null); setSheet({ kind: "edit", runner }); }}><Icon name="Edit" />Edit</button>
                <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => { setError(null); setSheet({ kind: "move", runner }); }}><Icon name="Laptop" />Move to machine…</button>
                <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => { setError(null); setSheet({ kind: "delete", runner }); }}><Icon name="Trash2" />Delete</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pt-1 text-xs text-muted-foreground">{data.loading ? "Loading…" : `Recurring jobs ${botName} hands off. They stay quiet unless they have something to tell you.`}</p>
      )}
      {sheet?.kind === "new" || sheet?.kind === "edit" || sheet?.kind === "move" ? (
        <RunnerDialog botId={botId} moving={sheet.kind === "move"} runner={sheet.kind !== "new" ? sheet.runner : null} busy={busy} error={error} onClose={() => setSheet(null)}
          onSave={(input) => sheet.kind === "move" ? void run("bot_runner_migrate", { id: sheet.runner.id, machine: input.machine ?? null, confirm: input.confirm }) : void run(sheet.kind === "edit" ? "bot_runner_update" : "bot_runner_create", sheet.kind === "edit" ? { id: sheet.runner.id, ...input } : input)} />
      ) : null}
      {sheet?.kind === "delete" ? (
        <Confirm title={`Delete ${sheet.runner.name}?`} busy={busy} error={error} action="Delete" danger onClose={() => setSheet(null)} onConfirm={() => void run("bot_runner_delete", { id: sheet.runner.id })}
          text={sheet.runner.adopted ? "It stops being a runner. Its thread and automation stay as they were before you adopted it." : "Its schedule is deleted and its thread archived; the history is kept."} />
      ) : null}
    </section>
  );
}

/** `points`: one line each, listed under the text (a machine's warnings). */
function Confirm({ title, text, points, action, danger, busy, error, onClose, onConfirm }: { title: string; text: string; points?: string[]; action: string; danger?: boolean; busy: boolean; error: string | null; onClose(): void; onConfirm(): void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{text}</DialogDescription></DialogHeader>
        {points?.length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{points.map((point) => <li key={point}>{point}</li>)}</ul> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <button type="button" className={GHOST_BUTTON} onClick={onClose}>Cancel</button>
          <button type="button" className={danger ? DANGER_BUTTON : PRIMARY_BUTTON} disabled={busy} onClick={onConfirm}>{action}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** New runner or Edit: name, job, and the heartbeat's schedule fields. */
function RunnerDialog({ botId, moving, runner, busy, error, onClose, onSave }: { botId: string; moving?: boolean; runner: RunnerView | null; busy: boolean; error: string | null; onClose(): void; onSave(input: { machine?: string | null; confirm?: boolean; name: string; job: string; schedule: { cadence: Cadence; time: string; cron?: string } }): void }) {
  const [name, setName] = useState(runner?.name ?? "");
  const [job, setJob] = useState(runner?.job ?? "");
  const [machine, setMachine] = useState(runner?.machine ?? "");
  const [confirming, setConfirming] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const call = useCall();
  const hosts = useLive("bot_runner_machines", { botId });
  const check = useLive("bot_runner_preflight", { botId, id: runner?.id, machine: machine || null, job: job.trim() || "Runner job" }, { enabled: !!machine, pollMs: 15_000 });
  const machineChanged = (runner?.machine ?? "") !== machine;
  const needsCheck = !!machine && (!runner || machineChanged || moving);
  const save = (confirm = false) => onSave({ name: name.trim(), job: job.trim(), machine: machine || null, confirm, schedule: { cadence: schedule.cadence, time: schedule.time, ...(schedule.cron ? { cron: schedule.cron } : {}) } });
  const form = useHeartbeatForm(runner ? { enabled: true, ...runner.schedule } : { enabled: true, cadence: "daily", time: "09:00" });
  const schedule = form.input();
  const ok = name.trim() && job.trim() && schedule.enabled;
  return (<>
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{moving ? `Move ${runner?.name} to another machine` : runner ? `Edit ${runner.name}` : "New runner"}</DialogTitle>
          <DialogDescription>{moving
            ? "It keeps its job, schedule and reports, and carries on in a new thread on that machine with a handoff from the last one."
            : "A thread that does one job on a schedule and stays quiet unless it has something to tell you."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <label className="block space-y-1"><span className="font-medium">Machine</span>
            <select aria-label="Machine" className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50" value={machine} disabled={busy || installing} onChange={event => { setMachine(event.target.value); setConfirming(false); }}>
              <option value="">This server</option>
              {hosts.data?.map(host => <option key={host.id} value={host.id}>{host.name}{host.connected ? "" : " (offline)"}</option>)}
            </select>
          </label>
          {hosts.error ? <p role="alert" className="text-xs text-destructive">{hosts.error}</p> : null}
          {needsCheck ? <Preflight check={check.data ?? null} loading={check.loading && !check.data} error={check.error ?? installError} installing={installing} busy={busy}
            onInstall={() => {
              setInstalling(true); setInstallError(null);
              void call("bot_runner_install_provider", { botId, id: runner?.id, machine }).then(() => check.refresh(), cause => setInstallError(errorMessage(cause))).finally(() => setInstalling(false));
            }} onRecheck={check.refresh} /> : null}
          {!moving ? <><label className="block space-y-1"><span className="font-medium">Name</span><Input aria-label="Name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Inbox watch" /></label>
          <label className="block space-y-1">
            <span className="font-medium">Job</span>
            <textarea aria-label="Job" value={job} maxLength={2000} rows={3} onChange={(event) => setJob(event.target.value)} placeholder="Check my inbox for replies from Dana; tell me when one arrives."
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </label>
          <HeartbeatFields form={form} disabled={busy} needs={null} label="Schedule" /></> : null}
        </div>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <button type="button" className={GHOST_BUTTON} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY_BUTTON} disabled={busy || installing || !ok || (needsCheck && (check.loading || !!check.error || !check.data || !!check.data.blocked))}
            onClick={() => { if (needsCheck && check.data?.warnings.length) setConfirming(true); else save(); }}>{moving ? "Move runner" : runner ? "Save" : "Make runner"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirming ? <Confirm title={`Check ${check.data?.machineName ?? "the machine"} first`} text={`Studio found ${check.data?.warnings.length === 1 ? "something" : "a few things"} that may not work there:`} points={check.data?.warnings ?? []} action={moving ? "Move anyway" : "Continue"} busy={busy} error={error} onClose={() => setConfirming(false)} onConfirm={() => save(true)} /> : null}
  </>);
}


type PreflightView = { machineName: string | null; warnings: string[]; blocked: string | null; install: boolean; providerName: string; signInHint: string | null };

/**
 * What Studio found on the picked machine, in one box: checking; blocked
 * (with Install, or the sign-in command to run there); warnings to review; or
 * ready. Check again sits in the box.
 */
function Preflight({ check, loading, error, installing, busy, onInstall, onRecheck }: { check: PreflightView | null; loading: boolean; error: string | null; installing: boolean; busy: boolean; onInstall(): void; onRecheck(): void }) {
  const recheck = <button type="button" className="h-7 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50" disabled={loading || installing} onClick={onRecheck}>Check again</button>;
  if (error) {
    return <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs"><Icon name="AlertCircle" className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden /><span className="min-w-0 flex-1">{error}</span>{recheck}</div>;
  }
  if (loading || !check) {
    return <p role="status" className="flex items-center gap-2 px-0.5 text-xs text-muted-foreground"><Icon name="Spinner" className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />Checking the machine…</p>;
  }
  const machine = check.machineName ?? "the machine";
  if (check.blocked) {
    // Its message names the install or ends with the sign-in command; the box shows both once.
    const headline = check.install ? `${check.providerName} isn't installed on ${machine}.` : check.signInHint ? check.blocked.replace(` ${check.signInHint}`, "") : check.blocked;
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs">
        <p className="flex items-start gap-2"><Icon name="AlertTriangle" className="mt-px size-3.5 shrink-0 text-warning" aria-hidden /><span className="min-w-0 flex-1 text-foreground">{headline}</span></p>
        {check.signInHint && !check.install ? <p className="pl-5.5 text-muted-foreground">Sign in directly on {machine}, then check again: <code className="rounded bg-foreground/[0.07] px-1 py-0.5 font-mono text-[11px] text-foreground">{check.signInHint}</code></p> : null}
        <div className="flex flex-wrap items-center gap-1 pl-5">
          {check.install ? <button type="button" className={OUTLINE_BUTTON} disabled={installing || busy} onClick={onInstall}><Icon name="Download" />{installing ? `Installing ${check.providerName}…` : `Install ${check.providerName} on ${machine}`}</button> : null}
          {recheck}
        </div>
      </div>
    );
  }
  if (check.warnings.length) {
    return (
      <div role="status" className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs">
        <p className="flex items-start gap-2"><Icon name="AlertTriangle" className="mt-px size-3.5 shrink-0 text-warning" aria-hidden /><span className="min-w-0 flex-1 font-medium text-foreground">{check.warnings.length === 1 ? "One thing to check" : `${check.warnings.length} things to check`} on {machine}</span>{recheck}</p>
        <ul className="flex list-disc flex-col gap-0.5 pl-9 text-muted-foreground">{check.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </div>
    );
  }
  return <p role="status" className="flex items-center gap-2 px-0.5 text-xs text-muted-foreground"><Icon name="CircleCheck" className="size-3.5 shrink-0 text-success" aria-hidden /><span className="min-w-0 flex-1">{check.providerName} is installed and signed in on {machine}.</span>{recheck}</p>;
}
