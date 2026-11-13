// The Bot page's week (This week): what wakes a Bot (src/automations.ts) — check-ins,
// reminders, watchers and runners — as a week calendar (AutomationsCalendar.tsx)
// or a list. A block with no thread to open shows its job in the list. A row shows its kind, name,
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
import { AutomationsCalendar } from "./AutomationsCalendar";
import { RUNS_LIMIT } from "./calendar";

type Kind = BotAutomationView["kind"];
export const KIND: Record<Kind, { label: string; icon: string }> = {
  checkin: { label: "Check-in", icon: "MessageSquare" },
  reminder: { label: "Reminder", icon: "Clock" },
  watcher: { label: "Watcher", icon: "Eye" },
  runner: { label: "Runner", icon: "Repeat" },
};
const STATE: Record<BotAutomationView["state"], string> = { active: "", paused: "Paused", done: "Done", ended: "Ended" };
const at = (time: number) => new Date(time).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
export const useAutomations = (botId: string) => useLive("bot_automations", { botId }, { pollMs: 20_000 });

type Sheet = { kind: "new"; type: Kind } | { kind: "edit"; automation: BotAutomationView } | { kind: "delete"; automation: BotAutomationView } | null;

/** New, Edit and Delete for a Bot's automations, and the actions every detail offers: one place for the Automations section and the Automations table. */
export function useAutomationEditor(botId: string, list: readonly BotAutomationView[], refresh: () => void) {
  const call = useCall();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <M extends Method,>(method: M, input: RpcInput<M>, close = true) => {
    setBusy(true); setError(null);
    try { await call(method, { ...input, botId }); if (close) setSheet(null); refresh(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  const openNew = (type: Kind) => { setError(null); setSheet({ kind: "new", type }); };
  const actions = (automation: BotAutomationView) => ({
    onAction: (method: DetailAction) => void run(method === "bot_maintenance_dry_run" ? "bot_maintenance_run" : method, method === "bot_maintenance_dry_run" ? { dryRun: true } : { id: automation.id }, false),
    onEdit: () => { setError(null); setSheet({ kind: "edit", automation }); },
    onDelete: () => { if (automation.original) void run("bot_automation_pause", { id: automation.id }); else { setError(null); setSheet({ kind: "delete", automation }); } },
  });
  const dialogs = (
    <>
      {sheet?.kind === "new" || sheet?.kind === "edit" ? (
        <AutomationDialog type={sheet.kind === "new" ? sheet.type : sheet.automation.kind} automation={sheet.kind === "edit" ? sheet.automation : null} runners={list.filter((each) => each.kind === "runner")} busy={busy} error={error} onClose={() => setSheet(null)}
          onSave={(input) => void run(sheet.kind === "edit" ? "bot_automation_update" : "bot_automation_create", sheet.kind === "edit" ? { id: sheet.automation.id, ...input } : { ...input, kind: sheet.type, name: input.name ?? "", schedule: input.schedule })} />
      ) : null}
      {sheet?.kind === "delete" ? (
        <Dialog open onOpenChange={(next) => !next && setSheet(null)}>
          <DialogContent className="sm:max-w-md" {...(sheet.automation.kind === "runner" && !sheet.automation.original ? {} : { "aria-describedby": undefined })}>
            <DialogHeader>
              <DialogTitle>{sheet.automation.original ? "Turn off the check-in?" : `Delete ${sheet.automation.name}?`}</DialogTitle>
              {sheet.automation.kind === "runner" && !sheet.automation.original ? <DialogDescription>Its thread is archived.</DialogDescription> : null}
            </DialogHeader>
            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
            <DialogFooter>
              <button type="button" className={GHOST_BUTTON} onClick={() => setSheet(null)}>Cancel</button>
              <button type="button" className={DANGER_BUTTON} disabled={busy} onClick={() => void run(sheet.automation.original ? "bot_automation_pause" : "bot_automation_delete", { id: sheet.automation.id })}>{sheet.automation.original ? "Turn off" : "Delete"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
  return { busy, error: sheet ? null : error, run, openNew, actions, dialogs };
}

/** The kinds New offers: an external Bot has no runners. */
export const newKinds = (external: boolean): Kind[] => external ? ["checkin", "reminder", "watcher"] : ["checkin", "reminder", "watcher", "runner"];

/** New, as a menu of kinds. */
export function NewAutomationMenu({ kinds, disabled, onPick }: { kinds: readonly Kind[]; disabled: boolean; onPick(kind: Kind): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className={GHOST_BUTTON} disabled={disabled}><Icon name="Plus" />New</button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {kinds.map((kind) => <DropdownMenuItem key={kind} onSelect={() => onPick(kind)}><Icon name={KIND[kind].icon} />{KIND[kind].label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AutomationsSection({ botId, botName, onOpen, disabled, external = false, page = false }: { botId: string; botName: string; onOpen(threadId: string): void; disabled: boolean; external?: boolean; page?: boolean }) {
  const data = useAutomations(botId);
  // What runs in bb (a BB Studio copy's imported rows) isn't this Bot's to schedule here: the week and list leave it out.
  const list = (data.data?.automations ?? []).filter((each) => !each.inBb);
  const editor = useAutomationEditor(botId, list, () => data.refresh());
  const { busy, error, run } = editor;
  const [open, setOpen] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useState<"week" | "list">("week");
  const toolbar = (
    <>
      {list.length ? (
        <div role="tablist" aria-label="Automations view" className="flex items-center rounded-md border border-border p-0.5">
          {(["week", "list"] as const).map((each) => (
            <button key={each} type="button" role="tab" aria-selected={view === each} onClick={() => setView(each)}
              className="flex h-6 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:text-foreground aria-selected:bg-state-active aria-selected:text-foreground">
              <Icon name={each === "week" ? "Calendar" : "List"} className="size-3.5" />{each === "week" ? "Week" : "List"}
            </button>
          ))}
        </div>
      ) : null}
      <NewAutomationMenu kinds={newKinds(external)} disabled={disabled} onPick={editor.openNew} />
    </>
  );
  return (
    <section aria-label="Automations" data-testid="bot-automations" className={page ? "pt-8" : "px-4 pt-4"}>
      {error ? <p role="alert" className="pb-1 text-xs text-destructive">{error}</p> : null}
      {list.length && view === "week" ? (
        <AutomationsCalendar wide={page} botId={botId} botName={botName} automations={list} onOpen={onOpen} busy={busy || disabled} toolbar={toolbar}
          onPick={(id) => { setView("list"); setOpen(id); if (list.find((each) => each.id === id && (each.state === "done" || each.state === "ended"))) setShowDone(true); }}
          onResume={(id) => void run("bot_automation_resume", { id }, false)}
          onRunNow={(id) => void run("bot_automation_run_now", { id }, false)} />
      ) : (
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-sm font-medium">{page ? "This week" : "Automations"}</h3>
          {toolbar}
        </div>
      )}
      {list.length && view === "list" ? (
        <ul className="mt-1 flex flex-col divide-y divide-border border-y border-border">
          {list.filter((a) => showDone || (a.state !== "done" && a.state !== "ended")).map((automation) => (
            <AutomationRow key={automation.id} botId={botId} automation={automation} expanded={open === automation.id} busy={busy} disabled={disabled}
              onToggle={() => setOpen(open === automation.id ? null : automation.id)} onOpen={onOpen} {...editor.actions(automation)} />
          ))}
        </ul>
      ) : !list.length ? (
        <p className="pt-1 text-xs text-muted-foreground">{data.loading ? "Loading…" : "No automations"}</p>
      ) : null}
      {view === "list" && list.some((a) => a.state === "done" || a.state === "ended") ? <button className={GHOST_BUTTON} onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>Done</button> : null}
      {editor.dialogs}
    </section>
  );
}

type DetailAction = "bot_automation_pause" | "bot_automation_resume" | "bot_automation_run_now" | "bot_maintenance_dry_run";

function AutomationRow({ botId, automation, expanded, busy, disabled, onToggle, onOpen, onAction, onEdit, onDelete }: {
  botId: string; automation: BotAutomationView; expanded: boolean; busy: boolean; disabled: boolean;
  onToggle(): void; onOpen(threadId: string): void; onAction(method: DetailAction): void; onEdit(): void; onDelete(): void;
}) {
  const off = automation.state !== "active";
  // The calendar reads the same runs (one shared request); the newest failure shows here too.
  const runs = useLive("bot_automation_runs", { botId, id: automation.id, limit: RUNS_LIMIT }, { pollMs: 30_000 });
  const failure = runs.data?.runs.find((run) => run.status === "failed") ?? null;
  const latest = runs.data?.runs.find((run) => run.status !== "resumed" && run.outcome !== "Running") ?? null;
  const when = off ? STATE[automation.state] : automation.nextRunAt ? at(automation.nextRunAt) : automation.scheduleText;
  return (
    <li data-automation={automation.id} data-kind={automation.kind} className="flex flex-col gap-1 py-2">
      <button type="button" className="flex min-w-0 items-center gap-2 text-left" aria-expanded={expanded} onClick={onToggle}>
        <Icon name={KIND[automation.kind].icon} className={`size-3.5 shrink-0 ${off ? "text-muted-foreground/60" : "text-muted-foreground"}`} aria-label={KIND[automation.kind].label} />
        <span className={`min-w-0 flex-1 truncate text-sm font-medium ${off ? "text-muted-foreground" : ""}`}>{automation.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground" title={automation.nextRunAt ? `Next run ${new Date(automation.nextRunAt).toLocaleString()}` : undefined}>{when}</span>
      </button>
      <p className="truncate pl-5.5 text-xs text-muted-foreground" title={automation.lastOutcome ?? undefined}>{automation.scheduleText}{automation.kind === "watcher" && automation.target !== "main" ? ` · wakes ${automation.targetName}` : ""}{automation.lastOutcome && !/^(succeeded|skipped)$/.test(automation.lastOutcome) && !(failure && automation.lastOutcome === failure.outcome) ? <> · <span className="text-foreground/80">{automation.lastOutcome}</span></> : null}</p>
      {failure ? (
        <p data-testid="automation-last-failure" className={`flex min-w-0 items-center gap-1 pl-5.5 text-xs ${latest?.id === failure.id ? "text-destructive" : "text-muted-foreground"}`} title={failure.outcome}>
          <Icon name="AlertCircle" className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{latest?.id === failure.id ? "Last run failed" : "Last failed"} {at(failure.at)}: {failure.outcome.replace(/^Failed:?\s*/i, "") || "Failed"}</span>
        </p>
      ) : null}
      {expanded ? <div className="pl-5.5 pt-1"><AutomationDetail botId={botId} automation={automation} busy={busy} disabled={disabled} onOpen={onOpen} onAction={onAction} onEdit={onEdit} onDelete={onDelete} /></div> : null}
    </li>
  );
}

export interface AutomationActionProps {
  automation: BotAutomationView; busy: boolean; disabled: boolean;
  onOpen(threadId: string): void; onAction(method: DetailAction): void; onEdit(): void; onDelete(): void;
}

export const instructionLabel = (kind: Kind): string => kind === "runner" ? "Job" : kind === "reminder" ? "Remind it to" : kind === "watcher" ? "With the output" : "Instruction";

/** An automation opened: what it does, its actions (Pause or Resume, Run now, Edit, Delete) and its recent runs. */
export function AutomationDetail({ botId, ...props }: AutomationActionProps & { botId: string }) {
  const { automation, onOpen } = props;
  return (
    <div className="flex flex-col gap-2">
      {automation.kind === "watcher" && automation.script
        ? <pre className="max-h-32 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">{automation.script.body}</pre>
        : <p className="text-xs whitespace-pre-wrap">{automation.instruction}</p>}
      {automation.kind === "watcher" && automation.instruction ? <p className="text-xs text-muted-foreground">With its output: {automation.instruction}</p> : null}
      {automation.model?.model ? <p className="text-xs text-muted-foreground">Runs on {automation.model.model}{automation.model.reasoning ? ` · ${automation.model.reasoning}` : ""}</p> : null}
      <div className="flex flex-wrap gap-1"><AutomationActions {...props} /></div>
      <RecentRuns botId={botId} id={automation.id} onOpen={onOpen} />
    </div>
  );
}

export function AutomationActions({ automation, busy, disabled, onOpen, onAction, onEdit, onDelete, buttonClass = GHOST_BUTTON }: AutomationActionProps & { buttonClass?: string }) {
  return <>
    {automation.state === "active"
      ? <button type="button" className={buttonClass} disabled={busy} onClick={() => onAction("bot_automation_pause")}><Icon name="Pause" />Pause</button>
      : automation.state === "paused" ? <button type="button" className={buttonClass} disabled={busy || disabled} onClick={() => onAction("bot_automation_resume")}><Icon name="Play" />Resume</button> : null}
    {automation.state !== "done" ? <button type="button" className={buttonClass} disabled={busy || disabled} onClick={() => onAction("bot_automation_run_now")}><Icon name="Zap" />Run now</button> : null}
    {automation.id === "maintenance" ? <button type="button" className={buttonClass} disabled={busy || disabled} onClick={() => onAction("bot_maintenance_dry_run")} >Dry run</button> : null}
    {automation.id !== "maintenance" ? <><button type="button" className={buttonClass} disabled={busy} onClick={onEdit}><Icon name="Edit" />Edit</button>
    <button type="button" className={buttonClass} disabled={busy} onClick={onDelete}><Icon name="Trash2" />{automation.original ? "Turn off" : "Delete"}</button></> : null}
    {automation.kind === "runner" && automation.threadId ? <button type="button" className={buttonClass} onClick={() => onOpen(automation.threadId!)}><Icon name="MessageSquare" />Thread</button> : null}
  </>;
}

export function RecentRuns({ botId, id, onOpen, title, empty }: { botId: string; id: string; onOpen(threadId: string): void; title?: string; empty?: string | null }) {
  const runs = useLive("bot_automation_runs", { botId, id, limit: RUNS_LIMIT }, { pollMs: 30_000 });
  const list = runs.data?.runs.slice(0, 6) ?? [];
  if (!list.length) {
    const text = runs.loading ? "Loading runs…" : empty === undefined ? "No runs yet." : empty;
    return text ? <p className="text-xs text-muted-foreground">{text}</p> : null;
  }
  const ol = (
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
  return title ? <div className="flex flex-col gap-1.5"><h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>{ol}</div> : ol;
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="automation-editor" {...(original ? {} : { "aria-describedby": undefined })}>
        <DialogHeader>
          <DialogTitle>{automation ? `Edit ${automation.name}` : `New ${KIND[type].label.toLowerCase()}`}</DialogTitle>
          {original ? <DialogDescription>One repeating schedule.</DialogDescription> : null}
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
                <span className="block text-xs text-muted-foreground">Runs on the BB server host. Output with exit 0 wakes the bot.</span>
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
              <span className="font-medium">{instructionLabel(type)}</span>
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
