import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { projectNameSchema } from "./projects-contract";

export type StudioProjectRow = { id: string; name: string; icon: string | null; position: number; archived_at: number | null; bb_project_id: string | null; role: "project" | "chief-of-staff"; legacy_bb_project_id: string | null };
export const legacyStudioId = (id: string) => `sp_${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
export class StudioProjects {
  private initializing?: Promise<void>;
  constructor(private db: Database.Database, private sdk: BbPluginApi["sdk"], private changed: () => void) {}
  ensure(): Promise<void> {
    if (this.db.prepare("SELECT 1 FROM studio_project_migrations WHERE id='v1'").get()) return Promise.resolve();
    if (!this.initializing) this.initializing = this.migrate().finally(() => { this.initializing = undefined; });
    return this.initializing;
  }
  private async migrate() {
    const projects = await this.sdk.projects.list({ includePersonal: true });
    this.db.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM studio_project_migrations WHERE id='v1'").get()) return;
      const personal = projects.find(p => p.kind === "personal");
      const rows = [
        { id: legacyStudioId("chief-of-staff"), name: "Chief of Staff", bbId: null, role: "chief-of-staff", old: personal?.id ?? null },
        ...projects.filter(p => p.kind !== "personal").map(p => ({ id: legacyStudioId(p.id), name: p.name, bbId: p.id, role: "project", old: p.id })),
      ];
      rows.forEach((p, index) => {
        this.db.prepare("INSERT OR IGNORE INTO studio_projects VALUES (?,?,NULL,?,NULL,?,?,?)").run(p.id, p.name, index, p.bbId, p.role, p.old);
        if (!p.old) return;
        for (const table of ["office_projects", "office_project_runs", "office_bot_projects", "office_thread_handoffs", "office_project_links"]) {
          this.db.prepare(`UPDATE ${table} SET project_id=? WHERE project_id=?`).run(p.id, p.old);
        }
        const owned = this.db.prepare("SELECT lead_thread_id,page_id FROM office_projects WHERE project_id=?").get(p.id) as { lead_thread_id: string | null; page_id: string | null } | undefined;
        for (const ref of [owned?.lead_thread_id ? `thread:${owned.lead_thread_id}` : null, owned?.page_id ? `item:pages:${owned.page_id}` : null].filter((r): r is string => !!r)) {
          this.db.prepare("INSERT OR IGNORE INTO office_project_links VALUES (?,?,?)").run(p.id, ref, Date.now());
          this.db.prepare("INSERT OR IGNORE INTO office_project_link_targets VALUES (?,?,?,?,NULL)").run(ref, ref.startsWith("thread:") ? `${p.name} · lead` : p.name, ref.startsWith("thread:") ? "thread" : "page", ref.startsWith("thread:") ? `/threads/${ref.slice(7)}` : `/plugins/pages/pages/${ref.slice(11)}`);
        }
      });
      this.db.prepare("INSERT INTO studio_project_migrations VALUES ('v1')").run();
    })();
    this.changed();
  }
  rows(): StudioProjectRow[] { return this.db.prepare("SELECT * FROM studio_projects ORDER BY position,id").all() as StudioProjectRow[]; }
  resolve(id: string): StudioProjectRow {
    const row = this.db.prepare("SELECT * FROM studio_projects WHERE id=? OR legacy_bb_project_id=?").get(id, id) as StudioProjectRow | undefined;
    if (!row) throw new Error("Studio project not found.");
    return row;
  }
  async executionProject(id: string): Promise<string> {
    await this.ensure(); const row = this.resolve(id);
    if (row.bb_project_id) { await this.sdk.projects.get({ projectId: row.bb_project_id }); return row.bb_project_id; }
    const personal = (await this.sdk.projects.list({ includePersonal: true })).find(p => p.kind === "personal");
    if (!personal) throw new Error("Personal BB project unavailable.");
    return personal.id;
  }
  private async validateConnection(bbProjectId: string | null, currentId?: string) {
    if (!bbProjectId) return;
    const project = await this.sdk.projects.get({ projectId: bbProjectId });
    if (project.kind === "personal") throw new Error("Personal is used automatically for projects without a connected folder.");
    const existing = this.rows().find(p => p.bb_project_id === bbProjectId && p.id !== currentId);
    if (existing) throw new Error(`This BB project is already connected to ${existing.name}.`);
  }
  async create(input: { name: string; bbProjectId?: string | null }) {
    await this.ensure(); const name = projectNameSchema.parse(input.name);
    await this.validateConnection(input.bbProjectId ?? null);
    const id = `sp_${randomBytes(8).toString("hex")}`;
    this.db.prepare("INSERT INTO studio_projects VALUES (?,?,NULL,?,NULL,?,'project',NULL)").run(id, name, (this.rows().at(-1)?.position ?? -1) + 1, input.bbProjectId ?? null);
    this.changed(); return this.resolve(id);
  }
  async update(input: { projectId: string; name?: string; bbProjectId?: string | null; icon?: string | null }) {
    await this.ensure(); const row = this.resolve(input.projectId);
    if (row.role === "chief-of-staff" && input.bbProjectId) throw new Error("Chief of Staff is independent of BB projects.");
    const connection = input.bbProjectId === undefined ? row.bb_project_id : input.bbProjectId;
    await this.validateConnection(connection, row.id);
    this.db.prepare("UPDATE studio_projects SET name=?,bb_project_id=?,icon=? WHERE id=?").run(input.name === undefined ? row.name : projectNameSchema.parse(input.name), connection, input.icon === undefined ? row.icon : input.icon, row.id);
    this.changed(); return this.resolve(row.id);
  }
  async archive(projectId: string, archived: boolean) {
    await this.ensure(); const row = this.resolve(projectId);
    if (row.role === "chief-of-staff" && archived) throw new Error("Chief of Staff cannot be archived.");
    this.db.prepare("UPDATE studio_projects SET archived_at=? WHERE id=?").run(archived ? row.archived_at ?? Date.now() : null, row.id);
    this.changed(); return this.resolve(row.id);
  }
  async reorder(input: { projectId: string; previousProjectId: string | null; nextProjectId: string | null }) {
    await this.ensure(); const row = this.resolve(input.projectId);
    const rows = this.rows().filter(p => p.id !== row.id);
    const previous = input.previousProjectId ? this.resolve(input.previousProjectId).id : null;
    const next = input.nextProjectId ? this.resolve(input.nextProjectId).id : null;
    if (previous === row.id || next === row.id) throw new Error("A project cannot be its own neighbor.");
    const index = previous ? rows.findIndex(p => p.id === previous) + 1 : 0;
    if (next && rows[index]?.id !== next) throw new Error("Project order changed; refresh and try again.");
    if (!next && previous && index !== rows.length) throw new Error("Project order changed; refresh and try again.");
    rows.splice(index, 0, row);
    this.db.transaction(() => { rows.forEach((p, position) => this.db.prepare("UPDATE studio_projects SET position=? WHERE id=?").run(position, p.id)); })();
    this.changed(); return { ok: true as const };
  }
}
