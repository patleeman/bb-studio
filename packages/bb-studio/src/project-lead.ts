// A BB project's lead is optional: an ordinary thread the user makes the lead
// (project_set_lead). The project's heartbeat (ProjectRuns, below) wakes the
// lead on a schedule; a handoff keeps its successor the lead. A thread leads
// at most one project, and needn't be in the project it leads.
//
// The personal project's lead is the user's Bot's thread (src/bot.ts; it was
// called the Chief of Staff). It sees every project, and its heartbeat uses
// the Bot's prompt (botHeartbeat).
//
// Leads used to belong to Studio Spaces. A migration (src/migrations.ts)
// queues each Space's lead and heartbeat in `space_lead_moves`;
// ProjectLeads.finishMoves puts them on the Space's main project, which needs
// BB to say which project the lead thread is in.
//
// The heartbeat runs on Studio's own scheduler (src/triggers/scheduler.ts),
// not BB's automations plugin: `project_runs.automation_id` holds its
// `trg_heartbeat_<key>` id. Threads live in BB, so nothing here shares a
// transaction with them: every step can be retried without making a second
// one.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcErrorStatus } from "./kit/server/index";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { ChiefOfStaffView, HeartbeatRun, NewThreadRequestInput, ProjectLeadView } from "./contract";
import { heartbeatRunSchema } from "./contract";
import { fromHeartbeat, localZone } from "./schedule";
import { isScheduleId, type EngineScheduler, type RunTarget, type ScheduleStatus } from "./triggers/scheduler";

type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["get"]>>;
/** BB's personal project. Its lead is the Chief of Staff. */
export const PERSONAL_PROJECT_ID = "proj_personal";
export const LEAD_ROLE = "project-lead";
export const HEARTBEAT = "Heartbeat: check on this project's threads and Studio items. Steer only the workers you started; for threads the user started, read and report but don't steer them. Reply only when something changed or needs the user; otherwise reply exactly [PASS] (no ✓ or other filler), and reuse a worker you started before rather than starting a new one for each heartbeat.";
export const CHIEF_HEARTBEAT = "Heartbeat: you are the user's Chief of Staff, the lead of their personal project and above every other project. Check on the projects and their leads; hand work to a project's lead rather than doing it yourself. Steer only the workers and leads' work you started; read and report on threads the user started. Reply only when something changed or needs the user; otherwise reply exactly [PASS] (no ✓ or other filler), and reuse a worker you started before rather than starting a new one for each heartbeat.";

export interface ProjectLeadDeps {
  db: Database.Database;
  sdk: Sdk;
  /** Studio's scheduler: it wakes the lead for each heartbeat. */
  scheduler: EngineScheduler;
  /** Open collections refetch. */
  changed(): void;
  /** The personal project's heartbeat prompt (the Bot's); CHIEF_HEARTBEAT when absent. */
  personalPrompt?(): string;
  /** An additional Bot's check-in prompt, for its run key (`bot:<id>`, src/bot.ts); null for other keys. */
  botPrompt?(key: string): string | null;
}

/** project_runs also keeps additional Bots' check-ins, keyed `bot:<id>`: not projects. */
export const BOT_RUN_PREFIX = "bot:";

const threadTitle = (thread: Pick<Thread, "title" | "titleFallback">) => thread.title || thread.titleFallback || "Untitled thread";
const missing = (error: unknown) => rpcErrorStatus(error) === 404;

export class ProjectLeads {
  private pending: Promise<unknown> = Promise.resolve();
  readonly runs: ProjectRuns;

  constructor(private readonly deps: ProjectLeadDeps) {
    this.runs = new ProjectRuns(deps.db, deps.sdk, deps.scheduler, deps.changed, deps.personalPrompt, deps.botPrompt);
  }

