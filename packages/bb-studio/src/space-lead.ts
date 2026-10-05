// A Space's lead is optional: an ordinary thread the user makes the lead
// (space_set_lead). The Space's heartbeat (SpaceRuns, below)
// wakes the lead on a schedule; a handoff keeps its successor the lead. Each
// thread is in at most one space (src/space-threads.ts).
//
// Threads and automations live in other plugins, so nothing here shares a
// transaction with them: each external result is saved before the next call,
// and every step can be retried without making a second one.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcErrorStatus } from "@bb-studio/kit/server";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { NewThreadRequestInput, SpaceLeadView, SpaceRun } from "./contract";
import { spaceRunSchema } from "./contract";
import { PERSONAL_PROJECT_ID, THREAD_REF, type Space, type SpaceStore } from "./spaces";

type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["get"]>>;
type Listed = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
export const LEAD_ROLE = "space-lead";
export const HEARTBEAT = "Heartbeat: check on this space's threads and items. Steer only the workers you started; for threads the user started, read and report but don't steer them. Reply only when something changed or needs the user; otherwise finish without a final assistant message.";
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const SNAPSHOT_MS = 60_000;

export interface SpaceLeadDeps {
  db: Database.Database;
  sdk: Sdk;
  spaces: SpaceStore;
  /** Open collections and sidebars refetch. */
  changed(): void;
}

const threadTitle = (thread: Pick<Thread, "title" | "titleFallback">) => thread.title || thread.titleFallback || "Untitled thread";
const missing = (error: unknown) => rpcErrorStatus(error) === 404;

export class SpaceLeads {
  private readonly pending = new Map<string, Promise<unknown>>();
  readonly runs: SpaceRuns;
  private snapshot: { at: number; fingerprint: string; threads: Promise<Record<string, string>> } | null = null;

  constructor(private readonly deps: SpaceLeadDeps) {
    this.runs = new SpaceRuns(deps.db, deps.sdk, deps.changed);
  }

  // Reads, lead, run and handoff for one space share a queue: a stale read
  // must not clear a lead another request just made. A failure frees the queue.
  private serial<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (this.pending.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    this.pending.set(key, next);
    void next.finally(() => { if (this.pending.get(key) === next) this.pending.delete(key); }).catch(() => {});
    return next;
  }

  private space(spaceId: string): Space {
    const space = this.deps.spaces.get(spaceId);
    if (!space) throw new Error("That space no longer exists.");
    return space;
  }

  private storedLead(spaceId: string): string | null {
    return (this.deps.db.prepare("SELECT lead_thread_id FROM space_leads WHERE space_id = ?").get(spaceId) as { lead_thread_id: string | null } | undefined)?.lead_thread_id ?? null;
  }

  private saveLead(spaceId: string, threadId: string | null) {
    const now = Date.now();
    this.deps.db
      .prepare("INSERT INTO space_leads (space_id, lead_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (space_id) DO UPDATE SET lead_thread_id = excluded.lead_thread_id, updated_at = excluded.updated_at")
      .run(spaceId, threadId, now, now);
  }

  private async thread(threadId: string): Promise<Thread | null> {
    const thread = await this.deps.sdk.threads.get({ threadId }).catch((error) => { if (missing(error)) return null; throw error; });
    return thread && thread.deletedAt == null ? thread : null;
  }

  /** The space and its lead; forgets a lead thread that was deleted and turns its heartbeat off. Transport errors keep it. */
  private async read(spaceId: string): Promise<SpaceLeadView> {
    const space = this.space(spaceId);
    let leadThreadId = this.storedLead(spaceId);
    if (leadThreadId && !(await this.thread(leadThreadId))) {
      this.saveLead(spaceId, null);
      leadThreadId = null;
      const run = this.runs.get(spaceId);
      if (run?.enabled) await this.runs.set(spaceId, null, { ...run, enabled: false }).catch(() => {});
    }
    return { spaceId: space.id, name: space.name, icon: space.icon, color: space.color, leadThreadId, defaultProjectId: space.defaultProjectId, run: this.runs.get(spaceId) };
  }

  private join(spaceId: string, threadId: string) {
    this.deps.spaces.add(spaceId, [{ pluginId: THREAD_REF, id: threadId }]);
  }

