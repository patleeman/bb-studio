import { GHOST_BUTTON } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { useState } from "react";
import type { MaintenanceRule, MaintenanceView } from "../../bot-maintenance";
import { useCall, useLive } from "../live";
import { useOpenThread } from "./workspace";

const labels: Record<MaintenanceRule, string> = { threads: "Finished threads", workers: "Hidden workers", automations: "Automations and reminders", memory: "Memory page", skills: "Skills (pinned skills exempt)", adopt: "Runner suggestions" };
export function BotMaintenance({ botId }: { botId: string }) {
  const live = useLive<MaintenanceView>("bot_maintenance_get", { botId });
  const call = useCall();
  const open = useOpenThread();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (method: string, input: object) => {
    setBusy(true); setError(null);
    try { await call(method, { botId, ...input }); live.refresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const view = live.data;
  const last = view?.runs[0];
  return <section aria-label="Maintenance" data-testid="bot-maintenance" className="px-4 pt-4 text-xs">
    <h3 className="font-medium text-muted-foreground">Maintenance</h3>
    {view ? <>
      <label className="flex items-center gap-2 py-2"><input type="checkbox" checked={view.settings.enabled} disabled={busy} onChange={(e) => void act("bot_maintenance_set", { enabled: e.target.checked })} />Daily maintenance</label>
      <p className="text-muted-foreground">{!view.settings.enabled ? "Off. Turning it on starts a one-day dry run." : view.liveAt && Date.now() < view.liveAt ? `Dry run until ${new Date(view.liveAt).toLocaleString()}. Goes live automatically.` : "Live. Daily at 4 AM local and after a check-in, at most once a day."} Archives can be undone.</p>
      <details className="py-2"><summary className="cursor-pointer">Rules</summary>
        {Object.entries(labels).map(([key, label]) => <label key={key} className="flex items-center gap-2 py-1"><input type="checkbox" disabled={busy} checked={view.settings.rules[key as MaintenanceRule]} onChange={(e) => void act("bot_maintenance_set", { rules: { [key]: e.target.checked } })} />{label}</label>)}
        <label className="flex items-center gap-2 py-1">Memory word budget<input aria-label="Memory word budget" type="number" min={100} max={100000} defaultValue={view.settings.memoryWords} key={view.settings.memoryWords} disabled={busy} className="w-24 rounded border border-border bg-background px-2 py-1" onBlur={(e) => { const memoryWords = Number(e.target.value); if (memoryWords !== view.settings.memoryWords) void act("bot_maintenance_set", { memoryWords }); }} /></label>
      </details>
      <div className="flex gap-1"><button className={GHOST_BUTTON} disabled={busy} onClick={() => void act("bot_maintenance_run", { dryRun: false })}>Run now</button><button className={GHOST_BUTTON} disabled={busy} onClick={() => void act("bot_maintenance_run", { dryRun: true })}>Dry run</button></div>
      {last ? <div className="space-y-2 pt-2"><p role="status">{last.summary}</p>
        {last.actions.length ? <details><summary className="cursor-pointer">{last.dryRun ? "Proposed actions" : "Actions"}</summary><ul className="list-disc space-y-1 pl-4">{last.actions.map((action, i) => <li key={i}>{action}</li>)}</ul></details> : null}
        {last.needsCall.length ? <div><h4 className="font-medium">Needs your call</h4>{last.needsCall.map((entry) => <p key={entry.threadId}><button className="underline" onClick={() => open(entry.threadId)}>{entry.title}</button>: {entry.reason}</p>)}</div> : null}
        {last.suggestions.map((suggestion, i) => <p key={i}>{suggestion.text}{suggestion.threadId && suggestion.automationId ? <> · <button className="underline" disabled={busy} onClick={() => void act("bot_runner_adopt", { threadId: suggestion.threadId, automationId: suggestion.automationId })}>Adopt</button></> : null}</p>)}
      </div> : null}
    </> : <p>{live.loading ? "Loading…" : live.error}</p>}
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </section>;
}
