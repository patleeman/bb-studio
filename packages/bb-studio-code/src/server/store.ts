// Workspaces: a title, the project (and so the Space) it belongs to, and the
// folders it opens.
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import { ID_PREFIX, type Workspace } from "../shared";

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS code_workspaces (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT, folders TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS code_workspaces_updated ON code_workspaces(updated_at);`,
];

type Row = { id: string; title: string; project_id: string | null; folders: string; archived: number; created_at: number; updated_at: number };

function decode(row: Row): Workspace {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
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

  create(input: { title: string; projectId: string | null; folders: string[] }): Workspace {
    const now = Date.now();
    const id = newId(ID_PREFIX);
    this.db
      .prepare("INSERT INTO code_workspaces (id, title, project_id, folders, archived, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .run(id, input.title, input.projectId, JSON.stringify(input.folders), now, now);
    return this.get(id)!;
  }

  update(id: string, changes: Partial<Pick<Workspace, "title" | "projectId" | "folders" | "archived">>): Workspace {
    const current = this.get(id);
    if (!current) throw new Error("Workspace not found.");
    const next = { ...current, ...changes };
    this.db
      .prepare("UPDATE code_workspaces SET title = ?, project_id = ?, folders = ?, archived = ?, updated_at = ? WHERE id = ?")
      .run(next.title, next.projectId, JSON.stringify(next.folders), next.archived ? 1 : 0, Date.now(), id);
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM code_workspaces WHERE id = ?").run(id);
  }
}
