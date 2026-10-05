// A space's catch-all project: a BB project in a folder of its own under
// ~/Spaces/<space>-<id>/general, made when the space is. Project creation is
// in BB core and can't share a transaction with Studio's storage, so the path
// is reserved first (`space_folders`); a retry finds the project by that path
// and never makes a second one.
import type Database from "better-sqlite3";
import { basename, join, posix, win32 } from "node:path";
import type { SpaceStore } from "./spaces";

export interface FolderProject {
  id: string;
  name: string;
  path: string | null;
}

export interface FolderHost {
  root: string;
  mkdir(path: string): Promise<void>;
  projects(): Promise<FolderProject[]>;
  createProject(name: string, path: string): Promise<FolderProject>;
}

export function folderSlug(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return slug || "folder";
}

export class SpaceFolders {
  private readonly pending = new Map<string, Promise<FolderProject>>();

  constructor(private readonly db: Database.Database, private readonly spaces: SpaceStore, private readonly host: FolderHost) {}

  /** Gives the space a catch-all project, if it has none. */
  async ensureCatchAll(spaceId: string): Promise<void> {
    const space = this.spaces.get(spaceId);
    if (!space || space.defaultProjectId) return;
    const project = await this.create(spaceId, "General");
    this.spaces.setCatchAll(spaceId, project.id);
  }

  /** The BB project at a folder the user picked, made if there's none yet; concurrent calls share one. */
  projectAt(path: string): Promise<FolderProject> {
    const folder = path.replace(/(.)\/+$/, "$1");
    // BB stores a project's path as given, so `~/code` or `code` would make a project nothing can open.
    if (!posix.isAbsolute(folder) && !win32.isAbsolute(folder)) {
      return Promise.reject(new Error(`Use the folder's full path, such as /Users/you/code/site, not ${JSON.stringify(path)}.`));
    }
    const key = `path:${folder}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = (async () => (await this.host.projects()).find((each) => each.path === folder) ?? await this.host.createProject(basename(folder) || folder, folder))()
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  /** A project in its own folder in the space; concurrent calls share one. */
  create(spaceId: string, name: string): Promise<FolderProject> {
    const key = `${spaceId}:${name.toLowerCase()}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = this.createOnce(spaceId, name).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private async createOnce(spaceId: string, name: string): Promise<FolderProject> {
    const space = this.spaces.get(spaceId);
    if (!space) throw new Error("That space no longer exists.");
    let reserved = this.db.prepare("SELECT path, project_id FROM space_folders WHERE space_id = ? AND name = ? COLLATE NOCASE").get(spaceId, name) as { path: string; project_id: string | null } | undefined;
    if (!reserved) {
      // The id suffix keeps renamed spaces and equal slugs apart.
      const base = join(this.host.root, `${folderSlug(space.name)}-${space.id}`, folderSlug(name));
      let path = base;
      for (let n = 2; this.db.prepare("SELECT 1 FROM space_folders WHERE path = ?").get(path); n++) path = `${base}-${n}`;
      this.db.prepare("INSERT INTO space_folders (space_id, name, path) VALUES (?, ?, ?)").run(spaceId, name, path);
      reserved = { path, project_id: null };
    }
    const { path, project_id: projectId } = reserved;
    await this.host.mkdir(path);
    const project = (await this.host.projects()).find((each) => each.id === projectId || each.path === path) ?? await this.host.createProject(name, path);
    this.db.transaction(() => {
      this.spaces.moveProject(project.id, spaceId);
      this.db.prepare("UPDATE space_folders SET project_id = ? WHERE space_id = ? AND name = ? COLLATE NOCASE").run(project.id, spaceId, name);
    })();
    return project;
  }
}
