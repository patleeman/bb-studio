// Built-in Bot housekeeping. Every destructive decision is recomputed before
// execution; unknown ownership, targets or workspace status fail closed.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { scheduleKey, type EngineScheduler } from "./triggers/scheduler";
import { archiveQuietly } from "./bot-finish";

type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
const DAY = 86_400_000;
/** "1 finished thread", "2 workers". */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export const maintenanceRules = ["threads", "workers", "automations", "memory", "skills", "adopt"] as const;
export type MaintenanceRule = typeof maintenanceRules[number];
export interface MaintenanceSettings { enabled: boolean; enabledAt: number | null; memoryWords: number; rules: Record<MaintenanceRule, boolean> }
export interface MaintenanceRun { at: number; dryRun: boolean; summary: string; actions: string[]; needsCall: { threadId: string; title: string; reason: string }[]; suggestions: { text: string; threadId?: string; automationId?: string }[] }
export interface MaintenanceView { settings: MaintenanceSettings; liveAt: number | null; runs: MaintenanceRun[] }
export function maintenanceDefaults(): MaintenanceSettings { return { enabled: false, enabledAt: null, memoryWords: 8000, rules: Object.fromEntries(maintenanceRules.map((rule) => [rule, true])) as MaintenanceSettings["rules"] }; }
export function maintenanceDryRun(settings: MaintenanceSettings, now: number): boolean { return !settings.enabled || settings.enabledAt === null || now < settings.enabledAt + DAY; }
export function finished(thread: Pick<Thread, "status" | "hasPendingInteraction" | "activity" | "queuedWork">, targeted: boolean, interactions: readonly { status: string }[]): boolean {
  return thread.status === "idle" && !thread.hasPendingInteraction && !targeted && thread.queuedWork === "none" && Object.values(thread.activity).every((count) => count === 0) && !interactions.some((i) => i.status === "pending" || i.status === "resolving");
}
export function archiveAge(worker: boolean, captured: boolean, ownerReplied: boolean): number { return (worker ? ownerReplied ? 1 : 3 : captured ? 3 : 7) * DAY; }
const changedFile = z.object({ path: z.string(), status: z.string() }).passthrough();
/**
 * An environment's git status from BB's Git plugin (`bb--git`'s
 * `workspaceStatus` RPC). SDK 0.6.104 dropped `environments.status`; git
 * moved to that plugin. Only the fields the checks read are required.
 */
const workspaceStatusSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("available"),
    workspace: z.object({
      checkout: z.object({ kind: z.string(), branchName: z.string().nullish() }).passthrough(),
      workingTree: z.object({ files: z.array(changedFile) }).passthrough(),
      mergeBase: z.object({ mergeBaseBranch: z.string(), aheadCount: z.number(), files: z.array(changedFile) }).passthrough().nullish(),
    }).passthrough(),
  }).passthrough(),
  z.object({ outcome: z.literal("not_applicable") }).passthrough(),
  z.object({ outcome: z.literal("unavailable") }).passthrough(),
]);
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;
export const GIT_PLUGIN_ID = "bb--git";
export const PULL_REQUEST_PLUGIN_ID = "bb--github-pr-status";
/**
 * Why a workspace must not be archived, or null. Only real work blocks:
 * uncommitted changes to tracked files, or commits ahead of this branch's
 * own remote-tracking ref. Untracked scratch files, non-git workspaces and
 * workspaces that are gone don't block. A status that couldn't be read at
 * all (the call failed, the Git plugin is off or answered something else:
 * null) does block: it fails closed.
 */
