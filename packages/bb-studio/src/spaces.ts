// Spaces are meta-projects. Each BB project belongs to exactly one space
// (`space_projects`); projects Studio hasn't seen yet, and items with no
// project, belong to the default space, Personal. Items follow their project.
// A thread follows its project too, unless it was added to a space by itself
// (src/space-threads.ts). Only the user makes, renames or deletes a space.
//
// Members are `<plugin>:<id>` refs: a BB project is `bb-project:<project id>`
// and a thread `bb-thread:<thread id>`.
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import { SpaceThreadOwners } from "./space-threads";
import { TAG_COLORS, type ItemRef } from "./tags";

export const PROJECT_REF = "bb-project";
export const THREAD_REF = "bb-thread";
/** BB's personal project, which always belongs to the default space. */
export const PERSONAL_PROJECT_ID = "proj_personal";
export const MAX_SPACE_NAME = 100;
export const MAX_SPACE_DESCRIPTION = 500;

export interface Space {
  id: string;
  /** The default space, Personal: it holds every project no other space owns. */
  isDefault: boolean;
  name: string;
  color: string;
  /** An emoji, or null for the space icon. */
  icon: string | null;
  description: string;
  /** Where the space's new items and threads go: its catch-all project. */
  defaultProjectId: string | null;
  /** BB projects whose items and threads all belong to the space. */
  projectIds: string[];
  /** Threads added one by one. */
  threadIds: string[];
  /** Always empty: items follow their project. Kept for clients that read it. */
  itemKeys: string[];
  /** The space's home: a Pages page made from the space template, or null before it has one. */
  pageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SpaceInput {
  name?: string;
  icon?: string | null;
  description?: string;
  defaultProjectId?: string | null;
}

/** What a space can hold: a thread or a whole project. */
export type SpaceMember = ItemRef;

type Row = {
  id: string; name: string; color: string; icon: string | null; description: string; default_project_id: string | null;
  page_id: string | null; is_default: number; created_at: number; updated_at: number;
};

function spaceName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("A space needs a name.");
  if (name.length > MAX_SPACE_NAME) throw new Error(`Space names are at most ${MAX_SPACE_NAME} characters.`);
  return name;
}

function description(raw: string): string {
  const text = raw.trim();
  if (text.length > MAX_SPACE_DESCRIPTION) throw new Error(`Space descriptions are at most ${MAX_SPACE_DESCRIPTION} characters.`);
  return text;
}

export class SpaceStore {
  /** Threads added to a space one by one; each is in at most one space. */
  readonly threads: SpaceThreadOwners;

  constructor(private readonly db: Database.Database) {
    this.threads = new SpaceThreadOwners(db);
    // The default space exists from the start.
    db.transaction(() => {
      if (db.prepare("SELECT 1 FROM spaces WHERE is_default = 1").get()) return;
      const now = Date.now();
      let id = "spc_personal";
      for (let n = 2; db.prepare("SELECT 1 FROM spaces WHERE id = ?").get(id); n++) id = `spc_personal_${n}`;
      db.prepare("INSERT INTO spaces (id, name, color, default_project_id, is_default, created_at, updated_at) VALUES (?, 'Personal', ?, ?, 1, ?, ?)")
        .run(id, TAG_COLORS[0]!, PERSONAL_PROJECT_ID, now, now);
      db.prepare("INSERT INTO space_projects (project_id, space_id, created_at) VALUES (?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET space_id = excluded.space_id")
        .run(PERSONAL_PROJECT_ID, id, now);
    })();
  }