  get(spaceId: string): Promise<SpaceLeadView> {
    this.space(spaceId);
    return this.serial(spaceId, () => this.read(spaceId));
  }

  /** Makes an existing thread the space's lead, adding it to the space, or clears the lead and turns the heartbeat off. */
  setLead(spaceId: string, threadId: string | null): Promise<SpaceLeadView> {
    this.space(spaceId);
    return this.serial(spaceId, async () => {
      const run = this.runs.get(spaceId);
      if (threadId) {
        const thread = await this.thread(threadId);
        if (!thread) throw new Error("That thread no longer exists.");
        // Move the heartbeat first: if it can't target the new thread, the old lead stays.
        if (run?.enabled) await this.runs.set(spaceId, threadId, run);
        if (this.spaceOf({ id: threadId, projectId: thread.projectId ?? null }) !== spaceId) this.join(spaceId, threadId);
        this.saveLead(spaceId, threadId);
      } else {
        if (run?.enabled) await this.runs.set(spaceId, null, { ...run, enabled: false });
        this.saveLead(spaceId, null);
      }
      this.threadsChanged();
      this.deps.changed();
      return this.read(spaceId);
    });
  }

  setRun(spaceId: string, input: { enabled: boolean; cadence: SpaceRun["cadence"]; time?: string; cron?: string }): Promise<SpaceLeadView> {
    this.space(spaceId);
    return this.serial(spaceId, async () => {
      const current = await this.read(spaceId);
      if (input.enabled && !current.leadThreadId) throw new Error("Pick the space's lead before turning on its heartbeat.");
      await this.runs.set(spaceId, current.leadThreadId, { enabled: input.enabled, cadence: input.cadence, time: input.time ?? current.run?.time ?? "09:00", cron: input.cron ?? current.run?.cron });
      return this.read(spaceId);
    });
  }

  /**
   * Turns the heartbeat off and forgets the lead before the space goes. A
   * heartbeat that can't be turned off throws and keeps its row, so the
   * automation isn't orphaned and deleting can be retried.
   */
  removeSpace(spaceId: string): Promise<void> {
    return this.serial(spaceId, async () => {
      // Checked here, not only in SpaceStore.remove: that runs after the lead and heartbeat are gone.
      if (this.deps.spaces.get(spaceId)?.isDefault) throw new Error("The default space can't be deleted.");
      const run = this.runs.get(spaceId);
      if (run?.enabled) await this.runs.set(spaceId, null, { ...run, enabled: false });
      this.deps.db.prepare("DELETE FROM space_leads WHERE space_id = ?").run(spaceId);
      this.deps.db.prepare("DELETE FROM space_runs WHERE space_id = ?").run(spaceId);
    });
  }

  /** Where a thread is: its space's id. */
  private spaceOf(thread: { id: string; projectId: string | null }) {
    return this.deps.spaces.ownerOfThread(thread);
  }

