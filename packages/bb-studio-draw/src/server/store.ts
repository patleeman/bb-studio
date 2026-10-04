import type { Actor } from "@bb-studio/kit/server";
// Drawings in the plugin's SQLite database, stored as serialized Excalidraw
// scenes (the JSON shape Excalidraw's "save to file" uses).
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import { elementCount, parseSceneData, serializeSceneData } from "../../lib/merge";

/**
 * Append-only: statement index is the migration id, and BB checks each
 * statement against the hash it recorded, so never edit one (not even its
 * whitespace).
 */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS drawings (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       data TEXT NOT NULL DEFAULT '{}',
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       project_id TEXT,
       updated_by TEXT,
       archived_at INTEGER,
       template INTEGER NOT NULL DEFAULT 0
     );
   CREATE TABLE IF NOT EXISTS drawing_recovery_copies (
       recovery_key TEXT PRIMARY KEY,
       drawing_id TEXT NOT NULL
     );`,
];

export type DrawingRow = {
  id: string;
  name: string;
  data: string;
  created_at: number;
  updated_at: number;
  project_id: string | null;
  /** "user" or "agent". */
  updated_by: string | null;
  archived_at: number | null;
  template: number;
};

/** Who wrote a change. The CLI counts as an agent: agents are its main users. */
export type Writer = Extract<Actor["kind"], "editor" | "agent" | "cli" | "app">;

export function writerKind(by: Writer): "user" | "agent" {
  return by === "agent" || by === "cli" ? "agent" : "user";
}

export type DrawingMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  elementCount: number;
  projectId: string | null;
  archived: boolean;
};

export function toMeta(row: DrawingRow): DrawingMeta {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    elementCount: elementCount(parseSceneData(row.data)),
    projectId: row.project_id,
    archived: row.archived_at !== null,
  };
}

/** The name to show for a drawing; Studio creates them untitled. */
export function displayName(row: Pick<DrawingRow, "name">): string {
  return row.name.trim() || "Untitled drawing";
}

/** New empty scene in Excalidraw's file shape. */
export function emptySceneData(): string {
  return serializeSceneData({
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });
}

export class DrawingStore {
  setTemplate(id: string, template: boolean): void {
    this.db.prepare("UPDATE drawings SET template = ? WHERE id = ?").run(template ? 1 : 0, id);
  }
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {}

  get(id: string): DrawingRow | null {
    return (this.db.prepare("SELECT * FROM drawings WHERE id = ?").get(id) as DrawingRow | undefined) ?? null;
  }

  list(options: { includeArchived?: boolean; limit?: number } = {}): DrawingRow[] {
    return this.db
      .prepare(
        `SELECT * FROM drawings ${options.includeArchived ? "" : "WHERE archived_at IS NULL"}
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(options.limit ?? -1) as DrawingRow[];
  }

  create(input: { name: string; projectId?: string | null; by: Writer }): DrawingRow {
    const id = newId("drw");
    const at = this.now();
    this.db
      .prepare(
        `INSERT INTO drawings (id, name, data, created_at, updated_at, project_id, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, emptySceneData(), at, at, input.projectId ?? null, writerKind(input.by));
    return this.get(id)!;
  }

  /** One complete copy per durable draft token; deletion explicitly permits recreation. */
  recoverCopy(input: { key: string; name: string; data: string; projectId?: string | null }): { row: DrawingRow; created: boolean } {
    return this.db.transaction(() => {
      const previous = this.db.prepare("SELECT drawing_id FROM drawing_recovery_copies WHERE recovery_key = ?").get(input.key) as { drawing_id: string } | undefined;
      const existing = previous ? this.get(previous.drawing_id) : null;
      if (existing) return { row: existing, created: false };
      const row = this.create({ name: input.name, projectId: input.projectId, by: "editor" });
      this.write(row.id, input.data, "editor");
      this.db.prepare(`INSERT INTO drawing_recovery_copies (recovery_key, drawing_id) VALUES (?, ?)
        ON CONFLICT(recovery_key) DO UPDATE SET drawing_id = excluded.drawing_id`).run(input.key, row.id);
      return { row: this.get(row.id)!, created: true };
    }).immediate();
  }

  /** Writes a scene, bumping updated_at. Returns the new revision. */
  write(id: string, data: string, by: Writer, options: { name?: string } = {}): number {
    const at = this.nextRevision(id);
    this.db
      .prepare("UPDATE drawings SET name = COALESCE(?, name), data = ?, updated_at = ?, updated_by = ? WHERE id = ?")
      .run(options.name ?? null, data, at, writerKind(by), id);
    return at;
  }

  rename(id: string, name: string, by: Writer): number {
    const at = this.nextRevision(id);
    this.db.prepare("UPDATE drawings SET name = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(name, at, writerKind(by), id);
    return at;
  }

  setProject(id: string, projectId: string | null): void {
    this.db.prepare("UPDATE drawings SET project_id = ? WHERE id = ?").run(projectId, id);
  }

  setArchived(id: string, archived: boolean): void {
    this.db.prepare("UPDATE drawings SET archived_at = ? WHERE id = ?").run(archived ? this.now() : null, id);
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM drawings WHERE id = ?").run(id).changes > 0;
  }

  /**
   * Editors ignore revisions they've already seen, so two writes in the
   * same millisecond must still get distinct revisions.
   */
  private nextRevision(id: string): number {
    const current = this.get(id)?.updated_at ?? 0;
    return Math.max(this.now(), current + 1);
  }
}
