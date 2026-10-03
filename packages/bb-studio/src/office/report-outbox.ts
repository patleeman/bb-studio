import type Database from "better-sqlite3";

export interface TaskReport {
  taskId: string; title: string; body: string; threadId: string; projectId: string | null; botId: string;
}

/** One pending revision per task. Successful delivery of an older revision must
 * not erase a newer result queued while the publishing request was in flight. */
export class TaskReportOutbox {
  private running = false;
  constructor(private readonly db: Database.Database, private readonly publish: (report: TaskReport) => Promise<void>, private readonly warn: (message: string) => void) {
    db.exec("CREATE TABLE IF NOT EXISTS office_task_reports (task_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)");
  }
  enqueue(report: TaskReport): void {
    this.db.prepare("INSERT INTO office_task_reports VALUES (?,1,?) ON CONFLICT(task_id) DO UPDATE SET revision=revision+1,payload=excluded.payload").run(report.taskId, JSON.stringify(report));
  }
  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pending = this.db.prepare("SELECT task_id,revision,payload FROM office_task_reports").all() as { task_id: string; revision: number; payload: string }[];
      for (const row of pending) {
        try {
          await this.publish(JSON.parse(row.payload) as TaskReport);
          if (this.db.open) this.db.prepare("DELETE FROM office_task_reports WHERE task_id=? AND revision=?").run(row.task_id, row.revision);
        } catch (error) { this.warn(`Task report ${row.task_id} will retry: ${String(error)}`); }
      }
    } finally { this.running = false; }
  }
}
