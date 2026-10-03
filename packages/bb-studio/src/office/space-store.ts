import type Database from "better-sqlite3";
import { newId } from "@bb-studio/kit/ids";
import { officeContract, spaceSettingsSchema, type OfficeInput, type OfficeSpace, type SpaceSettings } from "./contract";
import { PERSONAL_PROJECT_ID } from "./migration";

type Row = { id: string; name: string; icon: string | null; description: string; is_default: number; default_project_id: string | null; created_at: number; updated_at: number };
const defaults: SpaceSettings = { enabledItemKinds: null, defaultTrust: "ask", defaultBotModel: null };

/** Project ownership is authoritative. No membership is inferred from tags. */
export class OfficeSpaceStore {
  constructor(private readonly db: Database.Database) {}

  list(): OfficeSpace[] {
    const rows = this.db.prepare("SELECT * FROM spaces ORDER BY is_default DESC, name COLLATE NOCASE, id").all() as Row[];
    const projects = this.db.prepare("SELECT project_id, space_id FROM space_projects ORDER BY sort_key, created_at, project_id").all() as { project_id: string; space_id: string }[];
    return rows.map(row => ({
      id: row.id, name: row.name, icon: row.icon, description: row.description,
      isDefault: !!row.is_default, defaultProjectId: row.default_project_id,
      createdAt: row.created_at, updatedAt: row.updated_at,
      projectIds: projects.filter(p => p.space_id === row.id).map(p => p.project_id),
    }));
  }

  get(id: string): OfficeSpace {
    const space = this.list().find(s => s.id === id);
    if (!space) throw new Error("That Space no longer exists.");
    return space;
  }

  defaultSpace(): OfficeSpace {
    const space = this.list().find(s => s.isDefault);
    if (!space) throw new Error("The default Space is missing.");
    return space;
  }

  forProject(projectId: string | null): OfficeSpace {
    return this.list().find(s => s.projectIds.includes(projectId ?? PERSONAL_PROJECT_ID)) ?? this.defaultSpace();
  }

  /** Reconcile projects created outside Studio without changing existing owners. */
  reconcileProjects(ids: readonly string[]): void {
    const fallback = this.defaultSpace().id;
    const insert = this.db.prepare("INSERT OR IGNORE INTO space_projects(project_id,space_id,created_at) VALUES (?,?,?)");
    this.db.transaction(() => { for (const id of ids) insert.run(id, fallback, Date.now()); })();
  }

  create(input: OfficeInput<"space_create">): OfficeSpace {
    const parsed = officeContract.space_create.input.parse(input);
    const id = newId("spc");
    const now = Date.now();
    this.db.prepare("INSERT INTO spaces(id,name,color,icon,description,created_at,updated_at) VALUES (?,?,'#3b82f6',?,?,?,?)")
      .run(id, parsed.name, parsed.icon ?? null, parsed.description ?? "", now, now);
    return this.get(id);
  }

  update(input: OfficeInput<"space_update">): OfficeSpace {
    const parsed = officeContract.space_update.input.parse(input);
    const old = this.get(parsed.spaceId);
    this.db.prepare("UPDATE spaces SET name=?,icon=?,description=?,updated_at=? WHERE id=?")
      .run(parsed.name ?? old.name, parsed.icon === undefined ? old.icon : parsed.icon, parsed.description ?? old.description, Date.now(), old.id);
    return this.get(old.id);
  }

  /** Call only after checking for global/no-project data in the default Space. */
  remove(id: string): void {
    const space = this.get(id);
    if (space.isDefault) throw new Error("The default Space cannot be deleted.");
    if (space.projectIds.length) throw new Error("Move this Space's folders before deleting it.");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM space_settings WHERE space_id=?").run(id);
      this.db.prepare("DELETE FROM spaces WHERE id=?").run(id);
    })();
  }

  /** The caller has verified that the sole catch-all contains no items or threads. */
  removeEmptySpace(id: string): void {
    const space = this.get(id);
    if (space.isDefault) throw new Error("The default Space cannot be deleted.");
    if (space.projectIds.some(p => p !== space.defaultProjectId)) throw new Error("Move this Space's folders before deleting it.");
    this.db.transaction(() => {
      if (space.defaultProjectId) {
        this.db.prepare("UPDATE spaces SET default_project_id=NULL WHERE id=?").run(id);
        this.moveProject(space.defaultProjectId, this.defaultSpace().id);
        this.db.prepare("INSERT OR IGNORE INTO office_folder_archives VALUES (?,?)").run(space.defaultProjectId, Date.now());
      }
      this.db.prepare("DELETE FROM office_folder_intents WHERE space_id=?").run(id);
      this.remove(id);
    })();
  }

  moveProject(projectId: string, spaceId: string): OfficeSpace {
    this.get(spaceId);
    if (projectId === PERSONAL_PROJECT_ID && spaceId !== this.defaultSpace().id) throw new Error("Personal belongs to the default Space.");
    const old = this.forProject(projectId);
    if (old.defaultProjectId === projectId && old.id !== spaceId) throw new Error("A Space's catch-all folder cannot move to another Space.");
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO space_projects(project_id,space_id,created_at) VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET space_id=excluded.space_id")
        .run(projectId, spaceId, Date.now());
      this.db.prepare("UPDATE spaces SET updated_at=? WHERE id IN (?,?)").run(Date.now(), old.id, spaceId);
    })();
    return this.get(spaceId);
  }

  setCatchAll(spaceId: string, projectId: string): void {
    this.db.transaction(() => {
      this.moveProject(projectId, spaceId);
      this.db.prepare("UPDATE spaces SET default_project_id=?,updated_at=? WHERE id=?").run(projectId, Date.now(), spaceId);
    })();
  }

  settings(id: string): SpaceSettings {
    this.get(id);
    const rows = this.db.prepare("SELECT key,value FROM space_settings WHERE space_id=?").all(id) as { key: string; value: string }[];
    return spaceSettingsSchema.parse({ ...defaults, ...Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value)])) });
  }

  setSettings(id: string, patch: Partial<SpaceSettings>): SpaceSettings {
    const next = spaceSettingsSchema.parse({ ...this.settings(id), ...spaceSettingsSchema.partial().parse(patch) });
    this.db.transaction(() => {
      const put = this.db.prepare("INSERT INTO space_settings(space_id,key,value) VALUES (?,?,?) ON CONFLICT(space_id,key) DO UPDATE SET value=excluded.value");
      for (const [key, value] of Object.entries(next)) put.run(id, key, JSON.stringify(value));
    })();
    return next;
  }
}
