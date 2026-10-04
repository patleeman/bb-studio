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
  constructor(private readonly db: Database.Database, private readonly sdk: BbPluginApi["sdk"], private readonly changed: () => void) { this.runs = new ProjectRuns(db, sdk, changed); }

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
    const role = project.kind === "personal" ? "chief-of-staff" as const : "project" as const;
    const row = this.db.prepare("SELECT * FROM office_projects WHERE project_id=?").get(projectId) as Row | undefined;
    const result = { projectId, role, run: this.runs.get(projectId), name: role === "chief-of-staff" ? "Chief of Staff" : project.name, leadThreadId: row?.lead_thread_id ?? null, pageId: row?.page_id ?? null, pageHref: null as string | null };
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
  get(projectId: string) { return this.serial(projectId, () => this.read(projectId)); }
  setup({ projectId, request }: Setup) {
    return this.serial(projectId, async () => {
      const result = await this.read(projectId);
      if (!result.pageId) {
        const brief = request.input.filter(part => part.type === "text").map(part => part.text).join("\n\n");
        const { page: created } = await this.sdk.plugins.callRpc({ pluginId: "pages", method: "create", input: {
          projectId, parentId: null, title: result.name, icon: "📁",
          markdown: result.role === "chief-of-staff" ? `## What I watch\n\n${brief}\n\n## Handed off\n\nProjects and their leads.\n\n## Memory\n\nShared facts, preferences and conventions.\n` : `## Brief\n\n${brief || "What this project is for."}\n\n## Plan\n\nNext steps.\n\n## Decisions\n\nDecisions and their reasons.\n\n## Memory\n\nShared by every thread in this project: facts, preferences, conventions\n\n## Links\n\nUseful pages, artifacts and references.\n`,
        }, outputSchema: z.object({ page }) });
        result.pageId = created.id;
        result.pageHref = `/plugins/pages/pages/${encodeURIComponent(created.id)}`;
        // Persist each external result before the next call, so a spawn failure
        // can be retried without creating another page.
        this.save({ project_id: projectId, lead_thread_id: result.leadThreadId, page_id: result.pageId });
      }
      if (!result.leadThreadId) {
        const instructions = (result.role === "chief-of-staff" ? `You are Patrick’s Chief of Staff. Handle one-offs; create and staff projects. Create the BB project if needed using the SDK or bb project, then call Studio project_setup with a sensible composer request. Hand work to each project’s lead using bb thread tell <lead>. Keep What I watch, Handed off and Memory current. ` : "") + `You are the lead for project ${result.name} (${projectId}). You own this project and coordinate its work.\nRead the project page ${result.pageHref} (page ${result.pageId}) with the Pages tools, especially its Memory section, before acting. Keep its Brief, Plan, Decisions, Memory and Links current. Memory is shared by every thread in this project; tell every worker to read it before acting and record lasting facts, preferences and conventions there.\nStart and steer worker threads in this project for parallel work using bb thread spawn and bb thread tell. Keep their scopes clear and review their results. Report progress and anything waiting on the user to the Studio Inbox.\nThe user's first message follows and describes what the project is about.`;
        const lead = await this.sdk.threads.spawn({ ...request, projectId, title: `${result.name} · lead`,
          pluginMetadata: { role: result.role === "chief-of-staff" ? "chief-of-staff" : "project-lead", projectId, pageId: result.pageId },
          input: [{ type: "text", text: instructions, mentions: [], visibility: "agent-only" }, ...request.input],
        });
        result.leadThreadId = lead.id;
        this.save({ project_id: projectId, lead_thread_id: lead.id, page_id: result.pageId });
        await this.sdk.threads.unpin({ threadId: lead.id });
      }
      if (result.run?.enabled) await this.runs.set(projectId, result.leadThreadId, result.run);
      return result;
    });
  }
  setRun(input: z.output<typeof officeProjectsContract.project_set_run.input>) {
    return this.serial(input.projectId, async () => {
      const project = await this.read(input.projectId);
      if (input.enabled && !project.leadThreadId) throw new Error("Start the project lead before enabling Run mode.");
      await this.runs.set(input.projectId, project.leadThreadId, { enabled: input.enabled, cadence: input.cadence, time: input.time ?? "09:00" });
      return { ...project, run: this.runs.get(input.projectId) };
    });
  }
  handoff({ threadId, request }: z.output<typeof officeProjectsContract.thread_handoff.input>) {
    const owner = this.db.prepare("SELECT project_id FROM office_projects WHERE lead_thread_id=? UNION SELECT project_id FROM office_thread_handoffs WHERE old_thread_id=? AND project_id IS NOT NULL").get(threadId, threadId) as { project_id: string } | undefined;
    return this.serial(owner?.project_id ?? `thread:${threadId}`, async () => {
      const previous = this.db.prepare("SELECT new_thread_id,archived FROM office_thread_handoffs WHERE old_thread_id=?").get(threadId) as { new_thread_id: string; archived: number } | undefined;
      const old = await this.sdk.threads.get({ threadId });
      const hub = await this.read(owner?.project_id ?? old.projectId);
      let newId = previous?.new_thread_id;
      if (!newId) {
        const { output } = await this.sdk.threads.output({ threadId });
        const summary = `Continue work from /threads/${encodeURIComponent(threadId)} (${old.title ?? "Untitled"}).\nLatest response (excerpt):\n${(output ?? "No response yet.").slice(-12000)}\nProject page: ${hub.pageHref ?? "Not set up; use project_get"}. Read its Memory before acting. Use bb thread to read the old conversation if more context is needed.`;
        const { prompt, ...composer } = request;
        const note = prompt?.trim();
        const next = await this.sdk.threads.spawn({ ...composer, projectId: old.projectId, title: old.title ?? "Handoff", pluginMetadata: { ...(owner ? { role: hub.role === "chief-of-staff" ? "chief-of-staff" : "project-lead", projectId: hub.projectId, pageId: hub.pageId } : {}), handoffFrom: threadId },
          input: [{ type: "text", text: `${summary}${owner ? "\nYou are this hub’s lead. Keep its page and shared Memory current, coordinate worker threads, and report progress to the Studio Inbox." : ""}`, mentions: [], visibility: "agent-only" }, ...request.input, ...(note ? [{ type: "text" as const, text: note, mentions: [] }] : [])],
        });
        newId = next.id;
        this.db.prepare("INSERT INTO office_thread_handoffs(old_thread_id,new_thread_id,project_id) VALUES (?,?,?)").run(threadId, newId, owner?.project_id ?? null);
      }
      if (owner) {
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
  importBot(projectId: string, bot: { id: string; name: string; mission: string; memory: string; threadId: string | null }) {
    return this.serial(projectId, async () => {
      const result = await this.read(projectId);
      const imported = this.db.prepare("SELECT imported_page_id FROM office_bot_projects WHERE bot_id=?").get(bot.id) as { imported_page_id: string | null } | undefined;
      const sections = `## Brief\n\n${bot.mission}\n\n## Memory\n\n${bot.memory}\n`;
      if (!result.pageId) {
        const { page: created } = await this.sdk.plugins.callRpc({ pluginId: "pages", method: "create", input: { projectId, parentId: null, title: result.name, icon: "📁", markdown: result.role === "chief-of-staff" ? `## What I watch\n\n${bot.mission}\n\n## Handed off\n\n## Memory\n\n${bot.memory}\n` : `${sections}\n## Plan\n\n## Decisions\n\n## Links\n` }, outputSchema: z.object({ page }) });
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
      this.changed(); return result;
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
