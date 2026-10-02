// Explore's explainers, their jobs, and each project's "Explore" parent page.
import { createHash } from "node:crypto";
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import { ACTIVE_JOB_STATUSES, STAGES, labelKey, type ExploreItem, type JobStatus } from "./shared";

export type ExplainerStatus = "pending" | "generating" | "ready" | "error";
export type JobKind = "generate" | "regenerate";

export type ExplainerRow = {
  id: string;
  key: string;
  parent_id: string | null;
  thread_id: string;
  message_id: string;
  turn_id: string | null;
  emoji: string;
  label: string;
  page_id: string | null;
  project_id: string | null;
  status: ExplainerStatus;
  /** JSON array of ExploreItem. */
  follow_ups: string;
  generated_at: number | null;
  regenerated_at: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type JobRow = {
  id: string;
  explainer_id: string;
  kind: JobKind;
  status: JobStatus;
  label: string;
  detail: string;
  progress: number;
  worker_thread_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

/** A finding an agent ended a reply with, kept for the Feed: saved there, or listed in the daily digest. */
export type FindingRow = {
  id: string;
  /** The explainer key it would have. */
  key: string;
  thread_id: string;
  message_id: string;
  turn_id: string | null;
  emoji: string;
  label: string;
  project_id: string | null;
  thread_title: string;
  created_at: number;
  /** The Feed post it was saved as. */
  post_id: string | null;
  /** The explainer page that post links to. */
  linked_page_id: string | null;
  digested_at: number | null;
};

export type JobPatch = Partial<Pick<JobRow, "status" | "label" | "detail" | "progress" | "worker_thread_id" | "error">>;

/** The same finding in the same message (under the same parent) is one explainer. */
export function explainerKey(input: { threadId: string; messageId: string; label: string; parentId?: string | null }): string {
  return createHash("sha256")
    .update(JSON.stringify([input.threadId, input.messageId, labelKey(input.label), input.parentId ?? ""]))
    .digest("hex");
}



const ACTIVE_SQL = ACTIVE_JOB_STATUSES.map((status) => `'${status}'`).join(", ");

export function parseFollowUps(value: string): ExploreItem[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: unknown) => {
      if (typeof item !== "object" || item === null) return [];
      const { emoji, label } = item as Record<string, unknown>;
      return typeof emoji === "string" && typeof label === "string" ? [{ emoji, label }] : [];
    });
  } catch {
    return [];
  }
}

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS explore_explainers (
     id TEXT PRIMARY KEY,
     key TEXT NOT NULL UNIQUE,
     parent_id TEXT,
     thread_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     turn_id TEXT,
     emoji TEXT NOT NULL,
     label TEXT NOT NULL,
     page_id TEXT,
     project_id TEXT,
     status TEXT NOT NULL,
     follow_ups TEXT NOT NULL DEFAULT '[]',
     generated_at INTEGER,
     regenerated_at INTEGER,
     error TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS explore_explainers_message ON explore_explainers (thread_id, message_id)`,
  `CREATE INDEX IF NOT EXISTS explore_explainers_page ON explore_explainers (page_id)`,
  `CREATE TABLE IF NOT EXISTS explore_jobs (
     id TEXT PRIMARY KEY,
     explainer_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     status TEXT NOT NULL,
     label TEXT NOT NULL,
     detail TEXT NOT NULL,
     progress INTEGER NOT NULL,
     worker_thread_id TEXT,
     error TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS explore_jobs_explainer ON explore_jobs (explainer_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS explore_parents (
     project_key TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS explore_findings (
     id TEXT PRIMARY KEY,
     key TEXT NOT NULL UNIQUE,
     thread_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     turn_id TEXT,
     emoji TEXT NOT NULL,
     label TEXT NOT NULL,
     project_id TEXT,
     thread_title TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     post_id TEXT,
     linked_page_id TEXT,
     digested_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS explore_findings_digest ON explore_findings (digested_at, created_at);
   CREATE INDEX IF NOT EXISTS explore_findings_post ON explore_findings (post_id);
   CREATE TABLE IF NOT EXISTS explore_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

export class ExploreStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {}

  // ----- explainers -----

  explainer(id: string): ExplainerRow | undefined {
    return this.db.prepare("SELECT * FROM explore_explainers WHERE id = ?").get(id) as ExplainerRow | undefined;
  }

  byKey(key: string): ExplainerRow | undefined {
    return this.db.prepare("SELECT * FROM explore_explainers WHERE key = ?").get(key) as ExplainerRow | undefined;
  }

  forMessage(threadId: string, messageId: string, parentId: string | null): ExplainerRow[] {
    return this.db
      .prepare("SELECT * FROM explore_explainers WHERE thread_id = ? AND message_id = ? AND COALESCE(parent_id, '') = ? ORDER BY created_at")
      .all(threadId, messageId, parentId ?? "") as ExplainerRow[];
  }

  children(parentId: string): ExplainerRow[] {
    return this.db.prepare("SELECT * FROM explore_explainers WHERE parent_id = ? ORDER BY created_at").all(parentId) as ExplainerRow[];
  }

  list(options: { threadId?: string; limit?: number } = {}): ExplainerRow[] {
    const limit = options.limit ?? 50;
    if (options.threadId) {
      return this.db.prepare("SELECT * FROM explore_explainers WHERE thread_id = ? ORDER BY updated_at DESC LIMIT ?").all(options.threadId, limit) as ExplainerRow[];
    }
    return this.db.prepare("SELECT * FROM explore_explainers ORDER BY updated_at DESC LIMIT ?").all(limit) as ExplainerRow[];
  }

  createExplainer(input: {
    key: string;
    parentId: string | null;
    threadId: string;
    messageId: string;
    turnId: string | null;
    emoji: string;
    label: string;
    projectId: string | null;
  }): ExplainerRow {
    const at = this.now();
    const id = newId("exp");
    this.db
      .prepare(
        `INSERT INTO explore_explainers (id, key, parent_id, thread_id, message_id, turn_id, emoji, label, project_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(id, input.key, input.parentId, input.threadId, input.messageId, input.turnId, input.emoji, input.label, input.projectId, at, at);
    return this.explainer(id)!;
  }

  setStatus(id: string, status: ExplainerStatus, error: string | null = null): void {
    this.db.prepare("UPDATE explore_explainers SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(status, error, this.now(), id);
  }

  /** A generation finished: the page, when it was written, and what it found next. */
  saved(id: string, input: { pageId: string; projectId: string | null; followUps: ExploreItem[]; regenerated: boolean }): ExplainerRow {
    const at = this.now();
    this.db
      .prepare(
        `UPDATE explore_explainers SET page_id = ?, project_id = ?, follow_ups = ?, status = 'ready', error = NULL,
           generated_at = CASE WHEN ? THEN generated_at ELSE ? END,
           regenerated_at = CASE WHEN ? THEN ? ELSE regenerated_at END,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(input.pageId, input.projectId, JSON.stringify(input.followUps), input.regenerated ? 1 : 0, at, input.regenerated ? 1 : 0, at, at, id);
    return this.explainer(id)!;
  }

  /** The page was deleted: forget it so the next click writes a new one. A running job keeps its status. */
  forgetPage(id: string): void {
    this.db
      .prepare(
        `UPDATE explore_explainers SET page_id = NULL, status = CASE WHEN status = 'generating' THEN status ELSE 'pending' END,
           generated_at = NULL, regenerated_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(this.now(), id);
  }

  /** Pages were deleted: forgets them as explainer pages and Explore parents. Returns the explainers that had one. */
  forgetPages(pageIds: readonly string[]): string[] {
    if (!pageIds.length) return [];
    const marks = pageIds.map(() => "?").join(", ");
    const ids = (this.db.prepare(`SELECT id FROM explore_explainers WHERE page_id IN (${marks})`).all(...pageIds) as { id: string }[]).map((row) => row.id);
    this.db.transaction(() => {
      for (const id of ids) this.forgetPage(id);
      this.db.prepare(`DELETE FROM explore_parents WHERE page_id IN (${marks})`).run(...pageIds);
    })();
    return ids;
  }

  // ----- jobs -----

  job(id: string): JobRow | undefined {
    return this.db.prepare("SELECT * FROM explore_jobs WHERE id = ?").get(id) as JobRow | undefined;
  }

  activeJob(explainerId: string): JobRow | undefined {
    return this.db
      .prepare(`SELECT * FROM explore_jobs WHERE explainer_id = ? AND status IN (${ACTIVE_SQL}) ORDER BY created_at DESC LIMIT 1`)
      .get(explainerId) as JobRow | undefined;
  }

  latestJob(explainerId: string): JobRow | undefined {
    return this.db.prepare("SELECT * FROM explore_jobs WHERE explainer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(explainerId) as JobRow | undefined;
  }

  createJob(explainerId: string, kind: JobKind): JobRow {
    const at = this.now();
    const id = newId("job");
    this.db
      .prepare(
        `INSERT INTO explore_jobs (id, explainer_id, kind, status, label, detail, progress, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, 'Waiting to start.', ?, ?, ?)`,
      )
      .run(id, explainerId, kind, STAGES.queued.label, STAGES.queued.progress, at, at);
    return this.job(id)!;
  }

  /** A stopped job stays stopped: late progress from its worker is ignored. */
  updateJob(id: string, patch: JobPatch): JobRow | undefined {
    const current = this.job(id);
    if (!current) return undefined;
    if (!ACTIVE_JOB_STATUSES.includes(current.status)) return current;
    const next = { ...current, ...patch };
    this.db
      .prepare("UPDATE explore_jobs SET status = ?, label = ?, detail = ?, progress = ?, worker_thread_id = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(next.status, next.label, next.detail, Math.max(0, Math.min(100, Math.round(next.progress))), next.worker_thread_id, next.error, this.now(), id);
    return this.job(id);
  }

  /**
   * Jobs run in this process; after a restart nothing is running them. Marks
   * them interrupted and returns the explainers they belonged to, and the
   * workers they had started.
   */
  interruptActiveJobs(): { explainerIds: string[]; workerIds: string[] } {
    const at = this.now();
    const rows = this.db.prepare(`SELECT id, explainer_id, worker_thread_id FROM explore_jobs WHERE status IN (${ACTIVE_SQL})`).all() as {
      id: string;
      explainer_id: string;
      worker_thread_id: string | null;
    }[];
    if (!rows.length) return { explainerIds: [], workerIds: [] };
    const interrupt = this.db.prepare(
      "UPDATE explore_jobs SET status = 'interrupted', label = ?, detail = 'BB restarted before this finished.', error = 'Interrupted by a restart.', updated_at = ? WHERE id = ?",
    );
    const settle = this.db.prepare(
      `UPDATE explore_explainers SET status = CASE WHEN page_id IS NULL THEN 'error' ELSE 'ready' END,
         error = CASE WHEN page_id IS NULL THEN 'Interrupted by a restart.' ELSE error END, updated_at = ?
       WHERE id = ? AND status = 'generating'`,
    );
    this.db.transaction(() => {
      for (const row of rows) {
        interrupt.run(STAGES.interrupted.label, at, row.id);
        settle.run(at, row.explainer_id);
      }
    })();
    return {
      explainerIds: [...new Set(rows.map((row) => row.explainer_id))],
      workerIds: rows.flatMap((row) => (row.worker_thread_id ? [row.worker_thread_id] : [])),
    };
  }

  // ----- the "Explore" parent page per project -----

  // ----- findings, for the Feed -----

  /** Keeps a finding; one already kept is returned as it is. */
  addFinding(input: { threadId: string; messageId: string; turnId: string | null; emoji: string; label: string; projectId: string | null; threadTitle: string }): FindingRow {
    const key = explainerKey({ threadId: input.threadId, messageId: input.messageId, label: input.label });
    this.db
      .prepare(
        `INSERT INTO explore_findings (id, key, thread_id, message_id, turn_id, emoji, label, project_id, thread_title, created_at)
         VALUES (@id, @key, @threadId, @messageId, @turnId, @emoji, @label, @projectId, @threadTitle, @now)
         ON CONFLICT(key) DO NOTHING`,
      )
      .run({ ...input, id: newId("fnd"), key, now: this.now() });
    return this.findingByKey(key)!;
  }

  findingByKey(key: string): FindingRow | undefined {
    return this.db.prepare("SELECT * FROM explore_findings WHERE key = ?").get(key) as FindingRow | undefined;
  }

  findingByPost(postId: string): FindingRow | undefined {
    return this.db.prepare("SELECT * FROM explore_findings WHERE post_id = ?").get(postId) as FindingRow | undefined;
  }

  findingsForMessage(threadId: string, messageId: string): FindingRow[] {
    return this.db.prepare("SELECT * FROM explore_findings WHERE thread_id = ? AND message_id = ?").all(threadId, messageId) as FindingRow[];
  }

  setFindingPost(id: string, postId: string | null, linkedPageId: string | null): void {
    this.db.prepare("UPDATE explore_findings SET post_id = ?, linked_page_id = ? WHERE id = ?").run(postId, linkedPageId, id);
  }

  /** Findings for the digest: not digested, not saved, not explored, since `since`; oldest first. */
  undigested(since: number): FindingRow[] {
    return this.db
      .prepare(
        `SELECT f.* FROM explore_findings f
         WHERE f.digested_at IS NULL AND f.post_id IS NULL AND f.created_at >= ?
           AND NOT EXISTS (SELECT 1 FROM explore_explainers e WHERE e.key = f.key)
         ORDER BY f.created_at`,
      )
      .all(since) as FindingRow[];
  }

  markDigested(ids: readonly string[]): void {
    const mark = this.db.prepare("UPDATE explore_findings SET digested_at = ? WHERE id = ?");
    const at = this.now();
    this.db.transaction(() => ids.forEach((id) => mark.run(at, id)))();
  }

  meta(key: string): string | null {
    return (this.db.prepare("SELECT value FROM explore_meta WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO explore_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  parentPage(projectId: string | null): string | null {
    const row = this.db.prepare("SELECT page_id FROM explore_parents WHERE project_key = ?").get(projectId ?? "") as { page_id: string } | undefined;
    return row?.page_id ?? null;
  }

  setParentPage(projectId: string | null, pageId: string | null): void {
    if (pageId === null) {
      this.db.prepare("DELETE FROM explore_parents WHERE project_key = ?").run(projectId ?? "");
      return;
    }
    this.db
      .prepare("INSERT INTO explore_parents (project_key, page_id, created_at) VALUES (?, ?, ?) ON CONFLICT (project_key) DO UPDATE SET page_id = excluded.page_id")
      .run(projectId ?? "", pageId, this.now());
  }
}