export function workspaceBlock(status: WorkspaceStatus | null): string | null {
  if (status === null) return "Couldn't read the workspace's git status.";
  if (status.outcome !== "available") return null;
  const { checkout, mergeBase, workingTree } = status.workspace;
  const tracked = workingTree.files.filter((f) => f.status !== "??" && f.status !== "?");
  if (tracked.length) return `Uncommitted changes to ${count(tracked.length, "tracked file")}.`;
  // No upstream/push count: only a remote-tracking ref for this exact
  // branch proves which commits are unpushed. `baseRef` is a SHA.
  const remote = mergeBase && !mergeBase.mergeBaseBranch.startsWith("refs/heads/") ? /^(?:refs\/remotes\/)?[^/]+\/(.+)$/.exec(mergeBase.mergeBaseBranch)?.[1] : undefined;
  if (checkout.kind === "branch" && remote === checkout.branchName && mergeBase!.aheadCount > 0 && mergeBase!.files.length) return `${count(mergeBase!.aheadCount, "unpushed commit")}.`;
  return null;
}
/**
 * A thread environment's git status through the Git plugin, compared with
 * `mergeBaseBranch` when given. Null when it can't be read (fails closed in
 * workspaceBlock).
 */
export async function readWorkspaceStatus(plugins: Pick<Sdk["plugins"], "callRpc">, environmentId: string, mergeBaseBranch?: string): Promise<WorkspaceStatus | null> {
  return Promise.resolve()
    .then(() => plugins.callRpc({ pluginId: GIT_PLUGIN_ID, method: "workspaceStatus", input: { environmentId, ...mergeBaseBranch ? { mergeBaseBranch } : {} }, outputSchema: workspaceStatusSchema }))
    .then((status) => workspaceStatusSchema.parse(status))
    .catch(() => null);
}
const pullRequestRows = z.record(z.string(), z.object({ outcome: z.string(), pullRequest: z.object({ attention: z.string() }).passthrough().optional() }).passthrough());
/**
 * Whether a thread environment's pull request is merged, through the GitHub
 * PR plugin (`pullRequests` RPC). False when there's none or it can't be read:
 * a merged PR only shortens how long a thread is kept, so unknown is safe.
 */
