// Bot info's Maintenance (src/bot-maintenance.ts): the daily switch with its
// state (off, a first day's dry run, live), Dry run and Run now, the rules,
// and the last run: its summary, the actions it took or would take, the
// threads that need your call, and runner suggestions to adopt.
import { Badge, GHOST_BUTTON } from "../../kit/app/index";
import { errorMessage, relativeTime } from "../../kit/format";
import { Icon } from "../../kit/ui/index";
import { useState, type ReactNode } from "react";
import type { MaintenanceRule } from "../../bot-maintenance";
import { useCall, useLive, type Method, type RpcInput } from "../live";
import { useOpenThread } from "./workspace";

const labels: Record<MaintenanceRule, string> = { threads: "Finished threads", workers: "Hidden workers", automations: "Automations and reminders", memory: "Memory page", skills: "Skills (pinned skills exempt)", adopt: "Runner suggestions" };
const CHECKBOX = "size-3.5 shrink-0 accent-[var(--foreground)] disabled:opacity-50";
const when = (at: number) => new Date(at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export function BotMaintenance({ botId }: { botId: string }) {
  const live = useLive("bot_maintenance_get", { botId });
  const call = useCall();
  const open = useOpenThread();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const act = async <M extends Method,>(method: M, input: RpcInput<M>) => {
    setBusy(true); setError(null);
    try { await call(method, { ...input, botId }); live.refresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const view = live.data;
  const last = view?.runs[0];
  const dryRunning = !!view?.settings.enabled && !!view.liveAt && Date.now() < view.liveAt;
  const rulesOn = view ? Object.values(view.settings.rules).filter(Boolean).length : 0;
  return (
    <section aria-label="Maintenance" data-testid="bot-maintenance" className="px-4 pt-4">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-xs font-medium text-muted-foreground">Maintenance</h3>
        {view ? <>
          <button type="button" className={GHOST_BUTTON} disabled={busy} title="See what it would do, without doing it" onClick={() => void act("bot_maintenance_run", { dryRun: true })}><Icon name="Eye" />Dry run</button>
          <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => void act("bot_maintenance_run", { dryRun: false })}><Icon name="Play" />Run now</button>
        </> : null}
      </div>
      {view ? (
        <div className="mt-1 flex flex-col divide-y divide-border border-y border-border text-sm">
          <div className="flex flex-col gap-0.5 py-2.5">
            <label className="flex items-center gap-2">
              <input type="checkbox" className={CHECKBOX} checked={view.settings.enabled} disabled={busy} onChange={(e) => void act("bot_maintenance_set", { enabled: e.target.checked })} />
              <span className="min-w-0 flex-1">Daily maintenance</span>
              <Badge label={!view.settings.enabled ? "Off" : dryRunning ? "Dry run" : "Live"} tone={!view.settings.enabled ? "neutral" : dryRunning ? "warning" : "success"} />
            </label>
            <p className="pl-5.5 text-xs text-muted-foreground">
              {!view.settings.enabled ? "Turning it on starts with a one-day dry run." : dryRunning ? `Only shows what it would do until ${when(view.liveAt!)}, then goes live.` : "Runs daily at 4 AM and after a check-in, at most once a day."} Archives can be undone.
            </p>
          </div>
          <div className="flex flex-col py-1.5">
            <Disclosure id="bot-maintenance-rules" open={rulesOpen} onToggle={() => setRulesOpen(!rulesOpen)} label="Rules" hint={`${rulesOn} of ${Object.keys(labels).length} on`} />
            {rulesOpen ? (
              <div id="bot-maintenance-rules" className="flex flex-col gap-1.5 pt-1 pb-1.5 pl-5.5">
                {Object.entries(labels).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input type="checkbox" className={CHECKBOX} disabled={busy} checked={view.settings.rules[key as MaintenanceRule]} onChange={(e) => void act("bot_maintenance_set", { rules: { [key]: e.target.checked } })} />{label}
                  </label>
                ))}
                <label className="flex items-center gap-2 pt-1 text-muted-foreground">Keep the Memory page under
                  <input aria-label="Memory word budget" type="number" min={100} max={100000} defaultValue={view.settings.memoryWords} key={view.settings.memoryWords} disabled={busy}
                    className="h-7 w-20 rounded-md border border-border bg-background px-2 text-sm text-foreground tabular-nums"
                    onBlur={(e) => { const memoryWords = Number(e.target.value); if (memoryWords !== view.settings.memoryWords) void act("bot_maintenance_set", { memoryWords }); }} />words
                </label>
              </div>
            ) : null}
          </div>
          {last ? (
            <div className="flex flex-col gap-2 py-2.5">
              <p className="text-xs text-muted-foreground">{last.dryRun ? "Last dry run" : "Last run"} · {relativeTime(last.at)}</p>
              <p role="status">{last.summary}</p>
              {last.actions.length ? (
                <div className="flex flex-col">
                  <Disclosure id="bot-maintenance-actions" open={actionsOpen} onToggle={() => setActionsOpen(!actionsOpen)} label={last.dryRun ? "Proposed actions" : "Actions"} hint={String(last.actions.length)} />
                  {actionsOpen ? <ul id="bot-maintenance-actions" className="flex list-disc flex-col gap-0.5 pt-1 pl-10 text-xs text-muted-foreground">{last.actions.map((action, i) => <li key={i}>{action}</li>)}</ul> : null}
                </div>
              ) : null}
              {last.needsCall.length ? (
                <Group title="Needs your call">
                  {last.needsCall.map((entry) => (
                    <li key={entry.threadId} className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1"><span className="block truncate">{entry.title}</span><span className="block truncate text-xs text-muted-foreground">{entry.reason}</span></span>
                      <button type="button" className={GHOST_BUTTON} onClick={() => open(entry.threadId)}>Open</button>
                    </li>
                  ))}
                </Group>
              ) : null}
              {last.suggestions.length ? (
                <Group title="Suggestions">
                  {last.suggestions.map((suggestion, i) => (
                    <li key={i} className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm">{suggestion.text}</span>
                      {suggestion.threadId && suggestion.automationId ? <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => void act("bot_runner_adopt", { threadId: suggestion.threadId!, automationId: suggestion.automationId! })}>Adopt</button> : null}
                    </li>
                  ))}
                </Group>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : <p className="pt-1 text-xs text-muted-foreground">{live.loading ? "Loading…" : live.error}</p>}
      {error ? <p role="alert" className="pt-1 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

/** A chevron toggle, as Bot info's other collapsed lists. */
function Disclosure({ id, open, onToggle, label, hint }: { id: string; open: boolean; onToggle(): void; label: string; hint?: string }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}
      className="-ml-1 flex h-7 items-center gap-1.5 self-start rounded-md pr-1.5 pl-0.5 text-sm hover:text-foreground">
      <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-4 text-muted-foreground" aria-hidden />{label}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 pt-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}
