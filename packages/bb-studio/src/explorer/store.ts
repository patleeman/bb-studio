// The Explorer's filing (the `folders` and `filing` tables): folders the
// user or an agent makes inside a project (or inside "No project"), and which
// folder each thread and item sits in.
//
// - A folder belongs to one project (`project_id` null = No project) and may
//   sit inside another folder of the same project.
// - A filing row puts one thread or item in a folder. `folder_id` null is the
//   root of the thing's project, said on purpose: it is what a user's drag to
//   the project folder leaves, so auto-filing knows to keep away. A thing
//   with no row also sits at the root.
// - A row the user made (`filed_by` 'user') is never changed by an agent's
//   automatic filing; only the user or the explorer_file tool moves it.
// - Deleting a folder moves its folders and filings up to its parent.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export type FilingKind = "thread" | "item";
export type FiledBy = "user" | "agent" | "auto";
export interface FilingTarget { kind: FilingKind; id: string }

export interface Folder {
  id: string;
  projectId: string | null;
  parentId: string | null;
  name: string;
  createdAt: number;
  sort: number;
}

export interface Filing {
  kind: FilingKind;
  id: string;
  folderId: string | null;
  filedBy: FiledBy;
  filedAt: number;
}

export const FOLDER_NAME_MAX = 120;
/** Folders nest this deep at most, so a path stays readable and a loop in the data can't hang a walk. */
export const FOLDER_DEPTH_MAX = 12;

type FolderRow = { id: string; project_id: string | null; parent_id: string | null; name: string; created_at: number; sort: number };
type FilingRow = { target_kind: FilingKind; target_id: string; folder_id: string | null; filed_by: FiledBy; filed_at: number };
const folder = (row: FolderRow): Folder => ({ id: row.id, projectId: row.project_id, parentId: row.parent_id, name: row.name, createdAt: row.created_at, sort: row.sort });
const filing = (row: FilingRow): Filing => ({ kind: row.target_kind, id: row.target_id, folderId: row.folder_id, filedBy: row.filed_by, filedAt: row.filed_at });

