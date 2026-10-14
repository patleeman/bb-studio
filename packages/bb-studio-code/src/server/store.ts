// Workspaces: a title, the project it belongs to, and the
// folders it opens.
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import { ID_PREFIX, type Workspace } from "../shared";
import { COMMENT_MIGRATIONS } from "./comments";

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS code_workspaces (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT, folders TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS code_workspaces_updated ON code_workspaces(updated_at);`,
  `ALTER TABLE code_workspaces ADD COLUMN thread_id TEXT; CREATE INDEX IF NOT EXISTS code_workspaces_thread ON code_workspaces(thread_id);`,
  // Workspaces made so far were made by the user, so they stay trusted.
  `ALTER TABLE code_workspaces ADD COLUMN trusted INTEGER NOT NULL DEFAULT 1;`,
  // Whether agents may see what the user has open in this workspace.
  `ALTER TABLE code_workspaces ADD COLUMN share INTEGER NOT NULL DEFAULT 1;`,
  // When the user last opened the workspace's editor: Code's page opens the latest.
  `ALTER TABLE code_workspaces ADD COLUMN opened_at INTEGER;`,
  // Review comments (src/server/comments.ts).
  ...COMMENT_MIGRATIONS,
];

type Row = { id: string; title: string; project_id: string | null; thread_id: string | null; trusted: number; share: number; folders: string; archived: number; created_at: number; updated_at: number };

function decode(row: Row): Workspace {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    threadId: row.thread_id,
    trusted: row.trusted === 1,
    share: row.share !== 0,
    folders: JSON.parse(row.folders) as string[],
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WorkspaceStore {
  constructor(private readonly db: Database.Database) {}

  list(): Workspace[] {
    return (this.db.prepare("SELECT * FROM code_workspaces ORDER BY updated_at DESC").all() as Row[]).map(decode);
  }

  get(id: string): Workspace | null {
    const row = this.db.prepare("SELECT * FROM code_workspaces WHERE id = ?").get(id) as Row | undefined;
    return row ? decode(row) : null;
  }

  /** The live workspace made for a thread's worktree. */
  forThread(threadId: string): Workspace | null {
    const row = this.db.prepare("SELECT * FROM code_workspaces WHERE thread_id = ? AND archived = 0 ORDER BY created_at DESC LIMIT 1").get(threadId) as Row | undefined;
    return row ? decode(row) : null;
  }

  /**
   * The workspace Code's page opens: the one last opened (or else changed),
   * live and with folders. A thread's worktree workspace only when nothing else.
   */
  recent(): Workspace | null {
    const row = this.db
      .prepare("SELECT * FROM code_workspaces WHERE archived = 0 AND folders != '[]' ORDER BY thread_id IS NOT NULL, COALESCE(opened_at, updated_at) DESC LIMIT 1")
      .get() as Row | undefined;
    return row ? decode(row) : null;
  }

  /** Workspaces not archived, the one last opened first: Code's switcher. */
  recentList(): Workspace[] {
    return (this.db
      .prepare("SELECT * FROM code_workspaces WHERE archived = 0 ORDER BY COALESCE(opened_at, updated_at) DESC")
      .all() as Row[]).map(decode);
  }

  /** The thread a workspace's review goes to: its own thread, else the one whose VS Code tab last showed it. */
  reviewThread(id: string): string | null {
    const row = this.db.prepare("SELECT thread_id, review_thread_id FROM code_workspaces WHERE id = ?").get(id) as { thread_id: string | null; review_thread_id: string | null } | undefined;
    return row?.thread_id ?? row?.review_thread_id ?? null;
  }

  setReviewThread(id: string, threadId: string): void {
    this.db.prepare("UPDATE code_workspaces SET review_thread_id = ? WHERE id = ?").run(threadId, id);
  }

  markOpened(id: string): void {
    this.db.prepare("UPDATE code_workspaces SET opened_at = ? WHERE id = ?").run(Date.now(), id);
  }

  create(input: { title: string; projectId: string | null; folders: string[]; threadId?: string | null; trusted?: boolean }): Workspace {
    const now = Date.now();
    const id = newId(ID_PREFIX);
    this.db
      .prepare("INSERT INTO code_workspaces (id, title, project_id, thread_id, trusted, folders, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
      .run(id, input.title, input.projectId, input.threadId ?? null, input.trusted === false ? 0 : 1, JSON.stringify(input.folders), now, now);
    return this.get(id)!;
  }

  update(id: string, changes: Partial<Pick<Workspace, "title" | "projectId" | "folders" | "archived" | "trusted" | "share">>): Workspace {
    const current = this.get(id);
    if (!current) throw new Error("Workspace not found.");
    const next = { ...current, ...changes };
    this.db
      .prepare("UPDATE code_workspaces SET title = ?, project_id = ?, folders = ?, archived = ?, trusted = ?, share = ?, updated_at = ? WHERE id = ?")
      .run(next.title, next.projectId, JSON.stringify(next.folders), next.archived ? 1 : 0, next.trusted ? 1 : 0, next.share ? 1 : 0, Date.now(), id);
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM code_workspaces WHERE id = ?").run(id);
  }
}