  // Lead transfers touch two projects. Reads and mutations share one queue so
  // transfers cannot deadlock or race a stale read clearing a new lead.
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => {}).then(run);
    this.pending = next;
    return next;
  }

  storedLead(projectId: string): string | null {
    return (this.deps.db.prepare("SELECT lead_thread_id FROM project_leads WHERE project_id = ?").get(projectId) as { lead_thread_id: string | null } | undefined)?.lead_thread_id ?? null;
  }

  private saveLead(projectId: string, threadId: string | null) {
    const now = Date.now();
    this.deps.db
      .prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET lead_thread_id = excluded.lead_thread_id, updated_at = excluded.updated_at")
      .run(projectId, threadId, now, now);
  }

  private async thread(threadId: string): Promise<Thread | null> {
    const thread = await this.deps.sdk.threads.get({ threadId }).catch((error) => { if (missing(error)) return null; throw error; });
    return thread && thread.deletedAt == null ? thread : null;
  }

  /** The project's lead; forgets a lead thread that was deleted and turns its heartbeat off. Transport errors keep it. */
  private async read(projectId: string): Promise<ProjectLeadView> {
    let leadThreadId = this.storedLead(projectId);
    if (leadThreadId && !(await this.thread(leadThreadId))) {
      this.saveLead(projectId, null);
      leadThreadId = null;
      const run = this.runs.get(projectId);
      if (run?.enabled) await this.runs.set(projectId, null, { ...run, enabled: false }).catch(() => {});
    }
    return { projectId, leadThreadId, run: this.runs.get(projectId) };
  }

  get(projectId: string): Promise<ProjectLeadView> {
    return this.serial(() => this.read(projectId));
  }

  /** Every project with a lead or heartbeat settings, as stored. */
  list(): ProjectLeadView[] {
    const rows = this.deps.db.prepare("SELECT project_id FROM project_leads WHERE lead_thread_id IS NOT NULL UNION SELECT project_id FROM project_runs WHERE project_id NOT LIKE 'bot:%' ORDER BY project_id").all() as { project_id: string }[];
    return rows.map(({ project_id: projectId }) => ({ projectId, leadThreadId: this.storedLead(projectId), run: this.runs.get(projectId) }));
  }

  /** The project a thread leads, if any. */
  ledBy(threadId: string): string | null {
    return (this.deps.db.prepare("SELECT project_id FROM project_leads WHERE lead_thread_id = ?").get(threadId) as { project_id: string } | undefined)?.project_id ?? null;
  }

  /**
   * Makes an existing thread the project's lead, or clears the lead and turns
   * the heartbeat off. A thread leads one project: the one it led loses its
   * lead and heartbeat, whose schedule carries over if this project has none.
   */
  setLead(projectId: string, threadId: string | null): Promise<ProjectLeadView> {
    return this.serial(async () => {
      let run = this.runs.get(projectId);
      if (threadId) {
        if (this.storedLead(projectId) === threadId) return this.read(projectId);
        const thread = await this.thread(threadId);
        if (!thread) throw new Error("That thread no longer exists.");
        if (thread.archivedAt != null) throw new Error("That thread is archived. Unarchive it before making it a lead.");
        const led = this.ledBy(threadId);
        const ledRun = led ? this.runs.get(led) : null;
        if (!run && ledRun) run = { ...ledRun };
        // Move the heartbeat first: if it can't target the new thread, the old lead stays.
        if (run?.enabled) await this.runs.set(projectId, threadId, run);
        if (led) {
          const ledNow = this.runs.get(led);
          if (ledNow?.enabled) await this.runs.set(led, null, { ...ledNow, enabled: false });
          if (this.storedLead(led) === threadId) this.saveLead(led, null);
        }
        this.saveLead(projectId, threadId);
      } else {
        if (run?.enabled) await this.runs.set(projectId, null, { ...run, enabled: false });
        this.saveLead(projectId, null);
      }
      this.deps.changed();
      return this.read(projectId);
    });
  }

  setRun(projectId: string, input: { enabled: boolean; cadence: HeartbeatRun["cadence"]; time?: string; cron?: string }): Promise<ProjectLeadView> {
    return this.serial(async () => {
      const current = await this.read(projectId);
      if (input.enabled && !current.leadThreadId) throw new Error(projectId === PERSONAL_PROJECT_ID ? "Make your Bot before turning on its heartbeat." : "Pick the project's lead before turning on its heartbeat.");
      await this.runs.set(projectId, current.leadThreadId, { enabled: input.enabled, cadence: input.cadence, time: input.time ?? current.run?.time ?? "09:00", cron: input.cron ?? current.run?.cron });
      return this.read(projectId);
    });
  }

  /** The Chief of Staff (the personal project's lead) as stored; may be a deleted thread until read. */
  chiefThreadId(): string | null {
    return this.storedLead(PERSONAL_PROJECT_ID);
  }

  private chiefView(view: ProjectLeadView): ChiefOfStaffView {
    return { threadId: view.leadThreadId, run: view.run };
  }

  /** The personal project's lead, in the Chief of Staff shape. */
  async chief(): Promise<ChiefOfStaffView> {
    return this.chiefView(await this.get(PERSONAL_PROJECT_ID));
  }

  async setChief(threadId: string | null): Promise<ChiefOfStaffView> {
    return this.chiefView(await this.setLead(PERSONAL_PROJECT_ID, threadId));
  }

  async setChiefRun(input: { enabled: boolean; cadence: HeartbeatRun["cadence"]; time?: string; cron?: string }): Promise<ChiefOfStaffView> {
    return this.chiefView(await this.setRun(PERSONAL_PROJECT_ID, input));
  }

  /**
   * Puts each Space's lead and heartbeat, queued by the migration, on the
   * Space's main project: the personal project for the default Space;
   * otherwise the project the lead thread is in, or the Space's own pick
   * (`fallback_project_id`) when it has no lead or the lead is gone. A project
   * that already has a lead keeps it. An enabled heartbeat is provisioned
   * again by ProjectRuns.repair. A transport error stops here; the next
   * startup retries the rest.
   */
  async finishMoves(): Promise<void> {
    const db = this.deps.db;
    const moves = db.prepare("SELECT * FROM space_lead_moves ORDER BY is_default DESC, lead_updated_at DESC, space_id").all() as MoveRow[];
    for (const move of moves) {
      const thread = move.lead_thread_id ? await this.thread(move.lead_thread_id) : null;
      const projectId = move.is_default ? PERSONAL_PROJECT_ID : thread?.projectId ?? move.fallback_project_id;
      db.transaction(() => {
        db.prepare("DELETE FROM space_lead_moves WHERE space_id = ?").run(move.space_id);
        if (!projectId || this.storedLead(projectId) || db.prepare("SELECT 1 FROM project_runs WHERE project_id = ?").get(projectId)) return;
        const lead = thread && !this.ledBy(thread.id) ? thread.id : null;
        if (lead) {
          db.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET lead_thread_id = excluded.lead_thread_id")
            .run(projectId, lead, move.lead_updated_at, move.lead_updated_at);
        }
        if (move.cadence) {
          db.prepare("INSERT INTO project_runs (project_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES (?, ?, ?, ?, ?, NULL, NULL)")
            .run(projectId, lead && move.enabled ? 1 : 0, move.cadence, move.time, move.cron);
        }
      })();
    }
  }

  handoff(threadId: string, request: NewThreadRequestInput): Promise<{ threadId: string }> {
    const db = this.deps.db;
    const ledProject = (db.prepare("SELECT project_id FROM project_leads WHERE lead_thread_id = ? UNION SELECT project_id FROM project_thread_handoffs WHERE old_thread_id = ? AND lead = 1 AND project_id IS NOT NULL").get(threadId, threadId) as { project_id: string } | undefined)?.project_id ?? null;
    return this.serial(async () => {
      const previous = db.prepare("SELECT new_thread_id, archived FROM project_thread_handoffs WHERE old_thread_id = ?").get(threadId) as { new_thread_id: string; archived: number } | undefined;
      const old = await this.deps.sdk.threads.get({ threadId });
      // Leadership moves only while this thread, or its successor on a retry, is still the lead.
      const current = ledProject ? this.storedLead(ledProject) : null;
      const leading = ledProject && current && (current === threadId || current === previous?.new_thread_id) ? ledProject : null;
      let newId = previous?.new_thread_id;
      if (!newId) {
        const { output } = await this.deps.sdk.threads.output({ threadId });
        const summary = [
          `Continue the work from /threads/${encodeURIComponent(threadId)} (${threadTitle(old)}). Read that thread with bb thread if you need more context.`,
          `Latest response (excerpt):\n${(output ?? "No response yet.").slice(-12_000)}`,
          ledProject === PERSONAL_PROJECT_ID ? "You are now the user's Bot, the lead of their personal project and above every other project. Hand work to each project's lead, steer the workers you start (read but don't steer threads the user started), and report in this thread." : "",
          ledProject && ledProject !== PERSONAL_PROJECT_ID ? `You are now the lead of the project ${ledProject}. Steer the workers you start (read but don't steer threads the user started), and report in this thread.` : "",
        ].filter(Boolean).join("\n\n");
        const next = await this.deps.sdk.threads.spawn({
          ...request,
          projectId: old.projectId,
          title: old.title ?? "Handoff",
          pluginMetadata: { ...(ledProject ? { role: LEAD_ROLE, projectId: ledProject } : {}), handoffFrom: threadId },
          input: [{ type: "text", text: summary, mentions: [], visibility: "agent-only" }, ...request.input],
        });
        newId = next.id;
        db.prepare("INSERT INTO project_thread_handoffs (old_thread_id, new_thread_id, project_id, lead) VALUES (?, ?, ?, ?)").run(threadId, newId, ledProject, ledProject ? 1 : 0);
      }
      if (leading) {
        this.saveLead(leading, newId);
        await this.deps.sdk.threads.unpin({ threadId: newId }).catch(() => {});
        const run = this.runs.get(leading);
        if (run?.enabled) await this.runs.set(leading, newId, run);
      }
      if (!previous?.archived) {
        await this.deps.sdk.threads.archive({ threadId });
        db.prepare("UPDATE project_thread_handoffs SET archived = 1 WHERE old_thread_id = ?").run(threadId);
      }
      this.deps.changed();
      return { threadId: newId };
    });
  }
}