/** A folder name as stored: trimmed, one line, no slashes (a slash separates a path's folders). */
export function folderName(raw: string): string {
  const name = raw.replace(/[\r\n\t]+/g, " ").replace(/\//g, "-").trim().slice(0, FOLDER_NAME_MAX);
  if (!name) throw new Error("A folder needs a name.");
  return name;
}

export class ExplorerStore {
  constructor(private readonly db: Database.Database) {}

  folders(): Folder[] {
    return (this.db.prepare("SELECT * FROM folders ORDER BY sort, created_at, id").all() as FolderRow[]).map(folder);
  }

  filings(): Filing[] {
    return (this.db.prepare("SELECT * FROM filing").all() as FilingRow[]).map(filing);
  }

  folder(id: string): Folder | null {
    const row = this.db.prepare("SELECT * FROM folders WHERE id = ?").get(id) as FolderRow | undefined;
    return row ? folder(row) : null;
  }

  filingOf(target: FilingTarget): Filing | null {
    const row = this.db.prepare("SELECT * FROM filing WHERE target_kind = ? AND target_id = ?").get(target.kind, target.id) as FilingRow | undefined;
    return row ? filing(row) : null;
  }

  /** The folders from the project's root down to `id`, or [] for an unknown folder. */
  path(id: string): Folder[] {
    const path: Folder[] = [];
    for (let at = this.folder(id); at && path.length <= FOLDER_DEPTH_MAX; at = at.parentId ? this.folder(at.parentId) : null) path.unshift(at);
    return path;
  }

  private sibling(projectId: string | null, parentId: string | null, name: string, except?: string): Folder | null {
    const row = this.db.prepare("SELECT * FROM folders WHERE project_id IS ? AND parent_id IS ? AND name = ? COLLATE NOCASE AND id IS NOT ?").get(projectId, parentId, name, except ?? null) as FolderRow | undefined;
    return row ? folder(row) : null;
  }

  /** Makes a folder in a project's root or inside `parentId` (whose project it takes). Two folders side by side can't share a name. */
  createFolder(input: { projectId: string | null; parentId: string | null; name: string }, now = Date.now()): Folder {
    const name = folderName(input.name);
    const parent = input.parentId ? this.folder(input.parentId) : null;
    if (input.parentId && !parent) throw new Error("That folder is gone.");
    const projectId = parent ? parent.projectId : input.projectId;
    if (parent && this.path(parent.id).length >= FOLDER_DEPTH_MAX) throw new Error("Folders can't nest deeper than that.");
    if (this.sibling(projectId, parent?.id ?? null, name)) throw new Error(`There is already a folder called "${name}" here.`);
    const id = `fld_${randomBytes(8).toString("hex")}`;
    const sort = (this.db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM folders WHERE project_id IS ? AND parent_id IS ?").get(projectId, parent?.id ?? null) as { next: number }).next;
    this.db.prepare("INSERT INTO folders (id, project_id, parent_id, name, created_at, sort) VALUES (?, ?, ?, ?, ?, ?)").run(id, projectId, parent?.id ?? null, name, now, sort);
    return this.folder(id)!;
  }

  renameFolder(id: string, rawName: string): Folder {
    const current = this.folder(id);
    if (!current) throw new Error("That folder is gone.");
    const name = folderName(rawName);
    if (this.sibling(current.projectId, current.parentId, name, id)) throw new Error(`There is already a folder called "${name}" here.`);
    this.db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, id);
    return this.folder(id)!;
  }

  /** Moves a folder to its project's root (`parentId` null) or into another folder of the same project, never into itself. */
  moveFolder(id: string, parentId: string | null): Folder {
    const current = this.folder(id);
    if (!current) throw new Error("That folder is gone.");
    const parent = parentId ? this.folder(parentId) : null;
    if (parentId && !parent) throw new Error("That folder is gone.");
    if (parent) {
      if (parent.projectId !== current.projectId) throw new Error("A folder stays in its project.");
      const above = this.path(parent.id);
      if (above.some((each) => each.id === id)) throw new Error("A folder can't move into itself.");
      if (above.length + this.depthBelow(id) > FOLDER_DEPTH_MAX) throw new Error("Folders can't nest deeper than that.");
    }
    if (this.sibling(current.projectId, parent?.id ?? null, current.name, id)) throw new Error(`There is already a folder called "${current.name}" there.`);
    this.db.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").run(parent?.id ?? null, id);
    return this.folder(id)!;
  }

  /** How many levels `id` spans, itself included. */
  private depthBelow(id: string, seen = new Set<string>()): number {
    if (seen.has(id) || seen.size > 10_000) return 1;
    seen.add(id);
    const children = this.db.prepare("SELECT id FROM folders WHERE parent_id = ?").all(id) as { id: string }[];
    return 1 + Math.max(0, ...children.map((child) => this.depthBelow(child.id, seen)));
  }

  /**
   * Deletes one folder. Its folders and filings move up to its parent (the
   * project's root when it had none) and keep who filed them. A folder moving
   * up beside one of the same name gets " (2)" so both stay.
   */
  deleteFolder(id: string): boolean {
    const current = this.folder(id);
    if (!current) return false;
    this.db.transaction(() => {
      const children = (this.db.prepare("SELECT * FROM folders WHERE parent_id = ?").all(id) as FolderRow[]).map(folder);
      for (const child of children) {
        let name = child.name;
        for (let n = 2; this.sibling(current.projectId, current.parentId, name, child.id); n += 1) name = `${child.name} (${n})`;
        this.db.prepare("UPDATE folders SET parent_id = ?, name = ? WHERE id = ?").run(current.parentId, name, child.id);
      }
      this.db.prepare("UPDATE filing SET folder_id = ? WHERE folder_id = ?").run(current.parentId, id);
      this.db.prepare("DELETE FROM folders WHERE id = ?").run(id);
    })();
    return true;
  }

  /**
   * Puts things in a folder, or at their project's root (`folderId` null).
   * Automatic filing ('auto') leaves alone what the user placed; it answers
   * which targets it filed.
   */
  file(targets: readonly FilingTarget[], folderId: string | null, filedBy: FiledBy, now = Date.now()): FilingTarget[] {
    if (folderId && !this.folder(folderId)) throw new Error("That folder is gone.");
    const done: FilingTarget[] = [];
    const put = this.db.prepare(`INSERT INTO filing (target_kind, target_id, folder_id, filed_by, filed_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(target_kind, target_id) DO UPDATE SET folder_id = excluded.folder_id, filed_by = excluded.filed_by, filed_at = excluded.filed_at`);
    this.db.transaction(() => {
      for (const target of targets) {
        if (filedBy === "auto" && this.filingOf(target)?.filedBy === "user") continue;
        put.run(target.kind, target.id, folderId, filedBy, now);
        done.push(target);
      }
    })();
    return done;
  }

  /** Forgets where things were filed: they sit at their project's root again, and auto-filing may place them. */
  unfile(targets: readonly FilingTarget[]): number {
    const drop = this.db.prepare("DELETE FROM filing WHERE target_kind = ? AND target_id = ?");
    let removed = 0;
    this.db.transaction(() => { for (const target of targets) removed += drop.run(target.kind, target.id).changes; })();
    return removed;
  }

  /** The folder at `names` under a project's root, making the ones that are missing. Names match without case. */
  ensurePath(projectId: string | null, names: readonly string[], now = Date.now()): Folder {
    if (!names.length) throw new Error("A path needs at least one folder.");
    if (names.length > FOLDER_DEPTH_MAX) throw new Error("Folders can't nest deeper than that.");
    return this.db.transaction(() => {
      let parentId: string | null = null;
      let last: Folder | null = null;
      for (const raw of names) {
        const name = folderName(raw);
        last = this.sibling(projectId, parentId, name) ?? this.createFolder({ projectId, parentId, name }, now);
        parentId = last.id;
      }
      return last!;
    })();
  }
}
