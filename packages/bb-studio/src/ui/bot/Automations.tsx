// The Info tab's Automations: one list of what wakes a Bot (src/automations.ts)
// — check-ins, reminders, watchers and runners. A row shows its kind, name,
// schedule and next run; opening it shows the instruction (or script), the
// last outcome, recent runs, and Pause/Resume, Run now, Edit and Delete.
// New picks the kind; the editor holds the shared schedule editor.
import { errorMessage } from "../../kit/format";
import { DANGER_BUTTON, GHOST_BUTTON, PRIMARY_BUTTON } from "../../kit/app/index";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon, Input,
} from "../../kit/ui/index";
import { useState } from "react";
import type { BotAutomationView } from "../../contract";
import { WEEKDAYS, type Schedule } from "../../schedule";
import { useCall, useLive, type Method, type RpcInput } from "../live";
import { ScheduleEditor, schedulePreview } from "./ScheduleEditor";

type Kind = BotAutomationView["kind"];
export const KIND: Record<Kind, { label: string; icon: string; blurb: string }> = {
  checkin: { label: "Check-in", icon: "MessageSquare", blurb: "Wakes the bot in its chat with a short instruction, on a schedule." },
  reminder: { label: "Reminder", icon: "Clock", blurb: "One message to the bot at a time you pick." },
  watcher: { label: "Watcher", icon: "Eye", blurb: "A script on a schedule. It wakes the bot only when it prints something; otherwise it costs nothing." },
  runner: { label: "Runner", icon: "Repeat", blurb: "A recurring job in its own thread that reports only what matters." },
};
const STATE: Record<BotAutomationView["state"], string> = { active: "", paused: "Paused", done: "Done", ended: "Ended" };
const at = (time: number) => new Date(time).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
export const useAutomations = (botId: string) => useLive("bot_automations", { botId }, { pollMs: 20_000 });

type Sheet = { kind: "new"; type: Kind } | { kind: "edit"; automation: BotAutomationView } | { kind: "delete"; automation: BotAutomationView } | null;

