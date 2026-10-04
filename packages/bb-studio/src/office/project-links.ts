import type Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { StudioHub } from "../hub";
import type { StudioProjects } from "./studio-projects";
import { projectRefSchema } from "./projects-contract";

type Target = { ref: string; title: string; kind: string; href: string; icon: string | null };
export class ProjectLinks {
  constructor(private db: Database.Database, private sdk: BbPluginApi["sdk"], private hub: Pick<StudioHub, "get"> | undefined, private changed: () => void, private projects: StudioProjects) {}
  rows(projectId?: string) {
    return this.db.prepare(`SELECT project_id,ref FROM office_project_links${projectId ? " WHERE project_id=?" : ""} ORDER BY added_at,ref`).all(...(projectId ? [projectId] : [])) as { project_id: string; ref: string }[];
  }
  async all() {
    await this.projects.ensure();
    const threads: Record<string, string> = {};
    const connected = new Map(this.projects.rows().filter(p => p.bb_project_id).map(p => [p.bb_project_id!, p.id]));
    const excluded = new Set((this.db.prepare("SELECT ref FROM office_project_unlinked").all() as { ref: string }[]).map(r => r.ref));
    for (let offset = 0; ; offset += 200) {
      const batch = await this.sdk.threads.list({ includeHidden: true, limit: 200, offset });
      for (const thread of batch) {
        const projectId = connected.get(thread.projectId), ref = `thread:${thread.id}`;
        if (projectId && !excluded.has(ref) && thread.deletedAt == null) {
          threads[thread.id] = projectId;
          this.cache({ ref, title: thread.title ?? "Untitled", kind: "thread", href: `/threads/${encodeURIComponent(thread.id)}`, icon: null });
        }
      }
      if (batch.length < 200) break;
    }
    for (const row of this.rows()) if (row.ref.startsWith("thread:")) threads[row.ref.slice(7)] = row.project_id;
    const items = this.db.prepare("SELECT l.ref,l.project_id AS projectId,t.title,t.kind,t.href,t.icon FROM office_project_links l JOIN office_project_link_targets t USING(ref) WHERE l.ref LIKE 'item:%' ORDER BY l.added_at,l.ref").all() as (Target & { projectId: string })[];
    return { threads, items };
  }
  context(projectId: string): string {
    const targets = this.db.prepare("SELECT t.ref,t.title FROM office_project_links l JOIN office_project_link_targets t USING(ref) WHERE l.project_id=? ORDER BY l.added_at,l.ref").all(projectId) as Pick<Target, "ref" | "title">[];
    return `Studio membership overlay: linked work belongs to this project even if BB's underlying project differs. Read project_membership for current membership and project_threads for threads.\n${targets.map(t => `- ${JSON.stringify(t.title)} (${t.ref})`).join("\n")}`;
  }
  private cache(target: Target) {
    this.db.prepare("INSERT OR REPLACE INTO office_project_link_targets VALUES (?,?,?,?,?)").run(target.ref, target.title, target.kind, target.href, target.icon);
  }
  remember(projectId: string, target: Target) {
    this.db.prepare("INSERT INTO office_project_links VALUES (?,?,?) ON CONFLICT(ref) DO UPDATE SET project_id=excluded.project_id,added_at=excluded.added_at").run(projectId, target.ref, Date.now());
    this.db.prepare("DELETE FROM office_project_unlinked WHERE ref=?").run(target.ref);
    this.cache(target);
  }
  async leadContext(projectId: string) {
    const membership = await this.all();
    const refs = Object.entries(membership.threads).filter(([, id]) => id === projectId).map(([id]) => `thread:${id}`);
    const targets = refs.map(ref => this.db.prepare("SELECT title FROM office_project_link_targets WHERE ref=?").get(ref) as { title: string } | undefined);
    return `${this.context(projectId)}\nMember threads (including connected BB project):\n${refs.map((ref, i) => `- ${JSON.stringify(targets[i]?.title ?? "Thread")} (${ref})`).join("\n")}`;
  }
  async link(projectId: string, refs: string[]) {
    await this.projects.ensure();
    projectId = this.projects.resolve(projectId).id;
    const targets: Target[] = [];
    const groups = new Map<string, { ref: string; id: string }[]>();
    for (const ref of new Set(refs)) {
      projectRefSchema.parse(ref);
      if (ref.startsWith("thread:")) {
        const thread = await this.sdk.threads.get({ threadId: ref.slice(7) });
        if (thread.deletedAt != null) throw new Error(`Thread no longer exists: ${ref}`);
        targets.push({ ref, title: thread.title ?? "Untitled", kind: "thread", href: `/threads/${encodeURIComponent(thread.id)}`, icon: null });
      } else {
        const [, pluginId, ...parts] = ref.split(":");
        const group = groups.get(pluginId!) ?? []; group.push({ ref, id: parts.join(":") }); groups.set(pluginId!, group);
      }
    }
    for (const [pluginId, group] of groups) {
      const items = await this.hub?.get(pluginId, group.map(g => g.id));
      for (const { ref, id } of group) {
        const item = items?.find(i => i.id === id);
        if (!item) throw new Error(`Item no longer exists: ${ref}`);
        targets.push({ ref, title: item.title, kind: item.kind, href: item.href, icon: item.icon });
      }
    }
    const affected = new Set([projectId]);
    this.db.transaction(() => {
      for (const target of targets) {
        const previous = this.db.prepare("SELECT project_id FROM office_project_links WHERE ref=?").get(target.ref) as { project_id: string } | undefined;
        if (previous) affected.add(previous.project_id);
        this.remember(projectId, target);
      }
    })();
    this.changed(); return [...affected];
  }
  async unlink(refs: string[]) {
    await this.projects.ensure();
    const membership = await this.all();
    const affected = new Set<string>();
    this.db.transaction(() => {
      for (const ref of refs) {
        projectRefSchema.parse(ref);
        const previous = this.db.prepare("SELECT project_id FROM office_project_links WHERE ref=?").get(ref) as { project_id: string } | undefined;
        const implicit = ref.startsWith("thread:") ? membership.threads[ref.slice(7)] : undefined;
        if (previous) affected.add(previous.project_id);
        if (implicit) affected.add(implicit);
        this.db.prepare("INSERT OR IGNORE INTO office_project_unlinked VALUES (?)").run(ref);
        this.db.prepare("DELETE FROM office_project_links WHERE ref=?").run(ref);
        this.db.prepare("DELETE FROM office_project_link_targets WHERE ref=?").run(ref);
      }
    })();
    this.changed(); return [...affected];
  }
  removeProject(projectId: string) {
    this.db.prepare("DELETE FROM office_project_link_targets WHERE ref IN (SELECT ref FROM office_project_links WHERE project_id=?)").run(projectId);
    this.db.prepare("DELETE FROM office_project_links WHERE project_id=?").run(projectId);
  }
}
