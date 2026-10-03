import type Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { TaskStore } from "../modules/tasks/src/server/store";
import type { RecurringTaskInput } from "./recurring-contract";

type Row = { source_key: string; task_id: string; project_id: string; source_json: string; enabled: number };
/** A projection of an existing engine, never a second scheduler. Tombstones
 * retain source identity after deletion so maintenance cannot recreate work. */
export class OfficeRecurringTasks {
  constructor(private db: Database.Database, private store: TaskStore, private sdk: BbPluginApi["sdk"]) {
    db.exec(`CREATE TABLE IF NOT EXISTS office_recurring_tasks (
      source_key TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL, source_json TEXT NOT NULL, enabled INTEGER NOT NULL
    )`);
  }
  label(taskId: string): string | null {
    const row = this.row(taskId);
    if (!row) return null;
    const source = JSON.parse(row.source_json) as RecurringTaskInput["source"];
    return source.kind === "mission" ? `Every ${source.intervalMinutes} minutes` : source.schedule;
  }
  sync(input: RecurringTaskInput): string | null {
    const key = input.source.kind === "mission" ? `mission:${input.source.botId}` : `automation:${input.source.automationId}`;
    return this.db.transaction(() => {
      const saved = this.db.prepare("SELECT * FROM office_recurring_tasks WHERE source_key=?").get(key) as Row | undefined;
      let task = saved ? this.store.get(saved.task_id) : undefined;
      if (saved && !task) return null;
      if (!task) {
        // A disabled legacy mission with no interval is not recurring work.
        if (input.source.kind === "mission" && input.source.intervalMinutes === 0) return null;
        task = this.store.create({ title: input.title, description: input.description, projectId: input.projectId,
          assignee: input.botId ? `bot:${input.botId}` : null, by: "user" });
      }
      const previous = saved ? JSON.parse(saved.source_json) as RecurringTaskInput["source"] : null;
      const source = input.source.kind === "mission" && !input.source.intervalMinutes && previous?.kind === "mission" ? previous : input.source;
      this.db.prepare(`INSERT INTO office_recurring_tasks VALUES (?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET source_json=excluded.source_json, enabled=excluded.enabled`).run(key, task.id, input.projectId, JSON.stringify(source), +input.enabled);
      // MISSION.md/automation prompt remains the engine's source of truth.
      if (task.description !== input.description || task.title !== input.title)
        this.store.update(task.id, { title: input.title, description: input.description }, "user");
      return task.id;
    })();
  }
  private row(taskId: string) { return this.db.prepare("SELECT * FROM office_recurring_tasks WHERE task_id=?").get(taskId) as Row | undefined; }
  async control(taskId: string, action: "pause" | "resume" | "delete") {
    const row = this.row(taskId);
    if (!row) return;
    const source = JSON.parse(row.source_json) as RecurringTaskInput["source"];
    if (source.kind === "mission") {
      await this.sdk.plugins.callRpc({ pluginId: "bot-teams", method: "update", input: { id: source.botId, intervalMinutes: action === "resume" ? source.intervalMinutes : 0 }, outputSchema: z.unknown() });
    } else {
      await this.sdk.plugins.callRpc({ pluginId: "automations", method: `automations_${action === "delete" ? "pause" : action}`, input: { projectId: row.project_id, automationId: source.automationId }, outputSchema: z.unknown() });
    }
    // Deleting the presentation pauses but preserves the original engine/data.
    this.db.prepare("UPDATE office_recurring_tasks SET enabled=? WHERE task_id=?").run(+(action === "resume"), taskId);
  }
}
