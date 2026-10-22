// Project leads in Studio's Setup page: each BB project can have a lead
// thread, and a heartbeat that wakes it on a schedule (src/project-lead.ts).
// The personal project's lead is the user's Bot, which has its own home
// (src/ui/bot/BotHome.tsx); Setup links there instead of listing it.
import { errorMessage } from "../kit/format";
import { useProjects } from "../kit/app/index";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "../kit/ui/index";
import { useEffect, useState } from "react";
import type { HeartbeatRun } from "../contract";
import { useCall, useLive, type Method, type RpcInput, type Cadence } from "./live";
import { openAppPath } from "../kit/app/index";

const PERSONAL_PROJECT_ID = "proj_personal";
const RUN_LABELS: Record<Cadence, string> = {
  every5minutes: "Every 5 minutes", every15minutes: "Every 15 minutes", every30minutes: "Every 30 minutes",
  hourly: "Every hour", every2hours: "Every 2 hours", every6hours: "Every 6 hours",
  daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", custom: "Custom (cron)",
};
const SELECT = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50";

type Run = { enabled: boolean; cadence: Cadence; time?: string | null; cron?: string | null } | null;
export type HeartbeatForm = ReturnType<typeof useHeartbeatForm>;

/** The heartbeat's cadence, time and cron, reset whenever the saved run changes. */
export function useHeartbeatForm(run: Run) {
  const [cadence, setCadence] = useState<Cadence | "off">("off");
  const [time, setTime] = useState("09:00");
  const [cron, setCron] = useState("");
  useEffect(() => {
    setCadence(run?.enabled ? run.cadence : "off");
    setTime(run?.time ?? "09:00");
    setCron(run?.cron ?? "");
  }, [run?.enabled, run?.cadence, run?.time, run?.cron]);
  /** The run RPC's input: off keeps the saved cadence. */
  const input = () => {
    const enabled = cadence !== "off";
    return { enabled, cadence: enabled ? cadence : run?.cadence ?? "daily", time, ...(cadence === "custom" ? { cron: cron.trim() } : {}) };
  };
  return { cadence, setCadence, time, setTime, cron, setCron, input };
}

/** Cadence select plus time or cron. `needs` explains why it's off, when it must be. */
export function HeartbeatFields({ form, disabled, needs, label = "Heartbeat" }: { form: HeartbeatForm; disabled: boolean; needs: string | null; label?: string }) {
  const { cadence, setCadence, time, setTime, cron, setCron } = form;
  const on = needs === null;
  return (
    <>
      <label className="block space-y-1">
        <span className="font-medium">{label}</span>
        <select aria-label={label} className={SELECT} disabled={disabled || !on} value={on ? cadence : "off"} onChange={(event) => setCadence(event.target.value as Cadence | "off")}>
          <option value="off">Off</option>
          {(Object.keys(RUN_LABELS) as Cadence[]).map((value) => <option key={value} value={value}>{RUN_LABELS[value]}</option>)}
        </select>
        {needs ? <span className="block text-xs text-muted-foreground">{needs}</span> : null}
      </label>
      {on && cadence !== "off" && cadence !== "custom" ? (
        <label className="flex items-center justify-between gap-3">
          <span>Time (minute for hourly cadences)</span>
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1" />
        </label>
      ) : null}
      {on && cadence === "custom" ? (
        <Input aria-label="Cron expression" placeholder="*/15 9-17 * * 1-5" value={cron} onChange={(event) => setCron(event.target.value)} />
      ) : null}
    </>
  );
}

const leadLabel = (projectId: string) => (projectId === PERSONAL_PROJECT_ID ? "Chief of Staff" : "Lead");

