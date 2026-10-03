import type Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { permissionForTrust } from "./trust";

export type OfficeSchedule = "hourly" | "daily" | "weekdays" | "weekly";
const cron: Record<OfficeSchedule, string> = { hourly: "0 * * * *", daily: "0 9 * * *", weekdays: "0 9 * * 1-5", weekly: "0 9 * * 1" };
const automationSchema = z.object({ id: z.string(), name: z.string(), execution: z.object({ targetThreadId: z.string().optional() }).passthrough() });

/** The automations plugin owns timing and execution. Studio stores only the
 * task association. Disabled creation + reconciliation recovers a lost response
 * without leaving an unlinked live schedule or creating a second engine. */
export class OfficeTaskSchedules {
  private pending = new Map<string, Promise<void>>();
  constructor(private readonly db: Database.Database, private readonly sdk: BbPluginApi["sdk"]) {
    db.exec("CREATE TABLE IF NOT EXISTS office_task_schedules (task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, schedule TEXT NOT NULL, automation_id TEXT, timezone TEXT NOT NULL)");
  }
  forAutomation(automationId: string): { taskId: string; threadId: string } | null {
    return this.db.prepare("SELECT task_id AS taskId,thread_id AS threadId FROM office_task_schedules WHERE automation_id=?").get(automationId) as { taskId: string; threadId: string } | undefined ?? null;
  }
  label(taskId: string): string | null {
    return (this.db.prepare("SELECT schedule FROM office_task_schedules WHERE task_id=?").get(taskId) as { schedule: string } | undefined)?.schedule ?? null;
  }
  async control(taskId: string, action: "pause" | "resume" | "delete"): Promise<void> {
    const row = this.db.prepare("SELECT project_id,automation_id FROM office_task_schedules WHERE task_id=?").get(taskId) as { project_id: string; automation_id: string | null } | undefined;
    if (!row) return;
    if (row.automation_id) await this.sdk.plugins.callRpc({ pluginId: "automations", method: `automations_${action}`, input: { projectId: row.project_id, automationId: row.automation_id }, outputSchema: z.unknown() });
    if (action === "delete") this.db.prepare("DELETE FROM office_task_schedules WHERE task_id=?").run(taskId);
  }
  ensure(input: { taskId: string; projectId: string; threadId: string; schedule: OfficeSchedule; trust: "ask" | "act"; timezone?: string }): Promise<void> {
    const current = this.pending.get(input.taskId);
    if (current) return current;
    const result = this.provision(input).finally(() => this.pending.delete(input.taskId));
    this.pending.set(input.taskId, result);
    return result;
  }
  private async provision(input: { taskId: string; projectId: string; threadId: string; schedule: OfficeSchedule; trust: "ask" | "act"; timezone?: string }): Promise<void> {
    const timezone = input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    this.db.prepare("INSERT OR IGNORE INTO office_task_schedules VALUES (?,?,?,?,NULL,?)").run(input.taskId, input.projectId, input.threadId, input.schedule, timezone);
    const saved = this.db.prepare("SELECT * FROM office_task_schedules WHERE task_id=?").get(input.taskId) as { project_id: string; thread_id: string; schedule: string; automation_id: string | null; timezone: string };
    if (saved.project_id !== input.projectId || saved.thread_id !== input.threadId || saved.schedule !== input.schedule) throw new Error("This task already has a different schedule. Update its existing automation.");
    const call = <S extends z.ZodType>(method: string, args: unknown, outputSchema: S) => this.sdk.plugins.callRpc({ pluginId: "automations", method, input: args as never, outputSchema }) as Promise<z.output<S>>;
    const name = `Task ${input.taskId}`;
    let automationId = saved.automation_id;
    if (!automationId) {
      const existing = (await call("automations_list", { projectId: input.projectId }, z.array(automationSchema))).filter(a => a.name === name && a.execution.targetThreadId === input.threadId);
      if (existing.length > 1) throw new Error("Multiple schedules refer to this task; resolve them before enabling it.");
      automationId = existing[0]?.id ?? null;
      if (!automationId) {
        const [defaults, thread] = await Promise.all([this.sdk.threads.defaultExecutionOptions({ threadId: input.threadId }), this.sdk.threads.get({ threadId: input.threadId })]);
        if (!thread.providerId || !defaults?.model) throw new Error("Choose a bot provider and model before scheduling its work.");
        const created = await call("automations_create", {
          projectId: input.projectId, name, enabled: false, origin: "app",
          trigger: { triggerType: "schedule", cron: cron[input.schedule], timezone: saved.timezone },
          execution: { mode: "agent", providerId: thread.providerId, model: defaults.model, reasoningLevel: defaults.reasoningLevel ?? "medium", permissionMode: permissionForTrust(input.trust),
            environment: { type: "project-default" }, targetThreadId: input.threadId,
            prompt: `Run the recurring task ${input.taskId}. Read its current brief and linked context with tasks_get. Update this task's progress and output links; finish in review. Do not create another schedule.`,
          },
        }, automationSchema);
        automationId = created.id;
      }
      this.db.prepare("UPDATE office_task_schedules SET automation_id=? WHERE task_id=?").run(automationId, input.taskId);
    }
    await call("automations_resume", { projectId: input.projectId, automationId }, z.unknown());
  }
}
