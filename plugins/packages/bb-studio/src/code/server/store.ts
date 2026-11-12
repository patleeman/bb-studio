// Workspaces: a title, the project it belongs to, and the
// folders it opens.
import { newId } from "../../kit/ids";
import type Database from "better-sqlite3";
import { ID_PREFIX, type Workspace } from "../shared";


export { MIGRATIONS } from "../../kit/code-migrations";

type Row = { id: string; title: string; project_id: string | null; thread_id: string | null; folder_key: string | null; trusted: number; share: number; folders: string; archived: number; created_at: number; updated_at: number };

function decode(row: Row): Workspace {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    threadId: row.thread_id,
    folderKey: row.folder_key ?? null,
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

  /** The live workspace of a folder (`env:<id>` or `project:<id>`), whichever thread opened it first. */
  forFolder(key: string): Workspace | null {
    const row = this.db.prepare("SELECT * FROM code_workspaces WHERE folder_key = ? AND archived = 0 ORDER BY created_at ASC LIMIT 1").get(key) as Row | undefined;
    return row ? decode(row) : null;
  }

  /** An older per-thread workspace becomes its folder's: the next thread on that folder gets the same one. */
  adopt(id: string, key: string, title: string): Workspace {
    this.db.prepare("UPDATE code_workspaces SET folder_key = ?, title = ?, updated_at = ? WHERE id = ?").run(key, title, Date.now(), id);
    return this.get(id)!;
  }

  /** The live workspace made for one thread, from before workspaces were shared by folder. */
  forThread(threadId: string): Workspace | null {
    const row = this.db.prepare("SELECT * FROM code_workspaces WHERE thread_id = ? AND archived = 0 ORDER BY created_at DESC LIMIT 1").get(threadId) as Row | undefined;
    return row ? decode(row) : null;
  }

  /**
   * The workspace's current thread, where its review and questions go: the
   * one whose VS Code tab last showed it (or that last used it), else the
   * thread it was made for.
   */
  reviewThread(id: string): string | null {
    const row = this.db.prepare("SELECT thread_id, review_thread_id FROM code_workspaces WHERE id = ?").get(id) as { thread_id: string | null; review_thread_id: string | null } | undefined;
    return row?.review_thread_id ?? row?.thread_id ?? null;
  }

  setReviewThread(id: string, threadId: string): void {
    this.db.prepare("UPDATE code_workspaces SET review_thread_id = ? WHERE id = ?").run(threadId, id);
  }

  /** The live workspace opened last; one never opened counts from its last change. */
  recent(): Workspace | null {
    const row = this.db.prepare("SELECT * FROM code_workspaces WHERE archived = 0 ORDER BY COALESCE(opened_at, updated_at) DESC LIMIT 1").get() as Row | undefined;
    return row ? decode(row) : null;
  }

  /** The live workspaces, the one opened last first. */
  recents(limit = 50): Workspace[] {
    return (this.db.prepare("SELECT * FROM code_workspaces WHERE archived = 0 ORDER BY COALESCE(opened_at, updated_at) DESC LIMIT ?").all(limit) as Row[]).map(decode);
  }

  markOpened(id: string): void {
    this.db.prepare("UPDATE code_workspaces SET opened_at = ? WHERE id = ?").run(Date.now(), id);
  }

  create(input: { title: string; projectId: string | null; folders: string[]; threadId?: string | null; folderKey?: string | null; trusted?: boolean }): Workspace {
    const now = Date.now();
    const id = newId(ID_PREFIX);
    this.db
      .prepare("INSERT INTO code_workspaces (id, title, project_id, thread_id, folder_key, trusted, folders, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)")
      .run(id, input.title, input.projectId, input.threadId ?? null, input.folderKey ?? null, input.trusted === false ? 0 : 1, JSON.stringify(input.folders), now, now);
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