type MoveRow = {
  space_id: string; is_default: number; lead_thread_id: string | null; lead_updated_at: number; fallback_project_id: string | null;
  enabled: number | null; cadence: HeartbeatRun["cadence"] | null; time: string | null; cron: string | null;
};
type RunRow = Omit<HeartbeatRun, "cron"> & { cron: string | null; project_id: string; enabled: number | boolean; automation_id: string | null; automation_project_id: string | null; lead_thread_id: string | null };

/** A heartbeat's settings and identity; Studio's scheduler owns when it runs. */
export class ProjectRuns {
  private pending = new Map<string, Promise<void>>();
  constructor(private db: Database.Database, private sdk: Sdk, private scheduler: EngineScheduler, private changed: () => void, private personalPrompt: () => string = () => CHIEF_HEARTBEAT, private botPrompt: (key: string) => string | null = () => null) {
    scheduler.resolve("heartbeat", (projectId) => this.target(projectId));
  }

  /** What a due heartbeat sends, read when it is due: the lead as stored and the prompt as it is now. */
  private target(projectId: string): RunTarget | null {
    const row = this.row(projectId);
    if (!row?.enabled || !row.lead_thread_id) return null;
    return { threadId: row.lead_thread_id, prompt: this.prompt(projectId) };
  }