export async function pullRequestMerged(plugins: Pick<Sdk["plugins"], "callRpc">, environmentId: string): Promise<boolean> {
  return Promise.resolve()
    .then(() => plugins.callRpc({ pluginId: PULL_REQUEST_PLUGIN_ID, method: "pullRequests", input: { keys: [environmentId] }, outputSchema: pullRequestRows }))
    .then((rows) => { const row = pullRequestRows.parse(rows)[environmentId]; return row?.outcome === "available" && row.pullRequest?.attention === "merged"; })
    .catch(() => false);
}
export function memoryNeedsTidy(text: string, budget: number, updatedAt: number, now: number): boolean {
  const dates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => Date.parse(m[1]!)).filter(Number.isFinite);
  return text.trim().split(/\s+/).filter(Boolean).length > budget || (text.trim().length > 0 && now - Math.min(updatedAt, ...dates) >= 60 * DAY);
}
const automation = z.object({ id: z.string(), name: z.string().optional(), updatedAt: z.number().optional(), enabled: z.boolean(), lastRunAt: z.number().nullish(), nextRunAt: z.number().nullish(), lastRunStatus: z.string().nullish(), createdByThreadId: z.string().nullish(), execution: z.object({ targetThreadId: z.string().nullish(), prompt: z.string().optional() }).passthrough(), trigger: z.object({ cron: z.string().optional() }).passthrough() }).passthrough();
const overview = z.object({ automations: z.array(z.object({ automation, project: z.object({ id: z.string() }).passthrough() }).passthrough()) }).passthrough();
export interface MaintenanceDeps {
  db: Database.Database; sdk: Sdk; changed(): void;
  /** Studio's scheduler: check-ins and reminders run there (a `trg_` id in bb_ids), so their state and runs are read from it. */
  scheduler: EngineScheduler;
  bots(): { id: string; threadId: string | null; state: string; kind?: string }[];
  owned(botId: string): ReadonlySet<string>;
  refreshOwned(): Promise<unknown>;
  memory(botId: string): { id: string; markdown: string; updatedAt: number } | null;
  curate(botId: string, dryRun: boolean): Promise<{ result: string }>;
  automationPause(id: string, botId: string): Promise<unknown>;
  automationDelete(id: string, botId: string): Promise<unknown>;
  adoptable(botId: string): Promise<{ threadId: string; title: string; automationId: string; cron: string | null }[]>;
  alert(botId: string, line: string): Promise<void>;
}
const signatureOf = (value: unknown): string => JSON.stringify(value, (_key, part) => part && typeof part === "object" && !Array.isArray(part) ? Object.fromEntries(Object.keys(part).sort().map((key) => [key, part[key]])) : part);
type LocalAutomation = { model: string | null; provider_id: string | null; reasoning: string | null; id: string; name: string; kind: string; state: string; instruction: string; target: string; target_thread_id: string | null; updated_at: number; last_fired_at: number | null; schedule_json: string; bb_ids: string; project_id: string };
export class BotMaintenance {
  private running = new Set<string>();
  constructor(private readonly deps: MaintenanceDeps) {}
  view(botId: string): MaintenanceView {
    const row = this.deps.db.prepare("SELECT settings FROM bot_maintenance_settings WHERE bot_id = ? ORDER BY id DESC LIMIT 1").get(botId) as { settings: string } | undefined;
    const saved = row ? JSON.parse(row.settings) as Partial<MaintenanceSettings> : {};
    const defaults = maintenanceDefaults();
    const settings: MaintenanceSettings = {
      enabled: saved.enabled ?? defaults.enabled,
      enabledAt: saved.enabledAt ?? defaults.enabledAt,
      memoryWords: saved.memoryWords ?? defaults.memoryWords,
      rules: Object.fromEntries(maintenanceRules.map((rule) => [rule, saved.rules?.[rule] ?? defaults.rules[rule]])) as MaintenanceSettings["rules"],
    };
    const runs = (this.deps.db.prepare("SELECT result FROM bot_maintenance_runs WHERE bot_id = ? ORDER BY id DESC LIMIT 30").all(botId) as { result: string }[]).map((r) => JSON.parse(r.result) as MaintenanceRun);
    return { settings, liveAt: settings.enabled && settings.enabledAt !== null ? settings.enabledAt + DAY : null, runs };
  }
  async set(botId: string, patch: { enabled?: boolean; memoryWords?: number; rules?: Partial<Record<MaintenanceRule, boolean>> }, now = Date.now()): Promise<MaintenanceView> {
    const previous = this.view(botId).settings;
    const settings = { ...previous, ...patch, rules: { ...previous.rules, ...patch.rules }, enabledAt: patch.enabled === true && !previous.enabled ? now : previous.enabledAt };
    this.deps.db.prepare("INSERT INTO bot_maintenance_settings (bot_id, at, settings) VALUES (?, ?, ?)").run(botId, now, JSON.stringify(settings));
    this.deps.changed();
    if (settings.enabled && !previous.enabled) await this.run(botId, { dryRun: true, now });
    return this.view(botId);
  }
  async olderThreads(botId: string) {
    const threads: Thread[] = [];
    const owned = this.deps.owned(botId);
    for (const archived of [false, true]) for (let offset = 0; ; offset += 200) {
      const batch = await this.deps.sdk.threads.list({ archived, includeHidden: true, limit: 200, offset });
      threads.push(...batch.filter((t) => owned.has(t.id) && (t.archivedAt || Date.now() - t.updatedAt >= 7 * DAY) && !t.hasPendingInteraction && t.status === "idle"));
      if (batch.length < 200) break;
    }
    return threads.map((t) => ({ id: t.id, title: t.title || t.titleFallback || "Untitled thread", status: t.status, providerId: t.providerId ?? null, projectId: t.projectId, updatedAt: t.updatedAt, relation: "started" as const, parentId: null }));
  }
  async tick(now = Date.now(), heartbeatBotId?: string): Promise<void> {
    for (const bot of this.deps.bots()) {
      if (heartbeatBotId && heartbeatBotId !== bot.id) continue;
      const view = this.view(bot.id);
      if (!view.settings.enabled || bot.state !== "active" || bot.kind === "external") continue;
      const last = view.runs[0];
      const date = new Date(now);
      if (!heartbeatBotId && date.getHours() < 4) continue;
      if (last && new Date(last.at).toDateString() === date.toDateString()) continue;
      const boundary = new Date(now); boundary.setHours(4, 0, 0, 0);
      if (date < boundary) boundary.setDate(boundary.getDate() - 1);
      if (heartbeatBotId ? last && new Date(last.at).toDateString() === date.toDateString() : last && last.at >= boundary.getTime()) continue;
      await this.run(bot.id, { now });
    }
  }
  /**
   * BB's own automations, for the threads they wake. When the automations
   * plugin is confirmed off or absent there are none, so the list is empty.
   * Any other failure still throws: never archive against an unknown list.
   */
  private async bbAutomations() {
    try {
      return await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_overview", input: null, outputSchema: overview });
    } catch (error) {
      let plugins: { id: string; enabled: boolean }[] | null = null;
      try { plugins = (await this.deps.sdk.plugins.list()).plugins; } catch { plugins = null; }
      if (plugins === null || plugins.some((plugin) => plugin.id === "automations" && plugin.enabled)) throw error;
      return { automations: [] } as z.infer<typeof overview>;
    }
  }