  list(): Space[] {
    const rows = this.db.prepare("SELECT * FROM spaces ORDER BY is_default DESC, name COLLATE NOCASE, id").all() as Row[];
    const projects = this.db.prepare("SELECT project_id, space_id FROM space_projects ORDER BY created_at, project_id").all() as { project_id: string; space_id: string }[];
    const threads = this.db.prepare("SELECT thread_id, space_id FROM space_threads ORDER BY added_at, thread_id").all() as { thread_id: string; space_id: string }[];
    return rows.map((row) => ({
      id: row.id,
      isDefault: row.is_default === 1,
      name: row.name,
      color: row.color,
      icon: row.icon,
      description: row.description,
      defaultProjectId: row.default_project_id,
      projectIds: projects.filter((project) => project.space_id === row.id).map((project) => project.project_id),
      threadIds: threads.filter((thread) => thread.space_id === row.id).map((thread) => thread.thread_id),
      itemKeys: [],
      pageId: row.page_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  get(id: string): Space | null {
    return this.list().find((space) => space.id === id) ?? null;
  }

  private require(id: string): Space {
    const space = this.get(id);
    if (!space) throw new Error("That space no longer exists.");
    return space;
  }

  /** By id, or by name ignoring case and a leading "#". */
  find(idOrName: string): Space | null {
    const spaces = this.list();
    const byId = spaces.find((space) => space.id === idOrName);
    if (byId) return byId;
    const name = idOrName.replace(/^#+\s*/, "").trim().toLowerCase();
    return spaces.find((space) => space.name.toLowerCase() === name) ?? null;
  }

  defaultSpace(): Space {
    return this.list().find((space) => space.isDefault)!;
  }

  /** The space that owns a project; unknown projects and no project are the default space's. */
  forProject(projectId: string | null): Space {
    const spaces = this.list();
    return spaces.find((space) => space.projectIds.includes(projectId ?? PERSONAL_PROJECT_ID)) ?? spaces.find((space) => space.isDefault)!;
  }

  /** Files projects made outside Studio under the default space, leaving owned ones be. */
  reconcileProjects(ids: readonly string[]): void {
    const fallback = this.defaultSpace().id;
    const insert = this.db.prepare("INSERT OR IGNORE INTO space_projects (project_id, space_id, created_at) VALUES (?, ?, ?)");
    this.db.transaction(() => { for (const id of ids) insert.run(id, fallback, Date.now()); })();
  }

  private assertFree(name: string, except?: string): void {
    const clash = this.db.prepare("SELECT id FROM spaces WHERE name = ? COLLATE NOCASE").get(name) as { id: string } | undefined;
    if (clash && clash.id !== except) throw new Error(`There's already a space called "${name}".`);
  }

  create(input: SpaceInput & { name: string }): Space {
    const name = spaceName(input.name);
    this.assertFree(name);
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM spaces").get() as { n: number }).n;
    const id = newId("spc");
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO spaces (id, name, color, icon, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, name, TAG_COLORS[count % TAG_COLORS.length]!, input.icon ?? null, description(input.description ?? ""), now, now);
      if (input.defaultProjectId) this.setCatchAll(id, input.defaultProjectId);
    })();
    return this.require(id);
  }

  update(id: string, input: SpaceInput): Space {
    const space = this.require(id);
    this.db.transaction(() => {
      const name = input.name === undefined ? space.name : spaceName(input.name);
      if (name !== space.name) this.assertFree(name, id);
      this.db.prepare("UPDATE spaces SET name = ?, icon = ?, description = ?, updated_at = ? WHERE id = ?").run(
        name,
        input.icon !== undefined ? input.icon : space.icon,
        input.description !== undefined ? description(input.description) : space.description,
        Date.now(),
        id,
      );
      if (input.defaultProjectId) this.setCatchAll(id, input.defaultProjectId);
    })();
    return this.require(id);
  }

  /** Deletes a space. Its projects and threads go back to the default space. */
  remove(id: string): void {
    const space = this.get(id);
    if (!space) return;
    if (space.isDefault) throw new Error("The default space can't be deleted.");
    const fallback = this.defaultSpace().id;
    this.db.transaction(() => {
      this.db.prepare("UPDATE space_projects SET space_id = ? WHERE space_id = ?").run(fallback, id);
      this.db.prepare("DELETE FROM space_folders WHERE space_id = ?").run(id);
      this.threads.removeSpace(id);
      this.db.prepare("DELETE FROM spaces WHERE id = ?").run(id);
    })();
  }

  moveProject(projectId: string, spaceId: string): void {
    this.require(spaceId);
    const old = this.forProject(projectId);
    if (projectId === PERSONAL_PROJECT_ID && old.id !== spaceId) throw new Error("Personal belongs to the default space.");
    if (old.defaultProjectId === projectId && old.id !== spaceId) throw new Error("A space's catch-all project can't move to another space.");
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO space_projects (project_id, space_id, created_at) VALUES (?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET space_id = excluded.space_id")
        .run(projectId, spaceId, now);
      this.db.prepare("UPDATE spaces SET updated_at = ? WHERE id IN (?, ?)").run(now, old.id, spaceId);
    })();
  }

  /** Makes a project the space's catch-all, where its new items and threads go. */
  setCatchAll(spaceId: string, projectId: string): void {
    this.db.transaction(() => {
      this.moveProject(projectId, spaceId);
      this.db.prepare("UPDATE spaces SET default_project_id = ?, updated_at = ? WHERE id = ?").run(projectId, Date.now(), spaceId);
    })();
  }

  /** The one space a thread is in: the one it was added to, else its project's. */
  ownerOfThread(thread: { id: string; projectId: string | null }): string {
    return this.threads.explicit(thread.id) ?? this.forProject(thread.projectId).id;
  }

  /** Projects move to the space; threads join it and leave any other space. */
  add(id: string, members: readonly SpaceMember[]): void {
    if (members.some((member) => member.pluginId !== PROJECT_REF && member.pluginId !== THREAD_REF)) {
      throw new Error("Items follow their project. Move the item's project to this space instead.");
    }
    this.require(id);
    this.db.transaction(() => {
      for (const member of members) {
        if (member.pluginId === THREAD_REF) this.threads.set(id, member.id);
        else this.moveProject(member.id, id);
      }
    })();
  }

  /** A thread goes back to its project's space; a project goes back to the default space. */
  removeMembers(id: string, members: readonly SpaceMember[]): void {
    if (members.some((member) => member.pluginId !== PROJECT_REF && member.pluginId !== THREAD_REF)) {
      throw new Error("Items follow their project.");
    }
    for (const member of members) {
      if (member.pluginId === THREAD_REF) this.threads.remove(id, member.id);
      else if (this.forProject(member.id).id === id) this.moveProject(member.id, this.defaultSpace().id);
    }
  }

  /** Sets or clears the space's home page. */
  setPage(id: string, pageId: string | null): void {
    this.require(id);
    this.db.prepare("UPDATE spaces SET page_id = ? WHERE id = ?").run(pageId, id);
  }
}

/** Whether an item is in a space: in one of its projects, or with no project in the default space. */
export function inSpace(space: Space, item: { projectId: string | null }): boolean {
  return item.projectId === null ? space.isDefault : space.projectIds.includes(item.projectId);
}

/** Space ids per `<plugin>:<id>`, for every item given. */
export function spaceAssignments(spaces: readonly Space[], items: readonly { pluginId: string; id: string; projectId: string | null }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const item of items) {
    const ids = spaces.filter((space) => inSpace(space, item)).map((space) => space.id);
    if (ids.length) map.set(`${item.pluginId}:${item.id}`, ids);
  }
  return map;
}