  private prompt(projectId: string): string {
    return projectId === PERSONAL_PROJECT_ID ? this.personalPrompt() : projectId.startsWith(BOT_RUN_PREFIX) ? this.botPrompt(projectId) ?? CHIEF_HEARTBEAT : `${HEARTBEAT}\nProject: ${projectId}.`;
  }

  /**
   * Finishes migrations (src/migrations.ts) and any heartbeat left on without
   * a schedule: deletes retired BB automations and provisions enabled
   * heartbeats again. Safe to run at every startup. When BB can't delete a
   * retired automation now (its automations plugin is off or does not
   * answer), the rest stay listed for the next startup, one try each, and
   * the heartbeats are still provisioned.
   */
  async repair(leadOf: (projectId: string) => string | null): Promise<void> {
    const retired = this.db.prepare("SELECT automation_id, automation_project_id FROM space_retired_automations").all() as { automation_id: string; automation_project_id: string | null }[];
    for (const row of retired) {
      if (!await this.deleteOld(row.automation_id, row.automation_project_id)) break;
      this.db.prepare("DELETE FROM space_retired_automations WHERE automation_id = ?").run(row.automation_id);
    }
    const orphaned = this.db.prepare("SELECT project_id FROM project_runs WHERE enabled = 1 AND automation_id IS NULL").all() as { project_id: string }[];
    for (const { project_id: projectId } of orphaned) {
      const run = this.get(projectId)!;
      const lead = leadOf(projectId);
      await this.set(projectId, lead, lead ? run : { ...run, enabled: false });
    }
  }

  private row(projectId: string) {
    return this.db.prepare("SELECT * FROM project_runs WHERE project_id = ?").get(projectId) as RunRow | undefined;
  }

  /** The heartbeat's schedule id (the id in its runs' marker), if it has one. */
  automation(projectId: string): { id: string; projectId: string } | null {
    const row = this.row(projectId);
    return row?.automation_id ? { id: row.automation_id, projectId: row.automation_project_id ?? PERSONAL_PROJECT_ID } : null;
  }

  /** When the heartbeat runs next and how its last run went; null while it has no schedule. */
  status(projectId: string): ScheduleStatus | null {
    return isScheduleId(this.row(projectId)?.automation_id) ? this.scheduler.status({ owner: "heartbeat", ownerId: projectId }) : null;
  }

