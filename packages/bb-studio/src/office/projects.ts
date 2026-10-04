import { StudioProjects } from "./studio-projects";
import { ProjectLinks } from "./project-links";
import type { StudioHub } from "../hub";
import { ProjectRuns } from "./project-run";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcErrorStatus } from "@bb-studio/kit/server";
import type Database from "better-sqlite3";
import { z } from "zod";
import { officeProjectsContract } from "./projects-contract";

type Setup = z.output<typeof officeProjectsContract.project_setup.input>;
type Row = { project_id: string; lead_thread_id: string | null; page_id: string | null };
const page = z.object({ id: z.string().min(1) });

export class OfficeProjects {
  private readonly pending = new Map<string, Promise<unknown>>();
  readonly runs: ProjectRuns;
  readonly store: StudioProjects;
  readonly links: ProjectLinks;
  constructor(private readonly db: Database.Database, private readonly sdk: BbPluginApi["sdk"], private readonly changed: () => void, hub?: Pick<StudioHub, "get">) {
    this.store = new StudioProjects(db, sdk, changed);
    this.links = new ProjectLinks(db, sdk, hub, changed, this.store);
    this.runs = new ProjectRuns(db, sdk, changed, id => this.links.leadContext(id));
  }

  // Keep reads/recovery and setup in the same queue: a stale read must not clear
  // a reference another request just created. Failed setup releases the queue.
  private serial<T>(id: string, run: () => Promise<T>): Promise<T> {
    const next = (this.pending.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
    this.pending.set(id, next);
    void next.finally(() => { if (this.pending.get(id) === next) this.pending.delete(id); }).catch(() => {});
    return next;
  }
  private save(row: Row) {
    const now = Date.now();
    this.db.prepare(`INSERT INTO office_projects(project_id,lead_thread_id,page_id,created_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
      lead_thread_id=excluded.lead_thread_id,page_id=excluded.page_id,updated_at=excluded.updated_at`)
      .run(row.project_id, row.lead_thread_id, row.page_id, now, now);
    this.changed();
  }
  private async read(projectId: string) {
    await this.store.ensure();
    const project = this.store.resolve(projectId);
    projectId = project.id;
    const role = project.role;
    const row = this.db.prepare("SELECT * FROM office_projects WHERE project_id=?").get(projectId) as Row | undefined;
    const result = { id: projectId, projectId, bbProjectId: project.bb_project_id, icon: project.icon, position: project.position, archivedAt: project.archived_at, role, run: this.runs.get(projectId), name: project.name, leadThreadId: row?.lead_thread_id ?? null, pageId: row?.page_id ?? null, pageHref: null as string | null };
    if (result.leadThreadId) {
      const thread = await this.sdk.threads.get({ threadId: result.leadThreadId }).catch(error => {
        if (rpcErrorStatus(error) === 404) return null;
        throw error;
      });
      if (!thread || thread.deletedAt != null) result.leadThreadId = null;
    }
    if (result.pageId) {
      const found = await this.sdk.plugins.callRpc({ pluginId: "pages", method: "get", input: { id: result.pageId }, outputSchema: z.object({ page: page.nullable() }) });
      if (!found.page) result.pageId = null;
    }
    if (row && (row.lead_thread_id !== result.leadThreadId || row.page_id !== result.pageId)) {
      this.save({ project_id: projectId, lead_thread_id: result.leadThreadId, page_id: result.pageId });
    }
    result.pageHref = result.pageId ? `/plugins/pages/pages/${encodeURIComponent(result.pageId)}` : null;
    return result;
  }
  async get(projectId: string) { await this.store.ensure(); projectId = this.store.resolve(projectId).id; return this.serial(projectId, () => this.read(projectId)); }
  async list() { await this.store.ensure(); return { projects: await Promise.all(this.store.rows().map(p => this.get(p.id))) }; }
  async create(input: { name: string; bbProjectId?: string | null }) { return this.get((await this.store.create(input)).id); }
  async update(input: z.output<typeof officeProjectsContract.project_update.input>) {
    await this.store.ensure(); input = { ...input, projectId: this.store.resolve(input.projectId).id };
    return this.serial(input.projectId, async () => { await this.store.update(input); return this.read(input.projectId); });
  }
  async archive(projectId: string, archived: boolean) {
    await this.store.ensure(); projectId = this.store.resolve(projectId).id;
    return this.serial(projectId, async () => {
      const project = await this.read(projectId);
      if (archived && project.role === "chief-of-staff") throw new Error("Chief of Staff cannot be archived.");
      if (archived && project.run?.enabled) await this.runs.set(projectId, project.leadThreadId, { ...project.run, enabled: false });
      await this.store.archive(projectId, archived);
      return this.read(projectId);
    });
  }
  async membershipMutation(projectId: string | null, refs: string[]) {
    const affected = projectId ? await this.links.link(projectId, refs) : await this.links.unlink(refs);
    for (const id of affected) {
      const project = await this.get(id);
      if (project.run?.enabled) await this.runs.set(id, project.leadThreadId, project.run);
    }
    return { ok: true as const };
  }
  async start({ projectId, request }: Setup) {
    await this.store.ensure(); projectId = this.store.resolve(projectId).id;
    return this.serial(projectId, async () => {
      if (this.store.resolve(projectId).archived_at) throw new Error("Restore this project before starting work.");
      const thread = await this.sdk.threads.spawn({ ...request, projectId: await this.store.executionProject(projectId) });
      this.links.remember(projectId, { ref: `thread:${thread.id}`, title: thread.title ?? "Untitled", kind: "thread", href: `/threads/${encodeURIComponent(thread.id)}`, icon: null });
      this.changed(); return { threadId: thread.id };
    });
  }
  async setup({ projectId, request }: Setup) {
    await this.store.ensure(); projectId = this.store.resolve(projectId).id;
    return this.serial(projectId, async () => {
      const result = await this.read(projectId);
      if (result.archivedAt) throw new Error("Restore this project before starting work.");
      if (!result.pageId) {
        const brief = request.input.filter(part => part.type === "text").map(part => part.text).join("\n\n");
        const { page: created } = await this.sdk.plugins.callRpc({ pluginId: "pages", method: "create", input: {
          projectId: result.bbProjectId, parentId: null, title: result.name, icon: "📁",
          markdown: result.role === "chief-of-staff" ? `## What I watch\n\n${brief}\n\n## Handed off\n\nProjects and their leads.\n\n## Memory\n\nShared facts, preferences and conventions.\n` : `## Brief\n\n${brief || "What this project is for."}\n\n## Plan\n\nNext steps.\n\n## Decisions\n\nDecisions and their reasons.\n\n## Memory\n\nShared by every thread in this project: facts, preferences, conventions\n\n## Links\n\nUseful pages, artifacts and references.\n`,
        }, outputSchema: z.object({ page }) });
        result.pageId = created.id;
        result.pageHref = `/plugins/pages/pages/${encodeURIComponent(created.id)}`;
        this.links.remember(projectId, { ref: `item:pages:${created.id}`, title: result.name, kind: "page", href: result.pageHref, icon: "📁" });
        // Persist each external result before the next call, so a spawn failure
        // can be retried without creating another page.
        this.save({ project_id: projectId, lead_thread_id: result.leadThreadId, page_id: result.pageId });
      }
      if (!result.leadThreadId) {
        const instructions = (result.role === "chief-of-staff" ? `You are Patrick’s Chief of Staff. Handle one-offs; create and staff projects. Use Studio project_create to create a project without a folder; optionally connect an existing BB project for repository work. Then call Studio project_setup with a sensible composer request. Hand work to each project’s lead using bb thread tell <lead>. Keep What I watch, Handed off and Memory current. ` : "") + `You are the lead for project ${result.name} (${projectId}). You own this project and coordinate its work.\nRead the project page ${result.pageHref} (page ${result.pageId}) with the Pages tools, especially its Memory section, before acting. Keep its Brief, Plan, Decisions, Memory and Links current. Memory is shared by every thread in this project; tell every worker to read it before acting and record lasting facts, preferences and conventions there.\nStart workers with Studio project_thread_start using this Studio project ID so membership is recorded. Alternatively use bb thread spawn in the connected BB project (or Personal), then project_link the thread here. Steer workers with bb thread tell. Keep their scopes clear and review their results. Report progress and anything waiting on the user to the Studio Inbox.\nThe user's first message follows and describes what the project is about.`;
        const lead = await this.sdk.threads.spawn({ ...request, projectId: await this.store.executionProject(projectId), title: `${result.name} · lead`,
          pluginMetadata: { role: result.role === "chief-of-staff" ? "chief-of-staff" : "project-lead", projectId, pageId: result.pageId },
          input: [{ type: "text", text: `${instructions}\n\n${await this.links.leadContext(projectId)}`, mentions: [], visibility: "agent-only" }, ...request.input],
        });
        result.leadThreadId = lead.id;
        this.links.remember(projectId, { ref: `thread:${lead.id}`, title: `${result.name} · lead`, kind: "thread", href: `/threads/${encodeURIComponent(lead.id)}`, icon: null });
        this.save({ project_id: projectId, lead_thread_id: lead.id, page_id: result.pageId });
        await this.sdk.threads.unpin({ threadId: lead.id });
      }
      if (result.run?.enabled) await this.runs.set(projectId, result.leadThreadId, result.run);
      return result;
    });
  }
  async setRun(input: z.output<typeof officeProjectsContract.project_set_run.input>) {
    await this.store.ensure(); input = { ...input, projectId: this.store.resolve(input.projectId).id };
    return this.serial(input.projectId, async () => {
      const project = await this.read(input.projectId);
      if (input.enabled && project.archivedAt) throw new Error("Restore this project before enabling Run mode.");
      if (input.enabled && !project.leadThreadId) throw new Error("Start the project lead before enabling Run mode.");
      await this.runs.set(input.projectId, project.leadThreadId, { enabled: input.enabled, cadence: input.cadence, time: input.time ?? "09:00" });
      return { ...project, run: this.runs.get(input.projectId) };
    });
  }
  async handoff({ threadId, request }: z.output<typeof officeProjectsContract.thread_handoff.input>) {
    await this.store.ensure();
    const membership = await this.links.all();
    const owner = this.db.prepare("SELECT project_id FROM office_projects WHERE lead_thread_id=? UNION SELECT project_id FROM office_thread_handoffs WHERE old_thread_id=? AND project_id IS NOT NULL").get(threadId, threadId) as { project_id: string } | undefined;
    return this.serial(owner?.project_id ?? `thread:${threadId}`, async () => {
      const previous = this.db.prepare("SELECT new_thread_id,archived FROM office_thread_handoffs WHERE old_thread_id=?").get(threadId) as { new_thread_id: string; archived: number } | undefined;
      const old = await this.sdk.threads.get({ threadId });
      const hubId = owner?.project_id ?? membership.threads[threadId];
      const hub = hubId ? await this.read(hubId) : null;
      let newId = previous?.new_thread_id;
      if (!newId) {
        const { output } = await this.sdk.threads.output({ threadId });
        const summary = `Continue work from /threads/${encodeURIComponent(threadId)} (${old.title ?? "Untitled"}).\nLatest response (excerpt):\n${(output ?? "No response yet.").slice(-12000)}\nProject page: ${hub?.pageHref ?? "Not set up; use project_get"}. Read its Memory before acting. Use bb thread to read the old conversation if more context is needed.`;
        const { prompt, ...composer } = request;
        const note = prompt?.trim();
        const next = await this.sdk.threads.spawn({ ...composer, projectId: old.projectId, title: old.title ?? "Handoff", pluginMetadata: { ...(owner ? { role: hub!.role === "chief-of-staff" ? "chief-of-staff" : "project-lead", projectId: hub!.projectId, pageId: hub!.pageId } : {}), handoffFrom: threadId },
          input: [{ type: "text", text: `${summary}${owner ? "\nYou are this hub’s lead. Keep its page and shared Memory current, coordinate worker threads, and report progress to the Studio Inbox." : ""}`, mentions: [], visibility: "agent-only" }, ...request.input, ...(note ? [{ type: "text" as const, text: note, mentions: [] }] : [])],
        });
        newId = next.id;
        this.db.prepare("INSERT INTO office_thread_handoffs(old_thread_id,new_thread_id,project_id) VALUES (?,?,?)").run(threadId, newId, owner?.project_id ?? null);
      }
      if (hub) {
        this.links.remember(hub.id, { ref: `thread:${newId}`, title: old.title ?? "Untitled", kind: "thread", href: `/threads/${encodeURIComponent(newId)}`, icon: null });
      }
      if (!hub) this.db.prepare("INSERT OR IGNORE INTO office_project_unlinked VALUES (?)").run(`thread:${newId}`);
      if (owner && hub) {
        this.save({ project_id: hub.projectId, page_id: hub.pageId, lead_thread_id: newId });
        if (hub.run?.enabled) await this.runs.set(hub.projectId, newId, hub.run);
      }
      if (!previous?.archived) {
        await this.sdk.threads.archive({ threadId });
        this.db.prepare("UPDATE office_thread_handoffs SET archived=1 WHERE old_thread_id=?").run(threadId);
      }
      this.changed();
      return { threadId: newId };
    });
  }
  /** Merge bot documents without overwriting a page someone has edited. */
  async importBot(projectId: string, bot: { id: string; name: string; mission: string; memory: string; threadId: string | null }) {
    await this.store.ensure(); projectId = this.store.resolve(projectId).id;
    return this.serial(projectId, async () => {
      const result = await this.read(projectId);
      const imported = this.db.prepare("SELECT imported_page_id FROM office_bot_projects WHERE bot_id=?").get(bot.id) as { imported_page_id: string | null } | undefined;
      const sections = `## Brief\n\n${bot.mission}\n\n## Memory\n\n${bot.memory}\n`;
      if (!result.pageId) {
        const { page: created } = await this.sdk.plugins.callRpc({ pluginId: "pages", method: "create", input: { projectId: result.bbProjectId, parentId: null, title: result.name, icon: "📁", markdown: result.role === "chief-of-staff" ? `## What I watch\n\n${bot.mission}\n\n## Handed off\n\n## Memory\n\n${bot.memory}\n` : `${sections}\n## Plan\n\n## Decisions\n\n## Links\n` }, outputSchema: z.object({ page }) });
        result.pageId = created.id; result.pageHref = `/plugins/pages/pages/${encodeURIComponent(created.id)}`;
        this.save({ project_id: projectId, lead_thread_id: result.leadThreadId, page_id: created.id });
        this.db.prepare("UPDATE office_bot_projects SET imported_page_id=? WHERE bot_id=?").run(created.id, bot.id);
      } else if (imported?.imported_page_id !== result.pageId) {
        const { markdown } = await this.sdk.plugins.callRpc({ pluginId: "pages", method: "markdown", input: { id: result.pageId }, outputSchema: z.object({ markdown: z.string() }) });
        const marker = `<!-- Imported bot ${bot.id} -->`;
        if (!markdown.includes(marker)) await this.sdk.plugins.callRpc({ pluginId: "pages", method: "editDocument", input: { id: result.pageId, expected: markdown, markdown: `${markdown}\n\n${marker}\n\n${sections}` }, outputSchema: z.object({ markdown: z.string() }) });
        this.db.prepare("UPDATE office_bot_projects SET imported_page_id=? WHERE bot_id=?").run(result.pageId, bot.id);
      }
      if (!result.leadThreadId && bot.threadId) {
        const thread = await this.sdk.threads.get({ threadId: bot.threadId });
        if (thread.deletedAt == null) {
          await this.sdk.threads.updatePluginMetadata({ threadId: bot.threadId, set: { role: result.role === "chief-of-staff" ? "chief-of-staff" : "project-lead", projectId, pageId: result.pageId } });
          result.leadThreadId = bot.threadId;
          this.save({ project_id: projectId, page_id: result.pageId, lead_thread_id: bot.threadId });
          await this.sdk.threads.unpin({ threadId: bot.threadId });
        }
      }
      if (result.pageId) this.links.remember(projectId, { ref: `item:pages:${result.pageId}`, title: result.name, kind: "page", href: result.pageHref!, icon: "📁" });
      if (result.leadThreadId) this.links.remember(projectId, { ref: `thread:${result.leadThreadId}`, title: `${result.name} · lead`, kind: "thread", href: `/threads/${encodeURIComponent(result.leadThreadId)}`, icon: null });
      this.changed(); return result;
    });
  }
  async threads(projectId: string) {
    const project = await this.get(projectId);
    const membership = await this.links.all();
    const explicit = new Set(this.links.rows(project.id).map(r => r.ref));
    const threads: z.output<typeof officeProjectsContract.project_threads.output>["threads"] = [];
    for (const [threadId, owner] of Object.entries(membership.threads)) {
      if (owner !== project.id) continue;
      const thread = await this.sdk.threads.get({ threadId }).catch(error => { if (rpcErrorStatus(error) === 404) return null; throw error; });
      if (!thread || thread.deletedAt != null || (thread.parentThreadId && !explicit.has(`thread:${threadId}`))) continue;
      threads.push({ id: thread.id, title: thread.title, status: thread.status, updatedAt: thread.updatedAt, linked: explicit.has(`thread:${threadId}`), isLead: thread.id === project.leadThreadId });
    }
    threads.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { threads };
  }
}
