import type Database from "better-sqlite3";

export type Job = { thread_id: string; at: number; body: string };
export type Update = Job & { headline: string; urgent: number; read_at: number | null; filtered: number };

export class AutomaticStore {
  constructor(readonly db: Database.Database) {}
  enqueue(job: Job) {
    this.db.prepare(`INSERT INTO inbox_jobs (thread_id, at, body) SELECT @thread_id, @at, @body
      WHERE @at > COALESCE((SELECT at FROM inbox_checkpoints WHERE thread_id = @thread_id), 0)
      ON CONFLICT(thread_id) DO UPDATE SET at = excluded.at, body = excluded.body, retry_at = 0, attempts = 0 WHERE excluded.at > inbox_jobs.at`).run(job);
  }
  next(): Job | null { return this.db.prepare("SELECT thread_id, at, body FROM inbox_jobs WHERE retry_at <= ? ORDER BY at LIMIT 1").get(Date.now()) as Job | undefined ?? null; }
  retry(job: Job) {
    this.db.prepare("UPDATE inbox_jobs SET attempts = attempts + 1, retry_at = ? + MIN(300000, 1000 * (1 << MIN(attempts, 8))) WHERE thread_id = ? AND at = ?").run(Date.now(), job.thread_id, job.at);
  }
  processed(id: string): number { return (this.db.prepare("SELECT at FROM inbox_checkpoints WHERE thread_id = ?").get(id) as { at: number } | undefined)?.at ?? 0; }
  current(job: Job): boolean { return !!this.db.prepare("SELECT 1 FROM inbox_jobs WHERE thread_id = ? AND at = ?").get(job.thread_id, job.at); }
  get(id: string): Update | null { return this.db.prepare("SELECT * FROM inbox_updates WHERE thread_id = ?").get(id) as Update | undefined ?? null; }
  list(): Update[] { return this.db.prepare("SELECT * FROM inbox_updates ORDER BY at DESC").all() as Update[]; }
  finish(job: Job, result?: { headline: string; urgent: boolean; readAt: number | null; filtered?: boolean }) {
    return this.db.transaction(() => {
      if (!this.current(job)) return false;
      if (result) this.db.prepare(`INSERT INTO inbox_updates VALUES (@thread_id, @at, @headline, @body, @urgent, @readAt, @filtered)
        ON CONFLICT(thread_id) DO UPDATE SET at = excluded.at, headline = excluded.headline,
        body = excluded.body, urgent = excluded.urgent, read_at = excluded.read_at, filtered = excluded.filtered`).run({ ...job, ...result, urgent: Number(result.urgent), filtered: Number(result.filtered !== false) });
      this.db.prepare("INSERT INTO inbox_checkpoints VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET at = MAX(at, excluded.at)").run(job.thread_id, job.at);
      this.db.prepare("DELETE FROM inbox_jobs WHERE thread_id = ? AND at = ?").run(job.thread_id, job.at);
      return true;
    })();
  }
  read(id: string, at: number) { this.db.prepare("UPDATE inbox_updates SET read_at = ? WHERE thread_id = ? AND at <= ?").run(at, id, at); }
  remove(id: string) {
    for (const table of ["inbox_jobs", "inbox_updates", "inbox_checkpoints"]) this.db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(id);
  }
}