  private async list(args: { projectId?: string; archived?: boolean }): Promise<Listed[]> {
    const all: Listed[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.deps.sdk.threads.list({ ...args, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return all;
  }

  /** Threads whose space may have changed without a membership write: new, archived, deleted. */
  threadsChanged(): void {
    this.snapshot = null;
  }

  /** The one space each open thread (and each thread added to a space) is in. Cached until membership changes. */
  spaceOfThreads(): Promise<Record<string, string>> {
    const fingerprint = this.deps.spaces.threads.fingerprint();
    if (this.snapshot && this.snapshot.fingerprint === fingerprint && Date.now() - this.snapshot.at < SNAPSHOT_MS) return this.snapshot.threads;
    const threads = (async () => {
      const result: Record<string, string> = {};
      const owners = this.deps.spaces.threads.all();
      const spaces = this.deps.spaces.list();
      const byProject = new Map(spaces.flatMap((space) => space.projectIds.map((projectId) => [projectId, space.id] as const)));
      const fallback = spaces.find((space) => space.isDefault)?.id ?? null;
      for (const thread of await this.list({ archived: false })) {
        const owner = owners.get(thread.id) ?? byProject.get(thread.projectId ?? PERSONAL_PROJECT_ID) ?? fallback;
        if (owner) result[thread.id] = owner;
      }
      for (const [threadId, spaceId] of owners) result[threadId] = spaceId;
      return result;
    })();
    const snapshot = { at: Date.now(), fingerprint, threads };
    this.snapshot = snapshot;
    threads.catch(() => { if (this.snapshot === snapshot) this.snapshot = null; });
    return threads;
  }

  handoff(threadId: string, request: NewThreadRequestInput): Promise<{ threadId: string }> {
    const db = this.deps.db;
    const ledSpace = (db.prepare("SELECT space_id FROM space_leads WHERE lead_thread_id = ? UNION SELECT space_id FROM space_thread_handoffs WHERE old_thread_id = ? AND lead = 1 AND space_id IS NOT NULL").get(threadId, threadId) as { space_id: string } | undefined)?.space_id ?? null;
    return this.serial(ledSpace ?? `thread:${threadId}`, async () => {
      const previous = db.prepare("SELECT new_thread_id, archived FROM space_thread_handoffs WHERE old_thread_id = ?").get(threadId) as { new_thread_id: string; archived: number } | undefined;
      const old = await this.deps.sdk.threads.get({ threadId });
      const spaceId = ledSpace ?? this.spaceOf({ id: threadId, projectId: old.projectId ?? null });
      const space = this.deps.spaces.get(spaceId);
      const explicit = this.deps.spaces.threads.explicit(threadId) === spaceId;
      let newId = previous?.new_thread_id;
      if (!newId) {
        const { output } = await this.deps.sdk.threads.output({ threadId });
        const summary = [
          `Continue the work from /threads/${encodeURIComponent(threadId)} (${threadTitle(old)}). Read that thread with bb thread if you need more context.`,
          `Latest response (excerpt):\n${(output ?? "No response yet.").slice(-12_000)}`,
          space ? `This thread is in the space ${space.name} (${space.id}).` : "",
          ledSpace && space ? `You are now this space's lead. Steer the workers you start (read but don't steer threads the user started), and report in this thread.` : "",
        ].filter(Boolean).join("\n\n");
        const next = await this.deps.sdk.threads.spawn({
          ...request,
          projectId: old.projectId,
          title: old.title ?? "Handoff",
          pluginMetadata: { ...(ledSpace ? { role: LEAD_ROLE, spaceId: ledSpace } : {}), handoffFrom: threadId },
          input: [{ type: "text", text: summary, mentions: [], visibility: "agent-only" }, ...request.input],
        });
        newId = next.id;
        db.prepare("INSERT INTO space_thread_handoffs (old_thread_id, new_thread_id, space_id, lead) VALUES (?, ?, ?, ?)").run(threadId, newId, space ? spaceId : null, ledSpace ? 1 : 0);
      }
      // The successor stays where the old thread was: a lead and an added thread explicitly, others through the project.
      if (space && (ledSpace || explicit)) this.join(spaceId, newId);
      if (ledSpace && space) {
        this.saveLead(ledSpace, newId);
        await this.deps.sdk.threads.unpin({ threadId: newId }).catch(() => {});
        const run = this.runs.get(ledSpace);
        if (run?.enabled) await this.runs.set(ledSpace, newId, run);
      }
      if (!previous?.archived) {
        await this.deps.sdk.threads.archive({ threadId });
        db.prepare("UPDATE space_thread_handoffs SET archived = 1 WHERE old_thread_id = ?").run(threadId);
      }
      this.threadsChanged();
      this.deps.changed();
      return { threadId: newId };
    });
  }
}

type RunRow = Omit<SpaceRun, "cron"> & { cron: string | null; space_id: string; enabled: number | boolean; automation_id: string | null; automation_project_id: string | null };
const automation = z.object({ id: z.string(), name: z.string() });

/** Automations owns the schedule; this table keeps its settings and identity. */
export class SpaceRuns {
  private pending = new Map<string, Promise<void>>();
  constructor(private db: Database.Database, private sdk: Sdk, private changed: () => void) {}

  private row(spaceId: string) {
    return this.db.prepare("SELECT space_id, enabled, cadence, time, cron, automation_id, automation_project_id FROM space_runs WHERE space_id = ?").get(spaceId) as RunRow | undefined;
  }

  get(spaceId: string): SpaceRun | null {
    const row = this.row(spaceId);
    return row ? { enabled: !!row.enabled, cadence: row.cadence, time: row.time, ...(row.cron == null ? {} : { cron: row.cron }) } : null;
  }

  private call<T>(method: string, input: unknown, outputSchema: z.ZodType<T>) {
    return this.sdk.plugins.callRpc({ pluginId: "automations", method, input: input as never, outputSchema });
  }

  set(spaceId: string, leadThreadId: string | null, run: SpaceRun): Promise<void> {
    const next = (this.pending.get(spaceId) ?? Promise.resolve()).catch(() => {}).then(() => this.provision(spaceId, leadThreadId, run));
    this.pending.set(spaceId, next);
    void next.finally(() => { if (this.pending.get(spaceId) === next) this.pending.delete(spaceId); }).catch(() => {});
    return next;
  }

  private async provision(spaceId: string, leadThreadId: string | null, run: SpaceRun) {
    // Validate before any stored state or existing automation is changed, even when off.
    run = spaceRunSchema.parse(run);
    if (run.cadence === "custom" && !run.cron) throw new Error("Custom check-ins require a valid five-field cron expression.");
    const row = this.row(spaceId);
    if (!run.enabled || !leadThreadId) {
      if (row?.automation_id) {
        await this.call("automations_delete", { projectId: row.automation_project_id, automationId: row.automation_id }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
      }
      this.db
        .prepare("INSERT INTO space_runs (space_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES (?, 0, ?, ?, ?, NULL, NULL) ON CONFLICT (space_id) DO UPDATE SET enabled = 0, cadence = excluded.cadence, time = excluded.time, cron = excluded.cron, automation_id = NULL, automation_project_id = NULL")
        .run(spaceId, run.cadence, run.time, run.cron ?? null);
      this.changed();
      return;
    }
    const [thread, defaults] = await Promise.all([this.sdk.threads.get({ threadId: leadThreadId }), this.sdk.threads.defaultExecutionOptions({ threadId: leadThreadId })]);
    if (!thread.providerId || !defaults?.model) throw new Error("Choose a provider and model for the lead before turning on its heartbeat.");
    const cron = heartbeatCron(run);
    const trigger = { triggerType: "schedule", cron, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const execution = {
      mode: "agent", providerId: thread.providerId, model: defaults.model, reasoningLevel: defaults.reasoningLevel ?? "medium",
      permissionMode: defaults.permissionMode ?? "accept-edits", environment: { type: "project-default" }, targetThreadId: leadThreadId,
      prompt: `${HEARTBEAT}\nSpace: ${spaceId}.`,
    };
    const name = `Studio space heartbeat ${spaceId}`;
    let automationId = row?.automation_id ?? null;
    if (automationId && row?.automation_project_id !== thread.projectId) {
      await this.call("automations_delete", { projectId: row?.automation_project_id, automationId }, z.unknown()).catch((error) => { if (!missing(error)) throw error; });
      automationId = null;
      this.db.prepare("UPDATE space_runs SET automation_id = NULL, automation_project_id = NULL WHERE space_id = ?").run(spaceId);
    }
    if (!automationId) {
      // Found by its stable name, so a lost create response doesn't make a second one.
      const existing = (await this.call("automations_list", { projectId: thread.projectId }, z.array(automation))).filter((each) => each.name === name);
      if (existing.length > 1) throw new Error("This space has more than one heartbeat automation.");
      automationId = existing[0]?.id ?? (await this.call("automations_create", { projectId: thread.projectId, name, enabled: false, origin: "app", trigger, execution }, automation)).id;
      this.db.prepare("INSERT OR IGNORE INTO space_runs (space_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES (?, 0, ?, ?, ?, NULL, NULL)").run(spaceId, run.cadence, run.time, run.cron ?? null);
      this.db.prepare("UPDATE space_runs SET automation_id = ?, automation_project_id = ? WHERE space_id = ?").run(automationId, thread.projectId, spaceId);
    }
    await this.call("automations_update", { projectId: thread.projectId, automationId, trigger, execution }, z.unknown());
    await this.call("automations_resume", { projectId: thread.projectId, automationId }, z.unknown());
    this.db.prepare("UPDATE space_runs SET enabled = 1, cadence = ?, time = ?, cron = ? WHERE space_id = ?").run(run.cadence, run.time, run.cron ?? null, spaceId);
    this.changed();
  }
}

function heartbeatCron(run: SpaceRun): string {
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
