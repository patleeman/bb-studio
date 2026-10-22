// The Bot's runners (src/runners.ts) in its sidebar and Info tab: each
// runner's name, schedule, next run, state and last report; pause or resume,
// Run now, edit (name, job, schedule), delete; New runner; and Adopt as
// runner for threads the Bot started that an automation wakes. Opening a
// runner opens its thread as a BB thread.
import { errorMessage } from "../../kit/format";
import { DANGER_BUTTON, GHOST_BUTTON, PRIMARY_BUTTON } from "../../kit/app/index";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, Input } from "../../kit/ui/index";
import { useState } from "react";
import type { RunnerAdoptableView, RunnerView } from "../../contract";
import { describeCron } from "../../schedule";
import { useCall, useLive, type Method, type RpcInput, type Cadence } from "../live";
import { HeartbeatFields, useHeartbeatForm } from "../ProjectLeads";
import { ProviderStatusMark, runnerStatusTone, type ProviderCatalogEntry } from "./ProviderStatusMark";

import { botItemName, runnerLastRun, sidebarTime } from "./sidebarAgenda";

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
const dotOf = (runner: RunnerView) => runner.machineOffline ? "border border-warning" : runner.urgent ? "bg-warning" : runner.state === "paused" ? "border border-muted-foreground/60" : "bg-success";
const dotLabel = (runner: RunnerView) => runner.machineOffline ? "Machine offline" : runner.urgent ? "Needs you" : runner.state === "paused" ? "Paused" : "Active";

/** A runner in the Bots sidebar. */
export function RunnerSidebarRow({ runner, active, onOpen, providers, fallbackProviderId, botName, agenda = false }: { botName: string; agenda?: boolean; runner: RunnerView; active: boolean; onOpen(runner: RunnerView): void; providers: readonly ProviderCatalogEntry[]; fallbackProviderId?: string | null }) {
  const last = runnerLastRun(runner);
  const tone = runner.machineOffline ? "waiting" : !agenda && last.failed ? "failed" : runnerStatusTone(runner.state, runner.urgent);
  return (
    <button type="button" data-runner={runner.id} data-agenda={agenda ? runner.id : undefined} aria-current={active ? "true" : undefined} title={runnerTitle(runner)} disabled={!runner.threadId} onClick={() => onOpen(runner)}
      className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover aria-[current]:bg-state-active">
      <ProviderStatusMark providerId={runner.providerId ?? fallbackProviderId} tone={tone} providers={providers} />
      <span className={`min-w-0 flex-1 truncate ${runner.state === "paused" ? "text-muted-foreground" : ""}`}>{botItemName(runner.name, botName)}{runner.machineName ? <span className="text-muted-foreground"> · {runner.machineName}</span> : null}</span>
      <span className={`shrink-0 text-[11px] ${!agenda && last.failed ? "text-destructive" : "text-muted-foreground"}`}>{runner.machineOffline ? "machine offline" : agenda ? runner.state === "paused" ? "paused" : runner.nextRunAt ? sidebarTime(runner.nextRunAt) : "" : last.text}</span>
    </button>
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
export function RunnersSection({ botId, botName, onOpen, disabled, adoptOnly = false }: { botId: string; botName: string; onOpen(threadId: string): void; disabled: boolean; adoptOnly?: boolean }) {
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
            <li key={runner.id} data-runner={runner.id} className="flex flex-col gap-1 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`size-1.5 shrink-0 rounded-full ${dotOf(runner)}`} role="img" aria-label={dotLabel(runner)} />
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" title={runnerTitle(runner)} onClick={() => open(runner)}>{runner.name}</button>
                {runner.machineName ? <span className="text-xs text-muted-foreground">{runner.machineName}{runner.machineOffline ? " · machine offline" : ""}</span> : null}
                <span className="shrink-0 text-xs text-muted-foreground">{scheduleLabel(runner.schedule)}</span>
              </div>
              <p className="line-clamp-2 pl-3.5 text-xs text-muted-foreground">
                {runner.lastReport ? <><span className="text-foreground/80">{LEVEL[runner.lastLevel ?? "log"]}:</span> {runner.lastReport}</> : runner.job}
              </p>
              <div className="flex flex-wrap gap-1 pl-2">
                {runner.state === "active"
                  ? <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => void run("bot_runner_pause", { id: runner.id })}><Icon name="Pause" />Pause</button>
                  : <button type="button" className={GHOST_BUTTON} disabled={busy || disabled} onClick={() => void run("bot_runner_resume", { id: runner.id })}><Icon name="Play" />Resume</button>}
                <button type="button" className={GHOST_BUTTON} disabled={busy || disabled} onClick={() => void run("bot_runner_run_now", { id: runner.id })}><Icon name="Zap" />Run now</button>
                <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => { setError(null); setSheet({ kind: "edit", runner }); }}><Icon name="Edit" />Edit</button>
                <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => { setError(null); setSheet({ kind: "move", runner }); }}>Move to machine…</button>
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

function Confirm({ title, text, action, danger, busy, error, onClose, onConfirm }: { title: string; text: string; action: string; danger?: boolean; busy: boolean; error: string | null; onClose(): void; onConfirm(): void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{text}</DialogDescription></DialogHeader>
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
          <DialogTitle>{moving ? `Move ${runner?.name} to machine` : runner ? `Edit ${runner.name}` : "New runner"}</DialogTitle>
          <DialogDescription>A thread that does one job on a schedule and stays quiet unless it has something to tell you.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <label className="block space-y-1"><span className="font-medium">Machine</span>
            <select aria-label="Machine" className="w-full rounded-md border border-border bg-background px-2 py-1.5" value={machine} disabled={busy || installing} onChange={event => { setMachine(event.target.value); setConfirming(false); }}>
              <option value="">Server machine</option>
              {hosts.data?.map(host => <option key={host.id} value={host.id}>{host.name}{host.connected ? "" : " (offline)"}</option>)}
            </select>
          </label>
          {hosts.error || check.error || installError ? <p role="alert" className="text-xs text-destructive">{hosts.error ?? check.error ?? installError}</p> : null}
          {needsCheck && check.data?.blocked ? <p role="status" className="text-xs text-muted-foreground">{check.data.blocked}</p> : null}
          {needsCheck && check.data?.install ? <button type="button" className={GHOST_BUTTON} disabled={installing || busy} onClick={() => {
            setInstalling(true); setInstallError(null);
            void call("bot_runner_install_provider", { botId, id: runner?.id, machine }).then(() => check.refresh(), cause => setInstallError(errorMessage(cause))).finally(() => setInstalling(false));
          }}>Install {check.data.providerName} on {check.data.machineName}</button> : null}
          {needsCheck && check.data?.signInHint && check.data.blocked && !check.data.install ? <p className="text-xs text-muted-foreground">Sign in directly on {check.data.machineName}: {check.data.signInHint}</p> : null}
          {needsCheck && machine ? <button type="button" className={GHOST_BUTTON} onClick={check.refresh}>Check again</button> : null}
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
    {confirming ? <Confirm title="Review target machine warnings" text={check.data?.warnings.join("\n") ?? ""} action={moving ? "Move anyway" : "Continue"} busy={busy} error={error} onClose={() => setConfirming(false)} onConfirm={() => save(true)} /> : null}
  </>);
}