export function AutomationsSection({ botId, botName, onOpen, disabled, external = false }: { botId: string; botName: string; onOpen(threadId: string): void; disabled: boolean; external?: boolean }) {
  const data = useAutomations(botId);
  const call = useCall();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <M extends Method,>(method: M, input: RpcInput<M>, close = true) => {
    setBusy(true); setError(null);
    try { await call(method, { ...input, botId }); if (close) setSheet(null); data.refresh(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  const list = data.data?.automations ?? [];
  const [showDone, setShowDone] = useState(false);
  const kinds: Kind[] = external ? ["checkin", "reminder", "watcher"] : ["checkin", "reminder", "watcher", "runner"];
  return (
    <section aria-label="Automations" data-testid="bot-automations" className="px-4 pt-4">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-xs font-medium text-muted-foreground">Automations</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" className={GHOST_BUTTON} disabled={disabled}><Icon name="Plus" />New</button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {kinds.map((kind) => <DropdownMenuItem key={kind} onSelect={() => { setError(null); setSheet({ kind: "new", type: kind }); }}><Icon name={KIND[kind].icon} />{KIND[kind].label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && !sheet ? <p role="alert" className="pt-1 text-xs text-destructive">{error}</p> : null}
      {list.length ? (
        <ul className="mt-1 flex flex-col divide-y divide-border border-y border-border">
          {list.filter((a) => showDone || (a.state !== "done" && a.state !== "ended")).map((automation) => (
            <AutomationRow key={automation.id} botId={botId} automation={automation} expanded={open === automation.id} busy={busy} disabled={disabled}
              onToggle={() => setOpen(open === automation.id ? null : automation.id)} onOpen={onOpen}
              onAction={(method) => void run(method === "bot_maintenance_dry_run" ? "bot_maintenance_run" : method, method === "bot_maintenance_dry_run" ? { dryRun: true } : { id: automation.id }, false)}
              onEdit={() => { setError(null); setSheet({ kind: "edit", automation }); }} onDelete={() => { if (automation.original) void run("bot_automation_pause", { id: automation.id }); else { setError(null); setSheet({ kind: "delete", automation }); } }} />
          ))}
        </ul>
      ) : (
        <p className="pt-1 text-xs text-muted-foreground">{data.loading ? "Loading…" : `No check-ins. ${botName} only wakes when you write.`}</p>
      )}
      {list.some((a) => a.state === "done" || a.state === "ended") ? <button className={GHOST_BUTTON} onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>Done</button> : null}
      {sheet?.kind === "new" || sheet?.kind === "edit" ? (
        <AutomationDialog type={sheet.kind === "new" ? sheet.type : sheet.automation.kind} automation={sheet.kind === "edit" ? sheet.automation : null} runners={list.filter((each) => each.kind === "runner")} busy={busy} error={error} onClose={() => setSheet(null)}
          onSave={(input) => void run(sheet.kind === "edit" ? "bot_automation_update" : "bot_automation_create", sheet.kind === "edit" ? { id: sheet.automation.id, ...input } : { ...input, kind: sheet.type, name: input.name ?? "", schedule: input.schedule })} />
      ) : null}
      {sheet?.kind === "delete" ? (
        <Dialog open onOpenChange={(next) => !next && setSheet(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{sheet.automation.original ? "Turn off the check-in?" : `Delete ${sheet.automation.name}?`}</DialogTitle>
              <DialogDescription>{sheet.automation.original ? "Its schedule is kept; resume it any time." : sheet.automation.kind === "runner" ? "Its schedule is deleted and its thread archived; the history is kept." : "Its schedule is deleted. Past runs stay in BB's Automations."}</DialogDescription>
            </DialogHeader>
            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
            <DialogFooter>
              <button type="button" className={GHOST_BUTTON} onClick={() => setSheet(null)}>Cancel</button>
              <button type="button" className={DANGER_BUTTON} disabled={busy} onClick={() => void run(sheet.automation.original ? "bot_automation_pause" : "bot_automation_delete", { id: sheet.automation.id })}>{sheet.automation.original ? "Turn off" : "Delete"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

function AutomationRow({ botId, automation, expanded, busy, disabled, onToggle, onOpen, onAction, onEdit, onDelete }: {
  botId: string; automation: BotAutomationView; expanded: boolean; busy: boolean; disabled: boolean;
  onToggle(): void; onOpen(threadId: string): void; onAction(method: "bot_automation_pause" | "bot_automation_resume" | "bot_automation_run_now" | "bot_maintenance_dry_run"): void; onEdit(): void; onDelete(): void;
}) {
  const off = automation.state !== "active";
  const when = off ? STATE[automation.state] : automation.nextRunAt ? at(automation.nextRunAt) : automation.scheduleText;
  return (
    <li data-automation={automation.id} data-kind={automation.kind} className="flex flex-col gap-1 py-2">
      <button type="button" className="flex min-w-0 items-center gap-2 text-left" aria-expanded={expanded} onClick={onToggle}>
        <Icon name={KIND[automation.kind].icon} className={`size-3.5 shrink-0 ${off ? "text-muted-foreground/60" : "text-muted-foreground"}`} aria-label={KIND[automation.kind].label} />
        <span className={`min-w-0 flex-1 truncate text-sm font-medium ${off ? "text-muted-foreground" : ""}`}>{automation.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground" title={automation.nextRunAt ? `Next run ${new Date(automation.nextRunAt).toLocaleString()}` : undefined}>{when}</span>
      </button>
      <p className="truncate pl-5.5 text-xs text-muted-foreground" title={automation.lastOutcome ?? undefined}>{automation.scheduleText}{automation.kind === "watcher" && automation.target !== "main" ? ` · wakes ${automation.targetName}` : ""}{automation.lastOutcome && !/^(succeeded|skipped)$/.test(automation.lastOutcome) ? <> · <span className="text-foreground/80">{automation.lastOutcome}</span></> : null}</p>
      {expanded ? (
        <div className="flex flex-col gap-2 pl-5.5 pt-1">
          {automation.kind === "watcher" && automation.script
            ? <pre className="max-h-32 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">{automation.script.body}</pre>
            : <p className="text-xs whitespace-pre-wrap">{automation.instruction}</p>}
          {automation.kind === "watcher" && automation.instruction ? <p className="text-xs text-muted-foreground">With its output: {automation.instruction}</p> : null}
          {automation.model?.model ? <p className="text-xs text-muted-foreground">Runs on {automation.model.model}{automation.model.reasoning ? ` · ${automation.model.reasoning}` : ""}</p> : null}
          <div className="flex flex-wrap gap-1">
            {automation.state === "active"
              ? <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => onAction("bot_automation_pause")}><Icon name="Pause" />Pause</button>
              : automation.state === "paused" ? <button type="button" className={GHOST_BUTTON} disabled={busy || disabled} onClick={() => onAction("bot_automation_resume")}><Icon name="Play" />Resume</button> : null}
            {automation.state !== "done" ? <button type="button" className={GHOST_BUTTON} disabled={busy || disabled} onClick={() => onAction("bot_automation_run_now")}><Icon name="Zap" />Run now</button> : null}
            {automation.id === "maintenance" ? <button type="button" className={GHOST_BUTTON} disabled={busy || disabled} onClick={() => onAction("bot_maintenance_dry_run")} >Dry run</button> : null}
            {automation.id !== "maintenance" ? <><button type="button" className={GHOST_BUTTON} disabled={busy} onClick={onEdit}><Icon name="Edit" />Edit</button>
            <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={onDelete}><Icon name="Trash2" />{automation.original ? "Turn off" : "Delete"}</button></> : null}
            {automation.kind === "runner" && automation.threadId ? <button type="button" className={GHOST_BUTTON} onClick={() => onOpen(automation.threadId!)}><Icon name="MessageSquare" />Thread</button> : null}
          </div>
          <RecentRuns botId={botId} id={automation.id} onOpen={onOpen} />
        </div>
      ) : null}
    </li>
  );
}

function RecentRuns({ botId, id, onOpen }: { botId: string; id: string; onOpen(threadId: string): void }) {
  const runs = useLive("bot_automation_runs", { botId, id, limit: 6 }, { pollMs: 30_000 });
  const list = runs.data?.runs ?? [];
  if (!list.length) return <p className="text-xs text-muted-foreground">{runs.loading ? "Loading runs…" : "No runs yet."}</p>;
  return (
    <ol aria-label="Recent runs" className="flex flex-col gap-0.5 text-xs">
      {list.map((run) => (
        <li key={run.id} className="flex min-w-0 items-baseline gap-2">
          <span className="w-24 shrink-0 text-muted-foreground tabular-nums">{at(run.at)}</span>
          <span className={`min-w-0 flex-1 truncate ${run.status === "failed" ? "text-destructive" : run.outcome.startsWith("Woke") ? "text-foreground" : "text-muted-foreground"}`} title={run.outcome}>{run.outcome}{run.manual ? " · manual" : ""}</span>
          {run.threadId ? <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground hover:underline" onClick={() => onOpen(run.threadId!)}>Open</button> : null}
        </li>
      ))}
    </ol>
  );
}

const DEFAULT_SCHEDULE: Record<Kind, () => Schedule> = {
  checkin: () => ({ type: "times", days: WEEKDAYS, times: ["08:00"] }),
  reminder: () => ({ type: "once", at: Math.round((Date.now() + 3_600_000) / 60_000) * 60_000 }),
  watcher: () => ({ type: "interval", every: 15, unit: "minutes", days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59", quiet: { from: "22:00", to: "07:00" } }),
  runner: () => ({ type: "times", days: WEEKDAYS, times: ["09:00"] }),
};
const WATCHER_SAMPLE = `# Print what changed; print nothing when nothing did.
new=$(curl -fsS https://example.com/status.txt)
old=$(cat last.txt 2>/dev/null)
echo "$new" > last.txt
[ "$new" != "$old" ] && echo "Status changed: $new"
exit 0`;

/** New or Edit, for any kind: name, instruction or script, model for agent kinds, and the schedule. */
function AutomationDialog({ type, automation, runners, busy, error, onClose, onSave }: {
  type: Kind; automation: BotAutomationView | null; runners: BotAutomationView[]; busy: boolean; error: string | null; onClose(): void; onSave(input: Omit<RpcInput<"bot_automation_update">, "id"> & { schedule: Schedule }): void;
}) {
  const [name, setName] = useState(automation?.name ?? "");
  const [instruction, setInstruction] = useState(automation?.original ? "" : automation?.instruction ?? "");
  const [schedule, setSchedule] = useState<Schedule>(automation?.schedule ?? DEFAULT_SCHEDULE[type]());
  const [script, setScript] = useState(automation?.script?.body ?? WATCHER_SAMPLE);
  const [interpreter, setInterpreter] = useState(automation?.script?.interpreter ?? "bash");
  const [timeout, setTimeoutSeconds] = useState(Math.round((automation?.script?.timeoutMs ?? 60_000) / 1000));
  const [target, setTarget] = useState(automation?.target && automation.target !== "own" ? automation.target : "main");
  const [model, setModel] = useState(automation?.model?.model ?? "");
  const [reasoning, setReasoning] = useState(automation?.model?.reasoning ?? "");
  const original = !!automation?.original;
  const agent = type === "checkin" || type === "reminder";
  const ok = !schedulePreview(schedule).error && (original || (name.trim() && (type === "watcher" ? script.trim() : instruction.trim())));
  const save = () => onSave({
    ...(original ? {} : { name: name.trim(), instruction: instruction.trim() }),
    schedule,
    ...(agent && !original ? { model: { model: model.trim() || null, reasoning: reasoning || null } } : {}),
    ...(type === "watcher" ? { script: { body: script, interpreter, timeoutMs: Math.min(900, Math.max(1, timeout)) * 1000 }, target } : {}),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="automation-editor">
        <DialogHeader>
          <DialogTitle>{automation ? `Edit ${automation.name}` : `New ${KIND[type].label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>{original ? "The bot's original check-in: what it does is its Memory page's Check-in section. It takes one repeating schedule." : KIND[type].blurb}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          {!original ? <label className="block space-y-1"><span className="font-medium">Name</span><Input aria-label="Name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={type === "watcher" ? "Release watch" : type === "reminder" ? "Check the deploy" : "Morning brief"} /></label> : null}
          {type === "watcher" ? (
            <>
              <label className="block space-y-1">
                <span className="flex items-center gap-2 font-medium">Script
                  <select aria-label="Interpreter" className="h-6 rounded border border-border bg-background px-1 text-xs font-normal" value={interpreter} onChange={(event) => setInterpreter(event.target.value as typeof interpreter)}>
                    {["bash", "sh", "node", "python3"].map((each) => <option key={each}>{each}</option>)}
                  </select>
                  <span className="text-xs font-normal text-muted-foreground">timeout</span>
                  <input type="number" aria-label="Timeout seconds" min={1} max={900} className="h-6 w-14 rounded border border-border bg-background px-1 text-xs font-normal" value={timeout} onChange={(event) => setTimeoutSeconds(Number(event.target.value) || 60)} />
                  <span className="text-xs font-normal text-muted-foreground">s</span>
                </span>
                <textarea aria-label="Script" value={script} rows={7} spellCheck={false} onChange={(event) => setScript(event.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs" />
                <span className="block text-xs text-muted-foreground">Runs on the BB server host. Exit 0 and print the finding to wake the bot with it; print nothing (or exit non-zero) and nothing happens.</span>
              </label>
              <label className="block space-y-1"><span className="font-medium">With the output <span className="font-normal text-muted-foreground">(optional)</span></span>
                <Input aria-label="Instruction" value={instruction} maxLength={2000} onChange={(event) => setInstruction(event.target.value)} placeholder="Tell me only if it's a major version." />
              </label>
              {runners.length ? (
                <label className="flex items-center gap-2"><span className="font-medium">Wakes</span>
                  <select aria-label="Wakes" className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={target} onChange={(event) => setTarget(event.target.value)}>
                    <option value="main">The bot</option>
                    {runners.map((runner) => <option key={runner.id} value={runner.id}>Runner {runner.name}</option>)}
                  </select>
                </label>
              ) : null}
            </>
          ) : !original ? (
            <label className="block space-y-1">
              <span className="font-medium">{type === "runner" ? "Job" : type === "reminder" ? "Remind it to" : "Instruction"}</span>
              <textarea aria-label="Instruction" value={instruction} maxLength={2000} rows={3} onChange={(event) => setInstruction(event.target.value)}
                placeholder={type === "reminder" ? "Check whether the deploy finished and tell me." : type === "runner" ? "Check my inbox for replies from Dana; tell me when one arrives." : "Brief me on today: meetings, what needs me, what finished overnight."}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            </label>
          ) : null}
          <div className="space-y-1">
            <span className="font-medium">{type === "reminder" ? "When" : "Schedule"}</span>
            <ScheduleEditor value={schedule} onChange={setSchedule} once={type === "reminder"} disabled={busy} />
          </div>
          {agent && !original ? (
            <details className="text-sm" open={!!automation?.model?.model}>
              <summary className="cursor-pointer text-xs text-muted-foreground">Model</summary>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input aria-label="Model" className="w-48" value={model} onChange={(event) => setModel(event.target.value)} placeholder="The bot's model" />
                <select aria-label="Reasoning" className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={reasoning} onChange={(event) => setReasoning(event.target.value)}>
                  <option value="">Its reasoning</option>{["low", "medium", "high"].map((each) => <option key={each} value={each}>{each}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">A cheaper model on the bot's provider suits routine runs.</span>
              </div>
            </details>
          ) : null}
        </div>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <button type="button" className={GHOST_BUTTON} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY_BUTTON} disabled={busy || !ok} onClick={save}>{automation ? "Save" : `Make ${KIND[type].label.toLowerCase()}`}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