  async run(botId: string, options: { dryRun?: boolean; now?: number } = {}): Promise<MaintenanceRun | null> {
    const bot = this.deps.bots().find((b) => b.id === botId);
    if (!bot || bot.state !== "active" || bot.kind === "external" || this.running.has(botId)) return null;
    const now = options.now ?? Date.now();
    const settings = this.view(botId).settings;
    const dryRun = options.dryRun === true || maintenanceDryRun(settings, now);
    this.running.add(botId);
    const result: MaintenanceRun = { at: now, dryRun, summary: "", actions: [], needsCall: [], suggestions: [] };
    let recorded = false;
    try {
      const act = async (text: string, apply: () => Promise<unknown> | unknown) => { if (!dryRun) await apply(); result.actions.push(text); };
      if (!dryRun) await this.deps.refreshOwned();
      // If the overview is unavailable, abort. Never archive against an incomplete target list.
      const external = await this.bbAutomations();
      const targets = new Set(external.automations.filter((a) => a.automation.enabled).flatMap((a) => a.automation.execution.targetThreadId ? [a.automation.execution.targetThreadId] : []));
      const locals = this.deps.db.prepare("SELECT * FROM bot_automations WHERE bot_id = ? ORDER BY created_at, id").all(botId) as LocalAutomation[];
      for (const row of this.deps.db.prepare("SELECT target_thread_id FROM bot_automations WHERE state = 'active'").all() as { target_thread_id: string | null }[]) if (row.target_thread_id) targets.add(row.target_thread_id);
      for (const row of this.deps.db.prepare("SELECT thread_id FROM bot_runners").all() as { thread_id: string | null }[]) if (row.thread_id) targets.add(row.thread_id);
      // Heartbeats run on Studio's scheduler, so BB's overview no longer lists the leads they wake.
      for (const row of this.deps.db.prepare("SELECT lead_thread_id FROM project_runs WHERE enabled = 1").all() as { lead_thread_id: string | null }[]) if (row.lead_thread_id) targets.add(row.lead_thread_id);
      const running = new Set((await this.deps.sdk.threads.listRunning()).map((t) => t.id));
      const owned = this.deps.owned(botId);
      const listed = new Map<string, Thread>();
      for (let offset = 0; ; offset += 200) {
        const batch = await this.deps.sdk.threads.list({ archived: false, includeHidden: true, limit: 200, offset });
        for (const thread of batch) listed.set(thread.id, thread);
        if (batch.length < 200) break;
      }
      let archived = 0, workers = 0;
      const archiving = new Set<string>();
      for (const id of owned) {
        const thread = listed.get(id);
        if (!thread || thread.archivedAt || running.has(id)) continue;
        const worker = thread.visibility === "hidden" && (!!thread.lifecycleOwnerThreadId || !!thread.sourceThreadId || /skill review|worker|sub.agent/i.test(thread.title ?? ""));
        if (!(worker ? settings.rules.workers : settings.rules.threads)) continue;
        const interactions = await this.deps.sdk.threads.interactions.list({ threadId: id });
        if (!finished(thread, targets.has(id), interactions)) continue;
        const plans = await this.deps.sdk.threads.events.list({ threadId: id, order: "desc", limit: "1", types: ["turn/plan/updated"] });
        if (plans.some((p) => (p.data as { plan?: { status: string }[] }).plan?.some((s) => s.status !== "completed"))) continue;
        let captured = !!this.deps.db.prepare("SELECT 1 FROM item_threads WHERE thread_id = ? LIMIT 1").get(id);
        if (!captured && thread.environmentId) {
          captured = await pullRequestMerged(this.deps.sdk.plugins, thread.environmentId);
        }
        const ownerId = thread.lifecycleOwnerThreadId ?? thread.parentThreadId ?? thread.sourceThreadId;
        const owner = worker && ownerId ? await this.deps.sdk.threads.get({ threadId: ownerId }).catch(() => null) : null;
        // updatedAt can change on rename: require a real owner turn after the worker.
        const replies = owner ? await this.deps.sdk.threads.events.list({ threadId: owner.id, order: "desc", limit: "1", types: ["turn/completed"] }) : [];
        const ownerReplied = replies.some((e) => e.createdAt > thread.updatedAt);
        if (now - thread.updatedAt < archiveAge(worker, captured, ownerReplied)) continue;
        const fresh = await this.deps.sdk.threads.get({ threadId: id });
        if (fresh.archivedAt || fresh.environmentId !== thread.environmentId || fresh.queuedMessageCount > 0 || fresh.updatedAt !== thread.updatedAt || fresh.status !== "idle" || fresh.activeBackgroundAgentCount > 0 || (await this.deps.sdk.threads.interactions.list({ threadId: id })).some((i) => i.status === "pending" || i.status === "resolving")) continue;
        const live = await this.bbAutomations();
        if (live.automations.some((a) => a.automation.enabled && a.automation.execution.targetThreadId === id)) continue;
        if (thread.environmentId) {
          // A missing or failing status call reads as null, which blocks (fails closed).
          const status = await readWorkspaceStatus(this.deps.sdk.plugins, thread.environmentId, thread.environmentBranchName ? `origin/${thread.environmentBranchName}` : undefined);
          const reason = workspaceBlock(status);
          if (reason) { result.needsCall.push({ threadId: id, title: thread.title || thread.titleFallback || id, reason }); continue; }
        }
        if (!this.deps.owned(botId).has(id) || this.deps.bots().find((b) => b.id === botId)?.state !== "active") continue;
        // BB archives a thread's children with it: wait until none are left open.
        if ([...listed.values()].some((t) => t.parentThreadId === id && !t.archivedAt && !archiving.has(t.id))) continue;
        archiving.add(id);
        await act(`Archive ${worker ? "worker" : "thread"}: ${thread.title || id}`, () => archiveQuietly(id, () => this.deps.sdk.threads.archive({ threadId: id })));
        if (worker) workers++; else archived++;
      }
      if (settings.rules.automations) {
        const seen = new Set<string>();
        for (const row of locals) {
          const age = now - row.updated_at;
          if (row.kind === "reminder" && row.state === "done" && age >= 14 * DAY) { await act(`Delete done reminder: ${row.name}`, () => this.deps.automationDelete(row.id, botId)); continue; }
          if (row.state === "paused" && age >= 30 * DAY) result.suggestions.push({ text: `Suggest delete: ${row.name} (disabled over 30 days)` });
          if (row.state === "ended" && row.kind === "checkin") await act(`Move finished check-in to Done: ${row.name}`, () => this.deps.db.prepare("UPDATE bot_automations SET state = 'done', updated_at = ? WHERE id = ?").run(now, row.id));
          if (row.state !== "active") continue;
          if (row.kind === "reminder") {
            const bbIds = JSON.parse(row.bb_ids) as string[];
            const backing = external.automations.filter((a) => bbIds.includes(a.automation.id)).map((a) => a.automation);
            const keys = bbIds.map((id) => scheduleKey(id));
            // Studio's own: the trigger is done once the reminder ran. BB's (from before the move): it ran and has no next run.
            const ran = keys.length > 0 && keys.every((key) => !!key) ? keys.every((key) => { const status = this.deps.scheduler.status(key!); return status.done && status.lastRunStatus === "succeeded"; })
              : backing.length === bbIds.length && backing.length > 0 && backing.every((a) => a.lastRunAt && a.lastRunStatus === "succeeded" && !a.nextRunAt);
            if (ran) {
              await act(`Move done reminder to Done: ${row.name}`, () => this.deps.db.prepare("UPDATE bot_automations SET state = 'done', updated_at = ? WHERE id = ?").run(now, row.id));
            }
            continue;
          }
          const targetId = row.target === "main" ? bot.threadId : (this.deps.db.prepare("SELECT thread_id FROM bot_runners WHERE id = ?").get(row.target) as { thread_id: string | null } | undefined)?.thread_id;
          const target = targetId ? await this.deps.sdk.threads.get({ threadId: targetId }).catch((error) => { if ((error as { status?: number }).status === 404 || /not found/i.test(String(error))) return null; throw error; }) : null;
          const retired = !target || !!target.archivedAt;
          const signature = signatureOf([row.project_id, targetId, row.kind, JSON.parse(row.schedule_json), row.instruction.trim(), row.provider_id, row.model, row.reasoning, row.kind === "watcher" ? row.id : ""]);
          const duplicate = seen.has(signature); seen.add(signature);
          if (retired || duplicate) { await act(`Pause ${retired ? "retired target" : "duplicate"}: ${row.name}`, () => this.deps.automationPause(row.id, botId)); result.suggestions.push({ text: `${row.name}: ${retired ? "target retired or missing" : "duplicate schedule, instruction and target"}` }); continue; }
          const ids = JSON.parse(row.bb_ids) as string[];
          const runs = (await Promise.all(ids.map((automationId) => { const key = scheduleKey(automationId); return key ? { runs: this.deps.scheduler.runs(key, 10) } : this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_runs", input: { projectId: row.project_id, automationId, limit: 10 }, outputSchema: z.object({ runs: z.array(z.object({ status: z.string(), output: z.string().nullish(), finishedAt: z.number().nullish() }).passthrough()) }).passthrough() }); }))).flatMap((p): { status: string; output?: string | null; finishedAt?: number | null }[] => p.runs).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)).slice(0, 10);
          if (runs.length === 10 && runs.every((r) => r.status === "succeeded" && (!r.output?.trim() || r.output.trim() === "[PASS]"))) result.suggestions.push({ text: `Review ${row.name}: no useful output in its last 10 runs` });
        }
      }
      if (settings.rules.automations) {
        const localIds = new Set(locals.flatMap((r) => JSON.parse(r.bb_ids) as string[]));
        const seen = new Set<string>();
        for (const entry of external.automations) {
          const a = entry.automation;
          if (localIds.has(a.id) || !a.createdByThreadId || (a.createdByThreadId !== bot.threadId && !owned.has(a.createdByThreadId))) continue;
          const name = a.name ?? a.id;
          if (!a.enabled) { if (a.updatedAt && now - a.updatedAt >= 30 * DAY) result.suggestions.push({ text: `Suggest delete: ${name} (disabled over 30 days)` }); continue; }
          if (!a.trigger.cron) continue;
          const targetId = a.execution.targetThreadId;
          const target = targetId ? await this.deps.sdk.threads.get({ threadId: targetId }).catch((error) => { if ((error as { status?: number }).status === 404 || /not found/i.test(String(error))) return null; throw error; }) : undefined;
          const retired = targetId ? !target || !!target.archivedAt : false;
          const signature = signatureOf([entry.project.id, a.trigger, { ...a.execution, prompt: a.execution.prompt?.trim() }]);
          const duplicate = !!a.execution.prompt && seen.has(signature); seen.add(signature);
          if (retired || duplicate) {
            await act(`Pause ${retired ? "retired target" : "duplicate"}: ${name}`, () => this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_pause", input: { projectId: entry.project.id, automationId: a.id }, outputSchema: z.unknown() }));
            result.suggestions.push({ text: `${name}: ${retired ? "target retired or missing" : "duplicate schedule, instruction and target"}` });
            continue;
          }
          const page = await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_runs", input: { projectId: entry.project.id, automationId: a.id, limit: 10 }, outputSchema: z.object({ runs: z.array(z.object({ status: z.string(), output: z.string().nullish() }).passthrough()) }).passthrough() });
          if (page.runs.length === 10 && page.runs.every((r) => r.status === "succeeded" && (!r.output?.trim() || r.output.trim() === "[PASS]"))) result.suggestions.push({ text: `Review ${name}: no useful output in its last 10 runs` });
        }
      }

      // Do not stop threads based solely on their last update time.
      if (settings.rules.memory && bot.threadId) {
        const memory = this.deps.memory(botId);
        if (memory && memoryNeedsTidy(memory.markdown, settings.memoryWords, memory.updatedAt, now)) await act("Memory tidy requested", () => this.deps.sdk.threads.send({ threadId: bot.threadId!, mode: "auto", input: [{ type: "text", text: `Maintenance: rewrite Memory page ${memory.id}. Merge duplicates, drop entries older than 60 days that are stale or contradicted, preserve useful facts, and stay under ${settings.memoryWords} words. Page history preserves the old version. Reply exactly [PASS].`, mentions: [], visibility: "agent-only" }] }));
      }
      if (settings.rules.skills) { const skills = await this.deps.curate(botId, dryRun); result.actions.push(`Skills: ${skills.result.replace(/^Dry run: /, "")}`); }
      if (settings.rules.adopt) for (const candidate of await this.deps.adoptable(botId)) if (candidate.cron) result.suggestions.push({ text: `Consider adopting ${candidate.title} as a runner`, threadId: candidate.threadId, automationId: candidate.automationId });
      result.summary = `${dryRun ? "Dry run: would archive" : "Archived"} ${count(archived, "finished thread")}, ${count(workers, "worker")}; ${result.actions.filter((a) => !a.startsWith("Archive")).join("; ") || "nothing else to tidy"}`;
      this.deps.db.prepare("INSERT INTO bot_maintenance_runs (bot_id, at, result) VALUES (?, ?, ?)").run(botId, now, JSON.stringify(result));
      recorded = true;
      this.deps.changed();
      if (!dryRun && result.needsCall.length) await this.deps.alert(botId, `Maintenance: ${result.needsCall.length} threads need your call in Bot info → Maintenance.`);
      return result;
    } catch (error) {
      if (recorded) throw error;
      result.summary = `${dryRun ? "Dry run" : "Maintenance"} stopped: ${error instanceof Error ? error.message : String(error)}`;
      this.deps.db.prepare("INSERT INTO bot_maintenance_runs (bot_id, at, result) VALUES (?, ?, ?)").run(botId, now, JSON.stringify(result));
      this.deps.changed();
      return result;
    } finally { this.running.delete(botId); }
  }
}
