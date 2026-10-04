import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { rpcErrorStatus } from "@bb-studio/kit/server";
import { runSchema } from "./projects-contract";
export type ProjectRun = z.infer<typeof runSchema>;
type Row = ProjectRun & { project_id: string; automation_id: string | null; automation_project_id: string | null };
const automation = z.object({ id: z.string(), name: z.string() });
export const HEARTBEAT = "Heartbeat: check the project against its page; act if needed; report to the Inbox only when something changed or needs Patrick.";

/** Automations owns scheduling; this table remembers configuration and identity. */
export class ProjectRuns {
  private pending = new Map<string, Promise<void>>();
  constructor(private db: Database.Database, private sdk: BbPluginApi["sdk"], private changed: () => void, private context: (projectId: string) => Promise<string> = async () => "") {}
  private row(projectId: string) { return this.db.prepare("SELECT * FROM office_project_runs WHERE project_id=?").get(projectId) as Row | undefined; }
  get(projectId: string): ProjectRun | null {
    const row = this.row(projectId);
    return row ? { enabled: !!row.enabled, cadence: row.cadence, time: row.time } : null;
  }
  private call<T>(method: string, input: unknown, outputSchema: z.ZodType<T>) {
    return this.sdk.plugins.callRpc({ pluginId: "automations", method, input: input as never, outputSchema });
  }
  set(projectId: string, leadThreadId: string | null, run: ProjectRun): Promise<void> {
    const next = (this.pending.get(projectId) ?? Promise.resolve()).catch(() => {}).then(() => this.provision(projectId, leadThreadId, run));
    this.pending.set(projectId, next);
    void next.finally(() => { if (this.pending.get(projectId) === next) this.pending.delete(projectId); }).catch(() => {});
    return next;
  }
  private async provision(projectId: string, leadThreadId: string | null, run: ProjectRun) {
    const row = this.row(projectId);
    if (!run.enabled) {
      if (row?.automation_id) await this.call("automations_delete", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown()).catch(error => {
        if (rpcErrorStatus(error) !== 404) throw error;
      });
      this.db.prepare("INSERT INTO office_project_runs VALUES (?,?,?,?,NULL,NULL) ON CONFLICT(project_id) DO UPDATE SET enabled=0,cadence=excluded.cadence,time=excluded.time,automation_id=NULL,automation_project_id=NULL")
        .run(projectId, 0, run.cadence, run.time);
      this.changed(); return;
    }
    // A migrated bot without a DM stores its intended cadence until setup starts
    // a lead; never create a timer with an unbound target.
    this.db.prepare("INSERT OR IGNORE INTO office_project_runs VALUES (?,?,?,?,NULL,NULL)")
      .run(projectId, leadThreadId ? 0 : 1, run.cadence, run.time);
    if (!leadThreadId) { this.changed(); return; }
    const [thread, defaults] = await Promise.all([this.sdk.threads.get({ threadId: leadThreadId }), this.sdk.threads.defaultExecutionOptions({ threadId: leadThreadId })]);
    if (!thread.providerId || !defaults?.model) throw new Error("Choose a lead provider and model before enabling Run mode.");
    const [hour, minute] = run.time.split(":");
    const cron = run.cadence === "hourly" ? `${Number(minute)} * * * *` : `${Number(minute)} ${Number(hour)} * * ${run.cadence === "weekdays" ? "1-5" : "*"}`;
    const trigger = { triggerType: "schedule", cron, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const execution = { mode: "agent", providerId: thread.providerId, model: defaults.model, reasoningLevel: defaults.reasoningLevel ?? "medium", permissionMode: defaults.permissionMode ?? "accept-edits", environment: { type: "project-default" }, targetThreadId: leadThreadId,
      prompt: `${HEARTBEAT}\nProject hub: /plugins/studio/projects/${encodeURIComponent(projectId)}. Read project_get for its current page and Memory.\n${await this.context(projectId)}`, };
    const name = `Studio project heartbeat ${projectId}`;
    let automationId = row?.automation_id;
    if (automationId && row?.automation_project_id !== thread.projectId) {
      await this.call("automations_delete", { projectId: row?.automation_project_id, automationId }, z.unknown());
      automationId = null;
      this.db.prepare("UPDATE office_project_runs SET automation_id=NULL WHERE project_id=?").run(projectId);
    }
    if (!automationId) {
      const existing = (await this.call("automations_list", { projectId: thread.projectId }, z.array(automation))).filter(a => a.name === name);
      if (existing.length > 1) throw new Error("Multiple heartbeat automations found for this project.");
      automationId = existing[0]?.id ?? (await this.call("automations_create", { projectId: thread.projectId, name, enabled: false, origin: "app", trigger, execution }, automation)).id;
      this.db.prepare("UPDATE office_project_runs SET automation_id=?,automation_project_id=? WHERE project_id=?").run(automationId, thread.projectId, projectId);
    }
    await this.call("automations_update", { projectId: thread.projectId, automationId, trigger, execution }, z.unknown());
    await this.call("automations_resume", { projectId: thread.projectId, automationId }, z.unknown());
    this.db.prepare("UPDATE office_project_runs SET enabled=1,cadence=?,time=? WHERE project_id=?").run(run.cadence, run.time, projectId);
    this.changed();
  }
}
