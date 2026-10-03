import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { TaskReportOutbox, type TaskReport } from "./report-outbox";

it("retries after failure/restart and preserves a newer in-flight revision", async () => {
  const db = new Database(":memory:");
  try {
    const report: TaskReport = { taskId: "task", title: "First", body: "Result", threadId: "thread", projectId: "folder", botId: "bot" };
    const warnings: string[] = [];
    const first = new TaskReportOutbox(db, async () => { throw new Error("Feed unavailable"); }, s => warnings.push(s));
    first.enqueue(report); await first.drain();
    expect(warnings).toHaveLength(1);
    const sent: string[] = [];
    const restarted = new TaskReportOutbox(db, async value => {
      sent.push(value.title);
      if (value.title === "First") restarted.enqueue({ ...report, title: "Updated" });
    }, () => {});
    await restarted.drain(); await restarted.drain(); await restarted.drain();
    expect(sent).toEqual(["First", "Updated"]);
    expect(db.prepare("SELECT * FROM office_task_reports").all()).toEqual([]);
  } finally { db.close(); }
});
