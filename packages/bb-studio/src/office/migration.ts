import type Database from "better-sqlite3";

export const PERSONAL_PROJECT_ID = "proj_personal";
export interface LegacyMember { pluginId: string; id: string }
export interface SpaceMigrationOptions {
  projectIds: readonly string[];
  /** Undefined means the provider is unavailable: preserve the membership as a tag. */
  projectForMember(member: LegacyMember): string | null | undefined;
  logConflict(message: string): void;
  now?: number;
}

/** All reads of external providers happen before this synchronous transaction.
 * Never discard unknown or missing items: their former memberships remain tags.
 * The marker commits with the data, so crashes and retries cannot half-migrate. */
export function migrateOfficeSpaces(db: Database.Database, options: SpaceMigrationOptions): void {
  const conflicts: string[] = [];
  db.transaction(() => {
    db.exec("CREATE TABLE IF NOT EXISTS office_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    if (db.prepare("SELECT 1 FROM office_migrations WHERE id = 'space-root-v1'").get()) return;
    const now = options.now ?? Date.now();
    db.exec(`CREATE TABLE office_spaces_next (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, color TEXT NOT NULL,
      icon TEXT, description TEXT NOT NULL DEFAULT '', default_project_id TEXT,
      page_id TEXT, page_template INTEGER, is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE space_projects (
      project_id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES office_spaces_next(id),
      sort_key TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE space_settings (
      space_id TEXT NOT NULL REFERENCES office_spaces_next(id), key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (space_id, key)
    );
    INSERT INTO office_spaces_next
      SELECT t.id, t.name, t.color, s.icon, COALESCE(s.description, ''), s.default_project_id,
        s.page_id, s.page_template, 0, t.created_at, t.created_at
      FROM tags t LEFT JOIN spaces s ON s.tag_id = t.id WHERE t.kind = 'space';`);
    const legacy = db.prepare("SELECT id, name, default_project_id FROM office_spaces_next ORDER BY created_at, id").all() as { id: string; name: string; default_project_id: string | null }[];
    let personal = legacy.find(s => s.name.toLowerCase() === "personal")?.id;
    if (!personal) {
      personal = "spc_personal";
      for (let suffix = 1; db.prepare("SELECT 1 FROM office_spaces_next WHERE id = ?").get(personal); suffix++) personal = `spc_personal_${suffix}`;
      db.prepare("INSERT INTO office_spaces_next (id,name,color,created_at,updated_at) VALUES (?, 'Personal', '#3b82f6', ?, ?)").run(personal, now, now);
    }
    db.prepare("UPDATE office_spaces_next SET is_default = 1, default_project_id = ? WHERE id = ?").run(PERSONAL_PROJECT_ID, personal);
    const assign = db.prepare("INSERT OR IGNORE INTO space_projects (project_id, space_id, created_at) VALUES (?, ?, ?)");
    // Personal is always in the default Space, even if old tags disagree.
    assign.run(PERSONAL_PROJECT_ID, personal, now);
    for (const space of legacy) {
      const members = db.prepare("SELECT item_id FROM item_tags WHERE tag_id = ? AND plugin_id = 'bb-project' ORDER BY created_at, item_id").all(space.id) as { item_id: string }[];
      for (const member of members) {
        assign.run(member.item_id, space.id, now);
        const owner = db.prepare("SELECT space_id FROM space_projects WHERE project_id = ?").get(member.item_id) as { space_id: string };
        if (owner.space_id !== space.id) conflicts.push(`Project ${member.item_id}: keeping Space ${owner.space_id}; preserving ${space.id} membership as a tag.`);
      }
    }
    for (const projectId of options.projectIds) assign.run(projectId, personal, now);
    const ownerOf = (projectId: string | null) => (db.prepare("SELECT space_id FROM space_projects WHERE project_id = ?").get(projectId ?? PERSONAL_PROJECT_ID) as { space_id: string } | undefined)?.space_id ?? personal;
    for (const space of legacy) {
      const members = db.prepare("SELECT plugin_id, item_id FROM item_tags WHERE tag_id = ?").all(space.id) as { plugin_id: string; item_id: string }[];
      for (const member of members) {
        const project = member.plugin_id === "bb-project" ? member.item_id : options.projectForMember({ pluginId: member.plugin_id, id: member.item_id });
        if (project !== undefined && ownerOf(project) === space.id) {
          db.prepare("DELETE FROM item_tags WHERE tag_id = ? AND plugin_id = ? AND item_id = ?").run(space.id, member.plugin_id, member.item_id);
        }
      }
      // Space names no longer share a namespace with tags. Keep unmatched refs
      // under the original tag id, including refs to unavailable providers.
      db.prepare("UPDATE tags SET kind = 'tag' WHERE id = ?").run(space.id);
      if (!db.prepare("SELECT 1 FROM item_tags WHERE tag_id = ? LIMIT 1").get(space.id)) db.prepare("DELETE FROM tags WHERE id = ?").run(space.id);
      if (space.id !== personal && space.default_project_id && ownerOf(space.default_project_id) !== space.id) {
        db.prepare("UPDATE office_spaces_next SET default_project_id = NULL WHERE id = ?").run(space.id);
      }
    }
    db.exec(`DROP TABLE spaces;
      ALTER TABLE office_spaces_next RENAME TO spaces;
      CREATE UNIQUE INDEX spaces_one_default ON spaces(is_default) WHERE is_default = 1;
      CREATE INDEX space_projects_space ON space_projects(space_id);
      DROP TABLE IF EXISTS item_space_inheritance;`);
    db.prepare("INSERT INTO office_migrations VALUES ('space-root-v1', ?)").run(now);
  })();
  for (const message of conflicts) options.logConflict(message);
}