/** One project's lead and heartbeat. The lead can be any open thread. */
export function ProjectLeadDialog({ project, onClose }: { project: { id: string; name: string }; onClose(): void }) {
  const call = useCall();
  const lead = useLive("project_lead", { projectId: project.id }, { pollMs: 0 });
  const recent = useLive("recentThreads", null, { pollMs: 0 });
  // The project's own threads first.
  const threads = [...(recent.data?.threads ?? [])].sort((a, b) => Number(b.projectId === project.id) - Number(a.projectId === project.id));
  const leadId = lead.data?.leadThreadId ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useHeartbeatForm((lead.data?.run ?? null) as Run);

  const perform = async <M extends Method,>(method: M, input: RpcInput<M>) => {
    setBusy(true);
    setError(null);
    try {
      await call(method, input);
      lead.refresh();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const setLead = (threadId: string) => void perform("project_set_lead", { projectId: project.id, threadId: threadId || null });
  const save = async () => {
    if (await perform("project_set_run", { projectId: project.id, ...form.input() })) onClose();
  };
  const label = leadLabel(project.id);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{label} and heartbeat · {project.name}</DialogTitle>
          <DialogDescription>
            {project.id === PERSONAL_PROJECT_ID
              ? "Your Chief of Staff leads your personal project and sees every project. The heartbeat wakes it on a schedule to check on the projects and their leads, and report in its thread."
              : "The lead is a thread you pick. The heartbeat wakes it on a schedule to check on the project's threads and items, and report in its thread."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <label className="block space-y-1">
            <span className="font-medium">{label}</span>
            <select aria-label="Lead thread" className={SELECT} disabled={busy || lead.loading} value={leadId ?? ""} onChange={(event) => setLead(event.target.value)}>
              <option value="">No {label.toLowerCase()}</option>
              {leadId && !threads.some((thread) => thread.id === leadId) ? <option value={leadId}>Current {label.toLowerCase()}</option> : null}
              {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}{thread.projectId === project.id ? "" : " (another project)"}</option>)}
            </select>
          </label>
          <HeartbeatFields form={form} disabled={busy} needs={leadId ? null : `Pick a ${label === "Lead" ? "lead" : "Chief of Staff"} to turn the heartbeat on.`} />
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !leadId} onClick={() => void save()}>Save heartbeat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const describeRun = (run: HeartbeatRun | null) => (run?.enabled ? `heartbeat ${RUN_LABELS[run.cadence].toLowerCase()}${run.cadence === "custom" ? ` (${run.cron})` : ""}` : "heartbeat off");

/** Every project, with its lead and heartbeat, for the Setup page. */
export function ProjectLeadsSection() {
  const projects = useProjects();
  const leads = useLive("project_leads", {}, { pollMs: 0 });
  const recent = useLive("recentThreads", null, { pollMs: 0 });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const byProject = new Map((leads.data?.leads ?? []).map((lead) => [lead.projectId, lead]));
  const titles = new Map((recent.data?.threads ?? []).map((thread) => [thread.id, thread.title]));
  const bot = useLive("bot_get", {}, { pollMs: 0 });
  // The personal project's lead is the Bot, set in its own home.
  const ordered = projects.filter((project) => project.id !== PERSONAL_PROJECT_ID).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section aria-label="Project leads" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-foreground">Project leads</h2>
      <p className="text-xs text-muted-foreground">Give a project a lead thread, and a heartbeat that wakes it to check on the project.</p>
      <button type="button" onClick={() => openAppPath("/plugins/studio/studio/bot")} className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-state-hover">
        <span aria-hidden className="text-base">{bot.data?.bot?.avatar ?? "🤖"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{bot.data?.bot?.name ?? "Your Bot"}</span>
          <span className="block truncate text-xs text-muted-foreground">Leads your personal project and sees every project. Its chat, check-ins and Activity are in its home.</span>
        </span>
        <span className="text-xs text-muted-foreground">Open Bot →</span>
      </button>
      {leads.error ? <p role="alert" className="text-xs text-destructive">{leads.error}</p> : null}
      <ul className="flex flex-col gap-1.5">
        {ordered.map((project) => {
          const lead = byProject.get(project.id);
          const leadId = lead?.leadThreadId ?? null;
          return (
            <li key={project.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{project.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {leadId ? `${leadLabel(project.id)}: ${titles.get(leadId) ?? leadId}` : `No ${leadLabel(project.id).toLowerCase()}`} · {describeRun(lead?.run ?? null)}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(project)}>Edit</Button>
            </li>
          );
        })}
      </ul>
      {editing ? <ProjectLeadDialog project={editing} onClose={() => { setEditing(null); leads.refresh(); }} /> : null}
    </section>
  );
}