  get(projectId: string): HeartbeatRun | null {
    const row = this.row(projectId);
    return row ? { enabled: !!row.enabled, cadence: row.cadence, time: row.time, ...(row.cron == null ? {} : { cron: row.cron }) } : null;
  }

  /** Deletes a BB automation from before Studio scheduled these itself. True when it is gone; false when BB could not say within ten seconds. */
  private async deleteOld(automationId: string, projectId: string | null): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      this.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_delete", input: { projectId, automationId } as never, outputSchema: z.unknown() }).then(() => true, (error) => missing(error)),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 10_000); }),
    ]).finally(() => clearTimeout(timer));
  }

  set(projectId: string, leadThreadId: string | null, run: HeartbeatRun): Promise<void> {
    const next = (this.pending.get(projectId) ?? Promise.resolve()).catch(() => {}).then(() => this.provision(projectId, leadThreadId, run));
    this.pending.set(projectId, next);
    void next.finally(() => { if (this.pending.get(projectId) === next) this.pending.delete(projectId); }).catch(() => {});
    return next;
  }

  private async provision(projectId: string, leadThreadId: string | null, run: HeartbeatRun) {
    // Validate before any stored state or existing schedule is changed, even when off.
    run = heartbeatRunSchema.parse(run);
    if (run.cadence === "custom" && !run.cron) throw new Error("Custom check-ins require a valid five-field cron expression.");
    const row = this.row(projectId);
    const key = { owner: "heartbeat" as const, ownerId: projectId };
    // One left from before the move to Studio's scheduler (src/triggers/migrate.ts moves the rest at startup).
    if (row?.automation_id && !isScheduleId(row.automation_id) && !await this.deleteOld(row.automation_id, row.automation_project_id)) {
      this.db.prepare("INSERT OR IGNORE INTO space_retired_automations (automation_id, automation_project_id) VALUES (?, ?)").run(row.automation_id, row.automation_project_id);
    }
    if (!run.enabled || !leadThreadId) {
      this.scheduler.remove(key);
      this.db
        .prepare("INSERT INTO project_runs (project_id, enabled, cadence, time, cron, automation_id, automation_project_id, lead_thread_id) VALUES (?, 0, ?, ?, ?, NULL, NULL, NULL) ON CONFLICT (project_id) DO UPDATE SET enabled = 0, cadence = excluded.cadence, time = excluded.time, cron = excluded.cron, automation_id = NULL, automation_project_id = NULL, lead_thread_id = NULL")
        .run(projectId, run.cadence, run.time, run.cron ?? null);
      this.changed();
      return;
    }
    const [thread, defaults] = await Promise.all([this.sdk.threads.get({ threadId: leadThreadId }), this.sdk.threads.defaultExecutionOptions({ threadId: leadThreadId })]);
    if (!thread.providerId || !defaults?.model) throw new Error("Choose a provider and model for the lead before turning on its heartbeat.");
    // The same schedule keeps its next time, so saving again (a new lead, the startup repair) does not push a run back.
    const id = this.scheduler.ensure(key, { schedule: fromHeartbeat(run), timeZone: localZone() }, true);
    this.db
      .prepare("INSERT INTO project_runs (project_id, enabled, cadence, time, cron, automation_id, automation_project_id, lead_thread_id) VALUES (?, 1, ?, ?, ?, ?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET enabled = 1, cadence = excluded.cadence, time = excluded.time, cron = excluded.cron, automation_id = excluded.automation_id, automation_project_id = excluded.automation_project_id, lead_thread_id = excluded.lead_thread_id")
      .run(projectId, run.cadence, run.time, run.cron ?? null, id, thread.projectId ?? PERSONAL_PROJECT_ID, leadThreadId);
    this.changed();
  }
}

export function heartbeatCron(run: HeartbeatRun): string {
  const [hour, minute] = run.time.split(":").map(Number);
  switch (run.cadence) {
    case "every5minutes": return "*/5 * * * *";
    case "every15minutes": return "*/15 * * * *";
    case "every30minutes": return "*/30 * * * *";
    case "every2hours": return `${minute} */2 * * *`;
    case "every6hours": return `${minute} */6 * * *`;
    case "hourly": return `${minute} * * * *`;
    case "daily": return `${minute} ${hour} * * *`;
    case "weekdays": return `${minute} ${hour} * * 1-5`;
    case "weekly": return `${minute} ${hour} * * 1`;
    case "custom": return run.cron!;
  }
}
