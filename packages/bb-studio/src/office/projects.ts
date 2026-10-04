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
  constructor(private readonly db: Database.Database, private readonly sdk: BbPluginApi["sdk"], private readonly changed: () => void) {}

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
    const project = await this.sdk.projects.get({ projectId });
    if (project.kind === "personal") throw new Error("Choose a project, not the personal workspace.");
    const row = this.db.prepare("SELECT * FROM office_projects WHERE project_id=?").get(projectId) as Row | undefined;
    const result = { projectId, name: project.name, leadThreadId: row?.lead_thread_id ?? null, pageId: row?.page_id ?? null, pageHref: null as string | null };
    if (result.leadThreadId) {
      const thread = await this.sdk.threads.get({ threadId: result.leadThreadId }).catch(error => {
        if (rpcErrorStatus(error) === 404) return null;
        throw error;
      });
      if (!thread || thread.projectId !== projectId) result.leadThreadId = null;
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
  get(projectId: string) { return this.serial(projectId, () => this.read(projectId)); }
  setup({ projectId, request }: Setup) {
    return this.serial(projectId, async () => {
      const result = await this.read(projectId);
      if (!result.pageId) {
        const brief = request.input.filter(part => part.type === "text").map(part => part.text).join("\n\n");
        const { page: created } = await this.sdk.plugins.callRpc({ pluginId: "pages", method: "create", input: {
          projectId, parentId: null, title: result.name, icon: "📁",
          markdown: `## Brief\n\n${brief || "What this project is for."}\n\n## Plan\n\nNext steps.\n\n## Decisions\n\nDecisions and their reasons.\n\n## Memory\n\nShared by every thread in this project: facts, preferences, conventions\n\n## Links\n\nUseful pages, artifacts and references.\n`,
        }, outputSchema: z.object({ page }) });
        result.pageId = created.id;
        result.pageHref = `/plugins/pages/pages/${encodeURIComponent(created.id)}`;
        // Persist each external result before the next call, so a spawn failure
        // can be retried without creating another page.
        this.save({ project_id: projectId, lead_thread_id: result.leadThreadId, page_id: result.pageId });
      }
      if (!result.leadThreadId) {
        const instructions = `You are the lead for project ${result.name} (${projectId}). You own this project and coordinate its work.\nRead the project page ${result.pageHref} (page ${result.pageId}) with the Pages tools, especially its Memory section, before acting. Keep its Brief, Plan, Decisions, Memory and Links current. Memory is shared by every thread in this project; tell every worker to read it before acting and record lasting facts, preferences and conventions there.\nStart and steer worker threads in this project for parallel work using bb thread spawn and bb thread tell. Keep their scopes clear and review their results. Report progress and anything waiting on the user to the Studio Inbox.\nThe user's first message follows and describes what the project is about.`;
        const lead = await this.sdk.threads.spawn({ ...request, projectId, title: `${result.name} · lead`,
          pluginMetadata: { role: "project-lead", projectId, pageId: result.pageId },
          input: [{ type: "text", text: instructions, mentions: [] }, ...request.input],
        });
        result.leadThreadId = lead.id;
        this.save({ project_id: projectId, lead_thread_id: lead.id, page_id: result.pageId });
        await this.sdk.threads.unpin({ threadId: lead.id });
      }
      return result;
    });
  }
  async threads(projectId: string) {
    const project = await this.get(projectId);
    const threads: z.output<typeof officeProjectsContract.project_threads.output>["threads"] = [];
    for (let offset = 0; ; offset += 100) {
      const batch = await this.sdk.threads.list({ projectId, hasParent: false, limit: 100, offset });
      threads.push(...batch.filter(t => t.projectId === projectId && !t.parentThreadId).map(t => ({
        id: t.id, title: t.title, status: t.status, updatedAt: t.updatedAt, isLead: t.id === project.leadThreadId,
      })));
      if (batch.length < 100) break;
    }
    threads.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { threads };
  }
}
