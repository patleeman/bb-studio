import type Database from "better-sqlite3";
import { join } from "node:path";
import { OfficeSpaceStore } from "./space-store";
import type { OfficeFolder } from "./contract";

export interface FolderProject {
  id: string; name: string; path: string | null;
}
export interface FolderHost {
  root: string;
  mkdir(path: string): Promise<void>;
  projects(): Promise<FolderProject[]>;
  createProject(name: string, path: string): Promise<FolderProject>;
}

export function folderSlug(name: string): string {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return slug || "folder";
}

/** Core project creation and Studio storage cannot share a transaction. A durable
 * intent reserves the path before creation; retries find the core project by
 * that path. Neither a lost response nor a failed Studio commit creates copies. */
export class FolderService {
  private pending = new Map<string, Promise<OfficeFolder>>();
  constructor(private readonly db: Database.Database, private readonly spaces: OfficeSpaceStore, private readonly host: FolderHost) {
    db.exec(`CREATE TABLE IF NOT EXISTS office_folder_intents (
      space_id TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, path TEXT NOT NULL UNIQUE,
      project_id TEXT, PRIMARY KEY(space_id,name)
    );
    CREATE TABLE IF NOT EXISTS office_folder_archives (project_id TEXT PRIMARY KEY, archived_at INTEGER NOT NULL);`);
  }

  async list(spaceId: string): Promise<OfficeFolder[]> {
    const projects = await this.host.projects();
    this.spaces.reconcileProjects(projects.map(p => p.id));
    const space = this.spaces.get(spaceId);
    return projects.filter(p => space.projectIds.includes(p.id)).map(p => ({
      ...p, spaceId, archived: !!this.db.prepare("SELECT 1 FROM office_folder_archives WHERE project_id=?").get(p.id),
      isDefault: space.defaultProjectId === p.id,
    }));
  }

  create(spaceId: string, rawName: string): Promise<OfficeFolder> {
    const name = rawName.trim();
    if (!name || name.length > 100) return Promise.reject(new Error("A folder needs a name of at most 100 characters."));
    const key = `${spaceId}:${name.toLowerCase()}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = this.createOnce(spaceId, name).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private async createOnce(spaceId: string, name: string): Promise<OfficeFolder> {
    const space = this.spaces.get(spaceId);
    let intent = this.db.prepare("SELECT path,project_id FROM office_folder_intents WHERE space_id=? AND name=? COLLATE NOCASE").get(spaceId, name) as { path: string; project_id: string | null } | undefined;
    if (!intent) {
      // The id suffix prevents renamed spaces and equal slugs sharing directories.
      const base = join(this.host.root, `${folderSlug(space.name)}-${space.id}`, folderSlug(name));
      let path = base;
      for (let n = 2; this.db.prepare("SELECT 1 FROM office_folder_intents WHERE path=?").get(path); n++) path = `${base}-${n}`;
      this.db.prepare("INSERT INTO office_folder_intents(space_id,name,path) VALUES (?,?,?)").run(spaceId, name, path);
      intent = { path, project_id: null };
    }
    await this.host.mkdir(intent.path);
    const projects = await this.host.projects();
    let project = projects.find(p => p.id === intent.project_id || p.path === intent.path);
    if (!project) project = await this.host.createProject(name, intent.path);
    this.db.transaction(() => {
      this.spaces.moveProject(project.id, spaceId);
      this.db.prepare("UPDATE office_folder_intents SET project_id=? WHERE space_id=? AND name=? COLLATE NOCASE").run(project.id, spaceId, name);
    })();
    return { ...project, spaceId, archived: !!this.db.prepare("SELECT 1 FROM office_folder_archives WHERE project_id=?").get(project.id), isDefault: this.spaces.get(spaceId).defaultProjectId === project.id };
  }

  async ensureCatchAll(spaceId: string): Promise<void> {
    const space = this.spaces.get(spaceId);
    if (space.defaultProjectId) return;
    const folder = await this.create(spaceId, "General");
    this.spaces.setCatchAll(spaceId, folder.id);
  }

  async archive(projectId: string): Promise<void> {
    if (!(await this.host.projects()).some(p => p.id === projectId)) throw new Error("That folder no longer exists.");
    const space = this.spaces.forProject(projectId);
    if (space.defaultProjectId === projectId) throw new Error("A Space's catch-all folder cannot be archived.");
    this.db.prepare("INSERT OR IGNORE INTO office_folder_archives VALUES (?,?)").run(projectId, Date.now());
  }
}
